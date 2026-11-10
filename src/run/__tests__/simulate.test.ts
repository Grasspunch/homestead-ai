import { describe, expect, it } from 'vitest'
import { simulatePlan, simulateRoute } from '../simPlan'
import { simulateRun } from '../simulate'
import { duration, pendingAsk, reduce } from '../reduce'
import { AUTONOMY_PRESETS } from '../types'

const GOAL = 'Build an AI support assistant that answers from our help docs'

describe('simulated planner', () => {
  it('suggests a crew with the Builder and Tester, and a gated ship task', () => {
    const p = simulatePlan(GOAL)
    const ids = p.farmers.map((f) => f.id)
    expect(ids).toContain('builder')
    expect(ids).toContain('tester')
    expect(p.tasks.some((t) => t.gate)).toBe(true)
    for (const t of p.tasks) expect(ids).toContain(t.farmer)
    expect(p.estimate.minutes).toBeLessThan(p.singleAgentEstimate.minutes)
  })

  it('honours a crew size, down to one agent', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const p = simulatePlan(GOAL, n)
      expect(p.farmers).toHaveLength(n)
      for (const t of p.tasks) expect(p.farmers.map((f) => f.id)).toContain(t.farmer)
    }
    expect(simulatePlan(GOAL, 1).farmers[0].model).toBe('Claude Opus 5.5')
  })

  it('routes a design note to the Designer', () => {
    const p = simulatePlan(GOAL)
    const r = simulateRoute({ message: 'make the button colour friendlier', farmers: p.farmers, tasks: p.tasks })
    expect(r.to).toBe('designer')
  })
})

describe('simulated run', () => {
  for (const goal of [GOAL, 'Add Stripe checkout', 'An analytics dashboard', 'A recipe sharing app']) {
    for (const n of [undefined, 1, 3]) {
      it(`runs to the end: ${goal} (crew ${n ?? 'auto'})`, () => {
        const plan = simulatePlan(goal, n)
        const ev = simulateRun({ goal, ...plan })
        // Answer every ask the way the run did and play to the end.
        const answers: Record<string, string> = {}
        for (const e of ev) if (e.type === 'answer') answers[e.id] = e.choice
        const end = reduce(ev, duration(ev), answers)
        expect(end.done).toBeTruthy()
        expect(end.tasks.every((t) => t.status === 'ripe')).toBe(true)
        expect(end.asks.length).toBeGreaterThan(0)
        expect(end.usage.usd).toBeGreaterThan(0)
        expect(pendingAsk(ev, duration(ev), answers)).toBeNull()
      })
    }
  }

  it('fixes one failed check without you', () => {
    const plan = simulatePlan(GOAL)
    const ev = simulateRun({ goal: GOAL, ...plan })
    expect(ev.some((e) => e.type === 'auto_fix')).toBe(true)
    expect(ev.some((e) => e.type === 'deploy' && e.stage === '10%')).toBe(true)
  })
})

describe('the moments in a run', () => {
  const plan = simulatePlan(GOAL)
  const run = (level: 'often' | 'matters' | 'undoable') => simulateRun({ goal: GOAL, ...plan, autonomy: AUTONOMY_PRESETS[level] })
  const asks = (ev: ReturnType<typeof run>) => ev.filter((e) => e.type === 'ask').map((e) => (e.type === 'ask' ? e.reason : ''))

  it('splits the pricey task with a replan, and rolls back a bad rollout by itself', () => {
    const ev = run('matters')
    expect(ev.some((e) => e.type === 'replan')).toBe(true)
    expect(ev.some((e) => e.type === 'deploy' && e.stage === 'rollback')).toBe(true)
    expect(ev.filter((e) => e.type === 'monitor').length).toBeGreaterThan(5)
    const end = reduce(ev, duration(ev))
    expect(end.tasks.length).toBe(plan.tasks.length + 1)
    expect(end.tasks.every((t) => t.status === 'ripe')).toBe(true)
  })

  it('asks more the more cautious you set it', () => {
    expect(asks(run('often')).length).toBeGreaterThan(asks(run('matters')).length)
    expect(asks(run('matters')).length).toBeGreaterThan(asks(run('undoable')).length)
    expect(asks(run('undoable'))).toEqual(['big', 'irreversible'])
    expect(asks(run('matters'))).toEqual(expect.arrayContaining(['cost', 'disagree', 'big', 'irreversible']))
  })

  it('carries proof on every passing check', () => {
    const ev = run('matters')
    for (const e of ev) if (e.type === 'check' && e.pass) expect(e.proof).toBeTruthy()
  })
})
