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
        expect(end.tasks.every((t) => t.status === 'accepted')).toBe(true)
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
  // Spend-limit asks come at every level, so they're left out of the comparison.
  const asks = (ev: ReturnType<typeof run>) => ev.filter((e) => e.type === 'ask' && !e.limitFor).map((e) => (e.type === 'ask' ? e.reason : ''))

  it('splits the pricey task with a replan, and rolls back a bad rollout by itself', () => {
    const ev = run('matters')
    expect(ev.some((e) => e.type === 'replan')).toBe(true)
    expect(ev.some((e) => e.type === 'deploy' && e.stage === 'rollback')).toBe(true)
    expect(ev.filter((e) => e.type === 'monitor').length).toBeGreaterThan(5)
    const end = reduce(ev, duration(ev))
    expect(end.tasks.length).toBe(plan.tasks.length + 1)
    expect(end.tasks.every((t) => t.status === 'accepted')).toBe(true)
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

describe('your answers branch the run', () => {
  const plan = simulatePlan(GOAL)
  const base = { goal: GOAL, ...plan, autonomy: AUTONOMY_PRESETS.often }
  const run = (choices?: Record<string, string>) => simulateRun({ ...base, choices })
  const asksOf = (ev: ReturnType<typeof run>) => ev.filter((e) => e.type === 'ask')
  const first = asksOf(run())[0]

  it('asks about cost first', () => {
    expect(first.type === 'ask' && first.reason).toBe('cost')
  })

  it('gives a different run for a different cost answer', () => {
    if (first.type !== 'ask') throw new Error()
    const split = run()
    const stop = run({ [first.id]: 'Stop it here' })
    const raise = run({ [first.id]: first.alternatives!.find((a) => a.startsWith('Raise'))! })
    const end = (ev: typeof split) => ev.find((e) => e.type === 'done')!
    expect(JSON.stringify(stop)).not.toBe(JSON.stringify(split))
    expect(JSON.stringify(raise)).not.toBe(JSON.stringify(split))
    expect(split.some((e) => e.type === 'replan')).toBe(true)
    expect(stop.some((e) => e.type === 'replan')).toBe(false)
    expect(stop.some((e) => e.type === 'stop')).toBe(true)
    const usd = (ev: typeof split) => { const d = end(ev); return d.type === 'done' ? d.usd : 0 }
    expect(usd(raise)).toBeGreaterThan(usd(split))
    // The answer in the log is the one you gave, and the run up to the ask is the same.
    const ans = stop.find((e) => e.type === 'answer' && e.id === first.id)
    expect(ans && ans.type === 'answer' && ans.choice).toBe('Stop it here')
    const before = (ev: typeof split) => JSON.stringify(ev.filter((e) => e.t <= first.t))
    expect(before(stop)).toBe(before(split))
  })

  it('ships to everyone when you skip the 10% stage, and every user sees the bad release', () => {
    const ship = asksOf(run()).find((a) => a.type === 'ask' && a.reason === 'irreversible' && /10%/.test(a.suggested))
    if (!ship || ship.type !== 'ask') throw new Error('no ship ask')
    const all = ship.alternatives!.find((a) => /everyone/i.test(a))!
    const ev = run({ [ship.id]: all })
    const deploys = ev.filter((e) => e.type === 'deploy').map((e) => (e.type === 'deploy' ? e.stage : ''))
    expect(deploys[0]).toBe('100%')
  })

  it('leaves a stopped failing task out of the pull request', () => {
    const fail = asksOf(run()).find((a) => a.type === 'ask' && a.reason === 'anomaly')
    if (!fail || fail.type !== 'ask') throw new Error('no failed-check ask')
    const ev = run({ [fail.id]: 'Stop this task' })
    const s = reduce(ev, Number.MAX_SAFE_INTEGER)
    const t = s.tasks.find((x) => x.id === fail.task)!
    expect(t.stopped).toBeTruthy()
    expect(t.status).not.toBe('accepted')
  })
})

describe('one pull request review', () => {
  const plan = simulatePlan(GOAL)
  const base = { goal: GOAL, ...plan, autonomy: AUTONOMY_PRESETS.matters }
  const shipAsk = (ev: ReturnType<typeof simulateRun>) => ev.filter((e) => e.type === 'ask' && e.reason === 'irreversible').pop()

  it('commits each task when its check passes, with no ask per task', () => {
    const ev = simulateRun(base)
    const s = reduce(ev, Number.MAX_SAFE_INTEGER)
    expect(s.tasks.filter((t) => !t.gate).every((t) => t.status === 'accepted')).toBe(true)
    const ship = shipAsk(ev)
    expect(ship && ship.type === 'ask' && ship.alternatives).toContain('Send back')
    expect(ship && ship.type === 'ask' && ship.question).toMatch(/\d+ commits/)
  })

  it('sends a task back from the review: a new check, a retry cost, and the review again', () => {
    const first = shipAsk(simulateRun(base))
    if (!first || first.type !== 'ask') throw new Error('no ship ask')
    const task = plan.tasks.find((t) => !t.gate)!
    const ev = simulateRun({ ...base, choices: { [first.id]: 'Send back' }, sendBacks: { [first.id]: { task: task.id, note: 'friendlier copy' } } })
    const again = shipAsk(ev)
    expect(again && again.type === 'ask' && again.id).not.toBe(first.id)
    expect(again && again.type === 'ask' && again.question).toMatch(/ready again/)
    expect(ev.some((e) => e.type === 'task_ripe' && e.task === task.id && e.change === 'friendlier copy')).toBe(true)
    expect(ev.some((e) => e.type === 'check' && e.notes.includes('friendlier copy'))).toBe(false)
    expect(ev.some((e) => e.type === 'usage' && e.task === task.id && e.kind === 'retry')).toBe(true)
    const usd = (x: typeof ev) => x.reduce((n, e) => n + (e.type === 'usage' ? e.usd : 0), 0)
    expect(usd(ev)).toBeGreaterThan(usd(simulateRun(base)))
    const s = reduce(ev, Number.MAX_SAFE_INTEGER, { [first.id]: 'Send back' })
    expect(s.tasks.find((t) => t.id === task.id)?.changes).toEqual(['friendlier copy'])
  })

  it('merges by itself when shipping is trusted and every check passed', () => {
    const ev = simulateRun({ ...base, autonomy: { ...AUTONOMY_PRESETS.matters, ship: 'auto' } })
    expect(shipAsk(ev)).toBeUndefined()
    expect(ev.some((e) => e.type === 'auto_fix' && /merged the pull request by itself/.test(e.what))).toBe(true)
  })

  it('still asks to merge when a task was stopped', () => {
    const often = { ...base, autonomy: { ...AUTONOMY_PRESETS.often, ship: 'auto' as const } }
    const fail = simulateRun(often).find((e) => e.type === 'ask' && e.reason === 'anomaly')
    if (!fail || fail.type !== 'ask') throw new Error('no failed-check ask')
    expect(shipAsk(simulateRun({ ...often, choices: { [fail.id]: 'Stop this task' } }))).toBeTruthy()
  })
})

describe('nobody grades its own work', () => {
  it('every check, verify and accept comes from a different farmer', () => {
    for (const g of [GOAL, 'Add a checkout with Stripe', 'Build a metrics dashboard', 'Plan a hiring sprint']) {
      for (const n of [2, 3, 5]) {
        const plan = simulatePlan(g, n)
        const ev = simulateRun({ goal: g, ...plan, autonomy: AUTONOMY_PRESETS.often })
        const owner = new Map<string, string>()
        for (const e of ev) if (e.type === 'task_start') owner.set(e.task, e.farmer)
        for (const e of ev) if ((e.type === 'check' || e.type === 'verify' || e.type === 'accept') && owner.has(e.task)) expect(e.by, `${g} ${n} ${e.type} ${e.task}`).not.toBe(owner.get(e.task))
      }
    }
  })
})

describe('crew against one agent, fairly', () => {
  it('prices one Sonnet agent with no checks, from the finished run', () => {
    const plan = simulatePlan(GOAL)
    const ev = simulateRun({ goal: GOAL, ...plan })
    const s = reduce(ev, Number.MAX_SAFE_INTEGER)
    expect(s.soloActual).toBeTruthy()
    // No check cost in the single agent's total: it's under the crew's, which pays for the Tester.
    expect(s.soloActual!.usd).toBeLessThan(s.done!.usd)
    expect(s.soloActual!.minutes).toBeGreaterThan(s.done!.minutes)
  })

  it('pauses a farmer at its spend limit and asks to raise it', () => {
    const plan = simulatePlan(GOAL)
    const ev = simulateRun({ goal: GOAL, ...plan, autonomy: AUTONOMY_PRESETS.matters })
    const ask = ev.find((e) => e.type === 'ask' && e.limitFor)
    expect(ask).toBeTruthy()
    const s = reduce(ev, Number.MAX_SAFE_INTEGER, {}, true)
    for (const f of Object.values(s.farmers)) if (f) expect(f.usd).toBeLessThanOrEqual(f.limits.usd + 0.01)
  })

  it('asks before every release when May deploy is off', () => {
    const plan = simulatePlan(GOAL)
    const ev = simulateRun({ goal: GOAL, ...plan, deployAsks: true, autonomy: AUTONOMY_PRESETS.undoable })
    const qs = ev.filter((e) => e.type === 'ask').map((e) => (e.type === 'ask' ? e.question : ''))
    expect(qs.some((q) => /Ship to 10% again/.test(q))).toBe(true)
    expect(qs.some((q) => /Ship to everyone\?/.test(q))).toBe(true)
  })
})

describe('the limit ask has a real no', () => {
  it('stops the farmer: its unfinished tasks stay out, and it spends nothing more', () => {
    const plan = simulatePlan(GOAL)
    const base = { goal: GOAL, ...plan, autonomy: AUTONOMY_PRESETS.undoable }
    const ask = simulateRun(base).find((e) => e.type === 'ask' && e.limitFor)
    if (!ask || ask.type !== 'ask') throw new Error('no limit ask')
    expect(ask.impact).not.toMatch(/\$0\.00/)
    const ev = simulateRun({ ...base, choices: { [ask.id]: 'Stop it here' } })
    expect(ev.some((e) => e.type === 'usage' && e.farmer === ask.limitFor && e.t > ask.t + 2000)).toBe(false)
    expect(ev.some((e) => e.type === 'stop')).toBe(true)
  })

  it('never counts a recorded answer you did not give', () => {
    const plan = simulatePlan(GOAL)
    const ev = simulateRun({ goal: GOAL, ...plan })
    const s = reduce(ev, Number.MAX_SAFE_INTEGER)
    expect(s.asks.every((a) => !a.answer)).toBe(true)
  })
})
