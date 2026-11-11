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
import type { Reshaped } from './reshape'
import { MODELS, SKILLS, contextName } from './kit'
import { isOwnWay, ownText, type Talk } from './discuss'

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
    `${n}: meets the task’s goal`,
    `${n}: stays under 300 ms`,
    `${n}: handles unicode`,
  ]
  const tests: TestResult[] = names.map((name, i) => ({
    name,
    pass: !(failing && i < 2),
    ms: 4 + ((i * 37) % 90),
    error: failing && i === 0 ? 'TypeError: Cannot read properties of undefined (reading "trim")' : failing && i === 1 ? 'Expected status 400, got 500' : undefined,
    why: failing && i === 0 ? 'Empty input crashes the handler' : failing && i === 1 ? 'An empty body fails with a server error, not a clear one' : undefined,
  }))
  return { kind: 'unit', tests }
}

function integration(plan: PlanTask[]): Proof {
  return {
    kind: 'integration',
    tests: plan.filter((t) => !t.gate && t.id !== 'e2e-check').map((t, i) => ({ name: `End to end: ${t.doneWhen}`, pass: true, ms: 800 + i * 410 })),
  }
}

const shot = (screen: Screen, state: 'ok' | 'overlap' | 'alt' | 'offbrand'): Proof => ({ kind: 'screens', screen, shots: [{ device: 'desktop', state }] })

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

// What a farmer does on a task, as short tool lines.
function steps(task: PlanTask, farmer: FarmerId): string[] {
  const n = lower(task.name)
  switch (farmer) {
    case 'designer':
      return ['Sketched the screen states', 'Wrote the copy', `Built the screens for ${n}`, 'Took screenshots of the built screens']
    case 'tester':
      return ['Started the app with test data', 'Checked every task’s goal', 'Ran the full test suite']
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
  // The run you've watched so far, up to t (ms): what each farmer has really spent, its limit now and how many
  // limit asks it has had. Spend limits count from these, so a change mid-run never re-asks or recounts the past.
  // raised: tasks whose raise already moved their farmer's limit in the run you watched, and said so.
  past?: { t: number; spent: Partial<Record<FarmerId, number>>; limit: Partial<Record<FarmerId, number>>; asked: Partial<Record<FarmerId, number>>; raised?: string[]; budget?: number; budgetAsked?: number }
  // Farmers you stopped at their spend limit, and the run minute they reached it. Set by the run itself:
  // a stop re-runs the simulation so nothing after it involves that farmer.
  halts?: Partial<Record<FarmerId, number>>
  // Farmers you stopped because the run reached its budget, not their own limit.
  budgetStop?: { t: number; id: string; f: FarmerId } // the run minute you stopped the whole run at its budget, and that ask
  // The project's budget for a run, in dollars: before a step would take the run over it, the Planner pauses and asks.
  budget?: number
  haltTotals?: Partial<Record<FarmerId, number>> // what each stopped farmer would have spent without the stop
  // Changes you asked the Planner for (reshape.ts): skipped tasks, no review, no Deployer, straight to everyone,
  // synthetic tests as the rollout's measure. They change what the crew does, not just its labels.
  reshape?: Reshaped
  // When you added the scenario's brand guide to the Designer's context during this run (ms). Before then it couldn't see it.
  brandAt?: number
  // When you gave a farmer back a file or skill a task failed without, by "farmer:path" or "farmer:skill" (ms).
  // Each time you turned a file or skill on or off mid-run, in order: a check sees what was on at its own moment.
  toggles?: Record<string, { t: number; on: boolean }[]>
  // Tasks an earlier run of this farm split mid-run, which this run plans in two from the start.
  presplit?: string[]
}

export const SEND_BACK = 'Send back'
// The Designer can't see the brand guide: one ask, its own id so it never renumbers the others.
export const BRAND_ASK = 'ask-brand'
export const BRAND_FIX = 'Add the brand guide'
export const BRAND_LOOK = 'Show me the Designer’s context'
// Any other file or skill a task fails without, turned off: its own ask, and its own key for when you gave it back.
export const needKey = (n: { farmer: FarmerId; path?: string; skill?: string }) => `${n.farmer}:${n.path ?? n.skill}`
export const needAsk = (n: { farmer: FarmerId; path?: string; skill?: string }) => `ask-need-${needKey(n)}`
const STOP_TASK = 'Stop this task'
interface Need { farmer: FarmerId; task: string; path?: string; skill?: string; fail: string; basis: string; redo: string }

export function simulateRun(input: SimInput): RunEvent[] {
  const { goal } = input
  const rs = input.reshape
  // The Deployer turned off: off the crew, and its release work goes to the Builder.
  const farmers = rs?.noDeployer ? input.farmers.filter((f) => f.id !== 'deployer') : input.farmers
  // Each task draws from its own seed, so an answer on one task never moves what another did before it.
  let r = rng(hash(goal + input.tasks.map((t) => t.id).join()))
  const ev: RunEvent[] = []
  const at = (min: number, e: Record<string, unknown>) => ev.push({ t: Math.round(min * MIN), ...e } as RunEvent)
  const has = (id: FarmerId) => farmers.some((f) => f.id === id)
  const label = (id: FarmerId) => farmers.find((f) => f.id === id)?.label ?? 'The farmer'
  const checker: FarmerId = has('tester') ? 'tester' : farmers[0]?.id ?? 'builder'
  const lead: FarmerId = has('planner') ? 'planner' : farmers[0]?.id ?? 'builder'
  const shipper: FarmerId = has('builder') ? 'builder' : lead
  const owner: Record<string, FarmerId> = {}
  const renamed: Record<string, string> = {}
  const doneWhen: Record<string, string> = { ...(rs?.doneWhen ?? {}) }
  let plan = input.tasks
    .filter((t) => !rs?.skip.includes(t.id))
    .map((t) => {
      const moved = rs?.noDeployer && t.farmer === 'deployer'
      if (moved) owner[t.id] = shipper
      // With the Deployer off, the release is the Builder pushing to main.
      if (moved && t.gate) {
        renamed[t.id] = 'Push to main'
        doneWhen[t.id] ??= 'Merged to main and live for everyone'
      }
      return { ...t, name: renamed[t.id] ?? t.name, farmer: moved ? shipper : t.farmer, doneWhen: doneWhen[t.id] ?? t.doneWhen }
    })
  // No review: the release merges by itself, as with shipping set to "just do it".
  const auto = rs?.noReview ? { ...(input.autonomy ?? AUTONOMY_PRESETS.matters), ship: 'auto' as const } : input.autonomy ?? AUTONOMY_PRESETS.matters
  // With "May deploy" off, every release asks you: the merge, the ship again after a rollback, and 10% to everyone.
  const asks = (m: keyof Autonomy) => auto[m] === 'ask' || ((m === 'ship' || m === 'reship') && !!input.deployAsks)
  const sc = scenario(goal).script
  // Straight to everyone: you asked for no 10% stage, or it's a small change that never had one.
  const straight = !!rs?.everyone || !!sc.direct
  // A small change takes a few steps, not a feature's worth.
  const linesFor = (task: PlanTask, f: FarmerId) => (sc.quiet && f === 'builder' ? (task.gate ? ['Built the release'] : ['Found where it lives', 'Made the change', 'Ran the existing tests']) : steps(task, f))
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
  // The first thing that needs you is money: the first builder task runs over. A small change runs clean.
  const pricey = sc.quiet ? undefined : builderTasks[0] ?? build[0]
  const failing = sc.quiet ? undefined : builderTasks.find((t) => t !== pricey) ?? build.find((t) => t !== pricey && t !== disputed)
  // The task where the Builder wants a refactor that reaches the others' code.
  const sweeping = sc.quiet ? undefined : builderTasks.find((t) => t !== pricey && t !== failing) ?? (builderTasks.length > 1 ? builderTasks[builderTasks.length - 1] : undefined)
  // What a task fails without: the files the scenario names, and the skills each role works with. Each applies
  // only when you took it away, so the plan's own run never changes.
  const evalTask = build.find((t) => t.farmer !== 'tester' && /eval/i.test(t.doneWhen))
  const e2eTask = build.find((t) => t.id === 'e2e-check')
  const lastBuilder = builderTasks[builderTasks.length - 1]
  const needs: Need[] = [
    ...(sc.needs ?? []),
    ...(builderTasks[0] ? [{ farmer: 'builder' as const, skill: 'tests', task: builderTasks[0].id, fail: 'No tests to pass: Write tests first is off for the Builder', basis: 'Write tests first is off, so I wrote no tests for it.', redo: 'Wrote its tests and ran them' }] : []),
    ...(lastBuilder ? [{ farmer: 'builder' as const, skill: 'search', task: lastBuilder.id, fail: 'One caller still uses the old code: Search the code is off, so the Builder missed it', basis: 'Search the code is off, so I looked for callers by hand and missed one.', redo: 'Searched the code and moved the last caller' }] : []),
    ...(designerTask
      ? [
          { farmer: 'designer' as const, skill: 'shots', task: designerTask.id, fail: 'No screenshots to check: Screenshot pages is off for the Designer', basis: 'Screenshot pages is off, so I had nothing to show the checker.', redo: 'Took screenshots of the built screens' },
          { farmer: 'designer' as const, skill: 'a11y', task: designerTask.id, fail: 'Fails accessibility: a field has no label and the contrast is too low. Accessibility check is off', basis: 'Accessibility check is off, so I didn’t test labels or contrast.', redo: 'Labelled the field and fixed the contrast' },
        ]
      : []),
    ...(e2eTask ? [{ farmer: 'tester' as const, skill: 'browser', task: e2eTask.id, fail: 'Can’t click through the app: Drive a browser is off for the Tester', basis: 'Drive a browser is off, so I can only run unit tests.', redo: 'Clicked through the app in a browser' }] : []),
    ...(evalTask ? [{ farmer: 'tester' as const, skill: 'evals', task: evalTask.id, fail: 'Can’t score the answers: Answer evals is off for the Tester', basis: 'Answer evals is off, so I can’t score the answers.', redo: 'Scored the answers against the eval questions' }] : []),
  ]
  const setupOf = (id: FarmerId) => farmers.find((x) => x.id === id)
  // Taken away: a file the plan gave it that it can't see now, or a skill you turned off, not yet given back by min.
  const without = (n: Need, min: number) => {
    const x = setupOf(n.farmer)
    if (!x) return false
    const now = n.path ? x.context.includes(n.path) : !x.skillsOff?.includes(n.skill!)
    // Its state at this moment: the last change at or before it, or, before any change, the opposite of the first.
    const tg = input.toggles?.[needKey(n)] ?? []
    const last = [...tg].reverse().find((c) => c.t <= min * MIN)
    const on = last ? last.on : tg.length ? !tg[0].on : now
    if (n.path) return (x.planContext ?? x.context).includes(n.path) && !on
    return !on
  }
  const perTask = Math.max(sc.quiet ? 1.5 : 5, (basis.minutes * 0.6) / Math.max(1, plan.length))
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
  // A split keeps its promise in the run itself: the steps left on the first part, and the hard cases' steps,
  // are sized so each ends on its own share, counting the check still to come on it.
  const sized: Record<string, number> = {}
  const checkRead = (t: PlanTask) => usdPer(checkerOf(t.farmer)) * (t.farmer === 'designer' ? 0.12 : 0.07)
  // A task limit you raised raises its farmer's limit by as much, so the same money is never asked about twice.
  const bumps: { f: FarmerId; t: number; by: number }[] = []
  // The hard cases of a task, as their own task, before the end-to-end check and the release.
  const restOf = (task: PlanTask): PlanTask => ({ id: `${task.id}-rest`, name: 'Hard cases', farmer: 'builder', doneWhen: `The cases left out of ${lower(task.name)} pass their own tests`, gate: false })
  const addRest = (rest: PlanTask) => {
    if (plan.some((t) => t.id === rest.id)) return
    const gateAt = plan.findIndex((t) => t.gate || t.id === 'e2e-check')
    plan = [...plan.slice(0, gateAt < 0 ? plan.length : gateAt), rest, ...plan.slice(gateAt < 0 ? plan.length : gateAt)]
    const e2e = queue.findIndex((t) => t.id === 'e2e-check')
    queue.splice(e2e < 0 ? queue.length : e2e, 0, rest)
    // Never free: a pricey checker on a cheap Builder still leaves the hard cases a third of their share.
    sized[rest.id] = Math.max(usdPer(rest.farmer) * 0.3, usdPer(rest.farmer) * 0.9 - checkRead(rest)) / steps(rest, rest.farmer).length
  }
  // Learned from an earlier run of this farm: the task that ran over is planned in two from the start, so its
  // first part runs at the plan's rate and nobody is asked about it.
  const learned = !!pricey && !!input.presplit?.includes(pricey.id) && !rs?.skip.includes(`${pricey.id}-rest`)
  if (learned) {
    addRest(restOf(pricey!))
    const pe = ev.find((e) => e.type === 'plan')
    if (pe && pe.type === 'plan') pe.tasks = plan
  }

  const usage = (min: number, f: FarmerId, task: string, usd0: number, kind: 'read' | 'write' | 'retry') => {
    const from = input.modelFrom?.[f]
    const before = from !== undefined && min * MIN < from
    const usd = before ? (usd0 * planned(f)) / rateOf(modelOf(f)) : usd0
    const rate = before ? planned(f) : rateOf(modelOf(f))
    const tokIn = Math.round((usd / 0.000004) * (0.8 + r() * 0.4))
    at(min, { type: 'usage', farmer: f, task, tokensIn: tokIn, tokensOut: Math.round(tokIn * 0.12), usd: +usd.toFixed(3), kind, rate })
  }
  const finish = (task: PlanTask, end: number, notes = task.doneWhen, evidence = ['tests/report.json'], change?: string) => {
    finished.add(task.id)
    at(end + 0.3, { type: 'task_ripe', task: task.id, summary: notes, evidence, ...(change ? { change } : {}) })
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
    // A Designer that can't see the brand guide works fast and loose: its first pass comes back early, off-brand.
    const loose = task === designerTask && !!sc.brand && !(farmers.find((x) => x.id === 'designer')?.context.includes(sc.brand) && (input.brandAt ?? 0) <= start * MIN)
    const full = perTask * (0.85 + r() * 0.4)
    const len = full * (loose ? 0.55 : 1)
    if (halted(f, start)) {
      // Its farmer was stopped before this task began: it stays out of the pull request.
      stopped.add(task.id)
      at(input.halts![f]! + 0.05, { type: 'stop', task: task.id, reason: input.budgetStop && input.halts?.[f] === input.budgetStop.t ? 'You stopped the run at its budget. This task stays out of the pull request.' : `You stopped the ${label(f)} at its spend limit. This task stays out of the pull request.` })
      continue
    }
    at(start, { type: 'task_start', task: task.id, farmer: f })
    const lines = linesFor(task, f)
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
      const cost = sized[task.id] !== undefined && (task !== pricey || learned || i > 1) ? sized[task.id] : (usdPer(f) / lines.length) * (task === pricey && !learned && i < 2 ? burn : 1)
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

      if (task === pricey && !learned && i === 1) {
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
        let approved = projected
        let at$ = tt + 0.1
        if (asks('cost')) {
          const id = `ask-${++askN}`
          at(tt + 0.1, {
            type: 'ask', id, farmer: lead, task: task.id, reason: 'cost',
            // How sure: how much of the task it has seen. Its hard cases are still ahead, and cost the most.
            confidence: seen >= 0.75 && steady ? 'high' : seen >= 0.5 && steady ? 'medium' : 'low',
            basis: `From ${i + 1} of its ${lines.length} steps, at ${stepCosts.slice(0, i + 1).map(money).join(' and ')}${steady ? ', a steady rate' : ', and rising'}. The hard cases are in the steps left, and cost the most.`,
            question: `${task.name} is over plan: ${cents(spent)} of its ${cents(budget)} spent, about half done.`,
            impact: `At this rate it ends near ${money(projected)}. Splitting it caps this part at ${cents(budget)} and gives the hard cases ${cents(rest$)} of their own, about ${money(projected - budget - rest$)} less.`,
            suggested,
            alternatives: [raise, 'Stop it here'],
          })
          c = choose(id, suggested)
          // A raise you approved stays a raise, at the amount you approved, when a model change moves the price:
          // never a stop, and never re-priced. Passing it asks again, as any limit does.
          if (c !== raise && /^Raise its limit/.test(c)) {
            approved = Number(/\$(\d+(\.\d+)?)/.exec(c)?.[1] ?? projected)
            c = raise
          }
          at(tt + 1.2, { type: 'answer', id, choice: choose(id, suggested), by: 'human' })
          at$ = tt + 1.2
        } else {
          at(tt + 0.15, { type: 'auto_fix', task: task.id, what: `${task.name} was heading to ${money(projected)}, over its ${money(budget)}. The ${label(lead)} split it in two, which saves about ${money(projected - budget - rest$)}.` })
        }
        if (c === suggested && rs?.skip.includes(`${task.id}-rest`)) {
          // Split, and the hard cases skipped: the first part stays on budget and they are left out.
          note = 'Split in two; the hard cases were skipped when you changed the plan'
          extra += 0.4
        } else if (c === suggested) {
          const rest = restOf(task)
          addRest(rest)
          at(at$ + 0.05, { type: 'replan', reason: `Split ${lower(task.name)} in two, so the first part stays on budget`, tasks: plan })
          extra += 1.3
          const asked = asks('cost') ? usdPer(lead) * 0.03 : 0
          const left = lines.length - i - 1
          if (left > 0) sized[task.id] = Math.max(0, budget - spent - asked - checkRead(task)) / left
        } else if (c === raise) {
          // Kept whole: it finishes, at the price it was heading for.
          at(at$ + 0.1, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: `Kept going under a ${money(approved)} limit` })
          usage(at$ + 0.2, f, task.id, Math.max(0, projected - spent - usdPer(f) * 0.5), 'write')
          extra += 5
          // What keeping it whole costs over splitting it, which the farmer's limit was planned on. Said once, at
          // the moment of the raise: a later change (a model, say) never re-prices it or says it again.
          if (!input.past?.raised?.includes(task.id)) {
            const by = Math.max(1, Math.ceil(approved - budget - rest$))
            const base = input.past?.limit[f] ?? farmers.find((x) => x.id === f)?.limits.usd ?? 0
            bumps.push({ f, t: Math.round((at$ + 0.05) * MIN), by })
            at(at$ + 0.05, { type: 'auto_fix', task: task.id, what: limitRaised(label(f), by, base + by) })
          }
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
      at(input.halts![f]! + 0.05, { type: 'stop', task: task.id, reason: input.budgetStop && input.halts?.[f] === input.budgetStop.t ? 'You stopped the run at its budget. This task stays out of the pull request.' : `You stopped the ${label(f)} at its spend limit. This task stays out of the pull request.` })
      free[f] = Number.MAX_SAFE_INTEGER
      continue
    }
    let end = start + len + extra
    at(end, { type: 'task_built', task: task.id, ...(loose ? { worked: Math.round((full + extra) * MIN) } : {}) })

    // The Designer can't see the brand guide, so its screens come out off-brand. The crew can't fix that alone:
    // you add the guide to its context, and it redoes the colours.
    const brand = sc.brand
    const sees = (path: string, min: number) => !!farmers.find((x) => x.id === f)?.context.includes(path) && (input.brandAt ?? 0) <= min * MIN
    if (brand && task === designerTask && f === 'designer' && !sees(brand, end + 0.4)) {
      const fix$ = usdPer(f) * 0.3
      at(end + 0.4, { type: 'check', task: task.id, by: checkerOf(f), pass: false, notes: `Off-brand: the colours don’t follow ${brand}, which isn’t in the ${label(f)}’s context`, evidence: ['evidence/screen.png'], proof: shot(sc.screen, 'offbrand') })
      at(end + 0.5, {
        type: 'ask', id: BRAND_ASK, farmer: f, task: task.id, reason: 'anomaly', confidence: 'high',
        basis: `${brand} isn’t in my context, so I guessed the colours.`,
        question: `${task.name} failed its check: it’s off-brand, because I can’t see the brand guide.`,
        impact: `Add ${brand} to my context and I’ll redo the colours. About 2 minutes and ${cents(fix$)}.`,
        suggested: BRAND_FIX, alternatives: [BRAND_LOOK],
      })
      at(end + 1.4, { type: 'answer', id: BRAND_ASK, choice: choose(BRAND_ASK, BRAND_FIX), by: 'human' })
      at(end + 1.6, { type: 'tool', farmer: f, task: task.id, tool: 'edit', summary: `Read ${brand} and redid the colours` })
      usage(end + 1.61, f, task.id, fix$, 'retry')
      end += 2.6
    }

    // Anything else it, or its checker, works without: the same failed check, ask and redo as the brand guide.
    let given = true
    for (const n of needs) {
      if (n.task !== task.id || (n.farmer !== f && n.farmer !== checkerOf(f)) || halted(n.farmer, end) || !without(n, end + 0.4)) continue
      const fix$ = usdPer(n.farmer) * 0.3
      const id = needAsk(n)
      const what = n.path ? contextName(n.path)?.toLowerCase() : undefined
      const skill = n.skill ? SKILLS[n.farmer].find((i) => i.id === n.skill)?.name ?? n.skill : undefined
      const fix = n.path ? `Add ${what ? `the ${what}` : n.path}` : `Turn on ${skill}`
      at(end + 0.4, { type: 'check', task: task.id, by: checkerOf(f), pass: false, yours: true, notes: n.fail, evidence: n.farmer === 'designer' ? ['evidence/screen.png'] : ['tests/report.json'] })
      at(end + 0.5, {
        type: 'ask', id, farmer: n.farmer, task: task.id, reason: 'anomaly', confidence: 'high', basis: n.basis,
        question: n.path ? `${task.name} failed its check, because I can’t see ${what ? `the ${what}` : n.path}.` : `${task.name} failed its check, because ${skill} is off for me.`,
        impact: `${n.path ? `Add ${n.path} to my context` : `Turn ${skill} back on`} and I’ll redo it. About 2 minutes and ${cents(fix$)}.`,
        suggested: fix, alternatives: [STOP_TASK],
        need: n.path ? { farmer: n.farmer, path: n.path } : { farmer: n.farmer, skill: n.skill },
      })
      const c = choose(id, fix)
      at(end + 1.4, { type: 'answer', id, choice: c, by: 'human' })
      if (c === STOP_TASK) {
        at(end + 1.5, { type: 'stop', task: task.id, reason: `You stopped ${lower(task.name)}. It stays out of the pull request.` })
        given = false
        end += 1.6
        break
      }
      at(end + 1.6, { type: 'tool', farmer: n.farmer, task: task.id, tool: 'edit', summary: n.redo })
      usage(end + 1.61, n.farmer, task.id, fix$, 'retry')
      end += 2.6
    }
    if (!given) {
      stopped.add(task.id)
      free[f] = end
      // The release waits for your answer: the pull request is asked about after the stop, never before it.
      lastBuilt = Math.max(lastBuilt, end + 0.5)
      continue
    }

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
      let own: string | undefined
      if (asks('disagree')) {
        const id = `ask-${++askN}`
        // What talking it through needs: both sides, and what each way costs. Yours is reworked by the Designer at a
        // retry cost and checked again, like work sent back.
        const talk: Talk = {
          topic: d.topic,
          impact: d.impact,
          sides: (['designer', 'builder'] as const).map((who) => ({ farmer: who, label: label(who), position: d[who].position, why: d[who].why, option: d[who].option })),
          usd: usdPer('builder') * 0.2,
          minutes: 2,
          ownUsd: usdPer('designer') * 0.35,
          ownMinutes: 3,
          builder: 'designer',
          checker: by,
        }
        at(end + 0.7, {
          type: 'ask', id, farmer: 'designer', task: task.id, reason: 'disagree',
          question: `The Builder and I disagree on ${d.topic}.`,
          suggested: d.designer.option, alternatives: [d.builder.option],
          talk,
        })
        const c = choose(id, d.designer.option)
        at(end + 2, { type: 'answer', id, choice: c, by: 'human' })
        if (c === d.builder.option) side = d.builder
        if (isOwnWay(c)) own = ownText(c)
      } else {
        at(end + 0.8, { type: 'auto_fix', task: task.id, what: `The Designer and Builder disagreed on ${d.topic}. The ${label(lead)} picked the Designer's way, since it fits the task’s goal.` })
      }
      if (own) {
        // Your way: the Designer builds it at a retry cost, a farmer other than its author checks it, and it's its
        // own commit in the pull request.
        at(end + 2.5, { type: 'tool', farmer: 'designer', task: task.id, tool: 'edit', summary: `Building your way: ${own}` })
        usage(end + 2.51, 'designer', task.id, usdPer('designer') * 0.35, 'retry')
        at(end + 2.52, { type: 'progress', task: task.id, value: 0.6 })
        at(end + 3.6, { type: 'tool', farmer: 'designer', task: task.id, tool: 'run', summary: 'Took screenshots of the screen at every width' })
        end += 5
        at(end, { type: 'check', task: task.id, by, pass: true, notes: `Built your way: ${own}`, evidence: ['evidence/screen.png'], proof: shot(sc.screen, 'ok') })
        changes++
        finish(task, end, `Built your way: ${own}`, ['evidence/screen.png'], `Your way: ${own}`)
        continue
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
    // The run stopped at its budget before the release, or with work left out by it: nothing goes out.
    if (input.budgetStop && (start + 0.3 >= input.budgetStop.t || stopped.size > 0)) {
      stopped.add(task.id)
      at(input.budgetStop.t + 0.05, { type: 'stop', task: task.id, reason: 'You stopped the run at its budget. This task stays out of the pull request.' })
      continue
    }
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
        const suggested = isShip ? (straight ? 'Merge and ship to everyone' : 'Merge and ship to 10%') : 'Go ahead'
        at(reviewAt + 0.3, {
          type: 'ask', id, farmer: f, task: task.id, reason: 'irreversible',
          confidence: isShip && !stopped.size && input.bugFixed ? 'high' : 'medium',
          basis: isShip
            ? stopped.size
              ? 'Every check passed, but stopped work is missing.'
              : input.bugFixed
                ? `Every check passed, and the last release of this farm ran clean.`
                : sc.direct
                  ? 'Every check passed, and it is a small change.'
                  : `Every check passed, but real users haven't seen this release yet, so 10% goes first.`
            : 'It reaches real people and is hard to undo.',
          question: isShip
            ? stopped.size
              ? `The pull request has ${shipped()} of ${built()} tasks, ${commits()} commits, and every check passed. ${stopped.size} stopped task${stopped.size === 1 ? '' : 's'} stay${stopped.size === 1 ? 's' : ''} out. Ship it without ${stopped.size === 1 ? 'it' : 'them'}?`
              : `${round ? 'The pull request is ready again' : 'The pull request is ready'}: ${commits()} commits, and every check passed.`
            : `${task.name} reaches real people. Go ahead?`,
          impact: isShip
            ? sc.direct && !rs?.everyone
              ? 'Merging ships it to every user. It is a small change, so there is no 10% stage.'
              : straight
              ? 'Merging puts it in front of every user at once. There is no 10% stage to roll back from.'
              : `Merging puts it in front of 10% of users first. ${rs?.synthetics ? 'If a synthetic test fails' : `If errors pass ${ERROR_LIMIT * 100}%`}, I roll back by myself.`
            : 'This one is hard to undo.',
          suggested,
          alternatives: isShip ? (straight ? [SEND_BACK, 'Not yet'] : [SEND_BACK, 'Ship to everyone', 'Not yet']) : ['Not yet'],
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
        everyone = c === 'Ship to everyone' || c === 'Merge and ship to everyone'
        break
      }
    } else if (isShip) {
      const to = straight ? 'shipped to everyone at once' : 'shipped to 10% first'
      at(start + 1.5, {
        type: 'auto_fix', task: task.id,
        what: rs?.noReview && rs.noDeployer
          ? `No review: the ${label(f)} pushed ${commits()} commits straight to main and ${to}.`
          : rs?.noReview
            ? `No review: the ${label(f)} merged the pull request by itself (${commits()} commits) and ${to}.`
            : `Every check passed, so the ${label(f)} merged the pull request by itself (${commits()} commits) and ${to}.`,
      })
    }
    if (straight) everyone = true
    const shipStart = reviewAt
    let t = shipStart + 1.7
    if (isShip) {
      at(t - 0.1, { type: 'tool', farmer: f, task: task.id, tool: 'run', summary: rs?.noDeployer && rs.noReview ? `Pushed straight to main (${commits()} commits)` : `Merged the pull request (${commits()} commits)` })
    }
    for (const line of linesFor(task, f)) {
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
    // Judged by synthetic tests, the rollback comes on the first failing test, not on the error rate.
    // With no 10% stage at all, nothing rolls back: everyone sees it until the fix goes out.
    const synth = !!rs?.synthetics
    const S = 12
    const mx = (errorRate: number, p95ms: number, answerScore: number, pass = S) => ({ errorRate, p95ms, answerScore, ...(synth ? { synth: { pass, total: S } } : {}) })
    const direct = straight
    if (!input.bugFixed && !sc.quiet) {
    const first = everyone ? '100%' : '10%'
    at(t, { type: 'progress', task: task.id, value: 0.3 })
    at(t + 0.1, { type: 'deploy', stage: first, metrics: mx(0.003, 1700, 0.91) })
    const bad = synth ? [0.003, 0.004, rb.peak * 0.3] : [0.003, 0.004, rb.peak * 0.3, rb.peak * 0.6, rb.peak]
    const passing = (i: number) => (synth && i === bad.length - 1 ? S - 1 : S)
    bad.forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: first, metrics: mx(e, 1700 + i * 900, 0.91 - i * 0.01, passing(i)) }))
    t += 0.6 + bad.length * 0.6
    const what = synth ? `a synthetic test failed (${S - 1} of ${S} passing)` : `errors reached ${peak}`
    if (direct) {
      // Nothing to roll back to a smaller group from: the fix goes forward, to everyone.
      at(t + 0.05, { type: 'auto_fix', task: task.id, what: `No 10% stage, so nothing rolled back: every user saw it when ${what}, for about 4 min until the ${label(has('builder') ? 'builder' : f)} pushed a fix.` })
    } else {
      at(t, { type: 'deploy', stage: 'rollback', reason: synth ? `A synthetic test failed for ${everyone ? 'every user' : 'the 10%'}: ${S - 1} of ${S} passing` : everyone ? `Errors reached ${peak} for every user, over the ${ERROR_LIMIT * 100}% limit` : `Errors reached ${peak} for the 10%, over the ${ERROR_LIMIT * 100}% limit` })
      at(t + 0.05, { type: 'auto_fix', task: task.id, what: everyone ? `Rolled back by itself when ${what}. Every user saw it for about 3 minutes.` : `Rolled back by itself when ${what}. Nobody else was affected.` })
    }
    at(t + 0.1, { type: 'progress', task: task.id, value: 0.1 })
    at(t + 0.6, { type: 'tool', farmer: f, task: task.id, tool: 'read', summary: `Read the errors: ${rb.cause}` })
    usage(t + 0.61, f, task.id, usdPer(f) * 0.1, 'read')
    const fixer: FarmerId = has('builder') ? 'builder' : f
    at(t + 1.4, { type: 'tool', farmer: fixer, task: task.id, tool: 'edit', summary: rb.fix })
    usage(t + 1.41, fixer, task.id, usdPer(fixer) * 0.3, 'retry')
    at(t + 2.2, { type: 'check', task: task.id, by: checkerOf(fixer), pass: true, notes: rb.check, evidence: [`${rb.file}: ${rb.tests.length} passed`], proof: { kind: 'unit', tests: rb.tests.map((name, i) => ({ name, pass: true, ms: 900 + i * 300 })) } })
    t += 2.6
    if (direct) {
      // The fix goes straight to everyone too.
    } else if (asks('reship')) {
      const id = `ask-${++askN}`
      at(t, { type: 'ask', id, farmer: f, task: task.id, reason: 'risk', confidence: 'high', basis: `${rb.tests.length} new tests reproduce the rollback and now pass.`, question: 'Fixed what caused the rollback. Ship to 10% again?', impact: synth ? 'Same rule as before: if a synthetic test fails, I roll back by myself.' : 'Same rule as before: if errors pass 2%, I roll back by myself.', suggested: 'Ship to 10% again', alternatives: ['Not yet'] })
      at(t + 1, { type: 'answer', id, choice: choose(id, 'Ship to 10% again'), by: 'human' })
      t += 1.1
    } else {
      at(t, { type: 'auto_fix', task: task.id, what: `Fixed what caused the rollback, so the ${label(f)} shipped to 10% again by itself.` })
    }
    }
    if (!(input.bugFixed && everyone) && !direct) {
    at(t, { type: 'progress', task: task.id, value: 0.5 })
    at(t + 0.1, { type: 'deploy', stage: '10%', metrics: mx(0.002, 1600, 0.92) })
    const good = [0.002, 0.003, 0.002, 0.003]
    good.forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: '10%', metrics: mx(e, 1600 + i * 40, 0.92) }))
    t += 0.6 + good.length * 0.6
    if (input.deployAsks) {
      const id = `ask-${++askN}`
      const go = 'Ship to everyone'
      at(t, { type: 'ask', id, farmer: f, task: task.id, reason: 'irreversible', confidence: 'high', basis: synth ? `4 readings in a row with all ${S} synthetic tests passing.` : '4 readings in a row at 0.3% errors or less.', question: synth ? `10% has been clean for ${Math.round(good.length * 0.6)} min, with ${S} of ${S} synthetic tests passing. Ship to everyone?` : `10% has been clean for ${Math.round(good.length * 0.6)} min, with errors at 0.3%. Ship to everyone?`, impact: synth ? 'Every user gets it. If a synthetic test fails, I roll back by myself.' : 'Every user gets it. If errors pass 2%, I roll back by myself.', suggested: go, alternatives: ['Stay at 10%'] })
      const c = choose(id, go)
      at(t + 1, { type: 'answer', id, choice: c, by: 'human' })
      t += 1.1
      if (c !== go) {
        at(t, { type: 'stop', task: task.id, reason: 'You kept it at 10%. Everyone else still has the last release.' })
        continue
      }
    } else {
      at(t, { type: 'auto_fix', task: task.id, what: synth ? `10% kept all ${S} synthetic tests passing, so the ${label(f)} shipped to everyone by itself.` : `10% stayed under ${ERROR_LIMIT * 100}% errors, so the ${label(f)} shipped to everyone by itself.` })
    }
    }
    at(t, { type: 'progress', task: task.id, value: 0.8 })
    at(t + 0.1, { type: 'deploy', stage: '100%', metrics: mx(0.003, 1650, 0.92) })
    ;[0.003, 0.004, 0.003].forEach((e, i) => at(t + 0.6 + i * 0.6, { type: 'monitor', stage: '100%', metrics: mx(e, 1650 + i * 30, 0.92) }))
    t += 2.4
    at(t, { type: 'task_built', task: task.id })
    const live = synth ? `Live for everyone, ${S} of ${S} synthetic tests passing in prod` : `Live for everyone, errors 0.3%, under the ${ERROR_LIMIT * 100}% limit`
    at(t + 0.2, { type: 'check', task: task.id, by: checkerOf(f), pass: true, notes: live, evidence: [synth ? 'deploy/synthetics.json' : 'deploy/metrics.json'], proof: { kind: 'rollout' } })
    finish(task, t + 0.2, synth ? `Live for everyone, ${S} of ${S} synthetic tests passing` : 'Live for everyone, errors 0.3%', [synth ? 'deploy/synthetics.json' : 'deploy/metrics.json'])
  }

  // Checking, planning and asking cost something too: the checker reads the work, the lead re-plans.
  usage(0.04, lead, plan[0]?.id ?? '', usdPer(lead) * 0.15, 'read')
  for (const e of [...ev]) {
    if (e.type === 'check') usage(e.t / MIN - 0.02, e.by, e.task, usdPer(e.by) * (e.proof?.kind === 'screens' ? 0.12 : 0.07), 'read')
    // Re-planning is the lead's own work, not any one task's.
    if (e.type === 'replan') usage(e.t / MIN - 0.02, lead, '', usdPer(lead) * 0.1, 'read')
    if (e.type === 'ask') usage(e.t / MIN - 0.02, e.farmer, e.task ?? '', usdPer(e.farmer) * 0.03, 'read')
  }
  // When the changes you asked for took effect: what they took out and changed, for the farm to show.
  if (rs) {
    const nameOf = (id: string) => input.tasks.find((k) => k.id === id)?.name ?? (/-rest$/.test(id) ? 'Hard cases' : id)
    ev.push({ t: Math.max(rs.at, Math.round(0.06 * MIN)), type: 'reshape', titles: rs.titles, removed: [...rs.skip], skipped: rs.skip.map(nameOf), off: rs.noDeployer ? ['deployer'] : [], owner, doneWhen, renamed, synthetics: rs.synthetics, everyone: rs.everyone, noReview: rs.noReview })
  }
  ev.sort((a, b) => a.t - b.t)
  // Spend limits, the same rule for every farmer at every level: the Planner pauses a farmer before the step that
  // would take it over its limit, and asks you to raise the limit or stop it there. A raise you approve is the new
  // limit, exactly: passing it asks again. A stop runs the whole simulation again with that farmer halted, so
  // nothing after involves it. A farmer that would pass its limit by a few cents is raised by the lead, not asked.
  {
    const past = input.past
    const pastT = past?.t ?? -1
    const total: Partial<Record<FarmerId, number>> = { ...past?.spent }
    for (const e of ev) if (e.type === 'usage' && e.t > pastT) total[e.farmer] = (total[e.farmer] ?? 0) + e.usd
    const spent: Partial<Record<FarmerId, number>> = { ...past?.spent }
    const limit: Partial<Record<FarmerId, number>> = { ...past?.limit }
    const asked: Partial<Record<FarmerId, number>> = { ...past?.asked }
    const done = new Set<FarmerId>()
    const stopIt = 'Stop it here'
    const fmtFor = (whole: number) => (n: number) => (whole >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)
    const limitAsk = (f: FarmerSetup, tm: number, spentNow: number, whole: number, task?: string) => {
      const now = limit[f.id] ?? f.limits.usd
      const to = Math.max(Math.ceil((whole * 1.1) / 5) * 5, Math.ceil(now) + 5)
      // Whole dollars once it's over $10, so the parts always add up to the total.
      const fmt = fmtFor(whole)
      const big = whole >= 10
      const spentS = big ? Math.round(spentNow) : +spentNow.toFixed(2)
      const wholeS = big ? Math.round(whole) : +whole.toFixed(2)
      const n = (asked[f.id] = (asked[f.id] ?? 0) + 1)
      const id = n === 1 ? `ask-limit-${f.id}` : `ask-limit-${f.id}-${n}`
      const suggested = `Raise its limit to ${money(to)}`
      // How sure: how much of what it needs is already spent, and so known.
      const known = whole > 0 ? spentNow / whole : 1
      at(tm + 0.01, {
        type: 'ask', id, farmer: lead, task, reason: 'cost', limitFor: f.id, limitTo: to,
        confidence: known >= 0.6 ? 'high' : known >= 0.35 ? 'medium' : 'low',
        basis: `${fmt(spentS)} of the ${fmt(wholeS)} is already spent; the rest is from the steps it has left.`,
        question: `The ${f.label} is about to pass its ${fmt(now)} limit, with ${fmt(spentS)} spent, so I paused it.`,
        impact: `Finishing its work needs about ${fmt(wholeS - spentS)} more, ${fmt(wholeS)} in all. Stopping it leaves its unfinished tasks out of the pull request.`,
        suggested, alternatives: [stopIt],
      })
      const c = choose(id, suggested)
      at(tm + 0.02, { type: 'answer', id, choice: c, by: 'human' })
      // The amount you approved, as you approved it.
      const m = /\$(\d+(\.\d+)?)/.exec(c)
      if (c !== stopIt) limit[f.id] = m ? Number(m[1]) : to
      return c
    }
    // The run's budget: the same rule across the whole crew. Before a step would take the run over it, the Planner
    // pauses the farmer taking it and asks: raise the budget, or stop that farmer there.
    let budget = past?.budget ?? input.budget
    let runSpent = Object.values(past?.spent ?? {}).reduce((n, x) => n + (x ?? 0), 0)
    const runWhole = ev.reduce((n, e) => n + (e.type === 'usage' && e.t > pastT ? e.usd : 0), runSpent)
    // A stop at the budget keeps the id of the ask you answered; new budget asks number on from there.
    let bAsked = (past?.budgetAsked ?? 0) + (input.budgetStop ? 1 : 0)
    const budgetAsk = (f: FarmerSetup, tm: number, spentNow: number, task?: string, kept?: string) => {
      const now = budget!
      const whole = Math.max(runWhole, spentNow)
      const to = Math.max(Math.ceil((whole * 1.1) / 5) * 5, Math.ceil(now) + 5)
      const fmt = fmtFor(whole)
      const n = kept ? 0 : ++bAsked
      const id = kept ?? (n === 1 ? 'ask-budget' : `ask-budget-${n}`)
      const suggested = `Raise the budget to ${money(to)}`
      const stop = 'Stop the run here'
      const known = whole > 0 ? spentNow / whole : 1
      at(tm + 0.01, {
        type: 'ask', id, farmer: lead, task: task || undefined, reason: 'cost', budgetFor: f.id, limitTo: to,
        confidence: known >= 0.6 ? 'high' : known >= 0.35 ? 'medium' : 'low',
        basis: `${fmt(spentNow)} of the ${fmt(whole)} is already spent; the rest is from the steps left.`,
        question: spentNow > now + 0.005 ? `This run has passed its ${fmt(now)} budget, with ${fmt(spentNow)} spent, so I paused the crew.` : `This run is about to pass its ${fmt(now)} budget, with ${fmt(spentNow)} spent, so I paused the crew.`,
        impact: `Finishing the run needs about ${fmt(Math.max(0, whole - spentNow))} more, ${fmt(whole)} in all. Stopping it here keeps what's already committed and leaves the rest, the release included, out.`,
        suggested, alternatives: [stop],
      })
      const c = choose(id, suggested)
      at(tm + 0.02, { type: 'answer', id, choice: c, by: 'human' })
      if (c !== stop) budget = Number(/\$(\d+(\.\d+)?)/.exec(c)?.[1] ?? to)
      return c === stop ? 'stop' : 'raise'
    }
    // Farmers you stopped: nothing of theirs after the minute you stopped them.
    const cuts: { f: FarmerSetup; tm: number; spentNow: number; task?: string; mine: Set<string> }[] = []
    for (const [id, tm] of Object.entries(input.halts ?? {}) as [FarmerId, number][]) {
      const f = farmers.find((x) => x.id === id)
      if (!f) continue
      const cut = tm * MIN
      const spentNow = (past?.spent[f.id] ?? 0) + ev.reduce((n, e) => n + (e.type === 'usage' && e.farmer === f.id && e.t > pastT && e.t <= cut ? e.usd : 0), 0)
      const last = [...ev].reverse().find((e) => e.type === 'task_start' && e.farmer === f.id && e.t <= cut)
      const accepted = new Set(ev.filter((x) => x.type === 'accept' && x.t <= cut).map((x) => (x.type === 'accept' ? x.task : '')))
      const mine = new Set(ev.filter((x) => x.type === 'task_start' && x.farmer === f.id && !accepted.has(x.task)).map((x) => (x.type === 'task_start' ? x.task : '')))
      const keep = ev.filter((x) => {
        if (x.t <= cut || x.type === 'goal' || x.type === 'plan' || x.type === 'farmer' || x.type === 'stop') return true
        // The whole run stopped at its budget: nothing of anyone's after that minute, releases and answers included.
        if (input.budgetStop && x.t > input.budgetStop.t * MIN) return false
        if ('farmer' in x && x.farmer === f.id && x.type !== 'ask') return false
        if ('task' in x && x.task && mine.has(x.task)) return false
        return true
      })
      ev.length = 0
      ev.push(...keep)
      cuts.push({ f, tm, spentNow, task: last && last.type === 'task_start' ? last.task : undefined, mine })
    }
    ev.sort((a, b) => a.t - b.t)
    // Raises before a stop are asked again, the same way, so the stop's ask keeps its place in the count.
    for (const e of [...ev]) {
      const bump = e.type === 'auto_fix' && e.t > pastT ? bumps.find((b) => b.t === e.t) : undefined
      if (bump) {
        const f = farmers.find((x) => x.id === bump.f)
        if (f) limit[f.id] = (limit[f.id] ?? f.limits.usd) + bump.by
        continue
      }
      if (e.type !== 'usage' || e.t <= pastT) continue
      const f = farmers.find((x) => x.id === e.farmer)
      const before = spent[e.farmer] ?? 0
      spent[e.farmer] = before + e.usd
      const runBefore = runSpent
      runSpent += e.usd
      if (!f || done.has(f.id)) continue
      if (budget !== undefined && runSpent > budget + 0.005) {
        const tmB = e.t / MIN - 0.016
        const id = `ask-budget${bAsked + 1 === 1 ? '' : `-${bAsked + 1}`}`
        if (budgetAsk(f, tmB, runBefore, e.task) === 'stop') {
          // The whole crew stops from that minute: nothing after it is spent.
          const halts = { ...input.halts }
          for (const x of farmers) halts[x.id] = Math.min(halts[x.id] ?? tmB, tmB)
          return simulateRun({ ...input, halts, budgetStop: { t: tmB, id, f: f.id } })
        }
      }
      const lim = limit[f.id] ?? f.limits.usd
      if (before + e.usd <= lim + 0.005) continue
      const tm = e.t / MIN - 0.015
      const whole = haltTotals[f.id] ?? total[f.id]!
      // Over by a few cents in all: the lead raises it to the next dollar and says so.
      if (whole - lim < Math.max(1, lim * 0.05)) {
        const to = Math.ceil(whole + 0.01)
        at(tm, { type: 'auto_fix', task: e.task, what: `The ${f.label} reached its ${fmtFor(whole)(lim)} limit with ${fmtFor(whole)(whole - before)} of work left, so the ${label(lead)} raised it to $${to}.` })
        limit[f.id] = to
        continue
      }
      const c = limitAsk(f, tm, before, whole, e.task)
      if (c === stopIt) return simulateRun({ ...input, halts: { ...input.halts, [f.id]: tm }, haltTotals: { ...input.haltTotals, [f.id]: whole } })
    }
    // The ask where you stopped each farmer, after the cut, so the cut never takes the ask itself.
    for (const k of cuts) {
      // Already asked in the run you watched: that ask stands as it was.
      const byBudget = !!input.budgetStop && k.tm === input.budgetStop.t
      if (!byBudget && !(past && k.tm * MIN <= pastT)) limitAsk(k.f, k.tm, k.spentNow, haltTotals[k.f.id] ?? total[k.f.id] ?? k.spentNow, k.task)
      const said = new Set(ev.filter((x) => x.type === 'stop').map((x) => (x.type === 'stop' ? x.task : '')))
      for (const t of k.mine) if (!said.has(t)) at(k.tm + 0.05, { type: 'stop', task: t, reason: byBudget ? 'You stopped the run at its budget. This task stays out of the pull request.' : `You stopped the ${k.f.label} at its spend limit. This task stays out of the pull request.` })
    }
    // The ask where you stopped the run at its budget, once, in its place.
    const bs = input.budgetStop
    if (bs && !(past && bs.t * MIN <= pastT)) {
      const f = farmers.find((x) => x.id === bs.f)
      const spentThen = Object.values(past?.spent ?? {}).reduce((n, x) => n + (x ?? 0), 0) + ev.reduce((n, e) => n + (e.type === 'usage' && e.t > pastT && e.t <= bs.t * MIN ? e.usd : 0), 0)
      if (f) budgetAsk(f, bs.t, spentThen, undefined, bs.id)
    }
    // Stopped at the budget: that ask is the last thing anyone asks. Nothing is merged or shipped after it.
    if (bs) {
      const end = bs.t * MIN
      const late = new Set(ev.filter((e) => e.type === 'ask' && e.id !== bs.id && e.t > end).map((e) => (e.type === 'ask' ? e.id : '')))
      const keep = ev.filter((e) => !((e.type === 'ask' || e.type === 'answer') && late.has(e.id)) && !(e.type === 'deploy' && e.t > end))
      ev.length = 0
      ev.push(...keep)
    }
    ev.sort((a, b) => a.t - b.t)
  }
  const usd = ev.reduce((s, e) => s + (e.type === 'usage' ? e.usd : 0), 0)
  const actions = ev.filter((e) => e.type === 'tool').length
  const last = ev[ev.length - 1].t
  ev.push({ t: last + 30_000, type: 'done', usd: +usd.toFixed(2), minutes: Math.round(last / MIN), asks: askN, autoFixes: ev.filter((e) => e.type === 'auto_fix').length, actions })
  return ev
}

// A farmer's limit raised along with a task's: said the same way here, in the replay and in a rebuild.
export const limitRaised = (who: string, by: number, to: number) => `You raised the task, so the ${who}'s limit went up by $${by} with it, to $${to}.`
export const LIMIT_RAISED = /so the (\w+)'s limit went up by \$\d+ with it, to \$(\d+)\./

function cents(n: number) {
  return `$${n.toFixed(2)}`
}

function money(n: number) {
  return n >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`
}

// Spend limits the plan can keep: each farmer's limit is at least what it spends on the plan's default path,
// with a margin, so the run only stops on money when something goes differently from the plan.
export function fitLimits(input: Pick<SimInput, 'goal' | 'farmers' | 'tasks' | 'estimate' | 'singleAgentEstimate'>): FarmerSetup[] {
  const wide = input.farmers.map((f) => ({ ...f, limits: { ...f.limits, usd: 1e6 } }))
  const ev = simulateRun({ ...input, farmers: wide })
  const total: Partial<Record<FarmerId, number>> = {}
  for (const e of ev) if (e.type === 'usage') total[e.farmer] = (total[e.farmer] ?? 0) + e.usd
  return input.farmers.map((f) => ({ ...f, limits: { ...f.limits, usd: Math.max(f.limits.usd, Math.ceil(((total[f.id] ?? 0) * 1.15) / 5) * 5) } }))
}
