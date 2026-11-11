// Checkpoint 27: a recorded budget Stop is final, whatever happens afterwards to the budget, the models or the
// inbox, and a budget ask asked again is made from the budget and the spend as they are now.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { budgetStopOf } from '../done'

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
})
