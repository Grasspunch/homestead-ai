import { beforeAll, describe, expect, it } from 'vitest'
import { scenario, simulatePlan } from '../simPlan'
import { simulateRun } from '../simulate'
import { duration, reduce } from '../reduce'
import { checkCost } from '../compare'
import { BY_YOU } from '../rollback'
import { readAnswer, store, type Project } from '../store'
import { AUTONOMY_PRESETS, type RunEvent } from '../types'

const GOAL = 'Build an AI support assistant that answers from our help docs'

beforeAll(() => {
  // The store plays runs on animation frames; these tests move its clock by hand.
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const doneOf = (ev: RunEvent[]) => {
  const d = ev.find((e) => e.type === 'done')
  return d && d.type === 'done' ? d : null
}

// An own farm, planned, approved and played to its end, answering every ask with its suggestion.
function finishedFarm(goal = GOAL): Project {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  for (let i = 0; i < 20; i++) {
    const ask = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
    if (!ask || ask.type !== 'ask') break
    store.answer(ask.id, ask.suggested)
  }
  p.clock = duration(p.events)
  ;(store as unknown as { finishRun: (p: Project) => void }).finishRun(p)
  return p
}

describe('a finished run never changes', () => {
  it('a hand rollback after done keeps the run’s own rollback and numbers before it', () => {
    const p = finishedFarm()
    expect(p.runs).toBe(1)
    const auto = p.events.filter((e) => e.type === 'deploy' && e.stage === 'rollback' && e.reason !== BY_YOU).length
    expect(auto).toBe(1)
    const before = p.events.filter((e) => e.t < p.clock!)
    p.clock = duration(p.events) - 1
    store.rollBackNow()
    expect(p.events.filter((e) => e.type === 'deploy' && e.stage === 'rollback' && e.reason !== BY_YOU).length).toBe(1)
    expect(JSON.stringify(p.events.filter((e) => e.t < before[before.length - 1].t))).toBe(JSON.stringify(before.filter((e) => e.t < before[before.length - 1].t)))
  })

  it('counts a run once, even when it reaches its end again after your rollback', () => {
    const p = finishedFarm()
    p.clock = duration(p.events) - 1
    store.rollBackNow()
    p.clock = duration(p.events)
    ;(store as unknown as { finishRun: (p: Project) => void }).finishRun(p)
    expect(p.runs).toBe(1)
  })

  it('a model change after done applies to the next run only', () => {
    const p = finishedFarm()
    const usd = doneOf(p.events)!.usd
    store.editKit(p.id, 'builder', (e) => {
      e.model = 'Claude Opus 5.5'
    })
    expect(doneOf(p.events)!.usd).toBe(usd)
  })

  it('opening another farm and coming back resumes where you were', () => {
    const p = finishedFarm()
    const at = p.clock
    const n = Object.keys(p.answers ?? {}).length
    store.open('sample')
    store.open(p.id)
    expect(p.clock).toBe(at)
    expect(Object.keys(p.answers ?? {}).length).toBe(n)
  })

  it('the next run of a farm decides once that last run’s bug is fixed', () => {
    const p = finishedFarm()
    store.runAgain()
    expect(p.run?.bugFixed).toBe(true)
    expect(p.events.some((e) => e.type === 'deploy' && e.stage === 'rollback')).toBe(false)
  })
})

describe('the plan’s numbers come from the run', () => {
  it('the forecast is the default run’s cost and time', () => {
    const p = store.newProject(GOAL)
    const plan = simulatePlan(GOAL)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    const fc = store.forecast(p)!
    store.approve(p.id)
    for (let i = 0; i < 20; i++) {
      const ask = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
      if (!ask || ask.type !== 'ask') break
      store.answer(ask.id, ask.suggested)
    }
    const d = doneOf(p.events)!
    expect(d.usd).toBeCloseTo(fc.crew.usd, 2)
    expect(d.minutes).toBe(fc.crew.minutes)
    const s = reduce(p.events, Number.MAX_SAFE_INTEGER)
    expect(s.estimate).toEqual(fc.crew)
    expect(s.singleAgentEstimate).toEqual(fc.solo)
  })
})

describe('stopping a farmer at its limit', () => {
  const goal = 'Stripe checkout for our pricing page'
  const plan = simulatePlan(goal)
  const farmers = plan.farmers.map((f) => (f.id === 'builder' ? { ...f, limits: { ...f.limits, usd: 4 } } : f))
  const base = { goal, ...plan, farmers, autonomy: AUTONOMY_PRESETS.matters }
  const limit = simulateRun(base).find((e) => e.type === 'ask' && e.limitFor === 'builder')

  it('asks with numbers that add up', () => {
    if (!limit || limit.type !== 'ask') throw new Error('no limit ask')
    const spent = Number(/spent \$([\d.]+)/.exec(limit.question)![1])
    const more = Number(/about \$([\d.]+) more/.exec(limit.impact!)![1])
    const all = Number(/\$([\d.]+) in all/.exec(limit.impact!)![1])
    expect(spent + more).toBeCloseTo(all, 2)
  })

  it('leaves the stopped farmer out of everything after, and asks before shipping part of the work', () => {
    if (!limit || limit.type !== 'ask') throw new Error('no limit ask')
    const choices: Record<string, string> = { [limit.id]: 'Stop it here' }
    const ev = simulateRun({ ...base, choices })
    const after = ev.filter((e) => e.t > limit.t + 6000)
    expect(after.some((e) => e.type === 'tool' && e.farmer === 'builder')).toBe(false)
    expect(after.some((e) => e.type === 'disagree' && e.sides.some((x) => x.farmer === 'builder'))).toBe(false)
    expect(after.some((e) => e.type === 'ask' && e.farmer === 'builder')).toBe(false)
    const ship = ev.find((e) => e.type === 'ask' && e.reason === 'irreversible')
    if (!ship || ship.type !== 'ask') throw new Error('no ship ask')
    const s = reduce(ev, Number.MAX_SAFE_INTEGER, {}, true)
    const work = s.tasks.filter((t) => !t.gate)
    const shipped = work.filter((t) => t.status === 'accepted').length
    expect(shipped).toBeLessThan(work.length)
    expect(ship.question).toContain(`${shipped} of ${work.length} tasks`)
  })
})

describe('smaller honesty fixes', () => {
  it('matches scenarios by whole word: an expense report tool is not a dashboard', () => {
    expect(scenario('An internal tool where managers approve expense reports').matched).toBe(false)
    expect(scenario('A dashboard of weekly signups').matched).toBe(true)
  })

  it('leaves the Planner’s reads out of check spend', () => {
    const ev = simulateRun({ goal: GOAL, ...simulatePlan(GOAL) })
    const withPlanner = ev.map((e) => (e.type === 'usage' && e.farmer === 'tester' && e.kind === 'read' ? { ...e, farmer: 'planner' as const } : e))
    expect(checkCost(withPlanner)).toBeLessThan(checkCost(ev))
  })
})

describe('answering in your own words', () => {
  const opts = ['Split it in two', 'Raise its limit to $29', 'Stop it here']
  it('reads yes as the suggestion, a named option as that option, and no as the stop', () => {
    expect(readAnswer('yes, go ahead', opts[0], opts)).toBe('Split it in two')
    expect(readAnswer('just raise the limit', opts[0], opts)).toBe('Raise its limit to $29')
    expect(readAnswer('no, stop', opts[0], opts)).toBe('Stop it here')
  })
  it('says it cannot tell rather than guessing', () => {
    expect(readAnswer('hmm, what about the docs?', opts[0], opts)).toBeNull()
  })
  it('every ask carries how sure it is and why', () => {
    const ev = simulateRun({ goal: GOAL, ...simulatePlan(GOAL), autonomy: AUTONOMY_PRESETS.often })
    const asks = ev.filter((e) => e.type === 'ask')
    expect(asks.length).toBeGreaterThan(3)
    for (const a of asks) if (a.type === 'ask') expect(a.confidence && a.basis).toBeTruthy()
  })
})
