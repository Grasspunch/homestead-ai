// Checkpoint 26: a Stop always holds, whatever happened to the budget before it. An answer is never logged
// before its ask, a budget set in the editor answers or replaces the ask on screen, and a stop after the 10%
// release says so.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { budgetStopOf, doneLead } from '../done'
import { prMarkdown } from '../export'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

type Ask = Extract<Project['events'][number], { type: 'ask' }>
const next = (p: Project) => p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id]) as Ask | undefined

function farm(goal: string, astra = true) {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  if (astra) store.editKit(p.id, 'builder', (e) => void (e.model = 'GPT-6 Astra'))
  store.approve(p.id)
  store.pause()
  return p
}

function ordered(p: Project) {
  const at = new Map(p.events.filter((e): e is Ask => e.type === 'ask').map((e) => [e.id, e.t]))
  return p.events.every((e) => e.type !== 'answer' || !at.has(e.id) || at.get(e.id)! <= e.t)
}

const GOALS = [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A habit tracker app']

describe('checkpoint 26', () => {
  for (const goal of GOALS)
    it(`${goal.slice(0, 20)}: Raise, lower the budget, then Stop: the stop holds everywhere`, () => {
      const p = farm(goal)
      let budgetAsks = 0
      let stopped = false
      for (let i = 0; i < 40; i++) {
        const a = next(p)
        if (!a) break
        p.clock = Math.max(p.clock!, a.t)
        if (a.budgetFor && ++budgetAsks === 1) {
          store.answer(a.id, a.suggested)
          store.setProjectBudget(p.id, 40)
          continue
        }
        store.answer(a.id, a.budgetFor ? 'Stop the run here' : a.suggested)
        if (a.budgetFor) stopped = true
      }
      expect(stopped).toBe(true)
      p.clock = p.events.find((e) => e.type === 'done')!.t
      const s = store.state(p)!
      expect(ordered(p)).toBe(true)
      expect(budgetStopOf(s)).toBe('$40')
      expect(doneLead(s)).toMatch(/^You stopped the run at its \$40 budget/)
      expect(s.asks.every((a) => a.answer)).toBe(true)
    })

  for (const goal of GOALS)
    it(`${goal.slice(0, 20)}: a budget ask on screen is answered by a budget in the editor that covers the spend`, () => {
      const p = farm(goal)
      store.setProjectBudget(p.id, 30)
      for (let i = 0; i < 40; i++) {
        const a = next(p)
        if (!a) break
        p.clock = Math.max(p.clock!, a.t)
        if (a.budgetFor) {
          store.setProjectBudget(p.id, 500)
          expect(p.answers?.[a.id]).toBe('Raise the budget to $500')
          continue
        }
        store.answer(a.id, a.suggested)
      }
      p.clock = p.events.find((e) => e.type === 'done')!.t
      const s = store.state(p)!
      expect(ordered(p)).toBe(true)
      expect(store.budgetOf(p)).toBe(500)
      expect(s.done!.usd).toBeLessThanOrEqual(500)
    })

  for (const goal of GOALS)
    it(`${goal.slice(0, 20)}: a lower budget in the editor withdraws the ask on screen and asks again with the new figure, and Stop holds`, () => {
      const p = farm(goal)
      store.setProjectBudget(p.id, 30)
      let replaced = false
      for (let i = 0; i < 40; i++) {
        const a = next(p)
        if (!a) break
        p.clock = Math.max(p.clock!, a.t)
        if (a.budgetFor && !replaced) {
          replaced = true
          store.setProjectBudget(p.id, 10)
          const again = p.events.find((e): e is Ask => e.type === "ask" && !!e.budgetFor && !(p.answers ?? {})[e.id])!
          expect(again.budgetFor).toBeTruthy()
          expect(again.question).toMatch(/its \$10 budget/)
          continue
        }
        store.answer(a.id, a.budgetFor ? 'Stop the run here' : a.suggested)
      }
      p.clock = p.events.find((e) => e.type === 'done')!.t
      const s = store.state(p)!
      expect(ordered(p)).toBe(true)
      expect(budgetStopOf(s)).toBe('$10')
      expect(s.deploy).toEqual([])
    })

  it('stopped after the release went out: Done says where it stood, and the files drop the comparisons', () => {
    const p = farm(SAMPLE_GOAL, false)
    for (let i = 0; i < 40; i++) {
      const a = next(p)
      if (!a) break
      p.clock = Math.max(p.clock!, a.t)
      store.answer(a.id, a.budgetFor ? 'Stop the run here' : a.suggested)
    }
    // After the first 10% release, before the fix ships again, lower the budget below what's spent.
    const ten = p.events.find((e) => e.type === 'deploy' && e.stage === '10%')!
    p.clock = ten.t + 1000
    store.setProjectBudget(p.id, 10)
    const a = next(p)!
    expect(a.budgetFor).toBeTruthy()
    p.clock = Math.max(p.clock, a.t)
    store.answer(a.id, 'Stop the run here')
    p.clock = p.events.find((e) => e.type === 'done')!.t
    const s = store.state(p)!
    // Where the release stood when you stopped, never "nothing shipped" once something went out.
    const last = s.deploy.at(-1)?.stage
    expect(last).toBeTruthy()
    expect(doneLead(s)).toMatch(/^You stopped the run at its \$10 budget: /)
    expect(doneLead(s)).not.toContain('nothing shipped')
    expect(doneLead(s)).toContain(last === '10%' ? 'stopped after the 10% release, which stays live for 10% of users' : last === 'rollback' ? 'rolled back, so nothing is live' : 'live for everyone')
    expect(prMarkdown(p, s)).not.toContain('assuming one agent runs a third slower')
  })
})
