// Checkpoint 27: a recorded budget Stop is final, whatever happens afterwards to the budget, the models or the
// inbox, and a budget ask asked again is made from the budget and the spend as they are now.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { budgetStopOf, doneLead } from '../done'
import { liveStage } from '../rollback'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

type Ask = Extract<Project['events'][number], { type: 'ask' }>
const next = (p: Project) => p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id]) as Ask | undefined
const spentAt = (p: Project, t: number) => p.events.reduce((n, e) => n + (e.type === 'usage' && e.t <= t ? e.usd : 0), 0)
const done = (p: Project) => p.events.find((e) => e.type === 'done')!.t

function farm(goal: string, astra = true) {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  if (astra) store.editKit(p.id, 'builder', (e) => void (e.model = 'GPT-6 Astra'))
  store.approve(p.id)
  store.pause()
  return p
}

// Answer every ask with its suggestion until the first budget ask, and leave that one open.
function toBudgetAsk(p: Project) {
  for (let i = 0; i < 40; i++) {
    const a = next(p)
    if (!a) return undefined
    p.clock = Math.max(p.clock!, a.t)
    if (a.budgetFor) return a
    store.answer(a.id, a.suggested)
  }
  return undefined
}

function finish(p: Project, budgetChoice = 'Stop the run here') {
  for (let i = 0; i < 40; i++) {
    const a = next(p)
    if (!a) break
    p.clock = Math.max(p.clock!, a.t)
    store.answer(a.id, a.budgetFor ? budgetChoice : a.suggested)
  }
}

const GOALS = [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A habit tracker app']

describe('checkpoint 27', () => {
  for (const goal of GOALS)
    it(`${goal.slice(0, 20)}: budget raised in the editor, then Change to Stop: refused, never a stale ask that ships`, () => {
      const p = farm(goal)
      const a = toBudgetAsk(p)!
      expect(a).toBeTruthy()
      store.setProjectBudget(p.id, 500)
      expect(p.answers?.[a.id]).toBe('Raise the budget to $500')
      const why = store.reopen(a.id, 'Stop the run here')
      expect(why).toMatch(/^The budget is \$500 now/)
      finish(p, 'Raise the budget')
      p.clock = done(p)
      const s = store.state(p)!
      expect(budgetStopOf(s)).toBeFalsy()
      expect(s.asks.every((x) => !/its \$60 budget/.test(x.question) || x.answer)).toBe(true)
    })

  for (const goal of GOALS)
    it(`${goal.slice(0, 20)}: a budget ask reopened after a lower budget is asked with the new figure, and Stop holds`, () => {
      const p = farm(goal)
      const a = toBudgetAsk(p)!
      store.answer(a.id, a.suggested)
      store.setProjectBudget(p.id, 5)
      const why = store.reopen(a.id, 'Stop the run here')
      expect(why).toBe('')
      p.clock = done(p)
      const s = store.state(p)!
      expect(budgetStopOf(s)).toBe('$5')
      expect(s.deploy).toEqual([])
    })

  for (const goal of GOALS)
    it(`${goal.slice(0, 20)}: after a Stop, a model switch and a new budget change nothing`, () => {
      const p = farm(goal)
      finish(p)
      const before = p.events.map((e) => `${e.type}@${e.t}`).join(',')
      store.editKit(p.id, 'builder', (e) => void (e.model = 'GPT-6 Luna'))
      store.setProjectBudget(p.id, 500)
      expect(p.events.map((e) => `${e.type}@${e.t}`).join(',')).toBe(before)
      p.clock = done(p)
      const s = store.state(p)!
      expect(budgetStopOf(s)).toBeTruthy()
      expect(s.deploy).toEqual([])
      const stopAsk = s.asks.find((x) => /^stop/i.test(x.answer?.choice ?? ''))!
      expect(store.lockedWhy(p, stopAsk.id)).toMatch(/that’s final/)
    })

  it('lowering the budget below what is spent asks at once, quoting the real spend', () => {
    const p = farm(SAMPLE_GOAL, false)
    const first = p.events.find((e) => e.type === 'ask')!
    p.clock = first.t
    store.answer(first.id, (first as Ask).suggested)
    const t = p.clock!
    const spent = spentAt(p, t)
    expect(spent).toBeGreaterThan(2)
    store.setProjectBudget(p.id, 1)
    const a = next(p)!
    expect(a.budgetFor).toBeTruthy()
    // Asked before any further step is paid for.
    expect(spentAt(p, a.t)).toBeCloseTo(spent, 2)
    expect(a.question).toContain(`with $${Math.round(spent)}`)
  })

  it('no budget ask once the release is live for everyone', () => {
    const p = farm(SAMPLE_GOAL, false)
    finish(p, 'Raise the budget')
    const all = p.events.find((e) => e.type === 'deploy' && e.stage === '100%')
    expect(all).toBeTruthy()
    p.clock = all!.t + 1000
    store.setProjectBudget(p.id, 1)
    expect(p.events.some((e) => e.type === 'ask' && e.budgetFor && e.t > all!.t)).toBe(false)
  })

  it('saving the same budget again does not ask again', () => {
    const p = farm(SAMPLE_GOAL)
    const a = toBudgetAsk(p)!
    const b = store.budgetOf(p)
    const before = p.events.length
    store.setProjectBudget(p.id, b)
    expect(p.events.length).toBe(before)
    expect(p.answers?.[a.id]).toBeUndefined()
  })
  for (const goal of GOALS)
    it(`${goal.slice(0, 20)}: lowering the budget with a budget ask open asks again before another step, and Stop spends nothing more`, () => {
      const p = farm(goal)
      toBudgetAsk(p)
      const spent = spentAt(p, p.clock!)
      store.setProjectBudget(p.id, 5)
      const b = next(p)!
      expect(b.budgetFor).toBeTruthy()
      expect(spentAt(p, b.t)).toBeCloseTo(spent, 2)
      expect(b.question).toContain(`with $${Math.round(spent)}`)
      p.clock = Math.max(p.clock!, b.t)
      store.answer(b.id, 'Stop the run here')
      p.clock = done(p)
      expect(store.state(p)!.usage.usd).toBeCloseTo(spent, 1)
    })

  // Raise the first budget ask, then answer up to the Builder's limit ask and leave it open.
  function toLimitAsk(raise: string) {
    const p = farm(SAMPLE_GOAL)
    for (let i = 0; i < 40; i++) {
      const a = next(p)
      if (!a) return { p, a: undefined }
      p.clock = Math.max(p.clock!, a.t)
      if (a.limitFor === 'builder') return { p, a }
      store.answer(a.id, a.budgetFor ? raise : a.suggested)
    }
    return { p, a: undefined }
  }

  it('a Stop never erases answers you gave or money already spent', () => {
    const { p, a } = toLimitAsk('Raise the budget to $115')
    expect(a).toBeTruthy()
    store.setProjectBudget(p.id, 50)
    const lim = next(p)!
    p.clock = Math.max(p.clock!, lim.t)
    store.answer(lim.id, lim.limitFor ? lim.suggested : 'Stop the run here')
    const b = next(p)
    if (b) {
      p.clock = Math.max(p.clock!, b.t)
      store.answer(b.id, 'Stop the run here')
    }
    const given = { ...p.answers }
    const spent = spentAt(p, p.clock!)
    p.clock = done(p)
    const s = store.state(p)!
    expect(budgetStopOf(s)).toBeTruthy()
    for (const [id, c] of Object.entries(given)) expect(s.asks.find((x) => x.id === id)?.answer?.choice).toBe(c)
    expect(s.asks.some((x) => x.answer?.choice === 'Raise the budget to $115')).toBe(true)
    expect(s.usage.usd).toBeGreaterThanOrEqual(spent - 0.01)
  })

  it('a budget lowered while a limit ask is open is asked before any farmer pays another step', () => {
    const { p, a } = toLimitAsk('Raise the budget to $235')
    expect(a).toBeTruthy()
    store.setProjectBudget(p.id, 59)
    store.answer(a!.id, a!.suggested)
    const b = next(p)!
    // Asked before the next step anyone pays for, so the run pauses there.
    const nextStep = p.events.find((e) => e.type === 'usage' && e.t > a!.t)!
    expect(b.t).toBeLessThan(nextStep.t)
    expect(b.budgetFor).toBeTruthy()
    const spent = spentAt(p, b.t)
    expect(b.question).toContain(`with $${Math.round(spent)}`)
    p.clock = Math.max(p.clock!, b.t)
    store.answer(b.id, 'Stop the run here')
    p.clock = done(p)
    expect(store.state(p)!.usage.usd).toBeCloseTo(spent, 1)
  })

  // Merge to 10%, lower the budget below what's spent: a budget ask opens while 10% is live.
  function tenLiveAsk() {
    const p = farm(SAMPLE_GOAL, false)
    finish(p, 'Raise the budget')
    const ten = p.events.find((e) => e.type === 'deploy' && e.stage === '10%')!
    p.clock = ten.t + 1000
    store.setProjectBudget(p.id, 10)
    const a = next(p)!
    expect(a.budgetFor).toBeTruthy()
    p.clock = Math.max(p.clock, a.t)
    return { p, a }
  }

  it('stopped while the 10% release is live: still live and watched, and you can roll it back', () => {
    const { p, a } = tenLiveAsk()
    store.answer(a.id, 'Stop the run here')
    const at = p.clock! + 2000
    expect(liveStage(p.events, at)).toBe('10%')
    // Still watched after the stop: readings keep coming, or it rolls back by itself.
    expect(p.events.some((e) => (e.type === 'monitor' || (e.type === 'deploy' && e.stage === 'rollback')) && e.t > at)).toBe(true)
    store.clock = at
    p.clock = at
    store.rollBackNow()
    const t = Math.max(...p.events.map((e) => e.t))
    p.clock = t
    const s = store.state(p)!
    expect(s.deploy.at(-1)?.stage).toBe('rollback')
    expect(liveStage(p.events, t)).toBeNull()
    expect(s.asks.every((x) => x.answer)).toBe(true)
    expect(doneLead(s)).toContain('rolled back, so nothing is live')
  })

  it('rolled back with the budget ask open, then Stop: nothing asks to ship again, nothing ships', () => {
    const { p, a } = tenLiveAsk()
    store.clock = p.clock!
    store.rollBackNow()
    const open = next(p)!
    expect(open.budgetFor).toBeTruthy()
    p.clock = Math.max(p.clock!, open.t)
    store.answer(open.id, 'Stop the run here')
    const end = done(p)
    p.clock = end
    const s = store.state(p)!
    expect(budgetStopOf(s)).toBeTruthy()
    expect(s.asks.every((x) => x.answer)).toBe(true)
    expect(s.asks.some((x) => /ship to 10% again/i.test(x.question))).toBe(false)
    expect(s.deploy.at(-1)?.stage).toBe('rollback')
    expect(liveStage(p.events, end)).toBeNull()
    expect(a.id).toBeTruthy()
  })
})
