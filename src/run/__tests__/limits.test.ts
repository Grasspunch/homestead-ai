// Spend limits come from the plan's own forecast: the run asks about money once, on the moment that matters,
// and never stops you for a few cents.
import { describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { fitLimits, simulateRun } from '../simulate'
import { reduce } from '../reduce'
import { SAMPLE_GOAL } from '../store'
import type { RunEvent } from '../types'

const GOALS = [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A dashboard of weekly signups', 'A tool that drafts replies to app store reviews', 'Add dark mode to the settings page']
const moneyAsks = (ev: RunEvent[]) => ev.filter((e) => e.type === 'ask' && e.reason === 'cost')

function planned(goal: string) {
  const plan = simulatePlan(goal)
  plan.farmers = fitLimits({ goal, ...plan })
  return plan
}

describe('money is asked about once', () => {
  for (const goal of GOALS) {
    it(`${goal.slice(0, 32)}: one money ask on the default path, and on the raise path`, () => {
      const plan = planned(goal)
      const ev = simulateRun({ goal, ...plan })
      const asks = moneyAsks(ev)
      expect(asks.length).toBeLessThanOrEqual(1)
      if (!asks.length) return
      const a = asks[0]
      if (a.type !== 'ask') throw new Error()
      // Raising the task's limit raises its farmer's by as much: no second ask for the same money.
      const raise = a.alternatives!.find((o) => /^raise/i.test(o))!
      const raised = simulateRun({ goal, ...plan, choices: { [a.id]: raise } })
      expect(moneyAsks(raised).length).toBe(1)
      const s = reduce(raised, Number.MAX_SAFE_INTEGER, { [a.id]: raise })
      for (const f of Object.values(s.farmers)) if (f) expect(f.usd).toBeLessThanOrEqual(f.limits.usd + 0.01)
    })
  }

  it('the sample’s limits sit at or above what each farmer spends on its default path', () => {
    const plan = planned(SAMPLE_GOAL)
    const s = reduce(simulateRun({ goal: SAMPLE_GOAL, ...plan }), Number.MAX_SAFE_INTEGER)
    for (const f of Object.values(s.farmers)) if (f) expect(f.usd).toBeLessThanOrEqual(f.limits.usd)
  })
})

describe('no stop for small change', () => {
  it('a farmer that would pass its limit by under a dollar is raised by the lead and told, not asked', () => {
    for (const goal of GOALS) {
      const plan = planned(goal)
      const wide = simulateRun({ goal, ...plan })
      const builder = wide.reduce((n, e) => n + (e.type === 'usage' && e.farmer === 'builder' ? e.usd : 0), 0)
      // A limit 8 cents under what the Builder spends.
      const tight = plan.farmers.map((f) => (f.id === 'builder' ? { ...f, limits: { ...f.limits, usd: +(builder - 0.08).toFixed(2) } } : f))
      const ev = simulateRun({ goal, ...plan, farmers: tight })
      expect(ev.some((e) => e.type === 'ask' && e.limitFor === 'builder')).toBe(false)
      expect(ev.some((e) => e.type === 'auto_fix' && /Builder reached its .* raised it/.test(e.what))).toBe(true)
    }
  })
  it('a real overrun still asks', () => {
    const plan = planned(SAMPLE_GOAL)
    const tight = plan.farmers.map((f) => (f.id === 'builder' ? { ...f, limits: { ...f.limits, usd: 20 } } : f))
    const ev = simulateRun({ goal: SAMPLE_GOAL, ...plan, farmers: tight })
    expect(ev.some((e) => e.type === 'ask' && e.limitFor === 'builder')).toBe(true)
  })
})
