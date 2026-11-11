// Checkpoint 23: project budgets, the Planner's figure in the downloaded files, and run 2's fixed line there too.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { prMarkdown, runReport } from '../export'
import { plannerEstimate } from '../done'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

function farm(goal: string) {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.pause()
  return p
}

function playOut(p: Project) {
  for (let i = 0; i < 30; i++) {
    const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
    if (!a || a.type !== 'ask') break
    p.clock = Math.max(p.clock!, a.t)
    store.answer(a.id, a.suggested)
  }
  p.clock = p.events.find((e) => e.type === 'done')!.t
  ;(store as unknown as { finishRun: (p: Project) => void }).finishRun(p)
}

describe('checkpoint 23', () => {
  it('a project budget you set is clamped and kept; a new project starts on its area budget', () => {
    const p = farm('Stripe checkout for our pricing page')
    expect(store.budgetOf(p)).toBe(store.budgets.checkout)
    store.setProjectBudget(p.id, 12.4)
    expect(store.budgetOf(p)).toBe(12)
    store.setProjectBudget(p.id, -3)
    expect(store.budgetOf(p)).toBe(12)
    store.setProjectBudget(p.id, 99999)
    expect(store.budgetOf(p)).toBe(1000)
  })

  it('the exports say the Planner’s own estimate, the figure Done reads against', () => {
    const p = farm(SAMPLE_GOAL)
    playOut(p)
    const s = store.state(p)!
    const g = plannerEstimate(p.events)!.usd
    const fig = `$${g < 10 ? g.toFixed(2) : g.toFixed(0)}`
    expect(runReport(p, s)).toContain(`against the Planner's ${fig} estimate`)
    expect(prMarkdown(p, s) + runReport(p, s)).not.toMatch(/Planned: \$/)
  })

  it('a budget lowered mid-run asks at once, and a raise carries on to Done at the budget you approved', () => {
    const p = farm(SAMPLE_GOAL)
    const first = p.events.find((e) => e.type === 'ask')!
    p.clock = first.t
    store.answer(first.id, first.type === 'ask' ? first.suggested : '')
    store.setProjectBudget(p.id, 5)
    const a = p.events.find((e) => e.type === 'ask' && e.budgetFor && !(p.answers ?? {})[e.id])
    expect(a && a.type === 'ask' && a.question).toMatch(/^This run is about to pass its \$5 budget/)
    playOut(p)
    const s = store.state(p)!
    expect(s.done).toBeTruthy()
    expect(s.done!.usd).toBeLessThanOrEqual(store.budgetOf(p) + 0.01)
    expect(s.tasks.every((t) => t.status === 'accepted')).toBe(true)
  })

  it('Stop the run here stops the whole crew: nothing more is spent and nothing ships', () => {
    const p = farm(SAMPLE_GOAL)
    const first = p.events.find((e) => e.type === 'ask')!
    p.clock = first.t
    store.answer(first.id, first.type === 'ask' ? first.suggested : '')
    store.setProjectBudget(p.id, 5)
    const a = p.events.find((e): e is Extract<typeof e, { type: 'ask' }> => e.type === 'ask' && !!e.budgetFor && !(p.answers ?? {})[e.id])!
    p.clock = a.t
    store.answer(a.id, 'Stop the run here')
    const end = p.events.find((e) => e.type === 'done')!
    p.clock = end.t
    const s = store.state(p)!
    expect(s.deploy).toEqual([])
    expect(p.events.some((e) => e.type === 'usage' && e.t > a.t + 60_000)).toBe(false)
    expect(p.events.filter((e) => e.type === 'ask' && e.budgetFor).length).toBe(1)
    expect(s.tasks.filter((t) => t.status !== "accepted" && !t.stopped).map((t) => t.id)).toEqual([])
  })

  for (const model of ['GPT-6 Astra', 'Claude Opus 5.5'])
    it(`a ${model} Builder never takes the run past its budget without asking`, () => {
      const p = farm(SAMPLE_GOAL)
      store.editKit(p.id, 'builder', (e) => void (e.model = model))
      playOut(p)
      const s = store.state(p)!
      expect(s.done!.usd).toBeGreaterThan(60)
      expect(p.events.some((e) => e.type === 'ask' && e.budgetFor)).toBe(true)
      expect(s.done!.usd).toBeLessThanOrEqual(store.budgetOf(p) + 0.01)
    })

  it('run 2’s downloaded files say the release fix and the clean-run count, as Done does', () => {
    const p = farm(SAMPLE_GOAL)
    playOut(p)
    store.runAgain()
    store.pause()
    playOut(p)
    const s = store.state(p)!
    expect(s.deploy.some((d) => d.stage === 'rollback')).toBe(false)
    for (const md of [prMarkdown(p, s), runReport(p, s)]) {
      expect(md).toContain('what rolled that release back is fixed')
      expect(md).toContain('Clean runs in a row: 1 of 3')
    }
  })
})
