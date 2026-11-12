import { describe, expect, it } from 'vitest'
import { AREAS, MATES, areaFor, buildTeam, mateEvents, snapAt } from '../team'
import { simulatePlan } from '../simPlan'
import { fitLimits, simulateRun } from '../simulate'
import { pendingAsk } from '../reduce'
import { SAMPLE_GOAL, store } from '../store'

const sample = () => {
  const plan = simulatePlan(SAMPLE_GOAL)
  plan.farmers = fitLimits({ goal: SAMPLE_GOAL, ...plan })
  return { id: 'sample', name: plan.name, goal: SAMPLE_GOAL, events: simulateRun({ goal: SAMPLE_GOAL, ...plan }), approved: true }
}
const budgets = Object.fromEntries(AREAS.map((a) => [a.id, a.budget]))

describe('the team view', () => {
  it('puts a goal in an area', () => {
    expect(areaFor('Card checkout for an online shop')).toBe('checkout')
    expect(areaFor('A dashboard of new sign-ups each week')).toBe('insights')
    expect(areaFor(SAMPLE_GOAL)).toBe('help')
  })

  it('counts people, agents and spend from the runs themselves', () => {
    const t = buildTeam([sample()], budgets)
    expect(t.people.map((p) => p.name)).toEqual(['You', 'Maya', 'Sam', 'Dev', 'Ines'])
    expect(t.projects).toBe(1 + MATES.length)
    expect(t.agents).toBe(t.people.reduce((m, p) => m + p.agents, 0))
    const maya = t.areas.flatMap((a) => a.farms).find((f) => f.id === 'team-maya-1')!
    const ev = mateEvents(MATES[0])
    const at = snapAt(ev, MATES[0].at).t
    expect(maya.spent).toBeCloseTo(ev.reduce((m, e) => m + (e.type === 'usage' && e.t <= at ? e.usd : 0), 0), 6)
    expect(maya.limit).toBe(60)
  })

  it('shows outliers only: a cost spike, the same work twice, and a disagreement', () => {
    const t = buildTeam([sample()], budgets)
    expect(t.outliers.map((o) => o.kind)).toEqual(['spike', 'twice', 'conflict'])
    const [spike, twice, fight] = t.outliers
    expect(spike.text).toMatch(/over plan/)
    expect(twice.kind === 'twice' && [twice.farm.name, twice.other.name]).toEqual(['Help-center bot', 'Support assistant'])
    expect(fight.text).toMatch(/^The Builder and the Designer disagree/)
    // Each one points at a project that is waiting on that very ask.
    for (const o of [spike, fight]) expect(pendingAsk(o.farm.events, o.farm.t, o.farm.answers)).toBeTruthy()
  })

  it('a project over its limit is the cost spike', () => {
    const t = buildTeam([sample()], { ...budgets, insights: 20 })
    expect(t.outliers[0]).toMatchObject({ kind: 'spike', farm: { id: 'team-ines-1' } })
    expect(t.outliers[0].text).toMatch(/^Over its limit by \$\d+\.$/)
  })
})

describe('budgets per area', () => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
  it('a new project starts with its area’s budget as its spend limit, and follows it', () => {
    store.setBudget('checkout', 75)
    const p = store.newProject('Card checkout for an online shop')
    expect(p.area).toBe('checkout')
    expect(p.spendLimit).toBe(75)
    const q = store.newProject('Stripe checkout for our pricing page')
    q.spendLimit = 120 // a limit of its own
    store.setBudget('checkout', 90)
    expect(p.spendLimit).toBe(90)
    expect(q.spendLimit).toBe(120)
    const t = buildTeam(store.projects.map((x) => (x.id === p.id ? { ...x, events: sample().events } : x)), store.budgets)
    expect(t.areas.find((a) => a.id === 'checkout')!.farms.find((f) => f.id === p.id)!.limit).toBe(90)
  })
})
