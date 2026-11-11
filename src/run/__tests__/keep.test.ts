// What you set stays set: a check-in level changed mid-run, task edits across a crew change, and a path you add back.
import { beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

// The Planner, simulated, for the crew you ask for.
vi.mock('../agent', async (orig) => {
  const real = await orig<typeof import('../agent')>()
  const { simulatePlan } = await import('../simPlan')
  return { ...real, getLiveMode: () => false, plan: async (goal: string, crew?: number | import('../types').FarmerId[]) => ({ data: simulatePlan(goal, crew), live: false }) }
})

import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store } from '../store'
import { planInto } from '../planning'
import { applyEdit, emptyEdit, turnPath } from '../kit'
import type { FarmerSetup } from '../types'
import { AUTONOMY_PRESETS } from '../types'

function plan(goal: string) {
  const p = store.newProject(goal)
  const pl = simulatePlan(goal)
  store.setPlan(p.id, pl.name, pl.farmers, pl.tasks, pl.estimate, pl.singleAgentEstimate)
  return p
}
const tasksOf = (id: string) => {
  const e = store.project(id)!.events.find((x) => x.type === 'plan')
  return e && e.type === 'plan' ? e.tasks : []
}

describe('the check-in level, changed mid-run', () => {
  it('keeps the run, its clock and your answers, and applies from the next run', () => {
    const p = plan(SAMPLE_GOAL)
    store.approve(p.id)
    store.pause()
    const first = p.events.find((e) => e.type === 'ask')!
    if (first.type !== 'ask') throw new Error('no ask')
    p.clock = first.t
    store.answer(first.id, first.suggested)
    p.clock = first.t + 60_000
    const seq = p.run!.seq
    const started = { ...p.run!.autonomy }
    const next = { ...p.autonomy, cost: 'auto' as const, failed: 'auto' as const }
    store.setAutonomy(p.id, 'custom', next)
    expect(p.clock).toBe(first.t + 60_000)
    expect(p.answers).toEqual({ [first.id]: first.suggested })
    expect(p.run!.seq).toBe(seq)
    expect(p.run!.autonomy).toEqual(started)
    expect(p.autonomy).toEqual(next)
    expect(p.level).toBe('custom')
    // The next run starts with it.
    store.startRun(p)
    store.pause()
    expect(p.run!.seq).toBe(seq! + 1)
    expect(p.run!.autonomy).toEqual(next)
  })

  it('before the run starts, it is the plan’s setting at once', () => {
    const p = plan(SAMPLE_GOAL)
    store.setAutonomy(p.id, 'undoable', { ...AUTONOMY_PRESETS.undoable })
    expect(p.level).toBe('undoable')
    store.approve(p.id)
    store.pause()
    expect(p.run!.autonomy).toEqual(AUTONOMY_PRESETS.undoable)
  })
})

describe('a crew change on the plan', () => {
  const goal = 'Card checkout for an online shop'

  it('keeps your done-when and gate on the tasks the new plan still has', async () => {
    const p = plan(goal)
    store.editPlan(p.id, (tasks) => {
      const t = tasks.find((x) => x.id === 'checkout-api')!
      t.doneWhen = 'A refund goes through too'
      t.gate = true
    })
    await planInto(p, ['builder', 'tester', 'planner', 'deployer'])
    expect(store.project(p.id)!.events.some((e) => e.type === 'farmer' && e.id === 'designer')).toBe(false)
    const t = tasksOf(p.id).find((x) => x.id === 'checkout-api')!
    expect(t).toMatchObject({ doneWhen: 'A refund goes through too', gate: true })
    // And again when the Designer comes back.
    await planInto(p, ['builder', 'tester', 'planner', 'deployer', 'designer'])
    expect(tasksOf(p.id).find((x) => x.id === 'checkout-api')).toMatchObject({ doneWhen: 'A refund goes through too', gate: true })
    // Tasks you didn't touch are the Planner's.
    const fresh = simulatePlan(goal).tasks.find((x) => x.id === 'webhooks')!
    expect(tasksOf(p.id).find((x) => x.id === 'webhooks')).toMatchObject({ doneWhen: fresh.doneWhen, gate: fresh.gate })
  })

  it('gives a task back to the farmer you chose once it is on the crew again', async () => {
    const p = plan(goal)
    store.editPlan(p.id, (tasks) => {
      tasks.find((x) => x.id === 'checkout-api')!.farmer = 'designer'
    })
    await planInto(p, ['builder', 'tester', 'planner', 'deployer'])
    expect(tasksOf(p.id).find((x) => x.id === 'checkout-api')!.farmer).toBe('builder')
    await planInto(p, ['builder', 'tester', 'planner', 'deployer', 'designer'])
    expect(tasksOf(p.id).find((x) => x.id === 'checkout-api')!.farmer).toBe('designer')
  })

  it('a plan from scratch starts clean', async () => {
    const p = plan(goal)
    store.editPlan(p.id, (tasks) => {
      tasks.find((x) => x.id === 'checkout-api')!.doneWhen = 'Mine'
    })
    await planInto(p)
    expect(tasksOf(p.id).find((x) => x.id === 'checkout-api')!.doneWhen).not.toBe('Mine')
  })

  it('closes a task panel whose task the new plan no longer has', async () => {
    const p = plan('A chatbot that answers questions from a shop’s help pages')
    store.open(p.id)
    store.setDrawer({ kind: 'task', id: 'e2e-check' })
    await planInto(p, ['builder', 'planner', 'designer', 'deployer'])
    expect(tasksOf(p.id).some((t) => t.id === 'e2e-check')).toBe(false)
    expect(store.drawer).toBeNull()
    // A panel on a task that is still there stays open.
    store.setDrawer({ kind: 'task', id: tasksOf(p.id)[0].id })
    await planInto(p, ['builder', 'planner', 'designer', 'deployer', 'tester'])
    expect(store.drawer).toEqual({ kind: 'task', id: tasksOf(p.id)[0].id })
  })
})

describe('switching a path in a farmer’s context', () => {
  const f = { id: 'builder', context: ['src/', 'docs/help/'] } as unknown as FarmerSetup
  const plan = ['src/', 'docs/help/']

  it('adding a path you switched off switches it back on, and the switch keeps working', () => {
    const e = emptyEdit()
    turnPath(e, 'docs/help/', false, plan)
    expect(applyEdit(f, e).context).toEqual(['src/'])
    turnPath(e, 'docs/help/', true, plan)
    expect(applyEdit(f, e).context).toEqual(['src/', 'docs/help/'])
    expect(e).toMatchObject({ contextOff: [], contextAdd: [] })
    turnPath(e, 'docs/help/', false, plan)
    expect(applyEdit(f, e).context).toEqual(['src/'])
    turnPath(e, 'docs/help/', true, plan)
    expect(applyEdit(f, e).context).toEqual(['src/', 'docs/help/'])
  })

  it('a plan path that was also added (the brand guide from an ask) still switches off', () => {
    const e = { ...emptyEdit(), contextAdd: ['docs/help/'] }
    turnPath(e, 'docs/help/', false, plan)
    expect(applyEdit(f, e).context).toEqual(['src/'])
  })

  it('a path of your own is added once, and switching it off takes it out', () => {
    const e = emptyEdit()
    turnPath(e, 'docs/x.md', true, plan)
    turnPath(e, 'docs/x.md', true, plan)
    expect(e.contextAdd).toEqual(['docs/x.md'])
    turnPath(e, 'docs/x.md', false, plan)
    expect(applyEdit(f, e).context).toEqual(['src/', 'docs/help/'])
  })
})
