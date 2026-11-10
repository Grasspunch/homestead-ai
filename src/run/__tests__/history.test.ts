import { beforeAll, describe, expect, it } from 'vitest'
import { scenario, simulatePlan } from '../simPlan'
import { simulateRun } from '../simulate'
import { duration, reduce } from '../reduce'
import { checkCost } from '../compare'
import { BY_YOU } from '../rollback'
import { needsConfirm, readAnswer, readAnswerWhy, store, type Project } from '../store'
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
    const spent = Number(/with \$([\d.]+) spent/.exec(limit.question)![1])
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
  const pr = ['Merge and ship to 10%', 'Ship to everyone', 'Not yet']
  it('reads yes as the suggestion, a named option as that option, and no as the stop', () => {
    expect(readAnswer('yes, go ahead', opts[0], opts)).toBe('Split it in two')
    expect(readAnswer('yes, split it', opts[0], opts)).toBe('Split it in two')
    expect(readAnswer('just raise the limit', opts[0], opts)).toBe('Raise its limit to $29')
    expect(readAnswer('no, stop', opts[0], opts)).toBe('Stop it here')
  })
  it('never turns a negation into the option it names, and a bare no never stops work', () => {
    expect(readAnswer('Do not raise its limit', opts[0], opts)).toBeNull()
    expect(readAnswer('no', opts[0], opts)).toBeNull()
    expect(readAnswer('no', pr[0], pr)).toBe('Not yet')
    expect(readAnswer("don't stop it", opts[0], opts)).toBeNull()
    expect(needsConfirm('Stop it here', 'cost')).toBe(true)
    expect(readAnswer("I'm not sure, don't split it", opts[0], opts)).toBeNull()
    expect(readAnswer('can you explain how the split works?', opts[0], opts)).toBeNull()
    expect(readAnswer("don't merge yet", pr[0], pr)).toBe('Not yet')
    expect(readAnswer('don’t ship to everyone', pr[0], pr)).toBe('Not yet')
    expect(readAnswer("no, don't split it", opts[0], opts)).toBeNull()
    expect(readAnswer("don't merge yet", 'Ship to 10% again', ['Ship to 10% again'])).toBeNull()
  })
  it('confirms anything hard to undo before acting on free text', () => {
    expect(needsConfirm('Ship to everyone', 'irreversible')).toBe(true)
    expect(needsConfirm('Merge and ship to 10%')).toBe(true)
    expect(needsConfirm('Not yet', 'irreversible')).toBe(false)
    expect(needsConfirm('Split it in two', 'cost')).toBe(false)
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

describe('checkpoint 15 fixes', () => {
  it('an answered ask keeps its words after a model change mid-run', () => {
    const p = store.newProject(GOAL)
    const plan = simulatePlan(GOAL)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    const ask = p.events.find((e) => e.type === 'ask')
    if (!ask || ask.type !== 'ask') throw new Error('no ask')
    store.answer(ask.id, ask.suggested)
    p.clock = ask.t + 60_000
    store.editKit(p.id, 'builder', (e) => {
      e.model = 'Claude Opus 5.5'
    })
    const again = p.events.find((e) => e.type === 'ask' && e.id === ask.id)
    expect(again && again.type === 'ask' && again.question).toBe(ask.question)
  })

  it('no farmer passes its limit without an ask first', () => {
    for (const goal of [GOAL, 'Stripe checkout for our pricing page', 'A dashboard of weekly signups']) {
      const plan = simulatePlan(goal)
      const farmers = plan.farmers.map((f) => ({ ...f, limits: { ...f.limits, usd: Math.max(1, f.limits.usd * 0.5) } }))
      const ev = simulateRun({ goal, ...plan, farmers, autonomy: AUTONOMY_PRESETS.matters })
      const s = reduce(ev, Number.MAX_SAFE_INTEGER, {}, true)
      for (const f of Object.values(s.farmers)) if (f) expect(f.usd).toBeLessThanOrEqual(f.limits.usd + 0.01)
    }
  })

  it('the first release is only fairly sure; a later run’s is sure', () => {
    const plan = simulatePlan(GOAL)
    const ship = (bugFixed: boolean) => simulateRun({ goal: GOAL, ...plan, bugFixed }).find((e) => e.type === 'ask' && e.reason === 'irreversible')
    const a = ship(false)
    const b = ship(true)
    expect(a && a.type === 'ask' && a.confidence).toBe('medium')
    expect(b && b.type === 'ask' && b.confidence).toBe('high')
  })

  it('the cost ask’s basis comes from its own numbers', () => {
    const ev = simulateRun({ goal: GOAL, ...simulatePlan(GOAL) })
    const a = ev.find((e) => e.type === 'ask' && e.reason === 'cost' && !e.limitFor)
    if (!a || a.type !== 'ask') throw new Error('no cost ask')
    const steps = ev.filter((e) => e.type === 'tool' && e.task === a.task && e.t < a.t).length
    expect(a.basis).toContain(`From ${steps} of its`)
  })

  it('confidence varies with the data, not the kind of ask', () => {
    const kinds = new Set<string>()
    for (const goal of [GOAL, 'Stripe checkout for our pricing page', 'A dashboard of weekly signups'])
      for (const bugFixed of [false, true])
        for (const e of simulateRun({ goal, ...simulatePlan(goal), bugFixed, autonomy: AUTONOMY_PRESETS.often })) if (e.type === 'ask' && e.confidence) kinds.add(e.confidence)
    expect(kinds.size).toBeGreaterThanOrEqual(2)
  })

  it('a stopped farmer is not left working', () => {
    const goal = 'Stripe checkout for our pricing page'
    const plan = simulatePlan(goal)
    const farmers = plan.farmers.map((f) => (f.id === 'builder' ? { ...f, limits: { ...f.limits, usd: 4 } } : f))
    const base = { goal, ...plan, farmers, autonomy: AUTONOMY_PRESETS.matters }
    const limit = simulateRun(base).find((e) => e.type === 'ask' && e.limitFor === 'builder')!
    const ev = simulateRun({ ...base, choices: { [limit.type === 'ask' ? limit.id : '']: 'Stop it here' } })
    const s = reduce(ev, limit.t + 5 * 60_000, {}, true)
    expect(s.farmers.builder?.state).not.toBe('working')
  })
})

describe('checkpoint 16: every phrasing from the report', () => {
  const cost = ['Split it in two', 'Raise its limit to $29', 'Stop it here']
  const pr = ['Merge and ship to 10%', 'Ship to everyone', 'Not yet']
  const promote = ['Ship to everyone', 'Stay at 10%']
  it('reads contractions and "rather" as a no, and never picks what they name', () => {
    for (const t of ["You shouldn't raise its limit", "I'd rather you didn't raise it", 'dnt split it', 'I would rather not split it', "can't raise it", 'wont split', "didn't want to split"])
      expect(readAnswer(t, cost[0], cost)).toBeNull()
    expect(readAnswer("you shouldn't merge", pr[0], pr)).toBe('Not yet')
  })
  it('reads a leading should, shall, do, can or could as a question', () => {
    for (const t of ['should we split it', 'shall I raise it', 'do we split it', 'can we split it', 'could you split it', 'would splitting help'])
      expect(readAnswerWhy(t, cost[0], cost)).toEqual({ none: 'question' })
  })
  it('never rounds a typed amount to another option', () => {
    expect(readAnswerWhy('raise it to $100', cost[0], cost)).toEqual({ none: 'amount', amount: '$100' })
    expect(readAnswer('raise it to $29', cost[0], cost)).toBe('Raise its limit to $29')
  })
  it('"not just 10%" widens, and money and Stay picks are always confirmed', () => {
    expect(readAnswer('ship to everyone, not just 10%', promote[0], promote)).toBe('Ship to everyone')
    expect(needsConfirm('Stay at 10%', 'irreversible')).toBe(true)
    expect(needsConfirm('Stay at 10%')).toBe(true)
    expect(needsConfirm('Raise its limit to $29', 'cost')).toBe(true)
    expect(needsConfirm('Not yet')).toBe(false)
    expect(readAnswer('yes, split it', cost[0], cost)).toBe('Split it in two')
  })
})

describe('checkpoint 16: a model change mid-run', () => {
  it('never puts a new ask in the past, and keeps the open ask’s numbers', () => {
    const goal = 'A dashboard of weekly signups'
    const p = store.newProject(goal)
    const plan = simulatePlan(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    const first = p.events.find((e) => e.type === 'ask')!
    if (first.type !== 'ask') throw new Error()
    store.answer(first.id, first.suggested)
    p.clock = first.t + 6 * 60_000
    for (const f of ['builder', 'designer'] as const)
      store.editKit(p.id, f, (e) => {
        e.model = 'Claude Opus 5.5'
      })
    const answered = p.answers ?? {}
    const past = p.events.filter((e) => e.type === 'ask' && e.t < p.clock! && !answered[e.id])
    // At most the one ask open now, and it is still unanswered in the log until you answer it.
    for (const a of past) expect(p.events.some((e) => e.type === 'answer' && e.id === (a.type === 'ask' ? a.id : '') && e.t < p.clock!)).toBe(false)
  })
})

describe('checkpoint 16: decisions are counted where you made them', () => {
  it('a Stop it here answer is one of your decisions', () => {
    const goal = 'Stripe checkout for our pricing page'
    const plan = simulatePlan(goal)
    const farmers = plan.farmers.map((f) => (f.id === 'builder' ? { ...f, limits: { ...f.limits, usd: 6 } } : f))
    const base = { goal, ...plan, farmers, autonomy: AUTONOMY_PRESETS.matters }
    const limit = simulateRun(base).find((e) => e.type === 'ask' && e.limitFor === 'builder')!
    const id = limit.type === 'ask' ? limit.id : ''
    const ev = simulateRun({ ...base, choices: { [id]: 'Stop it here' } })
    const answers: Record<string, string> = { [id]: 'Stop it here' }
    for (const e of ev) if (e.type === 'answer' && e.id !== id) answers[e.id] = e.choice
    const s = reduce(ev, Number.MAX_SAFE_INTEGER, answers)
    const decided = s.asks.filter((a) => a.answer)
    expect(decided.map((a) => a.answer!.choice)).toContain('Stop it here')
    expect(decided.length).toBe(Object.keys(answers).filter((k) => s.asks.some((a) => a.id === k)).length)
  })
})
