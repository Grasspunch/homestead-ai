// Simulates a crew's run from a plan, as a run log the replay plays back.
// Deterministic for a given plan, so the same goal always runs the same way.
//
// Every run passes through the moments that matter, so you can see how each one looks:
// - something goes wrong and gets fixed without you (a failed check wilts the crop, the fix regrows it)
// - a task gets more expensive than planned, and the Planner asks to split it
// - two farmers disagree, and you settle it
// - a gated task waits for your go-ahead before it reaches real people
// - the rollout to 10% goes bad, rolls back by itself, gets fixed, and ships again

import type { Autonomy, Estimate, FarmerId, FarmerSetup, PlanTask, Proof, RunEvent, Screen, TestResult } from './types'
import { AUTONOMY_PRESETS } from './types'
import { scenario } from './simPlan'
import { MODELS } from './kit'

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

const shot = (screen: Screen, state: 'ok' | 'overlap' | 'alt'): Proof => ({ kind: 'screens', screen, shots: [{ device: 'desktop', state }] })

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
      return ['Read what the task needs', 'Wrote the notes']
    default:
      return ['Read the code it touches', 'Wrote the first pass', 'Added tests', 'Ran the tests']
  }
}

export interface SimInput {
  goal: string
  farmers: FarmerSetup[]
  tasks: PlanTask[]
  estimate: Estimate
  singleAgentEstimate?: Estimate
  // The Planner's own estimate, which sizes each step. The estimate shown can be the simulated forecast instead.
  basis?: Estimate
  autonomy?: Autonomy
  // Your answers so far, by ask id. A different answer from the suggested one changes what happens next.
  choices?: Record<string, string>
  // Rules that need you: with "May deploy" off, the Deployer asks before every ship.
  deployAsks?: boolean
  // The models the plan was priced on, by farmer, when you've since changed one. A pricier model costs more per step.
  plannedModels?: Partial<Record<FarmerId, string>>
  // Work you sent back from the pull request review, by the ask you answered: which task, and what should change.
  sendBacks?: Record<string, { task: string; note: string }>
  // A later run of the same farm: last run's release bug is already fixed, so this release goes out clean.
  bugFixed?: boolean
  // When you changed each farmer's model mid-run (ms): its steps before then were paid at the planned model's rate.
  modelFrom?: Partial<Record<FarmerId, number>>
  // Farmers you stopped at their spend limit, and the run minute they reached it. Set by the run itself:
  // a stop re-runs the simulation so nothing after it involves that farmer.
  halts?: Partial<Record<FarmerId, number>>
  haltTotals?: Partial<Record<FarmerId, number>> // what each stopped farmer would have spent without the stop
}

export const SEND_BACK = 'Send back'

export function simulateRun(input: SimInput): RunEvent[] {
  const { goal, farmers } = input
  // Each task draws from its own seed, so an answer on one task never moves what another did before it.
  let r = rng(hash(goal + input.tasks.map((t) => t.id).join()))
  const ev: RunEvent[] = []
  const at = (min: number, e: Record<string, unknown>) => ev.push({ t: Math.round(min * MIN), ...e } as RunEvent)
  const has = (id: FarmerId) => farmers.some((f) => f.id === id)
  const label = (id: FarmerId) => farmers.find((f) => f.id === id)?.label ?? 'The farmer'
  const checker: FarmerId = has('tester') ? 'tester' : farmers[0]?.id ?? 'builder'
  const lead: FarmerId = has('planner') ? 'planner' : farmers[0]?.id ?? 'builder'
  let plan = [...input.tasks]
  const auto = input.autonomy ?? AUTONOMY_PRESETS.matters
  // With "May deploy" off, every release asks you: the merge, the ship again after a rollback, and 10% to everyone.
  const asks = (m: keyof Autonomy) => auto[m] === 'ask' || ((m === 'ship' || m === 'reship') && !!input.deployAsks)
  const sc = scenario(goal).script
  const choose = (id: string, suggested: string) => input.choices?.[id] ?? suggested
  // Never a farmer checking its own work: the Tester checks, and the Planner checks the Tester.
  const checkerOf = (f: FarmerId): FarmerId => (f !== checker ? checker : has('planner') && f !== 'planner' ? 'planner' : farmers.find((x) => x.id !== f)?.id ?? f)
  const stopped = new Set<string>()
  const finished = new Set<string>()
  let changes = 0 // commits from work you sent back
  // A farmer you stopped at its limit does nothing after that minute.
  const haltTotals = input.haltTotals ?? {}
  const halted = (id: FarmerId, min: number) => input.halts?.[id] !== undefined && min > input.halts[id]!

  at(0, { type: 'goal', text: goal })
  for (const f of farmers) at(0.02, { type: 'farmer', ...f, plannedModel: input.plannedModels?.[f.id] ?? f.plannedModel ?? f.model })
  const basis = input.basis ?? input.estimate
  at(0.05, { type: 'plan', tasks: plan, estimate: input.estimate, singleAgentEstimate: input.singleAgentEstimate, basis })

  const build = plan.filter((t) => !t.gate)
  const builderTasks = build.filter((t) => t.farmer === 'builder')
  const designerTask = build.find((t) => t.farmer === 'designer')
  const disputed = designerTask && has('builder') ? designerTask : undefined
  // The first thing that needs you is money: the first builder task runs over.
  const pricey = builderTasks[0] ?? build[0]
  const failing = builderTasks.find((t) => t !== pricey) ?? build.find((t) => t !== pricey && t !== disputed)
  // The task where the Builder wants a refactor that reaches the others' code.
  const sweeping = builderTasks.find((t) => t !== pricey && t !== failing) ?? (builderTasks.length > 1 ? builderTasks[builderTasks.length - 1] : undefined)
  const perTask = Math.max(5, (basis.minutes * 0.6) / Math.max(1, plan.length))
  // Each step costs its farmer's model rate. The plan's estimate fixes the unit; a model you changed since moves its share.
  const rateOf = (model?: string) => MODELS.find((m) => m.model === model)?.rate ?? 1
  const modelOf = (f: FarmerId) => farmers.find((x) => x.id === f)?.model
  const planned = (f: FarmerId) => rateOf(input.plannedModels?.[f] ?? modelOf(f))
  const usdUnit = (basis.usd * 0.7) / Math.max(0.05, plan.reduce((n, t) => n + planned(t.farmer), 0))
  const usdPer = (f: FarmerId) => usdUnit * rateOf(modelOf(f))
  const free: Partial<Record<FarmerId, number>> = {}
  let lastBuilt = 0
  let askN = 0
  const queue = [...build]
  // A split keeps its promise: the first part ends on its budget and the hard cases on their own share.
  type Split = { task: string; after: number; budget: number; rest: string; rest$: number }
  let split = null as Split | null

  const usage = (min: number, f: FarmerId, task: string, usd0: number, kind: 'read' | 'write' | 'retry') => {
    const from = input.modelFrom?.[f]
    const usd = from !== undefined && min * MIN < from ? (usd0 * planned(f)) / rateOf(modelOf(f)) : usd0
    const tokIn = Math.round((usd / 0.000004) * (0.8 + r() * 0.4))
    at(min, { type: 'usage', farmer: f, task, tokensIn: tokIn, tokensOut: Math.round(tokIn * 0.12), usd: +usd.toFixed(3), kind })
  }
  const finish = (task: PlanTask, end: number, notes = task.doneWhen, evidence = ['tests/report.json']) => {
    finished.add(task.id)
    at(end + 0.3, { type: 'task_ripe', task: task.id, summary: notes, evidence })
    at(end + 0.4, { type: 'verify', task: task.id, by: checkerOf(task.farmer), pass: true })
    // The checker's pass is the commit: the task goes into the pull request. You review once, at the merge.
    at(end + 0.45, { type: 'accept', task: task.id, by: checkerOf(task.farmer) })
    free[task.farmer] = end + 0.5
    lastBuilt = Math.max(lastBuilt, end + 0.5)
  }

  while (queue.length) {
    const task = queue.shift()!
    r = rng(hash(goal + task.id))
    const f = task.farmer
    const deps = task.id === 'e2e-check' ? lastBuilt : 0
    const start = Math.max(free[f] ?? 0.3, deps)
    const len = perTask * (0.85 + r() * 0.4)
    if (halted(f, start)) {
      // Its farmer was stopped before this task began: it stays out of the pull request.
      stopped.add(task.id)
      at(input.halts![f]! + 0.05, { type: 'stop', task: task.id, reason: `You stopped the ${label(f)} at its spend limit. This task stays out of the pull request.` })
      continue
    }
    at(start, { type: 'task_start', task: task.id, farmer: f })
    const lines = steps(task, f)
    let spent = 0
    let extra = 0 // minutes this task runs past its plan
    let cutAt = -1 // the line where you stopped it, if you did
    let note = task.doneWhen
    let haltedHere = false
    const stepCosts: number[] = []
    lines.forEach((line, i) => {
      if (cutAt >= 0 || haltedHere) return
      const tt = start + (len * (i + 1)) / (lines.length + 1) + extra
      // Stopped before this step's spend: the step that would have gone over never happens.
      if (halted(f, tt + 0.01)) {
        haltedHere = true
        return
      }
      at(tt, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: line })
      // The pricey task burns through its share more than twice as fast as planned; how much faster varies by task.
      const burn = i === 0 ? 2.4 : 2.4 * (0.8 + ((hash(goal + task.id + 'burn') % 1000) / 1000) * 0.5)
      const cost = (usdPer(f) / lines.length) * (task === pricey && i < 2 ? burn : 1)
      stepCosts.push(cost)
      spent += cost
      usage(tt + 0.01, f, task.id, cost, i === 0 ? 'read' : 'write')
      at(tt + 0.02, { type: 'progress', task: task.id, value: ((i + 1) / lines.length) * 0.85 })
      // The step that took it past its limit is its last.
      if (halted(f, tt + 0.03)) {
        haltedHere = true
        return
      }

      if (task === sweeping && i === 1) {
        const touches = plan.filter((x) => x !== task && !x.gate && x.id !== 'e2e-check' && (x.farmer === 'builder' || x.farmer === 'designer')).map((x) => x.id)
        const files = 6 + touches.length * 5
        let go = true
        if (asks('big')) {
          const id = `ask-${++askN}`
          const suggested = 'Go ahead, test everything'
          at(tt + 0.1, {
            type: 'ask', id, farmer: f, task: task.id, reason: 'big', touches, files,
            // How sure: how many of the tasks it reaches already have a passing check, so a break would show.
            ...(() => {
              const passing = touches.filter((id) => ev.some((x) => x.type === 'check' && x.task === id && x.pass && x.t <= tt * MIN)).length
              const share = touches.length ? passing / touches.length : 0
              return {
                confidence: share >= 0.75 ? 'high' : share >= 0.34 ? 'medium' : 'low',
                basis: `${passing} of the ${touches.length} tasks it reaches already pass their checks, so a break there would show.`,
              }
            })(),
            question: `To finish “${task.name}” cleanly, I want to ${sc.refactor.what}. That changes ${files} files across ${touches.length + 1} tasks.`,
            impact: 'The other tasks’ code moves with it. I’d run every test before and after.',
            suggested, alternatives: ['Keep it small, no refactor'],
          })
          const c = choose(id, suggested)
          at(tt + 1.3, { type: 'answer', id, choice: c, by: 'human' })
          go = c === suggested
        } else {
          at(tt + 0.2, { type: 'auto_fix', task: task.id, what: `The ${label(f)} made a change across ${files} files in ${touches.length + 1} tasks. Every test passed before and after.` })
        }
        if (go) {
          at(tt + 1.5, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: `${sc.refactor.line} (${files} files)` })
          usage(tt + 1.51, f, task.id, usdPer(f) * 0.5, 'write')
          at(tt + 2.2, { type: 'check', task: task.id, by: checkerOf(f), pass: true, notes: 'Every test still passes after the change', evidence: ['tests/report.json'], proof: integration(plan) })
          extra += 2.4
        } else {
          at(tt + 1.5, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: 'Kept the change inside this task' })
          usage(tt + 1.51, f, task.id, usdPer(f) * 0.1, 'write')
          extra += 0.6
        }
      }

      if (task === pricey && i === 1) {
        // Too expensive: about half done, most of its money gone. The Planner asks what to do.
        const budget = Math.ceil(spent * 1.15 * 20) / 20
        // The steps left cost what the last one did, twice over: the hard cases are in them.
        const projected = spent + (lines.length - i - 1) * stepCosts[i] * 2
        // How sure: how much of the task it has seen, and how steady its steps have cost.
        const steady = Math.abs(stepCosts[i] - stepCosts[0]) / stepCosts[0] < 0.12
        const seen = (i + 1) / lines.length
        const rest$ = usdPer(f) * 0.9
        const suggested = 'Split it in two'
        const raise = `Raise its limit to ${money(projected)}`
        let c = suggested
        let at$ = tt + 0.1
        if (asks('cost')) {
          const id = `ask-${++askN}`
          at(tt + 0.1, {
            type: 'ask', id, farmer: lead, task: task.id, reason: 'cost',
            // How sure: how much of the task it has seen. Its hard cases are still ahead, and cost the most.
            confidence: seen >= 0.75 && steady ? 'high' : seen >= 0.5 && steady ? 'medium' : 'low',
            basis: `From ${i + 1} of its ${lines.length} steps, at ${stepCosts.slice(0, i + 1).map(money).join(' and ')}${steady ? ', a steady rate' : ', and rising'}. The hard cases are in the steps left, and cost the most.`,
            question: `${task.name} is costing more than planned. It has used ${cents(spent)} of its ${cents(budget)} and is about half done.`,
            impact: `At this rate it ends near ${money(projected)}. Splitting it keeps this part at ${cents(budget)} and gives the hard cases their own ${cents(rest$)}, about ${money(projected - budget - rest$)} less.`,
            suggested,
            alternatives: [raise, 'Stop it here'],
          })
          c = choose(id, suggested)
          at(tt + 1.2, { type: 'answer', id, choice: c, by: 'human' })
          at$ = tt + 1.2
        } else {
          at(tt + 0.15, { type: 'auto_fix', task: task.id, what: `${task.name} was heading to ${money(projected)}, over its ${money(budget)}. The ${label(lead)} split it in two, which saves about ${money(projected - budget - rest$)}.` })
        }
        if (c === suggested) {
          const rest: PlanTask = { id: `${task.id}-rest`, name: 'Hard cases', farmer: 'builder', doneWhen: `The cases left out of ${lower(task.name)} pass their own tests`, gate: false }
          const gateAt = plan.findIndex((t) => t.gate || t.id === 'e2e-check')
          plan = [...plan.slice(0, gateAt < 0 ? plan.length : gateAt), rest, ...plan.slice(gateAt < 0 ? plan.length : gateAt)]
          at(at$ + 0.05, { type: 'replan', reason: `Split ${lower(task.name)} in two, so the first part stays on budget`, tasks: plan })
          const e2e = queue.findIndex((t) => t.id === 'e2e-check')
          queue.splice(e2e < 0 ? queue.length : e2e, 0, rest)
          extra += 1.3
          split = { task: task.id, after: at$ * MIN, budget, rest: rest.id, rest$ }
        } else if (c === raise) {
          // Kept whole: it finishes, at the price it was heading for.
          at(at$ + 0.1, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: `Kept going under a ${money(projected)} limit` })
          usage(at$ + 0.2, f, task.id, Math.max(0, projected - spent - usdPer(f) * 0.5), 'write')
          extra += 5
        } else {
          // Stopped at about half: what is built ships, the hard cases are left out.
          cutAt = i
          note = 'Stopped at about half by you: the common cases work, the hard cases are left out'
          at(at$ + 0.1, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: 'Stopped here: wrapped up the common cases' })
          at(at$ + 0.15, { type: 'stop', task: task.id, reason: `You stopped ${lower(task.name)} at about half. The hard cases are left out.` })
          extra += 1.2 - len * 0.4
        }
      }
    })
    if (haltedHere) {
      stopped.add(task.id)
      at(input.halts![f]! + 0.05, { type: 'stop', task: task.id, reason: `You stopped the ${label(f)} at its spend limit. This task stays out of the pull request.` })
      free[f] = Number.MAX_SAFE_INTEGER
      continue
    }
    let end = start + len + extra
    at(end, { type: 'task_built', task: task.id })

    if (task === failing) {
      // Goes wrong: the checker catches it.
      at(end + 0.4, { type: 'check', task: task.id, by: checkerOf(f), pass: false, notes: '2 of 10 tests fail: empty input crashes the handler', evidence: ['tests/report.json'], proof: unit(task, true) })
      let c = 'Fix it'
      if (asks('failed')) {
        const id = `ask-${++askN}`
        at(end + 0.5, { type: 'ask', id, farmer: f, task: task.id, reason: 'anomaly', confidence: 'high', basis: 'Both failing tests crash on the same empty input.', question: `${task.name} failed its check: 2 of 10 tests crash on empty input.`, impact: 'I can fix the handler and add a test for it. About 2 minutes and $0.20.', suggested: 'Fix it', alternatives: ['Show me the failures', 'Stop this task'] })
        c = choose(id, 'Fix it')
        at(end + 1.4, { type: 'answer', id, choice: c, by: 'human' })
        end += 1
      }
      if (c === 'Stop this task') {
        stopped.add(task.id)
        at(end + 0.5, { type: 'stop', task: task.id, reason: `You stopped ${lower(task.name)}. It stays out of the pull request.` })
        free[f] = end + 0.6
        continue
      }
      at(end + 0.9, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: 'Handled empty input and added a test for it' })
      usage(end + 0.91, f, task.id, usdPer(f) * 0.3, 'retry')
      end += 2.4
      if (!asks('failed')) at(end, { type: 'auto_fix', task: task.id, what: `${task.name}: 2 tests failed on empty input. ${label(f)} fixed it and all 10 pass.` })
      at(end + 0.3, { type: 'check', task: task.id, by: checkerOf(f), pass: true, notes: task.doneWhen, evidence: ['tests/report.json: 10 passed'], proof: unit(task) })
      finish(task, end + 0.3)
    } else if (task === disputed && halted('builder', end + 0.6)) {
      // The Builder was stopped, so there's nobody to disagree with: the Designer fixes its own overlap.
      const d = sc.dispute
      const by = checkerOf('designer')
      at(end + 0.4, { type: 'check', task: task.id, by, pass: false, notes: d.failNote, evidence: ['evidence/screen.png'], proof: shot(sc.screen, 'overlap') })
      at(end + 1, { type: 'tool', farmer: 'designer', task: task.id, tool: 'edit', summary: d.designer.tool })
      usage(end + 1.01, 'designer', task.id, usdPer('designer') * 0.2, 'write')
      end += 2.5
      at(end, { type: 'check', task: task.id, by, pass: true, notes: d.designer.check, evidence: ['evidence/screen.png'], proof: shot(sc.screen, d.designer.shot) })
      finish(task, end, d.designer.check, ['evidence/screen.png'])
    } else if (task === disputed) {
      const d = sc.dispute
      const by = checkerOf('designer')
      at(end + 0.4, { type: 'check', task: task.id, by, pass: false, notes: d.failNote, evidence: ['evidence/screen.png'], proof: shot(sc.screen, 'overlap') })
      at(end + 0.6, { type: 'disagree', task: task.id, sides: [
        { farmer: 'designer', position: d.designer.position, why: d.designer.why },
        { farmer: 'builder', position: d.builder.position, why: d.builder.why },
      ] })
      let side = d.designer
      if (asks('disagree')) {
        const id = `ask-${++askN}`
        at(end + 0.7, {
          type: 'ask', id, farmer: 'designer', task: task.id, reason: 'disagree',
          confidence: 'medium', basis: 'My way meets the done-when as written.',
          question: `The Builder and I disagree on ${d.topic}.`,
          impact: d.impact,
          suggested: d.designer.option, alternatives: [d.builder.option],
        })
        const c = choose(id, d.designer.option)
        at(end + 2, { type: 'answer', id, choice: c, by: 'human' })
        if (c === d.builder.option) side = d.builder
      } else {
        at(end + 0.8, { type: 'auto_fix', task: task.id, what: `The Designer and Builder disagreed on ${d.topic}. The ${label(lead)} picked the Designer's way, since it fits the done-when.` })
      }
      at(end + 2.5, { type: 'tool', farmer: 'builder', task: task.id, tool: 'edit', summary: side.tool })
      usage(end + 2.51, 'builder', task.id, usdPer('builder') * 0.2, 'write')
      end += 4
      at(end, { type: 'check', task: task.id, by, pass: true, notes: side.check, evidence: ['evidence/screen.png'], proof: shot(sc.screen, side.shot) })
      finish(task, end, side.check, ['evidence/screen.png'])
    } else {
      const proof = task.id === 'e2e-check' ? integration(plan.filter((t) => !stopped.has(t.id))) : task.farmer === 'designer' ? shot(sc.screen, 'ok') : unit(task)
      at(end + 0.4, { type: 'check', task: task.id, by: checkerOf(f), pass: true, notes: note, evidence: ['tests/report.json'], proof })
      finish(task, end + 0.4, note)
    }
  }

  // Gated tasks: wait for everything, then for you.
  r = rng(hash(goal + 'gate'))
  const rb = sc.rollout
  const peak = `${(rb.peak * 100).toFixed(1)}%`
  for (const task of plan.filter((t) => t.gate)) {
    const f = task.farmer
    const start = lastBuilt + 0.5
    at(start, { type: 'task_start', task: task.id, farmer: f })
    const isShip = /ship|deploy|launch|release|live/i.test(task.name + task.id)
    const shipped = () => [...finished].filter((id) => !plan.find((t) => t.id === id)?.gate).length
    const built = () => plan.filter((t) => !t.gate).length
    const commits = () => shipped() + changes
    // A failed check always asks; otherwise, with shipping set to "just do it", the Deployer merges by itself.
    let everyone = false
    let reviewAt = start
    if (asks('ship') || stopped.size > 0) {
      for (let round = 0; ; round++) {
        const id = `ask-${++askN}`
        const suggested = isShip ? 'Merge and ship to 10%' : 'Go ahead'
        at(reviewAt + 0.3, {
          type: 'ask', id, farmer: f, task: task.id, reason: 'irreversible',
          confidence: isShip && !stopped.size && input.bugFixed ? 'high' : 'medium',
          basis: isShip
            ? stopped.size
              ? 'Every check passed, but stopped work is missing.'
              : input.bugFixed
                ? `Every check passed, and the last release of this farm ran clean.`
                : `Every check passed, but real users haven't seen this release yet, so 10% goes first.`
            : 'It reaches real people and is hard to undo.',
          question: isShip
            ? stopped.size
              ? `The pull request has ${shipped()} of ${built()} tasks, ${commits()} commits, and every check passed. ${stopped.size} stopped task${stopped.size === 1 ? '' : 's'} stay${stopped.size === 1 ? 's' : ''} out. Ship it without ${stopped.size === 1 ? 'it' : 'them'}?`
              : `${round ? 'The pull request is ready again' : 'The pull request is ready'}: ${commits()} commits, and every check passed.`
            : `${task.name} reaches real people. Go ahead?`,
          impact: isShip ? `Merging puts it in front of 10% of users first. If errors pass ${ERROR_LIMIT * 100}%, I roll back by myself.` : 'This one is hard to undo.',
          suggested,
          alternatives: isShip ? [SEND_BACK, 'Ship to everyone', 'Not yet'] : ['Not yet'],
        })
        const c = choose(id, suggested)
        at(reviewAt + 1.5, { type: 'answer', id, choice: c, by: 'human' })
        const sb = c === SEND_BACK ? input.sendBacks?.[id] : undefined
        const back = sb && plan.find((x) => x.id === sb.task && !x.gate)
        if (sb && back) {
          // Sent back: its farmer changes it at a retry cost, a different farmer checks it, and it's a new commit.
          const bf = back.farmer
          // Checked again by someone other than its author and its first checker, when the crew has one.
          const first = checkerOf(bf)
          const again: FarmerId = farmers.find((x) => x.id !== bf && x.id !== first && x.id !== 'deployer')?.id ?? first
          const t0 = reviewAt + 1.6
          r = rng(hash(goal + back.id + sb.note))
          at(t0, { type: 'task_start', task: back.id, farmer: bf })
          at(t0 + 0.4, { type: 'tool', farmer: bf, task: back.id, tool: 'edit', summary: `Changing it: ${sb.note}` })
          usage(t0 + 0.41, bf, back.id, usdPer(bf) * 0.35, 'retry')
          at(t0 + 0.42, { type: 'progress', task: back.id, value: 0.5 })
          at(t0 + 1.2, { type: 'tool', farmer: bf, task: back.id, tool: 'edit', summary: 'Ran the tests' })
          at(t0 + 1.4, { type: 'task_built', task: back.id })
          at(t0 + 1.8, { type: 'check', task: back.id, by: again, pass: true, notes: back.doneWhen, evidence: ['tests/report.json'], proof: back.farmer === 'designer' ? shot(sc.screen, 'ok') : unit(back) })
          at(t0 + 2.1, { type: 'task_ripe', task: back.id, summary: `Changed as you asked: ${sb.note}`, evidence: ['tests/report.json'], change: sb.note })
          at(t0 + 2.2, { type: 'verify', task: back.id, by: again, pass: true })
          at(t0 + 2.25, { type: 'accept', task: back.id, by: again })
          changes++
          reviewAt = t0 + 2.3
          continue
        }
        everyone = c === 'Ship to everyone'
        break
      }
    } else if (isShip) {
      at(start + 1.5, { type: 'auto_fix', task: task.id, what: `Every check passed, so the ${label(f)} merged the pull request by itself (${commits()} commits) and shipped to 10% first.` })
    }
    const shipStart = reviewAt
    let t = shipStart + 1.7
    if (isShip) {
      at(t - 0.1, { type: 'tool', farmer: f, task: task.id, tool: 'run', summary: `Merged the pull request (${commits()} commits)` })
    }
    for (const line of steps(task, f)) {
      at(t, { type: 'tool', farmer: f, task: task.id, tool: 'run', summary: line })
      usage(t + 0.01, f, task.id, usdPer(f) * 0.15, 'write')
      t += 0.5
    }
    if (!isShip) {
      at(t, { type: 'task_built', task: task.id })
      at(t + 0.3, { type: 'check', task: task.id, by: checkerOf(f), pass: true, notes: task.doneWhen })
      finish(task, t + 0.3)
      continue
    }

    // Rollout: 10% (or everyone, if you said so), watch, it goes bad, roll back by itself, fix, ship again.
    // The bug lives in this release only the first time: on a later run of the same farm it was fixed last time.
    if (!input.bugFixed) {
    const first = everyone ? '100%' : '10%'
    at(t, { type: 'progress', task: task.id, value: 0.3 })
    at(t + 0.1, { type: 'deploy', stage: first, metrics: { errorRate: 0.003, p95ms: 1700, answerScore: 0.91 } })
    const bad = [0.003, 0.004, rb.peak * 0.3, rb.peak * 0.6, rb.peak]
    bad.forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: first, metrics: { errorRate: e, p95ms: 1700 + i * 900, answerScore: 0.91 - i * 0.01 } }))
    t += 0.6 + bad.length * 0.6
    at(t, { type: 'deploy', stage: 'rollback', reason: everyone ? `Errors reached ${peak} for every user, over the ${ERROR_LIMIT * 100}% limit` : `Errors reached ${peak} for the 10%, over the ${ERROR_LIMIT * 100}% limit` })
    at(t + 0.05, { type: 'auto_fix', task: task.id, what: everyone ? `Rolled back by itself when errors reached ${peak}. Every user saw the errors for about 3 minutes.` : `Rolled back by itself when errors reached ${peak}. Nobody else was affected.` })
    at(t + 0.1, { type: 'progress', task: task.id, value: 0.1 })
    at(t + 0.6, { type: 'tool', farmer: f, task: task.id, tool: 'read', summary: `Read the errors: ${rb.cause}` })
    usage(t + 0.61, f, task.id, usdPer(f) * 0.1, 'read')
    const fixer: FarmerId = has('builder') ? 'builder' : f
    at(t + 1.4, { type: 'tool', farmer: fixer, task: task.id, tool: 'edit', summary: rb.fix })
    usage(t + 1.41, fixer, task.id, usdPer(fixer) * 0.3, 'retry')
    at(t + 2.2, { type: 'check', task: task.id, by: checkerOf(fixer), pass: true, notes: rb.check, evidence: [`${rb.file}: ${rb.tests.length} passed`], proof: { kind: 'unit', tests: rb.tests.map((name, i) => ({ name, pass: true, ms: 900 + i * 300 })) } })
    t += 2.6
    if (asks('reship')) {
      const id = `ask-${++askN}`
      at(t, { type: 'ask', id, farmer: f, task: task.id, reason: 'risk', confidence: 'high', basis: `${rb.tests.length} new tests reproduce the rollback and now pass.`, question: 'Fixed what caused the rollback. Ship to 10% again?', impact: 'Same rule as before: if errors pass 2%, I roll back by myself.', suggested: 'Ship to 10% again', alternatives: ['Not yet'] })
      at(t + 1, { type: 'answer', id, choice: choose(id, 'Ship to 10% again'), by: 'human' })
      t += 1.1
    } else {
      at(t, { type: 'auto_fix', task: task.id, what: `Fixed what caused the rollback, so the ${label(f)} shipped to 10% again by itself.` })
    }
    }
    if (!(input.bugFixed && everyone)) {
    at(t, { type: 'progress', task: task.id, value: 0.5 })
    at(t + 0.1, { type: 'deploy', stage: '10%', metrics: { errorRate: 0.002, p95ms: 1600, answerScore: 0.92 } })
    const good = [0.002, 0.003, 0.002, 0.003]
    good.forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: '10%', metrics: { errorRate: e, p95ms: 1600 + i * 40, answerScore: 0.92 } }))
    t += 0.6 + good.length * 0.6
    if (input.deployAsks) {
      const id = `ask-${++askN}`
      const go = 'Ship to everyone'
      at(t, { type: 'ask', id, farmer: f, task: task.id, reason: 'irreversible', confidence: 'high', basis: '4 readings in a row at 0.3% errors or less.', question: `10% has been clean for ${Math.round(good.length * 0.6)} min, with errors at 0.3%. Ship to everyone?`, impact: 'Every user gets it. If errors pass 2%, I roll back by myself.', suggested: go, alternatives: ['Stay at 10%'] })
      const c = choose(id, go)
      at(t + 1, { type: 'answer', id, choice: c, by: 'human' })
      t += 1.1
      if (c !== go) {
        at(t, { type: 'stop', task: task.id, reason: 'You kept it at 10%. Everyone else still has the last release.' })
        continue
      }
    } else {
      at(t, { type: 'auto_fix', task: task.id, what: `10% stayed under ${ERROR_LIMIT * 100}% errors, so the ${label(f)} shipped to everyone by itself.` })
    }
    }
    at(t, { type: 'progress', task: task.id, value: 0.8 })
    at(t + 0.1, { type: 'deploy', stage: '100%', metrics: { errorRate: 0.003, p95ms: 1650, answerScore: 0.92 } })
    ;[0.003, 0.004, 0.003].forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: '100%', metrics: { errorRate: e, p95ms: 1650 + i * 30, answerScore: 0.92 } }))
    t += 2.4
    at(t, { type: 'task_built', task: task.id })
    at(t + 0.2, { type: 'check', task: task.id, by: checkerOf(f), pass: true, notes: `Live for everyone, errors 0.3%, under the ${ERROR_LIMIT * 100}% limit`, evidence: ['deploy/metrics.json'], proof: { kind: 'rollout' } })
    finish(task, t + 0.2, 'Live for everyone, errors 0.3%', ['deploy/metrics.json'])
  }

  // Checking, planning and asking cost something too: the checker reads the work, the lead re-plans.
  usage(0.04, lead, plan[0]?.id ?? '', usdPer(lead) * 0.15, 'read')
  for (const e of [...ev]) {
    if (e.type === 'check') usage(e.t / MIN - 0.02, e.by, e.task, usdPer(e.by) * (e.proof?.kind === 'screens' ? 0.12 : 0.07), 'read')
    if (e.type === 'replan') usage(e.t / MIN - 0.02, lead, plan[0]?.id ?? '', usdPer(lead) * 0.1, 'read')
    if (e.type === 'ask') usage(e.t / MIN - 0.02, e.farmer, e.task ?? '', usdPer(e.farmer) * 0.03, 'read')
  }
  const sp = split as Split | null
  if (sp) {
    const scaleTo = (pick: (e: Extract<RunEvent, { type: 'usage' }>) => boolean, fixed: number, to: number) => {
      const them = ev.filter((e): e is Extract<RunEvent, { type: 'usage' }> => e.type === 'usage' && pick(e))
      const sum = them.reduce((n, e) => n + e.usd, 0)
      const k = sum > 0 ? Math.max(0, to - fixed) / sum : 1
      for (const e of them) {
        e.usd = +(e.usd * k).toFixed(3)
        e.tokensIn = Math.round(e.tokensIn * k)
        e.tokensOut = Math.round(e.tokensOut * k)
      }
    }
    // What the task had spent before the split (the plan's own reading comes before its tasks exist).
    const before = ev.reduce((n, e) => n + (e.type === 'usage' && e.task === sp.task && e.t > 0.05 * MIN && e.t <= sp.after ? e.usd : 0), 0)
    scaleTo((e) => e.task === sp.task && e.t > sp.after, before, sp.budget)
    scaleTo((e) => e.task === sp.rest, 0, sp.rest$)
  }
  ev.sort((a, b) => a.t - b.t)
  // Spend limits, the same rule for every farmer at every level: the Planner pauses a farmer before the step that
  // would take it over its limit, and asks you to raise the limit or stop it there. A stop runs the whole
  // simulation again with that farmer halted, so nothing after involves it.
  {
    const total: Partial<Record<FarmerId, number>> = {}
    for (const e of ev) if (e.type === 'usage') total[e.farmer] = (total[e.farmer] ?? 0) + e.usd
    const spent: Partial<Record<FarmerId, number>> = {}
    const paused = new Set<FarmerId>()
    const stopIt = 'Stop it here'
    const limitAsk = (f: FarmerSetup, tm: number, spentNow: number, whole: number, task?: string) => {
      const to = Math.ceil((whole * 1.1) / 5) * 5
      // Whole dollars once it's over $10, so the parts always add up to the total.
      const big = whole >= 10
      const fmt = (n: number) => (big ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)
      const spentS = big ? Math.round(spentNow) : +spentNow.toFixed(2)
      const wholeS = big ? Math.round(whole) : +whole.toFixed(2)
      const id = `ask-limit-${f.id}`
      const suggested = `Raise its limit to ${money(to)}`
      at(tm + 0.01, {
        type: 'ask', id, farmer: lead, task, reason: 'cost', limitFor: f.id, limitTo: to,
        confidence: 'high', basis: 'From what it has spent and the steps it has left.',
        question: `The ${f.label} is about to pass its ${fmt(f.limits.usd)} limit, with ${fmt(spentS)} spent, so I paused it.`,
        impact: `Finishing its work needs about ${fmt(wholeS - spentS)} more, ${fmt(wholeS)} in all. Stopping it leaves its unfinished tasks out of the pull request.`,
        suggested, alternatives: [stopIt],
      })
      const c = choose(id, suggested)
      at(tm + 0.02, { type: 'answer', id, choice: c, by: 'human' })
      return c
    }
    // Farmers you stopped: the ask where you stopped each one, and nothing of theirs after it.
    for (const [id, tm] of Object.entries(input.halts ?? {}) as [FarmerId, number][]) {
      const f = farmers.find((x) => x.id === id)
      if (!f) continue
      paused.add(f.id)
      const cut = tm * MIN
      const spentNow = ev.reduce((n, e) => n + (e.type === 'usage' && e.farmer === f.id && e.t <= cut ? e.usd : 0), 0)
      const last = [...ev].reverse().find((e) => e.type === 'task_start' && e.farmer === f.id && e.t <= cut)
      const accepted = new Set(ev.filter((x) => x.type === 'accept' && x.t <= cut).map((x) => (x.type === 'accept' ? x.task : '')))
      const mine = new Set(ev.filter((x) => x.type === 'task_start' && x.farmer === f.id && !accepted.has(x.task)).map((x) => (x.type === 'task_start' ? x.task : '')))
      const keep = ev.filter((x) => {
        if (x.t <= cut || x.type === 'goal' || x.type === 'plan' || x.type === 'farmer' || x.type === 'stop') return true
        if ('farmer' in x && x.farmer === f.id && x.type !== 'ask') return false
        if ('task' in x && x.task && mine.has(x.task)) return false
        return true
      })
      ev.length = 0
      ev.push(...keep)
      // The ask where you stopped it, after the cut, so the cut never takes the ask itself.
      limitAsk(f, tm, spentNow, haltTotals[f.id] ?? total[f.id] ?? spentNow, last && last.type === 'task_start' ? last.task : undefined)
      const said = new Set(ev.filter((x) => x.type === 'stop').map((x) => (x.type === 'stop' ? x.task : '')))
      for (const k of mine) if (!said.has(k)) at(tm + 0.05, { type: 'stop', task: k, reason: `You stopped the ${f.label} at its spend limit. This task stays out of the pull request.` })
    }
    ev.sort((a, b) => a.t - b.t)
    for (const e of [...ev]) {
      if (e.type !== 'usage') continue
      const f = farmers.find((x) => x.id === e.farmer)
      const before = spent[e.farmer] ?? 0
      spent[e.farmer] = before + e.usd
      if (!f || paused.has(f.id) || before + e.usd <= f.limits.usd + 0.005) continue
      paused.add(f.id)
      const tm = e.t / MIN - 0.015
      const c = limitAsk(f, tm, before, total[f.id]!, e.task)
      if (c === stopIt) return simulateRun({ ...input, halts: { ...input.halts, [f.id]: tm }, haltTotals: { ...input.haltTotals, [f.id]: total[f.id]! } })
    }
    ev.sort((a, b) => a.t - b.t)
  }
  const usd = ev.reduce((s, e) => s + (e.type === 'usage' ? e.usd : 0), 0)
  const actions = ev.filter((e) => e.type === 'tool').length
  const last = ev[ev.length - 1].t
  ev.push({ t: last + 30_000, type: 'done', usd: +usd.toFixed(2), minutes: Math.round(last / MIN), asks: askN, autoFixes: ev.filter((e) => e.type === 'auto_fix').length, actions })
  return ev
}

function cents(n: number) {
  return `$${n.toFixed(2)}`
}

function money(n: number) {
  return n >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`
}
