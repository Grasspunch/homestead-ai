// Simulates a crew's run from a plan, as a run log the replay plays back.
// Deterministic for a given plan, so the same goal always runs the same way.
//
// Every run passes through the moments that matter, so you can see how each one looks:
// - something goes wrong and gets fixed without you (a failed check wilts the crop, the fix regrows it)
// - a task gets more expensive than planned, and the Planner asks to split it
// - two farmers disagree, and you settle it
// - a gated task waits for your go-ahead before it reaches real people
// - the rollout to 10% goes bad, rolls back by itself, gets fixed, and ships again

import type { Autonomy, Estimate, FarmerId, FarmerSetup, PlanTask, Proof, RunEvent, TestResult } from './types'
import { AUTONOMY_PRESETS } from './types'

const MIN = 60_000
export const ERROR_LIMIT = 0.02

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: number) {
  let x = seed || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 10_000) / 10_000
  }
}

// Test names for a task, read from its name. The first two are the ones a failing check trips on.
function unit(task: PlanTask, failing = false): Proof {
  const n = lower(task.name)
  const names = [
    `${n}: empty input returns a clear error`,
    `${n}: empty body is rejected`,
    `${n}: works on the happy path`,
    `${n}: handles a slow dependency`,
    `${n}: survives a restart`,
    `${n}: rejects a malformed request`,
    `${n}: logs no customer data`,
    `${n}: matches the done-when`,
    `${n}: stays under 300 ms`,
    `${n}: handles unicode`,
  ]
  const tests: TestResult[] = names.map((name, i) => ({
    name,
    pass: !(failing && i < 2),
    ms: 4 + ((i * 37) % 90),
    error: failing && i === 0 ? 'TypeError: Cannot read properties of undefined (reading "trim")' : failing && i === 1 ? 'Expected status 400, got 500' : undefined,
  }))
  return { kind: 'unit', tests }
}

function integration(plan: PlanTask[]): Proof {
  return {
    kind: 'integration',
    tests: plan.filter((t) => !t.gate && t.id !== 'e2e-check').map((t, i) => ({ name: `End to end: ${t.doneWhen}`, pass: true, ms: 800 + i * 410 })),
  }
}

const screens = (state: 'ok' | 'overlap'): Proof => ({ kind: 'screens', shots: [{ device: 'desktop', state }] })

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

// What a farmer does on a task, as short tool lines.
function steps(task: PlanTask, farmer: FarmerId): string[] {
  const n = lower(task.name)
  switch (farmer) {
    case 'designer':
      return ['Sketched the screen states', 'Wrote the copy', `Built the screens for ${n}`, 'Took screenshots of the built screens']
    case 'tester':
      return ['Started the app with test data', 'Ran every done-when check', 'Ran the full test suite']
    case 'deployer':
      return ['Built the release', 'Ran the smoke tests']
    case 'planner':
      return [`Read what ${n} needs`, 'Wrote the notes']
    default:
      return [`Read the code ${n} touches`, `Wrote the first pass of ${n}`, 'Added tests', 'Ran the tests']
  }
}

export interface SimInput {
  goal: string
  farmers: FarmerSetup[]
  tasks: PlanTask[]
  estimate: Estimate
  singleAgentEstimate?: Estimate
  autonomy?: Autonomy
}

export function simulateRun(input: SimInput): RunEvent[] {
  const { goal, farmers } = input
  const r = rng(hash(goal + input.tasks.map((t) => t.id).join()))
  const ev: RunEvent[] = []
  const at = (min: number, e: Record<string, unknown>) => ev.push({ t: Math.round(min * MIN), ...e } as RunEvent)
  const has = (id: FarmerId) => farmers.some((f) => f.id === id)
  const label = (id: FarmerId) => farmers.find((f) => f.id === id)?.label ?? 'The farmer'
  const checker: FarmerId = has('tester') ? 'tester' : farmers[0]?.id ?? 'builder'
  const verifier: FarmerId = has('planner') ? 'planner' : checker
  const lead: FarmerId = has('planner') ? 'planner' : farmers[0]?.id ?? 'builder'
  let plan = [...input.tasks]
  const auto = input.autonomy ?? AUTONOMY_PRESETS.matters
  const asks = (m: keyof Autonomy) => auto[m] === 'ask'

  at(0, { type: 'goal', text: goal })
  for (const f of farmers) at(0.02, { type: 'farmer', ...f })
  at(0.05, { type: 'plan', tasks: plan, estimate: input.estimate, singleAgentEstimate: input.singleAgentEstimate })

  const build = plan.filter((t) => !t.gate)
  const builderTasks = build.filter((t) => t.farmer === 'builder')
  const designerTask = build.find((t) => t.farmer === 'designer')
  const disputed = designerTask && has('builder') ? designerTask : undefined
  const pricey = builderTasks[1] ?? builderTasks[0] ?? build[0]
  const failing = builderTasks.find((t) => t !== pricey) ?? build.find((t) => t !== pricey && t !== disputed)
  // The task where the Builder wants a refactor that reaches the others' code.
  const sweeping = builderTasks.find((t) => t !== pricey && t !== failing) ?? (builderTasks.length > 1 ? builderTasks[builderTasks.length - 1] : undefined)
  const perTask = Math.max(5, (input.estimate.minutes * 0.6) / Math.max(1, plan.length))
  const usdPer = (input.estimate.usd * 0.7) / Math.max(1, plan.length)
  const free: Partial<Record<FarmerId, number>> = {}
  let lastBuilt = 0
  let askN = 0
  const queue = [...build]

  const usage = (min: number, f: FarmerId, task: string, usd: number, kind: 'read' | 'write' | 'retry') => {
    const tokIn = Math.round((usd / 0.000004) * (0.8 + r() * 0.4))
    at(min, { type: 'usage', farmer: f, task, tokensIn: tokIn, tokensOut: Math.round(tokIn * 0.12), usd: +usd.toFixed(3), kind })
  }
  const finish = (task: PlanTask, end: number, notes = task.doneWhen, evidence = ['tests/report.json']) => {
    at(end + 0.3, { type: 'task_ripe', task: task.id, summary: notes, evidence })
    at(end + 0.4, { type: 'verify', task: task.id, by: verifier, pass: true })
    // Unless you review finished work yourself, the checker's pass is the acceptance.
    if (!asks('review')) at(end + 0.6, { type: 'accept', task: task.id, by: verifier })
    free[task.farmer] = end + 0.5
    lastBuilt = Math.max(lastBuilt, end + 0.5)
  }

  while (queue.length) {
    const task = queue.shift()!
    const f = task.farmer
    const deps = task.id === 'e2e-check' ? lastBuilt : 0
    const start = Math.max(free[f] ?? 0.3, deps)
    const len = perTask * (0.85 + r() * 0.4)
    at(start, { type: 'task_start', task: task.id, farmer: f })
    const lines = steps(task, f)
    let spent = 0
    lines.forEach((s, i) => {
      const tt = start + (len * (i + 1)) / (lines.length + 1)
      at(tt, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: s })
      // The pricey task burns through its share twice as fast as planned.
      const cost = (usdPer / lines.length) * (task === pricey && i < 2 ? 2.4 : 1)
      spent += cost
      usage(tt + 0.01, f, task.id, cost, i === 0 ? 'read' : 'write')
      at(tt + 0.02, { type: 'progress', task: task.id, value: ((i + 1) / lines.length) * 0.85 })

      if (task === sweeping && i === 1) {
        const touches = plan.filter((x) => x !== task && !x.gate && x.id !== 'e2e-check' && (x.farmer === 'builder' || x.farmer === 'designer')).map((x) => x.id)
        const files = 6 + touches.length * 5
        if (asks('big')) {
          const id = `ask-${++askN}`
          at(tt + 0.1, {
            type: 'ask', id, farmer: f, task: task.id, reason: 'big', touches, files,
            question: `To finish “${task.name}” cleanly, I want to move how answers are routed into one module. That changes ${files} files across ${touches.length + 1} tasks.`,
            impact: 'The other tasks’ code moves with it. I’d run every test before and after, and it lands as one commit you can revert.',
            suggested: 'Go ahead, test everything', alternatives: ['Keep it small, no refactor'],
          })
          at(tt + 1.3, { type: 'answer', id, choice: 'Go ahead, test everything', by: 'human' })
        } else {
          at(tt + 0.2, { type: 'auto_fix', task: task.id, what: `The ${label(f)} refactored ${files} files across ${touches.length + 1} tasks. Every test passed before and after.` })
        }
        at(tt + 1.5, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: `Moved answer routing into one module (${files} files)` })
        usage(tt + 1.51, f, task.id, usdPer * 0.5, 'write')
        at(tt + 2.2, { type: 'check', task: task.id, by: checker, pass: true, notes: 'Every test still passes after the refactor', evidence: ['tests/report.json'], proof: integration(plan) })
      }

      if (task === pricey && i === 1) {
        // Too expensive: about half done, most of its money gone. The Planner asks to split it.
        const budget = Math.ceil(spent * 1.15 * 20) / 20
        const projected = spent * 3.4
        const rest$ = usdPer * 0.9
        let split = tt + 0.1
        if (asks('cost')) {
          const id = `ask-${++askN}`
          at(tt + 0.1, {
            type: 'ask', id, farmer: lead, task: task.id, reason: 'cost',
            question: `${task.name} is costing more than planned. It has used ${money(spent)} of its ${money(budget)} and is about half done.`,
            impact: `At this rate it ends near ${money(projected)}. Splitting it keeps this part on budget and gives the hard cases their own ${money(rest$)}, about ${money(projected - budget - rest$)} less.`,
            suggested: 'Split it in two',
            alternatives: [`Raise its limit to ${money(projected)}`, 'Stop it here'],
          })
          at(tt + 1.2, { type: 'answer', id, choice: 'Split it in two', by: 'human' })
          split = tt + 1.2
        } else {
          at(tt + 0.15, { type: 'auto_fix', task: task.id, what: `${task.name} was heading to ${money(projected)}, over its ${money(budget)}. The ${label(lead)} split it in two, which saves about ${money(projected - budget - rest$)}.` })
        }
        const rest: PlanTask = { id: `${task.id}-rest`, name: `Hard cases: ${lower(task.name)}`, farmer: 'builder', doneWhen: 'The cases left out of the first part pass their own tests', gate: false }
        const gateAt = plan.findIndex((t) => t.gate || t.id === 'e2e-check')
        plan = [...plan.slice(0, gateAt < 0 ? plan.length : gateAt), rest, ...plan.slice(gateAt < 0 ? plan.length : gateAt)]
        at(split + 0.05, { type: 'replan', reason: `Split ${lower(task.name)} in two, so the first part stays on budget`, tasks: plan })
        const e2e = queue.findIndex((t) => t.id === 'e2e-check')
        queue.splice(e2e < 0 ? queue.length : e2e, 0, rest)
      }
    })
    let end = start + len + (task === pricey ? 1.3 : 0) + (task === sweeping ? 2.4 : 0)
    at(end, { type: 'task_built', task: task.id })

    if (task === failing) {
      // Goes wrong, fixed without you.
      at(end + 0.4, { type: 'check', task: task.id, by: checker, pass: false, notes: '2 of 10 tests fail: empty input crashes the handler', evidence: ['tests/report.json'], proof: unit(task, true) })
      if (asks('failed')) {
        const id = `ask-${++askN}`
        at(end + 0.5, { type: 'ask', id, farmer: f, task: task.id, reason: 'anomaly', question: `${task.name} failed its check: 2 of 10 tests crash on empty input.`, impact: 'I can fix the handler and add a test for it. About 2 minutes and $0.20.', suggested: 'Fix it', alternatives: ['Show me the failures', 'Stop this task'] })
        at(end + 1.4, { type: 'answer', id, choice: 'Fix it', by: 'human' })
        end += 1
      }
      at(end + 0.9, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: 'Handled empty input and added a test for it' })
      usage(end + 0.91, f, task.id, usdPer * 0.3, 'retry')
      end += 2.4
      if (!asks('failed')) at(end, { type: 'auto_fix', task: task.id, what: `${task.name}: 2 tests failed on empty input. ${label(f)} fixed it and all 10 pass.` })
      at(end + 0.3, { type: 'check', task: task.id, by: checker, pass: true, notes: task.doneWhen, evidence: ['tests/report.json: 10 passed'], proof: unit(task) })
      finish(task, end + 0.3)
    } else if (task === disputed) {
      at(end + 0.4, { type: 'check', task: task.id, by: 'designer', pass: false, notes: 'The sources cover the reply box', evidence: ['evidence/widget.png'], proof: screens('overlap') })
      at(end + 0.6, { type: 'disagree', task: task.id, sides: [
        { farmer: 'designer', position: 'Fold the sources into one tap-to-open chip', why: 'In the 380 px chat panel the three sources take 180 px and cover the reply box. A chip keeps the box clear, and the done-when asks for the sources to be shown without getting in the way. The cost is one extra click for people who want them.' },
        { farmer: 'builder', position: 'Keep them open and make the text smaller', why: 'Support answers are only trusted when the source is visible, and a chip hides it. Dropping the sources to 12 px frees about 70 px, which clears the reply box. It is a two-line change with no new component to test.' },
      ] })
      if (asks('disagree')) {
        const id = `ask-${++askN}`
        at(end + 0.7, {
          type: 'ask', id, farmer: 'designer', task: task.id, reason: 'disagree',
          question: 'The Builder and I disagree on how the sources fit in the chat panel.',
          impact: 'People get either a tidy panel with one click to see sources, or every source at once in smaller text.',
          suggested: 'Fold into a chip', alternatives: ['Smaller text'],
        })
        at(end + 2, { type: 'answer', id, choice: 'Fold into a chip', by: 'human' })
      } else {
        at(end + 0.8, { type: 'auto_fix', task: task.id, what: `The Designer and Builder disagreed on where the sources go. The ${label(lead)} picked the Designer's chip, since the done-when asks for the sources without getting in the way.` })
      }
      at(end + 2.5, { type: 'tool', farmer: 'builder', task: task.id, tool: 'edit', summary: 'Folded the sources into a chip' })
      usage(end + 2.51, 'builder', task.id, usdPer * 0.2, 'write')
      end += 4
      at(end, { type: 'check', task: task.id, by: 'designer', pass: true, notes: task.doneWhen, evidence: ['evidence/widget.png'], proof: screens('ok') })
      finish(task, end, task.doneWhen, ['evidence/widget.png'])
    } else {
      const proof = task.id === 'e2e-check' ? integration(plan) : task.farmer === 'designer' ? screens('ok') : unit(task)
      at(end + 0.4, { type: 'check', task: task.id, by: task.farmer === 'designer' ? 'designer' : checker, pass: true, notes: task.doneWhen, evidence: ['tests/report.json'], proof })
      finish(task, end + 0.4)
    }
  }

  // Gated tasks: wait for everything, then for you.
  for (const task of plan.filter((t) => t.gate)) {
    const f = task.farmer
    const start = lastBuilt + 0.5
    at(start, { type: 'task_start', task: task.id, farmer: f })
    const isShip = /ship|deploy|launch|release|live/i.test(task.name + task.id)
    if (asks('ship')) {
      const id = `ask-${++askN}`
      at(start + 0.3, {
        type: 'ask', id, farmer: f, task: task.id, reason: 'irreversible',
        question: isShip ? `Everything passed. The pull request has ${plan.filter((x) => !x.gate).length} commits, one per task.` : `${task.name} reaches real people. Go ahead?`,
        impact: isShip ? `Merging puts it in front of 10% of users first. If errors pass ${ERROR_LIMIT * 100}%, I roll back by myself.` : 'This one is hard to undo.',
        suggested: isShip ? 'Merge and ship to 10%' : 'Go ahead',
        alternatives: isShip ? ['Not yet', 'Ship to everyone'] : ['Not yet'],
      })
      at(start + 1.5, { type: 'answer', id, choice: isShip ? 'Merge and ship to 10%' : 'Go ahead', by: 'human' })
    }
    let t = start + 1.7
    if (isShip) {
      at(t - 0.1, { type: 'tool', farmer: f, task: task.id, tool: 'run', summary: `Merged the pull request (${plan.filter((x) => !x.gate).length} commits)` })
    }
    for (const s of steps(task, f)) {
      at(t, { type: 'tool', farmer: f, task: task.id, tool: 'run', summary: s })
      usage(t + 0.01, f, task.id, usdPer * 0.15, 'write')
      t += 0.5
    }
    if (!isShip) {
      at(t, { type: 'task_built', task: task.id })
      at(t + 0.3, { type: 'check', task: task.id, by: checker, pass: true, notes: task.doneWhen })
      finish(task, t + 0.3)
      continue
    }

    // Rollout: 10%, watch, it goes bad, roll back by itself, fix, ship again, watch, everyone.
    at(t, { type: 'progress', task: task.id, value: 0.3 })
    at(t + 0.1, { type: 'deploy', stage: '10%', metrics: { errorRate: 0.003, p95ms: 1700, answerScore: 0.91 } })
    const bad = [0.003, 0.004, 0.009, 0.018, 0.031]
    bad.forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: '10%', metrics: { errorRate: e, p95ms: 1700 + i * 900, answerScore: 0.91 - i * 0.01 } }))
    t += 0.6 + bad.length * 0.6
    at(t, { type: 'deploy', stage: 'rollback', reason: `Errors reached 3.1% for the 10%, over the ${ERROR_LIMIT * 100}% limit` })
    at(t + 0.05, { type: 'auto_fix', task: task.id, what: 'Rolled back by itself when errors reached 3.1%. Nobody else was affected.' })
    at(t + 0.1, { type: 'progress', task: task.id, value: 0.1 })
    at(t + 0.6, { type: 'tool', farmer: f, task: task.id, tool: 'read', summary: 'Read the errors: long questions time out after 10 s' })
    usage(t + 0.61, f, task.id, usdPer * 0.1, 'read')
    const fixer: FarmerId = has('builder') ? 'builder' : f
    at(t + 1.4, { type: 'tool', farmer: fixer, task: task.id, tool: 'edit', summary: 'Shortened long questions before answering, added a timeout fallback' })
    usage(t + 1.41, fixer, task.id, usdPer * 0.3, 'retry')
    at(t + 2.2, { type: 'check', task: task.id, by: checker, pass: true, notes: 'Long questions answer in under 4 s', evidence: ['tests/long-questions.test.ts: 5 passed'], proof: { kind: 'unit', tests: ['a 2,000-word question answers in under 4 s', 'a timeout falls back to a person', 'short questions are unchanged', 'the fallback keeps the chat', 'no answer is cut mid-sentence'].map((name, i) => ({ name, pass: true, ms: 900 + i * 300 })) } })
    t += 2.6
    if (asks('reship')) {
      const id = `ask-${++askN}`
      at(t, { type: 'ask', id, farmer: f, task: task.id, reason: 'risk', question: 'Fixed the timeouts that caused the rollback. Ship to 10% again?', impact: 'Same rule as before: if errors pass 2%, I roll back by myself.', suggested: 'Ship to 10% again', alternatives: ['Not yet'] })
      at(t + 1, { type: 'answer', id, choice: 'Ship to 10% again', by: 'human' })
      t += 1.1
    }
    at(t, { type: 'progress', task: task.id, value: 0.5 })
    at(t + 0.1, { type: 'deploy', stage: '10%', metrics: { errorRate: 0.002, p95ms: 1600, answerScore: 0.92 } })
    const good = [0.002, 0.003, 0.002, 0.003]
    good.forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: '10%', metrics: { errorRate: e, p95ms: 1600 + i * 40, answerScore: 0.92 } }))
    t += 0.6 + good.length * 0.6
    at(t, { type: 'progress', task: task.id, value: 0.8 })
    at(t + 0.1, { type: 'deploy', stage: '100%', metrics: { errorRate: 0.003, p95ms: 1650, answerScore: 0.92 } })
    ;[0.003, 0.004, 0.003].forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: '100%', metrics: { errorRate: e, p95ms: 1650 + i * 30, answerScore: 0.92 } }))
    t += 2.4
    at(t, { type: 'task_built', task: task.id })
    at(t + 0.2, { type: 'check', task: task.id, by: f, pass: true, notes: `Live for everyone, errors 0.3%, under the ${ERROR_LIMIT * 100}% limit`, evidence: ['deploy/metrics.json'], proof: { kind: 'rollout' } })
    finish(task, t + 0.2, 'Live for everyone, errors 0.3%', ['deploy/metrics.json'])
  }

  ev.sort((a, b) => a.t - b.t)
  const usd = ev.reduce((s, e) => s + (e.type === 'usage' ? e.usd : 0), 0)
  const actions = ev.filter((e) => e.type === 'tool').length
  const last = ev[ev.length - 1].t
  ev.push({ t: last + 30_000, type: 'done', usd: +usd.toFixed(2), minutes: Math.round(last / MIN), asks: askN, autoFixes: ev.filter((e) => e.type === 'auto_fix').length, actions })
  return ev
}

function money(n: number) {
  return n >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`
}
