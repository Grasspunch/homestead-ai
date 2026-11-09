// The engine behind the demo.
// Five agent steps are Claude calls (the head farmer's clarify, plan and cross-team check, Frontend's
// session call and the Reviewer's review). They are simulated unless Live AI is on in Settings.
// Every number on screen is computed from the ledger: agent actions, energy, and how many times a human was needed.

import { ATTACHMENTS, BEATS, BRIEF_GOAL, BUILDERS, CHICKEN_PEN, CHORES, CLARIFY, CLASH, CREW, CROW_SPOT, FARM, LESSON_STAGING, LESSON_TRACE, MISSING, NEIGHBOUR, REPLAN_SUBTASKS, ROLE_ORDER, START_SEEDS, SUGGESTED_BUDGET, TASKS, type Attachment, type ClarifyQ } from './scenario'
import { callAgent, probeLive, setLiveAI, RECORDED, type ClarifyOut, type ConflictOut, type Outcome, type PlanOut, type ReviewOut, type SessionOut } from './live'
import { conflictDocs, PR_DIFF, SLOTS } from '../agent/agents'
import { LIBRARY, libItem, type Access } from './library'
import { CHECKS, COMMITS, E2E_FAIL, GATE_ORDER, GATES, OUTPUT, RESULTS, REVIEW_FAIL, TASK_GATES, TASK_RESULTS, UNIT_FAIL, type Check, type GateId, type GateState } from './review'
import { defaultSettings, toml, usd, type Settings } from './settings'
import { cartGate, CI_JOBS, HEALTH, LESSON_REDIRECT, RELEASE, SHIP_TEXT, SHIP_TIMES, healthOk, fmtHealth, type CiOutcome, type CiState, type ShipStage } from './ship'
import { expandSignposts } from '../agent/docs'
import { DEFAULT_TEAM, crewAsTemplate, teamTemplate, type GateKey, type TeamTemplate } from './templates'
import type { Ask, CropKind, Dir, Farmhand, Flag, Job, LedgerEvent, LogEntry, Phase, ReasonLabel, Rect, Replan, RoleId, Seed, Subtask, Task, Toast } from './types'

const WALK_SPEED = 3.4 // tiles per second
const CROW_FLIGHT = 2.2 // seconds

export type View = 'farm' | 'valley'

// Where the side panel is. An empty stack is the overview; each entry is one level deeper.
export type Nav =
  | { kind: 'step'; id: Phase | 'plant' }
  | { kind: 'task'; id: string }
  | { kind: 'log'; tab: LogTab }
  | { kind: 'why'; id: string }
  | { kind: 'trace' }
  | { kind: 'out'; id: OutId }
  | { kind: 'lib'; id: string }
  | { kind: 'pick'; id: string }
  | { kind: 'library' }
  | { kind: 'settings'; id?: string }
export type OutId = 'pr' | GateId | 'guide' | 'decisions' | 'lessons'
export type LogTab = 'all' | 'asks' | 'auto'

export type Hint = 'plot' | 'ask' | 'auto'

export interface GateResult {
  state: GateState
  text: string
}

interface Walker {
  x: number
  y: number
  path: { x: number; y: number }[]
  dir: Dir
}

// The head farmer is drawn doing a visible version of each model call it waits on.
export interface HeadFarmer extends Walker {
  anim: 'idle' | 'walk' | 'till'
  speed: number
  scrollT: number // seconds spent lifting files out of the chest
  till: number[] // 0..1 per plot while the plan comes in
}

export { BEATS }

export interface Chicken {
  x: number
  y: number
  tx: number
  ty: number
  wait: number
  clicks: number
  lastClick: number
  flee: number // seconds left running off
}

export interface CrowState {
  state: 'none' | 'flying' | 'landed' | 'leaving' | 'gone'
  t: number
  x: number
  y: number
}

export interface SeedFly {
  from: { x: number; y: number }
  to: { x: number; y: number }
  t: number
}

export interface Outputs {
  clarify?: Outcome<ClarifyOut>
  plan?: Outcome<PlanOut>
  session?: Outcome<SessionOut>
  review?: Outcome<ReviewOut>
  conflict?: Outcome<ConflictOut>
}

export class Engine {
  version = 0
  private listeners = new Set<() => void>()
  private dirty = false
  private lastNotify = 0

  // global
  phase: Phase = 'brief'
  t = 0 // simulated seconds since "Approve and start"
  clock = 0 // real seconds since load, for animation
  speed = 1
  paused = false
  view: View = 'valley'
  intro = true // the opening beats over the valley
  beat = 0
  beatT = 0
  ready = false // sprites and fonts are loaded
  bootT = 0 // clock when the valley started drawing in
  // harvest: first on the map, then the review in the panel
  harvestStage: 'map' | 'review' = 'map'
  harvestT = 0
  picked = new Set<string>() // plots already carried to the shipping chest
  carrying: Partial<Record<RoleId, CropKind>> = {}
  private harvestJobs: Partial<Record<RoleId, { taskId: string; stage: number; t: number }>> = {}
  // Done-when gates: which ones each task carries (set at Plan), and how each one did.
  taskGates: Record<string, GateId[]> = Object.fromEntries(Object.entries(TASK_GATES).map(([k, v]) => [k, v.map((g) => g.gate)]))
  gates: Record<string, Partial<Record<GateId, GateResult>>> = {}
  private gateRunAt: Record<string, number> = {}
  // The whole run's gates at the harvest. The review runs here, on the whole diff.
  harvestGates: Record<GateId, GateResult> = Object.fromEntries(GATE_ORDER.map((g) => [g, { state: 'wait', text: 'Not run yet' }])) as Record<GateId, GateResult>
  private rerunAt = 0
  reviewFixed = false
  ticked = new Set<string>()
  approved = false
  // The merge: the one step that reaches people outside the crew.
  sendState: 'none' | 'confirming' | 'sent' = 'none'
  // Ship: CI on main, then a canary deploy that rolls back by itself when a health check fails.
  shipStage: ShipStage = 'none'
  private shipT = 0 // seconds into the current ship stage
  ciIndex = 0
  ci: Record<string, { state: CiState; text: string }> = Object.fromEntries(CI_JOBS.map((j) => [j.id, { state: 'wait', text: 'Waiting' }]))
  ciOutcomes: Record<string, CiOutcome> = Object.fromEntries(CI_JOBS.map((j) => [j.id, j.outcome]))
  health: Record<string, { value: number; ok: boolean; seen: boolean }> = Object.fromEntries(HEALTH.map((h) => [h.id, { value: h.good, ok: true, seen: false }]))
  rollout = 0 // percent of users on the new version
  deploys = 0
  rolledBack = false
  // The cart that carries the harvest out of the valley: k runs 0..1 along its road.
  cart: { state: 'none' | 'loaded' | 'out' | 'back' | 'gate' | 'away'; k: number; crow: boolean } = { state: 'none', k: 0, crow: false }
  settings: Settings = defaultSettings()
  access: Record<string, Access[]> = Object.fromEntries(Object.entries(LIBRARY).filter(([, v]) => v.access).map(([k, v]) => [k, v.access!.map((a) => ({ ...a }))]))
  showHelp = false
  // The agent tree, opened with Tab.
  treeOpen = false
  live: boolean | null = null // whether a key is configured; null until probed
  liveAI = readLiveAI() // real model calls; off by default so testing spends no tokens

  // brief
  goal = BRIEF_GOAL
  attachments: Attachment[] = ATTACHMENTS.map((a) => ({ ...a }))
  budget = SUGGESTED_BUDGET
  crew = DEFAULT_TEAM // the team template the plan staffs from
  customTeams: TeamTemplate[] = [] // crews saved from a run
  questions: ClarifyQ[] = []
  questTitle = FARM.name // farms are named after their project, everywhere
  signpostEdits: string[] = []
  irreversible = { ...RECORDED.plan.irreversible }
  clarifyAnswers: Record<string, string> = {}
  planRevealT = -1

  // panel
  panelOpen = true
  // Set while you drag the map around; cleared when the panel reopens or the view changes.
  freeCam: { x: number; y: number; scale: number } | null = null
  nav: Nav[] = []
  hoverTask: string | null = null
  // Clicks on things around the farm: id -> clock of the click. Reactions are cosmetic.
  pokes: Record<string, number> = {}
  fishAt = -1
  chickens: Chicken[] = [0, 1, 2].map((i) => ({ x: CHICKEN_PEN.x + 0.4 + i * 1.4, y: CHICKEN_PEN.y + (i % 2) * 0.6, tx: CHICKEN_PEN.x + 0.4 + i * 1.4, ty: CHICKEN_PEN.y + (i % 2) * 0.6, wait: i + 0.5, clicks: 0, lastClick: -9, flee: 0 }))
  nudge: { x: number; y: number; t: number } | null = null // the camera leans toward a new ask
  hints = new Set<Hint>() // hints already acted on
  callStart = 0 // clock when the head farmer's current call went out

  // farm
  tasks: Task[] = []
  farmhands = {} as Record<RoleId, Farmhand>
  head: HeadFarmer = { x: FARM.headFarmer.x, y: FARM.headFarmer.y, path: [], dir: 'down', anim: 'idle', speed: WALK_SPEED, scrollT: 0, till: [] }
  planShown = 0 // plots tilled so far; the plan rows appear in step
  flags = new Set<Flag>()
  asks: Ask[] = []
  replan: Replan | null = null
  log: LogEntry[] = []
  ledger: LedgerEvent[] = []
  seeds: Seed[] = START_SEEDS.map((s) => ({ ...s }))
  pendingSeeds: Seed[] = []
  toasts: Toast[] = []
  trace: string | null = null
  crow: CrowState = { state: 'none', t: 0, x: 0, y: 0 }
  neighbourDrought = false
  seedFly: SeedFly | null = null
  energyCaught = 0
  harvestReady = false
  harvested = false
  endpoint: string | null = null // the session endpoint Frontend's code calls
  out: Outputs = {}
  private requested = new Set<string>()
  private logId = 1
  private toastId = 1

  constructor() {
    this.resetFarm()
    this.settings.run.mode = this.liveAI ? 'live' : 'simulated'
  }

  // ---- subscription ---------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getVersion = () => this.version

  notify() {
    this.version++
    this.dirty = false
    this.lastNotify = this.clock
    this.listeners.forEach((l) => l())
  }

  // ---- setup ------------------------------------------------------------------

  private resetFarm() {
    this.tasks = TASKS.map((t) => ({
      ...t,
      plot: { ...t.plot },
      used: 0,
      dry: false,
      pests: [],
      signposts: [...t.signposts],
      subtasks: t.subtasks.map((s) => ({ ...s, progress: 0, started: false, done: false, emitted: 0 })),
    }))
    // In the barn until their plot is planted.
    const homeSpots: Record<RoleId, { x: number; y: number }> = {
      backend: { x: 18.8, y: 8.5 },
      frontend: { x: 20.4, y: 9.1 },
      tests: { x: 22.0, y: 8.5 },
      docs: { x: 23.6, y: 9.1 },
      reviewer: { x: 25.2, y: 8.5 },
    }
    this.head.till = this.tasks.map(() => 0)
    this.farmhands = {} as Record<RoleId, Farmhand>
    for (const c of CREW) {
      const home = homeSpots[c.id]
      this.farmhands[c.id] = {
        ...c,
        tools: [...c.tools],
        almanac: [...c.almanac],
        seeds: [...c.seeds],
        context: [...c.context],
        x: FARM.barn.door.x,
        y: FARM.barn.door.y,
        home,
        path: [],
        facing: 1,
        dir: 'down',
        look: null,
        nextShift: 1 + Math.random() * 4,
        shiftLeft: 0,
        fade: 0,
        inside: true,
        seed: Math.random() * 10,
        chore: null,
        react: -9,
        moving: false,
        status: 'idle',
        paused: false,
        job: null,
        interrupts: [],
        transcript: [],
      }
    }
    probeLive().then((l) => {
      this.live = l
      this.notify()
    })
  }

  reset() {
    const fresh = new Engine()
    const keep = { listeners: this.listeners, clock: this.clock, speed: this.speed, version: this.version }
    Object.assign(this, fresh, keep)
    this.notify()
  }

  // ---- derived (all from the ledger) -------------------------------------------

  // The head farmer is thinking while its clarify or plan call is out.
  get headThinking() {
    return (this.phase === 'clarify' && !this.out.clarify) || (this.phase === 'plan' && !this.out.plan) ? 1 : 0
  }

  get docsChecked() {
    const { mine, theirs } = conflictDocs(this.task(MISSING.taskId).signposts)
    return mine.length + theirs.length
  }

  get demoScenario() {
    return /google sign-in/i.test(this.goal)
  }

  task(id: string) {
    return this.tasks.find((t) => t.id === id)!
  }

  get actions() {
    return this.ledger.filter((e) => e.kind === 'action').length
  }

  get liveCalls() {
    return this.ledger.filter((e) => e.src === 'live').length
  }

  get replayCalls() {
    return this.ledger.filter((e) => e.src === 'replay').length
  }

  get simSteps() {
    return this.ledger.filter((e) => e.kind === 'action' && e.src === 'sim').length
  }

  get modelTokens() {
    return this.ledger.reduce((s, e) => s + (e.src !== 'sim' ? e.tokens : 0), 0)
  }

  get energyUsed() {
    return this.ledger.reduce((s, e) => s + e.tokens, 0)
  }

  get neededYou() {
    return this.ledger.filter((e) => e.kind === 'human').length
  }

  get autoDecided() {
    return this.log.filter((l) => l.kind === 'auto')
  }

  get openAsks() {
    return this.asks.filter((a) => a.status !== 'resolved')
  }

  get activeAsk(): Ask | null {
    return this.openAsks[0] ?? null
  }

  get allDone() {
    return this.tasks.every((t) => this.taskRipe(t))
  }

  // A crop ripens only when its work is done and every gate it carries (except the review) passes.
  taskRipe(t: Task) {
    return t.subtasks.every((s) => s.done) && this.machineGates(t.id).every((g) => this.gates[t.id]?.[g]?.state === 'pass')
  }

  private machineGates(taskId: string) {
    return (this.taskGates[taskId] ?? []).filter((g) => g !== 'review')
  }

  get usd() {
    return usd(this.energyUsed, this.settings)
  }

  get liveTokens() {
    return Object.values(this.out).reduce((s, o) => s + (o && o.provenance === 'live' ? o.tokens : 0), 0)
  }

  cameraTarget(): Rect {
    if (this.intro) {
      if (this.beat === 0) return { x: 0, y: 0, w: 76, h: 46 }
      if (this.beat === 1) {
        // Pan from your farm's sign to the neighbour's.
        const k = Math.min(1, Math.max(0, (this.clock - this.beatT - 0.6) / 2.6))
        const e = k * k * (3 - 2 * k)
        return { x: 22 + e * 9, y: 3, w: 24, h: 13 }
      }
      return { x: 1, y: 1.5, w: 36, h: 21.5 }
    }
    if (this.view === 'valley') return { x: 0, y: 0, w: 76, h: 46 }
    if (this.trace) {
      const p = this.task(MISSING.taskId).plot
      return { x: p.x - 7, y: p.y - 5, w: p.w + 14, h: p.h + 9 }
    }
    // Ship: the plots, plus the gate and the road while the cart is out or back.
    if (this.phase === 'ship' && this.cart.state !== 'none' && this.cart.state !== 'loaded') {
      const p = this.plotsFrame()
      const cg = cartGate()
      const g = { x: cg.x - 3, y: cg.y - 1.5, w: 6, h: 4.6 }
      const x = Math.min(p.x, g.x)
      const y = Math.min(p.y, g.y)
      return { x, y, w: Math.max(p.x + p.w, g.x + g.w) - x, h: Math.max(p.y + p.h, g.y + g.h) - y }
    }
    // The crow's ask frames only the plot that asks, its farmhand and the crow.
    if (this.activeAsk?.id === 'crow' || this.crow.state === 'flying') {
      const r = this.task(this.activeAsk?.taskId ?? 'tests').plot
      const x = r.x - 2.5
      return { x, y: r.y - 2.6, w: CROW_SPOT.x + 1.4 - x, h: r.h + 4.3 }
    }
    if (this.phase === 'brief' || this.phase === 'clarify') return { x: 1, y: 1.5, w: 36, h: 21.5 }
    return this.plotsFrame()
  }

  // Plan, Grow, Harvest and Ship frame only our plots and the farmhands beside them.
  plotsFrame(): Rect {
    const rs = this.tasks.map((t) => t.plot)
    const x0 = Math.min(...rs.map((r) => r.x - 2)) - 0.4
    const x1 = Math.max(...rs.map((r) => r.x + r.w + 1)) + 0.4
    const y0 = Math.min(...rs.map((r) => r.y)) - 2.4
    const y1 = Math.max(...rs.map((r) => r.y + r.h)) + 1.7
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  // Close-up framings use a whole-number zoom, so a farmhand is 48 to 64 px tall and pixels stay crisp.
  get cameraInteger() {
    return this.view === 'farm' && !this.intro && this.phase !== 'brief' && this.phase !== 'clarify'
  }

  private act(who: string, tokens: number, taskId?: string, n = 1) {
    for (let i = 0; i < n; i++) this.ledger.push({ t: this.t, who, kind: 'action', tokens: tokens / n, taskId, src: 'sim' })
  }

  // One model call: one ledger entry with the tokens it really used (or the simulated estimate).
  private call(who: string, o: Outcome<unknown>, taskId?: string) {
    this.ledger.push({ t: this.t, who, kind: 'action', tokens: o.tokens, taskId, src: o.provenance })
    if (taskId) this.task(taskId).used += o.tokens
  }

  private human(who: string, taskId?: string) {
    this.ledger.push({ t: this.t, who, kind: 'human', tokens: 0, taskId, src: 'sim' })
  }

  private attachedNames() {
    return this.attachments.filter((a) => a.selected).map((a) => a.name)
  }

  // ---- brief, clarify, plan -------------------------------------------------------

  toggleAttachment(id: string) {
    const a = this.attachments.find((x) => x.id === id)
    if (a) a.selected = !a.selected
    this.notify()
  }

  setGoal(goal: string) {
    this.goal = goal
    this.notify()
  }

  setBudget(b: number) {
    this.budget = b
    this.notify()
  }

  get team(): TeamTemplate {
    return teamTemplate(this.crew, this.customTeams) ?? teamTemplate(DEFAULT_TEAM)!
  }

  // The crew can change until the plan is approved and the work starts.
  get crewLocked() {
    return ['grow', 'harvest', 'ship'].includes(this.phase as string)
  }

  // Pick the crew in the Brief. It can change until the plan is approved.
  setCrew(id: string) {
    if (!teamTemplate(id, this.customTeams) || this.crewLocked) return
    this.crew = id
    this.budget = this.team.budget // each crew brings its default budget
    this.notify()
  }

  // Save the crew this run used, with its budget and required gates, as a new team template.
  saveCrewAsTemplate(name = `${this.questTitle} crew`) {
    const gates = (Object.keys(this.settings.gates) as GateKey[]).filter((g) => this.settings.gates[g as GateId].required)
    const t = crewAsTemplate(this.team, name, this.tasks.map((x) => x.assignee), this.budget, gates, this.customTeams.length + 1)
    this.customTeams = [...this.customTeams, t]
    this.toast(`Saved ${t.name} as a team template`)
    this.notify()
    return t
  }

  submitBrief() {
    if (this.phase !== 'brief' || !this.goal.trim()) return
    this.phase = 'clarify'
    this.nav = []
    this.callStart = this.clock
    this.head.scrollT = 0
    const n = this.attachments.filter((a) => a.selected).length
    this.request('clarify', () => callAgent('clarify', { goal: this.goal, attached: this.attachedNames() }, RECORDED.clarify))
    this.addLog('Head farmer', `Read the brief and ${n} attachments`, 'info', undefined, 'A new head farmer starts every farm. It only knows the brief and the files, skills and tools attached to it.')
    this.notify()
  }

  answerClarify(id: string, value: string) {
    this.clarifyAnswers[id] = value
    this.notify()
  }

  finishClarify() {
    if (this.phase !== 'clarify' || this.headThinking) return
    const skipped = this.questions.filter((q) => !this.clarifyAnswers[q.id])
    for (const q of this.questions) this.clarifyAnswers[q.id] ??= q.options[0]
    if (skipped.length) this.addLog('Head farmer', `Assumed ${skipped.length} answer${skipped.length > 1 ? 's' : ''} you skipped`, 'auto', undefined, skipped.map((q) => `${q.q} → ${q.options[0]}`).join('; '))
    this.phase = 'plan'
    this.nav = []
    this.callStart = this.clock
    const answers = Object.fromEntries(this.questions.map((q) => [q.q, this.clarifyAnswers[q.id]]))
    this.request('plan', () => callAgent('plan', { goal: this.goal, answers, attached: this.attachedNames(), budget: this.budget }, RECORDED.plan))
    this.notify()
  }

  get answersText() {
    return this.questions.map((q) => `- ${q.q} ${this.clarifyAnswers[q.id] ?? q.options[0]}`).join('\n')
  }

  private applyPlan(p: PlanOut) {
    const attached = this.attachedNames()
    SLOTS.forEach((slot) => {
      const src = p.tasks[slot.key]
      const t = this.tasks.find((x) => x.id === slot.key)
      if (!src || !t) return
      t.name = src.name || t.name
      t.subtasks.forEach((s, k) => {
        if (src.subtasks[k]) s.name = src.subtasks[k]
      })
      if (BUILDERS.includes(src.assignee)) {
        t.assignee = src.assignee
        t.proposedAssignee = src.assignee
      }
      t.budget = Math.max(4_000, Math.min(40_000, Math.round(src.budget / 1000) * 1000 || t.budget))
      const posts = src.signposts.filter((x) => attached.includes(x))
      t.signposts = posts
      t.proposalNote = src.note ?? undefined
    })
    if (p.irreversible?.count) this.irreversible = { ...p.irreversible }
    for (const fh of Object.values(this.farmhands)) {
      fh.context = [...new Set(this.tasks.filter((t) => t.assignee === fh.id).flatMap((t) => t.signposts))]
    }
  }

  // Plan review: the owner decides which files each task reads and which skills it uses.
  attach(taskId: string, name: string) {
    if (!this.task(taskId).signposts.includes(name)) this.toggleSignpost(taskId, name)
  }

  detach(taskId: string, name: string) {
    if (this.task(taskId).signposts.includes(name)) this.toggleSignpost(taskId, name)
    this.nav = this.nav.filter((n) => !(n.kind === 'lib' && n.id === name))
    this.notify()
  }

  get library() {
    const names = new Set([...Object.keys(LIBRARY), ...this.seeds.filter((s) => s.isNew).map((s) => s.file)])
    return [...names].map((name) => ({ name, ...this.lib(name) }))
  }

  lib(name: string) {
    const L = libItem(name, this.seeds)
    return this.access[name] ? { ...L, access: this.access[name] } : L
  }

  // What agents may do with an MCP server. Takes effect on the next tool call.
  setAccess(name: string, i: number, on: boolean) {
    const a = this.access[name]?.[i]
    if (!a) return
    a.on = on
    this.addLog('You', `${on ? 'Allowed' : 'Blocked'} on ${name}: ${a.label}`, 'answer')
    this.notify()
  }

  // Plan review: which gates a task must pass before its crop ripens.
  toggleGate(taskId: string, g: GateId) {
    if (this.phase !== 'plan') return
    const have = this.taskGates[taskId] ?? []
    this.taskGates[taskId] = have.includes(g) ? have.filter((x) => x !== g) : GATE_ORDER.filter((x) => x === g || have.includes(x))
    this.signpostEdits.push(`${have.includes(g) ? 'Removed' : 'Added'} the ${g} gate on “${this.task(taskId).name}”`)
    this.notify()
  }

  gateFor(taskId: string, g: GateId): GateResult {
    if (this.phase === 'harvest' && this.harvestStage === 'review') {
      const h = this.harvestGates[g]
      if (h.state === 'run') return { state: 'run', text: 'Running again' }
      if (g === 'review') {
        if (h.state === 'fail') return { state: 'fail', text: taskId === REVIEW_FAIL.taskId ? '1 blocking' : 'Blocked' }
        return h.state === 'look' ? { state: 'pass', text: 'Passed' } : h
      }
      return { state: 'pass', text: this.gates[taskId]?.[g]?.text ?? 'Passed' }
    }
    return this.gates[taskId]?.[g] ?? (g === 'review' ? { state: 'wait', text: 'At harvest' } : { state: 'wait', text: 'Not run yet' })
  }

  // ---- settings: one homestead.toml ---------------------------------------------------------

  setSetting(path: string, key: string, value: unknown) {
    if (path === 'run' && key === 'mode') return this.setLiveAIOn(value === 'live')
    const obj = (path ? path.split('.').reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, this.settings as unknown as Record<string, unknown>) : this.settings) as Record<string, unknown>
    obj[key] = value
    this.notify()
  }

  settingsToml() {
    const agents: Record<string, { tools: string[]; skills: string[] }> = {}
    for (const id of ROLE_ORDER) {
      const posts = this.tasks.filter((t) => t.assignee === id).flatMap((t) => t.signposts)
      const almanac = this.farmhands[id].almanac
      agents[id] = {
        tools: [...new Set(posts.filter((n) => this.lib(n).kind === 'tool'))],
        skills: [...new Set([...posts, ...almanac].filter((n) => this.lib(n).kind === 'skill'))],
      }
    }
    const tools = Object.entries(this.access).map(([name, access]) => ({ name, access }))
    return toml(this.settings, { agents, tools })
  }

  contextTokens(t: Task) {
    return t.signposts.reduce((n, s) => n + this.lib(s).tokens, 0)
  }

  // Plan review: the owner decides which documents each task may read.
  toggleSignpost(taskId: string, name: string) {
    if (this.phase !== 'plan' || this.headThinking) return
    const t = this.task(taskId)
    const removing = t.signposts.includes(name)
    this.signpostEdits.push(`${removing ? 'Removed' : 'Added'} ${name} ${removing ? 'from' : 'to'} “${t.name}”`)
    if (removing) t.signposts = t.signposts.filter((x) => x !== name)
    else {
      t.signposts = [...t.signposts, name]
      const a = this.attachments.find((x) => x.name === name)
      if (a && !a.selected) a.selected = true
    }
    const fh = this.farmhands[t.assignee]
    fh.context = [...new Set(this.tasks.filter((x) => x.assignee === fh.id).flatMap((x) => x.signposts))]
    this.notify()
  }

  reassign(taskId: string, role: RoleId) {
    const t = this.task(taskId)
    if (t.assignee === role || this.phase !== 'plan') return
    t.assignee = role
    const fh = this.farmhands[role]
    for (const s of t.signposts) if (!fh.context.includes(s)) fh.context.push(s)
    this.notify()
  }

  get planReady() {
    return this.phase === 'plan' && !!this.out.plan && this.planShown >= this.tasks.length
  }

  approvePlan() {
    if (!this.planReady) return
    this.phase = 'grow'
    this.nav = []
    // The panel steps aside while the crew works; it comes back for an ask or the harvest.
    this.panelOpen = false
    this.t = 0
    this.human('You')
    const swapped = this.tasks.filter((t) => t.assignee !== t.proposedAssignee)
    const changes = [...swapped.map((t) => `Moved “${t.name}” to the ${this.farmhands[t.assignee].role}`), ...this.signpostEdits]
    this.addLog('You', 'Approved the quest plan' + (changes.length ? ` with ${changes.length} change${changes.length > 1 ? 's' : ''}` : ''), 'answer', undefined, changes.join('; ') || undefined)
    this.addLog('Head farmer', `Planted ${this.tasks.length} plots and sent the crew out`, 'info')
    this.notify()
  }

  // ---- pause ------------------------------------------------------------------------

  togglePause() {
    if (this.phase !== 'grow') return
    this.paused = !this.paused
    this.addLog('You', this.paused ? 'Paused the whole farm' : 'Resumed the farm', 'answer')
    this.toast(this.paused ? 'Farm paused. Nothing runs until you resume (P).' : 'Farm resumed')
    this.notify()
  }

  togglePauseFarmhand(id: RoleId) {
    const fh = this.farmhands[id]
    fh.paused = !fh.paused
    this.addLog('You', `${fh.paused ? 'Paused' : 'Resumed'} the ${fh.role}`, 'answer')
    this.notify()
  }

  // ---- asks ---------------------------------------------------------------------------

  private raise(ask: Omit<Ask, 'status' | 'raisedAt'>) {
    if (this.asks.some((a) => a.id === ask.id)) return
    this.asks.push({ ...ask, status: 'open', raisedAt: this.t })
    this.human(ask.fromName, ask.taskId)
    this.addLog(ask.fromName, `Asked: ${ask.question}`, 'ask', ask.taskId, ask.details.reasoning)
    const q = this.openAsks.length
    this.panelOpen = true
    this.freeCam = null
    const r = this.tasks.find((t) => t.id === ask.taskId)?.plot
    if (r) this.nudge = { x: r.x + r.w / 2, y: r.y + r.h / 2, t: this.clock }
    this.toast(q > 1 ? `${ask.fromName} needs you too (${q} waiting)` : `${ask.fromName} needs you`)
    this.chime()
    this.notify()
  }

  answer(askId: string, value: string) {
    const ask = this.asks.find((a) => a.id === askId)
    if (!ask || ask.status === 'resolved') return
    if (ask.confirm && value === 'approve' && ask.status === 'open') {
      ask.status = 'confirming'
      this.notify()
      return
    }
    const opt = ask.options.find((o) => o.value === value)
    this.nav = this.nav.filter((n) => !(n.kind === 'why' && n.id === askId))
    if (ask.id === this.asks[0]?.id) this.hints.add('ask')
    ask.status = 'resolved'
    ask.answer = value
    ask.answerLabel = opt?.label ?? (value === 'approve' ? 'Approved' : value)
    this.addLog('You', ask.label === 'Irreversible' ? ask.answerLabel : `${ask.label}: ${ask.answerLabel}`, 'answer', ask.taskId)
    this.toasts = this.toasts.filter((t) => !t.text.includes('needs you'))
    this.onResolve(ask, value)
    this.notify()
  }

  cancelConfirm(askId: string) {
    const ask = this.asks.find((a) => a.id === askId)
    if (ask?.status === 'confirming') ask.status = 'open'
    this.notify()
  }

  reply(askId: string, text: string) {
    const ask = this.asks.find((a) => a.id === askId)
    if (!ask || !text.trim()) return
    this.addLog('You', `Replied to the ${ask.fromName}: “${text.trim()}”`, 'answer', ask.taskId)
    this.addLog(ask.fromName, 'Noted. This one still needs your call.', 'info', ask.taskId)
    this.notify()
  }

  private onResolve(ask: Ask, value: string) {
    if (isShipAsk(ask.id)) return this.onShipResolve(ask, value)
    if (ask.id === 'crow') {
      const v2 = value === 'v2'
      const t = this.task(MISSING.taskId)
      const who = this.farmhands[t.assignee].role
      this.replan = {
        id: 'replan-session',
        title: v2 ? `Switch ${who} to ${CLASH.theirs}` : `Keep ${CLASH.ours}, ask the ${NEIGHBOUR.team}`,
        status: 'open',
        lines: v2
          ? [
              { op: '~', text: `src/api/session.ts: POST ${CLASH.ours} → ${CLASH.theirs}` },
              { op: '+', text: `New crop on ${t.name}: “${REPLAN_SUBTASKS.switch.name}” (${who})` },
              { op: '+', text: `${t.name} reads ${MISSING.file}` },
              { op: '~', text: 'End-to-end sign-in tests run again on staging' },
              { op: '~', text: `The ${NEIGHBOUR.name} crew is told web-app now calls ${CLASH.theirs}` },
            ]
          : [
              { op: '~', text: `${who} keeps ${CLASH.ours}` },
              { op: '+', text: `Ask sent to the ${NEIGHBOUR.name} crew: keep ${CLASH.ours} on staging until Nov 12` },
              { op: '+', text: `${t.name} reads ${MISSING.file}` },
            ],
      }
      this.act('Head farmer', 1_500, t.id, 8)
    }
    // Whoever asked goes back to work, whichever farmhand the plan gave the task to.
    const asker = ask.from !== 'head' ? this.farmhands[ask.from] : null
    if (asker?.status === 'asking') asker.status = 'working'
  }

  applyReplan() {
    if (!this.replan || this.replan.status !== 'open') return
    this.replan.status = 'applied'
    this.flags.add('replanApplied')
    const t = this.task(MISSING.taskId)
    if (!t.signposts.includes(MISSING.file)) t.signposts.push(MISSING.file)
    this.farmhands[t.assignee].context.push(MISSING.file)
    const v2 = this.replan.lines.length > 3
    if (v2) {
      t.plot = { ...t.plot, h: t.plot.h + 1 }
      t.subtasks.push({ ...REPLAN_SUBTASKS.switch, sets: [...REPLAN_SUBTASKS.switch.sets], progress: 0, started: false, done: false, emitted: 0, addedByReplan: true })
    } else {
      this.flags.add('sessionV2')
    }
    this.crow.state = 'leaving'
    this.crow.t = 0
    this.addLog('Head farmer', 'Applied the re-plan and sent the decision to 2 crews', 'replan', t.id, 'Both projects now agree on the session API.')
    this.addLog(`${NEIGHBOUR.name} crew`, v2 ? `Noted: web-app calls ${CLASH.theirs} from Friday` : `Kept ${CLASH.ours} on staging until Nov 12. Production still drops it Nov 12.`, 'info')
    this.toast('Decision sent to 2 crews')
    this.notify()
  }

  // ---- trace and seeds ------------------------------------------------------------------

  openTrace(id: string) {
    this.nav = [...this.nav.filter((n) => n.kind !== 'trace'), { kind: 'trace' }]
    this.trace = id
    this.view = 'farm'
    this.notify()
  }

  closeTrace() {
    this.setNav(this.nav.filter((n) => n.kind !== 'trace'))
  }

  saveSeed() {
    if (this.flags.has('seedSaved')) return
    this.flags.add('seedSaved')
    this.seeds.unshift({ ...LESSON_TRACE })
    const p = this.task(MISSING.taskId).plot
    this.seedFly = { from: { x: p.x + p.w / 2, y: p.y }, to: { x: FARM.seedLibrary.x + 0.7, y: FARM.seedLibrary.y + 0.5 }, t: 0 }
    this.addLog('You', `Saved a lesson: ${LESSON_TRACE.file}`, 'seed', MISSING.taskId)
    this.toast('Saved to Files and skills')
    this.closeTrace()
  }

  keepPendingSeed(file: string, keep: boolean) {
    const s = this.pendingSeeds.find((x) => x.file === file)
    if (!s) return
    this.pendingSeeds = this.pendingSeeds.filter((x) => x.file !== file)
    if (keep) this.seeds.unshift({ ...s })
    this.notify()
  }

  // ---- UI state --------------------------------------------------------------------------

  // Sprites and fonts are in: the valley draws in, then the opening beats run.
  markReady() {
    if (this.ready) return
    this.ready = true
    this.bootT = this.clock
    this.beatT = this.clock + 0.9
    this.notify()
  }

  nextBeat() {
    if (!this.intro) return
    if (this.beat >= BEATS.length - 1) return this.skipIntro()
    this.beat++
    this.beatT = this.clock
    if (this.beat === 2) this.headOutOfHouse()
    this.notify()
  }

  skipIntro() {
    if (!this.intro) return
    if (this.beat < 2) this.headOutOfHouse()
    this.intro = false
    this.view = 'farm'
    this.notify()
  }

  // Kept for the e2e script and the old start button.
  startDemo() {
    this.skipIntro()
  }

  private headOutOfHouse() {
    const h = this.head
    h.x = FARM.door.x
    h.y = FARM.door.y
    h.path = [{ x: FARM.door.x, y: FARM.headFarmer.y }, { ...FARM.headFarmer }]
    h.speed = 2.2
  }

  // Dragging the map hands the camera to you and folds the panel away.
  dragCam(cam: { x: number; y: number; scale: number }) {
    this.freeCam = cam
    if (this.panelOpen) {
      this.panelOpen = false
      this.notify()
    }
  }

  setPanel(open: boolean) {
    this.panelOpen = open
    if (open) this.freeCam = null
    this.notify()
  }

  setView(v: View) {
    this.view = v
    this.freeCam = null
    if (v === 'valley') this.closeTrace()
    this.notify()
  }

  setLiveAIOn(on: boolean) {
    this.liveAI = on
    this.settings.run.mode = on ? 'live' : 'simulated'
    setLiveAI(on)
    try {
      localStorage.setItem('homestead.liveAI', on ? '1' : '0')
    } catch {
      /* private window: the switch still works for this visit */
    }
    this.notify()
  }

  // ---- side panel navigation -------------------------------------------------------

  setNav(nav: Nav[]) {
    this.nav = nav
    const tracing = nav.some((n) => n.kind === 'trace')
    if (!tracing) this.trace = null
    if (nav.some((n) => n.kind === 'task')) this.hints.add('plot')
    if (nav.some((n) => n.kind === 'log' && n.tab === 'auto')) this.hints.add('auto')
    this.notify()
  }

  go(n: Nav) {
    if (n.kind === 'trace') return this.openTrace('endpoint')
    this.setNav([...this.nav, n])
  }

  goTo(depth: number) {
    this.setNav(this.nav.slice(0, depth))
  }

  back() {
    if (!this.nav.length) return false
    this.setNav(this.nav.slice(0, -1))
    return true
  }

  // From the map: a plot opens its task; a farmhand opens the task it is on.
  openTask(id: string) {
    this.panelOpen = true
    const top = this.nav[this.nav.length - 1]
    if (top?.kind === 'task' && top.id === id) return this.back()
    this.view = 'farm'
    this.setNav([{ kind: 'task', id }])
  }

  openFarmhand(id: RoleId) {
    const fh = this.farmhands[id]
    const task = fh.job ? fh.job.taskId : (this.tasks.find((t) => t.assignee === id && t.subtasks.some((s) => !s.done)) ?? this.tasks.find((t) => t.assignee === id))?.id
    if (task) return this.openTask(task)
    // The Reviewer has no plot: it opens its gate.
    this.panelOpen = true
    if (this.phase === 'harvest' && this.harvestStage === 'review') this.setNav([{ kind: 'out', id: 'review' }])
    else this.toast('The Reviewer reviews the whole diff at the harvest')
  }

  hover(taskId: string | null) {
    if (this.hoverTask === taskId) return
    this.hoverTask = taskId
    this.notify()
  }

  get openTaskId() {
    const top = this.nav[this.nav.length - 1]
    return top?.kind === 'task' ? top.id : null
  }

  // The farmhand on the task open in the panel.
  get selected(): RoleId | null {
    const id = this.openTaskId
    return id ? this.task(id).assignee : null
  }

  showHint(h: Hint) {
    if (this.intro || this.hints.has(h)) return false
    if (h === 'plot') return (this.phase === 'plan' && this.planShown > 0) || this.phase === 'grow'
    if (h === 'ask') return this.asks.length > 0 && this.activeAsk?.id === this.asks[0].id
    return this.autoDecided.length > 0 && this.phase === 'grow'
  }

  // ---- status lines ---------------------------------------------------------------------

  // The task a farmhand is waiting on, and how to say it.
  blockerOf(fh: Farmhand): { taskId: string; label: string } | null {
    for (const t of this.tasks) {
      if (t.assignee !== fh.id) continue
      const s = t.subtasks.find((x) => !x.done)
      if (!s) continue
      const missing = (s.needs ?? []).filter((f) => !this.flags.has(f))
      if (!missing.length) return null
      for (const f of missing) {
        for (const o of this.tasks) {
          if (o.subtasks.some((x) => !x.done && x.sets?.includes(f))) return { taskId: o.id, label: o.name }
        }
      }
      const yours = this.activeAsk?.id === 'crow' || this.replan?.status === 'open'
      return { taskId: MISSING.taskId, label: yours ? 'your call on the session API' : 'the session API check' }
    }
    return null
  }

  // The one glyph over a farmhand's head. Asks carry their reason, so the map draws its shape.
  glyphOf(fh: Farmhand): { kind: 'work' } | { kind: 'ask'; reason: ReasonLabel; at: number } | { kind: 'sleep' } | null {
    if (fh.inside || fh.paused) return null
    if (fh.status === 'asking') {
      const a = this.openAsks.find((x) => x.from === fh.id)
      return { kind: 'ask', reason: a?.label ?? 'Anomaly', at: a?.raisedAt ?? this.t }
    }
    if (fh.status === 'working') return { kind: 'work' }
    if (fh.status === 'done') return { kind: 'sleep' }
    return null
  }

  // The draft a task has ready (a commit, a test file, the guide), shown as a crate on its plot.
  // Filled in by the panel work: null means no crate.
  draftFor(taskId: string): { label: string; nav: Nav[] } | null {
    if (this.phase === 'brief' || this.phase === 'clarify' || this.phase === 'plan') return null
    const t = this.tasks.find((x) => x.id === taskId)
    if (!t || !t.subtasks.some((s) => s.done)) return null
    // The guide is its own output; every other task's draft is its commit, shown in the task view.
    if (taskId === 'docs') return { label: OUTPUT.guide.title, nav: [{ kind: 'task', id: taskId }, { kind: 'out', id: 'guide' }] }
    return { label: COMMITS[taskId] ?? t.name, nav: [{ kind: 'task', id: taskId }] }
  }

  // Grow rows: Needs you, then Working, then Done. Within a group the plan's order holds,
  // so a row only moves when its own state changes.
  growRows(): { t: Task; group: 'needs' | 'working' | 'done' }[] {
    const rank = { needs: 0, working: 1, done: 2 } as const
    return this.tasks
      .map((t, i) => {
        const s = this.taskStatus(t)
        const group: 'needs' | 'working' | 'done' = s.tone === 'needs' ? 'needs' : s.tone === 'done' ? 'done' : 'working'
        return { t, group, i }
      })
      .sort((a, b) => rank[a.group] - rank[b.group] || a.i - b.i)
      .map(({ t, group }) => ({ t, group }))
  }

  get growCounts(): string {
    const rows = this.growRows()
    const n = (g: string) => rows.filter((r) => r.group === g).length
    return [
      [n('needs'), 'needs you'],
      [n('working'), 'working'],
      [n('done'), 'done'],
    ]
      .filter(([c]) => c)
      .map(([c, w]) => `${c} ${w}`)
      .join(', ')
  }

  openDraft(taskId: string) {
    const d = this.draftFor(taskId)
    if (!d) return
    this.setPanel(true)
    this.setNav(d.nav)
  }

  setTree(open: boolean) {
    this.treeOpen = open
    this.notify()
  }

  fhStatus(fh: Farmhand): string {
    if (fh.paused) return 'Paused'
    if (fh.status === 'asking') return 'Waiting for you'
    const chore = CHORES.find((c) => c.id === fh.chore?.id)?.label ?? 'Taking a break'
    if (this.phase === 'harvest' && fh.id === this.task(REVIEW_FAIL.taskId).assignee) {
      if (this.gateFailed) return 'Waiting for you to send the review back'
      if (this.rerunAt) return 'Fixing line 48'
    }
    if (fh.id === 'reviewer' && this.phase !== 'harvest') return `Reviews at the harvest. ${chore}`
    if (fh.status === 'done') return `Done. ${chore}`
    if (fh.inside) return 'In the barn'
    const job = fh.job
    if (job?.kind === 'fix') return 'Fixing a failing test'
    if (job?.kind === 'sub') {
      const t = this.task(job.taskId)
      if (fh.moving) return `Walking to ${t.name}`
      return t.subtasks.find((s) => s.id === job.subId)?.name ?? t.name
    }
    if (fh.status === 'waiting') {
      const b = this.blockerOf(fh)
      return b ? `Waiting on ${b.label}` : 'Waiting'
    }
    return 'Ready'
  }

  taskStatus(t: Task): { text: string; tone: '' | 'done' | 'needs' | 'warn' | 'fail' } {
    const done = t.subtasks.filter((s) => s.done).length
    if (this.phase === 'harvest' && t.id === REVIEW_FAIL.taskId && this.harvestGates.review.state === 'fail') return { text: 'Review failed', tone: 'fail' }
    if (this.taskRipe(t)) return { text: 'Done', tone: 'done' }
    if (this.openAsks.some((a) => a.taskId === t.id) || (t.id === MISSING.taskId && this.replan?.status === 'open')) return { text: 'Needs you', tone: 'needs' }
    const failed = (this.taskGates[t.id] ?? []).find((g) => this.gates[t.id]?.[g]?.state === 'fail')
    if (failed) return { text: `${failed === 'e2e' ? 'End-to-end' : GATES[failed].name} failed`, tone: 'fail' }
    if (done === t.subtasks.length) return { text: 'Running gates', tone: '' }
    if (this.farmhands[t.assignee].paused) return { text: 'Paused', tone: '' }
    if (done > 0) return { text: `${done} of ${t.subtasks.length}`, tone: '' }
    if (t.subtasks.some((s) => s.started)) return { text: 'Working', tone: '' }
    const s = t.subtasks[0]
    if ((s.needs ?? []).some((f) => !this.flags.has(f))) return { text: 'Waiting', tone: '' }
    return { text: 'Up next', tone: '' }
  }

  get ripeCount() {
    return this.tasks.filter((t) => this.taskRipe(t)).length
  }

  get slowCall() {
    return this.headThinking > 0 && this.clock - this.callStart > 10
  }

  // The crew comes out of the barn and carries the ripe crops to the shipping chest.
  // Then the panel takes over with the review. Nothing has been sent yet.
  openHarvest() {
    if (!this.harvestReady) return
    if (this.phase === 'harvest') return this.setNav([])
    this.harvested = true
    this.act('Head farmer', 800, undefined, 4)
    this.addLog('Head farmer', 'Gathered the harvest for your review', 'done')
    this.phase = 'harvest'
    this.nav = []
    this.view = 'farm'
    this.harvestStage = 'map'
    this.harvestT = this.clock
    ROLE_ORDER.forEach((id, i) => {
      const t = this.tasks.find((x) => x.assignee === id && !this.picked.has(x.id))
      const fh = this.farmhands[id]
      if (!t) return
      this.harvestJobs[id] = { taskId: t.id, stage: 0, t: i * 0.35 }
      fh.path = []
      fh.paused = false
    })
    this.notify()
  }

  skipHarvestMap() {
    if (this.phase !== 'harvest' || this.harvestStage !== 'map') return
    this.endHarvestMap()
  }

  private endHarvestMap() {
    for (const t of this.tasks) this.picked.add(t.id)
    this.carrying = {}
    ROLE_ORDER.forEach((id, i) => {
      const fh = this.farmhands[id]
      fh.path = []
      fh.inside = false
      fh.fade = 1
      fh.status = 'done'
      fh.chore = { id: '', t: 2 + i * 0.8 } // a beat at the chest, then back to chores
      Object.assign(fh, this.dropSpot(i))
      fh.dir = 'down'
    })
    this.harvestJobs = {}
    this.harvestStage = 'review'
    this.startReview()
    this.notify()
  }

  // Either side of the shipping crate, clear of the crate and its sign.
  private dropSpot(i: number) {
    return { x: FARM.shipping.x + [-3.2, -2.1, 2.2, 3.3, 4.4][i % 5], y: FARM.shipping.y + 0.85 }
  }

  private updateHarvest(dt: number) {
    if (this.rerunAt && this.clock - this.rerunAt > 2.6) this.finishRerun()
    if (this.harvestStage !== 'map') {
      for (const id of ROLE_ORDER) {
        const fh = this.farmhands[id]
        if (!this.walkOnly(fh, dt)) this.doChores(fh, dt)
      }
      return
    }
    if (this.clock - this.harvestT > 6.5) return this.endHarvestMap()
    ROLE_ORDER.forEach((id, i) => {
      const fh = this.farmhands[id]
      const job = this.harvestJobs[id]
      if (!job) return
      if (this.walkOnly(fh, dt, 5)) return
      const task = this.task(job.taskId)
      if (job.stage === 0) {
        job.t -= dt
        if (job.t > 0) return
        if (fh.inside) {
          fh.inside = false
          fh.x = FARM.barn.door.x
          fh.y = FARM.barn.door.y
        }
        fh.fade = 1
        job.stage = 1
        job.t = 0.4
        return this.walkTo(fh, this.standSpot(task, 0))
      }
      if (job.stage === 1) {
        fh.dir = 'up'
        job.t -= dt
        if (job.t > 0) return
        this.picked.add(task.id)
        this.carrying[id] = task.crop
        job.stage = 2
        return this.walkTo(fh, this.dropSpot(i))
      }
      if (job.stage === 2) {
        delete this.carrying[id]
        fh.dir = 'down'
        job.stage = 3
      }
    })
  }

  get harvestHeadline() {
    if (this.harvestStage === 'map') return OUTPUT.ready
    if (this.gateFailed) return OUTPUT.failed
    if (this.rerunAt) return OUTPUT.rerun
    if (this.gatesRunning) return OUTPUT.running
    if (this.sendState === 'sent') return OUTPUT.merged
    return this.asks.find((a) => a.id === 'crow')?.answer === 'v2' ? OUTPUT.caught : OUTPUT.ready
  }

  // ---- review: gates, your eyes, approve, then merge -----------------------------------

  // Machine gates already passed in Grow. The review runs now, on the whole diff, by an agent that wrote none of it.
  private startReview() {
    for (const g of GATE_ORDER) this.harvestGates[g] = g === 'review' ? { state: 'run', text: 'Reviewing the whole diff' } : { ...RESULTS[g] }
    this.addLog('Reviewer', 'Started the review of the whole diff', 'info')
    this.request('review', () => callAgent('review', { diff: PR_DIFF }, RECORDED.review))
  }

  private reviewResult(): GateResult {
    const notes = this.out.review?.data.notes.length ?? 0
    return { state: 'look', text: `0 blocking, ${notes} note${notes === 1 ? '' : 's'}` }
  }

  get gateFailed() {
    return GATE_ORDER.some((g) => this.harvestGates[g].state === 'fail')
  }

  get gatesRunning() {
    return GATE_ORDER.some((g) => this.harvestGates[g].state === 'run')
  }

  get checks(): Check[] {
    return CHECKS
  }

  checksFor(g: GateId) {
    return CHECKS.filter((c) => c.gate === g)
  }

  canTick(c: Check) {
    const s = this.harvestGates[c.gate].state
    return !this.approved && (s === 'look' || s === 'pass')
  }

  get allTicked() {
    return CHECKS.every((c) => this.ticked.has(c.id))
  }

  get canApprove() {
    return this.allTicked && !this.gateFailed && !this.gatesRunning && this.harvestStage === 'review'
  }

  toggleTick(id: string) {
    const c = CHECKS.find((x) => x.id === id)
    if (!c || !this.canTick(c)) return
    if (this.ticked.has(id)) this.ticked.delete(id)
    else this.ticked.add(id)
    this.notify()
  }

  // A failed gate goes back to the agent whose code failed it. Then every gate runs again.
  sendBack() {
    if (!this.gateFailed || this.approved) return
    const t = this.task(REVIEW_FAIL.taskId)
    const who = this.farmhands[t.assignee].role
    this.reviewFixed = true
    this.ticked.clear()
    for (const g of GATE_ORDER) this.harvestGates[g] = { state: 'run', text: 'Running again' }
    this.rerunAt = this.clock
    this.act(who, 1_200, t.id, 4)
    this.addLog('You', `Sent back to ${who}: ${REVIEW_FAIL.text}`, 'answer', t.id)
    this.addLog(who, 'Removed the log line at src/auth/google.ts line 48', 'info', t.id, REVIEW_FAIL.fix)
    this.toast(`${who} removed the log line. Every gate is running again.`)
    this.notify()
  }

  private finishRerun() {
    this.rerunAt = 0
    this.toasts = []
    for (const g of GATE_ORDER) this.harvestGates[g] = g === 'review' ? this.reviewResult() : { ...RESULTS[g] }
    this.act('Reviewer', 2_400, undefined, 6)
    this.addLog('Reviewer', 'Every gate passed on the second run', 'done', undefined, 'The id_token is no longer logged. 0 blocking, 2 notes.')
    this.notify()
  }

  approveHarvest() {
    if (!this.canApprove || this.approved) return
    this.approved = true
    this.addLog('You', `Approved: every gate passed and you looked at ${CHECKS.length} things. Nothing merged yet.`, 'answer')
    this.notify()
  }

  startSend() {
    if (!this.approved || this.sendState !== 'none') return
    this.sendState = 'confirming'
    this.notify()
  }

  cancelSend() {
    if (this.sendState === 'confirming') this.sendState = 'none'
    this.notify()
  }

  send() {
    if (this.sendState !== 'confirming') return
    this.sendState = 'sent'
    this.act('Head farmer', 600, undefined, 2)
    this.addLog('You', `Merged PR #${OUTPUT.pr} into ${OUTPUT.base}`, 'done')
    this.toast(`Merged #${OUTPUT.pr} into ${OUTPUT.base}. CI is running on main.`)
    this.startShip()
    this.notify()
  }

  // Merging is an ordinary step now: you approved, so one click merges. Deploying is the outbound one.
  merge() {
    if (!this.approved || this.sendState === 'sent') return
    this.sendState = 'confirming'
    this.send()
  }

  // ---- ship: CI on main, deploy to production, canary, roll back --------------------------

  private startShip() {
    this.phase = 'ship'
    this.shipStage = 'ci'
    this.shipT = 0
    this.ciIndex = 0
    this.nav = []
    this.view = 'farm'
    this.cart = { state: 'loaded', k: 0, crow: false }
    this.addLog('Head farmer', `CI started on ${OUTPUT.base}`, 'info')
  }

  private ciJob() {
    return CI_JOBS[this.ciIndex]
  }

  private updateShip(dt: number) {
    for (const id of ROLE_ORDER) {
      const fh = this.farmhands[id]
      if (!this.walkOnly(fh, dt)) this.doChores(fh, dt)
    }
    this.updateCart(dt)
    this.shipT += dt
    const st = this.shipStage
    if (st === 'ci') return this.updateCi()
    if (st === 'canary' || st === 'canary2') return this.updateCanary()
    if (st === 'rollback' && this.shipT >= SHIP_TIMES.rollback) return this.finishRollback()
    if (st === 'rollout') {
      const k = Math.min(1, this.shipT / SHIP_TIMES.rollout)
      this.rollout = Math.round(5 + 95 * k)
      if (k >= 1) this.goLive()
    }
  }

  private updateCi() {
    const job = this.ciJob()
    if (!job) {
      this.shipStage = 'deploy'
      this.shipT = 0
      this.addLog('Head farmer', `CI passed on ${OUTPUT.base}`, 'done')
      this.requestDeploy()
      return
    }
    const r = this.ci[job.id]
    const outcome = this.ciOutcomes[job.id]
    if (r.state === 'wait') {
      this.ci[job.id] = { state: 'run', text: 'Running' }
      this.act('CI', 200, undefined, 1)
      return
    }
    if (outcome === 'flaky' && r.state === 'run' && this.shipT >= job.secs * 0.55) {
      // A known flaky test: retried once without asking you, and logged.
      this.ci[job.id] = { state: 'retry', text: 'Retrying a known flaky test' }
      this.addLog('Tests', `Retried a known flaky test once: ${job.flaky!.test}. It passed on the retry.`, 'auto', undefined, job.flaky!.why)
      return
    }
    const end = outcome === 'flaky' ? job.secs * 1.5 : job.secs
    if (this.shipT < end) return
    if (outcome === 'fail') {
      this.ci[job.id] = { state: 'fail', text: `Failed after ${job.time}` }
      this.shipStage = 'cifailed'
      this.addLog('CI', `${job.name} failed on ${OUTPUT.base}`, 'pest')
      this.raise({
        id: `ci-${job.id}`,
        label: 'Failure',
        from: 'head',
        fromName: 'Head farmer',
        taskId: '',
        question: `${job.name} failed on ${OUTPUT.base}. Revert the merge?`,
        impact: [`Nothing deploys until ${OUTPUT.base} is green again.`],
        options: [
          { key: '1', label: 'Revert the merge', value: 'revert', recommended: true, kind: 'approve' },
          { key: '2', label: 'Run it again', value: 'rerun', kind: 'alt' },
        ],
        details: { reasoning: `${job.name} is not on the list of known flaky jobs, so it was not retried on its own.`, sources: ['.github/workflows/main.yml'] },
        confidence: 'Medium',
        provenance: 'sim',
      })
      return
    }
    this.ci[job.id] = { state: 'pass', text: outcome === 'flaky' ? `${job.time}, passed on retry` : job.time }
    this.ciIndex++
    this.shipT = 0
  }

  private deployAsk(id: string) {
    return {
      id,
      label: 'Irreversible' as const,
      from: 'head' as const,
      fromName: 'Head farmer',
      taskId: '',
      question: id === 'deploy' ? `Deploy ${RELEASE.app} ${RELEASE.version} to production?` : `Redeploy ${RELEASE.app} ${RELEASE.version} to production?`,
      impact: [`Reaches ${RELEASE.users} users on ${RELEASE.app}`, id === 'deploy' ? 'CI passed on main. One known flaky test was retried.' : 'Same release, now with the production redirect URI in place.'],
      options: [
        { key: '1', label: 'Approve', value: 'approve', recommended: true, kind: 'approve' as const },
        { key: '2', label: 'Not now', value: 'hold', kind: 'deny' as const },
      ],
      confirm: id === 'deploy' ? 'Deploy to production?' : 'Redeploy to production?',
      confirmLabel: 'Deploy to production',
      confirmList: [`Production, ${RELEASE.users} users`, `${RELEASE.app} ${RELEASE.version}`, `Rollout: ${RELEASE.canary}`, `Roll back: ${this.settings.deploy.auto_rollback ? RELEASE.rule.toLowerCase() : 'ask you first if a health check fails'}`],
      details: {
        reasoning: 'Every gate passed, you approved and merged, and CI passed on main. Deploying is the step that reaches users.',
        sources: ['.github/workflows/main.yml', 'homestead.toml, deploy section'],
      },
      confidence: 'High' as const,
      basis: 'Every gate and CI job passed',
      provenance: 'sim' as const,
    }
  }

  requestDeploy() {
    if (this.shipStage !== 'deploy' && this.shipStage !== 'held') return
    this.shipStage = 'deploy'
    const id = this.deploys === 0 ? 'deploy' : `deploy-${this.deploys}`
    this.asks = this.asks.filter((a) => a.id !== id)
    this.raise(this.deployAsk(id))
  }

  // The canary: 5% of users get the new version while the health checks are watched.
  startCanary() {
    this.phase = 'ship'
    this.deploys++
    this.shipStage = this.rolledBack ? 'canary2' : 'canary'
    this.shipT = 0
    this.rollout = 5
    for (const h of HEALTH) this.health[h.id] = { value: h.good, ok: true, seen: false }
    this.cart = { state: 'out', k: 0, crow: false }
    this.act('Head farmer', 500, undefined, 2)
    this.addLog('Head farmer', `Deployed ${RELEASE.app} ${RELEASE.version} to 5% of production`, 'done')
    this.toast(`${RELEASE.version} is live for 5% of users`)
    this.notify()
  }

  private updateCanary() {
    const second = this.shipStage === 'canary2'
    const T = second ? SHIP_TIMES.canary2 : SHIP_TIMES.breach
    const k = Math.min(1, this.shipT / T)
    for (const h of HEALTH) {
      const wob = Math.sin(this.shipT * 3 + h.good) * 0.02
      let v = h.good * (1 + wob * (h.unit === 'ms' ? 1 : 0.02))
      // The first canary: sign-in success falls once real users start signing in.
      if (!second && h.id === 'signin') v = h.good + (h.bad - h.good) * Math.max(0, Math.min(1, (k - 0.3) / 0.7))
      else if (!second) v = h.good + (h.bad - h.good) * k
      this.health[h.id] = { value: v, ok: healthOk(h, v), seen: this.shipT > 0.3 }
    }
    if (k < 1) return
    if (second) {
      this.shipStage = 'rollout'
      this.shipT = 0
      this.addLog('Head farmer', 'Every health check passed on the canary. Rolling out to everyone.', 'auto', undefined, HEALTH.map((h) => `${h.name} ${fmtHealth(h, this.health[h.id].value)}`).join(', '))
      return
    }
    const bad = HEALTH.find((h) => !this.health[h.id].ok)
    if (!bad) return
    const reading = `${bad.name} fell to ${fmtHealth(bad, this.health[bad.id].value)} on the canary (needs ${bad.min}%)`
    if (this.settings.deploy.auto_rollback) return this.startRollback(reading)
    // The switch is off: hold the canary and ask.
    this.shipStage = 'held'
    this.raise({
      id: 'rollback',
      label: 'Failure',
      from: 'head',
      fromName: 'Head farmer',
      taskId: '',
      question: `${reading}. Roll back to ${RELEASE.previous}?`,
      impact: [`5% of users can't sign in with Google until this is decided.`],
      options: [
        { key: '1', label: `Roll back to ${RELEASE.previous}`, value: 'rollback', recommended: true, kind: 'approve' },
        { key: '2', label: 'Keep the canary running', value: 'keep', kind: 'deny' },
      ],
      details: { reasoning: 'Rolling back on its own is off in Settings, so the canary waits for you.', sources: ['Sentry', 'homestead.toml, deploy section'] },
      confidence: 'High',
      provenance: 'sim',
    })
  }

  private startRollback(reading: string) {
    this.shipStage = 'rollback'
    this.shipT = 0
    this.rolledBack = true
    this.act('Head farmer', 400, undefined, 2)
    this.addLog('Head farmer', `Rolled back to ${RELEASE.previous}: ${reading}. ${RELEASE.exposure.charAt(0).toUpperCase() + RELEASE.exposure.slice(1)}.`, 'auto', undefined, 'A rollback only restores what was live before, so it doesn’t wait for you.')
    this.toast(`Rolled back to ${RELEASE.previous}`)
    this.notify()
  }

  private finishRollback() {
    this.shipStage = 'rolledback'
    this.shipT = 0
    this.rollout = 0
    this.cart = { state: 'back', k: 0, crow: false }
    if (!this.pendingSeeds.some((s) => s.file === LESSON_REDIRECT.file) && !this.seeds.some((s) => s.file === LESSON_REDIRECT.file)) this.pendingSeeds.push({ ...LESSON_REDIRECT })
    this.raise({
      id: 'redirect',
      label: 'Anomaly',
      from: 'head',
      fromName: 'Head farmer',
      taskId: '',
      question: 'Add the production redirect URI, then redeploy?',
      impact: ['An agent can’t reach the Google console. Once you add it, Homestead redeploys with the same canary.', SHIP_TEXT.cause],
      options: [
        { key: '1', label: 'I added it, redeploy', value: 'redeploy', recommended: true, kind: 'approve' },
        { key: '2', label: `Keep ${RELEASE.previous} live`, value: 'hold', kind: 'deny' },
      ],
      link: { label: 'Setup guide, step 3', out: 'guide' },
      details: { reasoning: SHIP_TEXT.cause, sources: [SHIP_TEXT.sentry, 'docs/auth/google.md, step 3'], preview: 'redirect_uri_mismatch\nThe redirect URI in the request, https://app.example.com/auth/google/callback,\ndoes not match the ones authorized for the OAuth client.' },
      confidence: 'High',
      basis: 'Sentry shows the same Google error for every failed sign-in',
      provenance: 'sim',
    })
  }

  private goLive() {
    this.shipStage = 'live'
    this.rollout = 100
    this.cart = { state: 'away', k: 0, crow: false }
    this.act('Head farmer', 300, undefined, 1)
    this.addLog('Head farmer', `${RELEASE.version} is live for ${RELEASE.users} users`, 'done')
    this.toast(`Live for ${RELEASE.users} users`)
    this.notify()
  }

  // The cart: out along the valley road while a deploy runs, back to the gate on a rollback.
  private updateCart(dt: number) {
    const c = this.cart
    if (c.state === 'out' || c.state === 'back' || c.state === 'away') {
      c.k = Math.min(1, c.k + dt / (c.state === 'back' ? 2.2 : 3.4))
      if (c.state === 'back' && c.k >= 1) {
        c.state = 'gate'
        c.crow = true
      }
    }
  }

  private onShipResolve(ask: Ask, value: string) {
    const id = ask.id
    if (id === 'deploy' || id.startsWith('deploy-') || id === 'redeploy') {
      if (value === 'approve') return this.startCanary()
      this.shipStage = 'held'
      this.addLog('Head farmer', SHIP_TEXT.held, 'info')
      return
    }
    if (id === 'redirect') {
      this.cart.crow = false
      if (value !== 'redeploy') {
        this.shipStage = 'held'
        return
      }
      this.addLog('You', 'Added the production redirect URI in the Google console', 'answer')
      this.shipStage = 'deploy'
      this.asks = this.asks.filter((a) => a.id !== 'redeploy')
      this.raise(this.deployAsk('redeploy'))
      // You already said redeploy: the ask opens on its confirm.
      const r = this.asks.find((a) => a.id === 'redeploy')
      if (r) r.status = 'confirming'
      return
    }
    if (id === 'rollback') {
      if (value === 'rollback') {
        const h = HEALTH[0]
        return this.startRollback(`${h.name} fell to ${fmtHealth(h, this.health[h.id].value)} on the canary (needs ${h.min}%)`)
      }
      this.addLog('Head farmer', 'Kept the canary running at 5%', 'info')
      return
    }
    if (id.startsWith('ci-')) {
      const job = id.slice(3)
      if (value === 'rerun') {
        this.ciOutcomes[job] = 'pass'
        this.ci[job] = { state: 'wait', text: 'Waiting' }
        this.shipStage = 'ci'
        this.shipT = 0
      } else this.addLog('Head farmer', `Reverted PR #${OUTPUT.pr} on ${OUTPUT.base}`, 'info')
    }
  }

  get shipHeadline() {
    switch (this.shipStage) {
      case 'ci':
        return SHIP_TEXT.ciRunning
      case 'cifailed':
        return SHIP_TEXT.ciFailed
      case 'deploy':
        return this.rolledBack ? SHIP_TEXT.cause : SHIP_TEXT.ciPassed
      case 'held':
        return this.asks.some((a) => a.id === 'rollback' && a.status !== 'resolved') ? 'The canary is failing. It waits for you.' : SHIP_TEXT.held
      case 'canary':
        return SHIP_TEXT.canary
      case 'rollback':
        return SHIP_TEXT.rollback
      case 'rolledback':
        return SHIP_TEXT.rolledback
      case 'canary2':
        return SHIP_TEXT.canary2
      case 'rollout':
        return SHIP_TEXT.rollout
      case 'live':
        return SHIP_TEXT.live
      default:
        return ''
    }
  }

  get decisions() {
    const swapped = this.tasks.some((t) => t.assignee !== t.proposedAssignee) || this.signpostEdits.length > 0
    return [
      { word: 'Plan', text: swapped ? 'Approved the plan with your changes' : 'Approved the plan as proposed' },
      ...this.asks.filter((a) => a.status === 'resolved' && !isShipAsk(a.id)).map((a) => ({ word: REASON_WORD[a.label] ?? a.label, text: `${a.answerLabel}`, q: a.question })),
      ...(this.reviewFixed ? [{ word: 'Failed', text: `Sent the review back to ${this.farmhands[this.task(REVIEW_FAIL.taskId).assignee].role}` }] : []),
      ...(this.approved ? [{ word: 'Review', text: `Looked at ${CHECKS.length} things and approved` }] : []),
      ...(this.sendState === 'sent' ? [{ word: 'Merge', text: `Merged PR #${OUTPUT.pr}` }] : []),
      // Ship's asks come after the merge.
      ...this.asks.filter((a) => a.status === 'resolved' && isShipAsk(a.id)).map((a) => ({ word: REASON_WORD[a.label] ?? a.label, text: shipDecided(a), q: a.question })),
    ]
  }

  toast(text: string) {
    this.toasts.push({ id: this.toastId++, text, t: this.clock })
    if (this.toasts.length > 3) this.toasts.shift()
  }

  // A soft two-note chime, only when an agent asks. Settings can turn it off.
  private audio: AudioContext | null = null
  chime() {
    if (!this.settings.notify.chime || this.intro || typeof window === 'undefined' || typeof AudioContext === 'undefined') return
    try {
      this.audio ??= new AudioContext()
      const ctx = this.audio
      const now = ctx.currentTime
      ;[880, 1318.5].forEach((f, i) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'sine'
        o.frequency.value = f
        g.gain.setValueAtTime(0.0001, now + i * 0.09)
        g.gain.exponentialRampToValueAtTime(0.05, now + i * 0.09 + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.5)
        o.connect(g).connect(ctx.destination)
        o.start(now + i * 0.09)
        o.stop(now + i * 0.09 + 0.55)
      })
    } catch {
      /* sound is optional */
    }
  }

  addLog(who: string, text: string, kind: LogEntry['kind'], taskId?: string, reason?: string, traceId?: string) {
    this.log.push({ id: this.logId++, t: this.t, who, text, kind, taskId, reason, traceId })
  }

  // ---- live calls -------------------------------------------------------------------------

  private request<K extends keyof Outputs>(key: K, run: () => Promise<NonNullable<Outputs[K]>>) {
    if (this.requested.has(key)) return
    this.requested.add(key)
    run().then((o) => {
      this.out[key] = o
      if (o.error) this.addLog('Head farmer', `Live call failed, used a simulated response: ${o.error}`, 'info')
      this.onOutput(key)
      this.notify()
    })
  }

  private onOutput(key: keyof Outputs) {
    if (key === 'clarify') {
      const c = this.out.clarify!
      this.call('Head farmer', c)
      this.questions = c.data.questions.slice(0, 3).map((q, i) => ({ id: q.id || `q${i}`, q: q.q, why: q.why, options: q.options.slice(0, 2) }))
      this.addLog('Head farmer', `Asked ${this.questions.length} questions it couldn’t answer from the brief`, 'info', undefined, c.provenance === 'live' ? `Live call, ${fmtTokens(c.tokens)}` : undefined)
    }
    if (key === 'plan') {
      const p = this.out.plan!
      this.call('Head farmer', p)
      this.applyPlan(p.data)
      this.planRevealT = this.clock
      const crew = new Set(this.tasks.map((t) => t.assignee)).size
      this.addLog('Head farmer', `Proposed a plan: ${this.tasks.length} tasks for ${crew} agents, with Done-when gates on each`, 'info', undefined, p.provenance === 'live' ? `Live call, ${fmtTokens(p.tokens)}` : undefined)
    }
    if (key === 'session') {
      const d = this.out.session!
      const t = this.task(MISSING.taskId)
      this.call(this.farmhands[t.assignee].role, d, t.id)
      this.endpoint = d.data.endpoint
    }
    if (key === 'review') {
      const r = this.out.review!
      this.call('Reviewer', r)
      const b = r.data.blocking[0]
      if (b && !this.reviewFixed) {
        this.harvestGates.review = { state: 'fail', text: REVIEW_FAIL.text }
        this.addLog('Reviewer', `Blocking: ${b.problem}`, 'pest', REVIEW_FAIL.taskId, `${b.file} line ${b.line}. ${b.rule}`)
      } else {
        this.harvestGates.review = this.reviewResult()
        this.addLog('Reviewer', `Reviewed the whole diff: ${this.harvestGates.review.text}`, 'info', undefined, r.provenance === 'live' ? `Live call, ${fmtTokens(r.tokens)}` : undefined)
      }
    }
    if (key === 'conflict') {
      const c = this.out.conflict!
      const t = this.task(MISSING.taskId)
      this.call('Head farmer', c, t.id)
      if (c.data.conflict) {
        this.crow = { state: 'flying', t: 0, x: CROW_SPOT.x + 14, y: CROW_SPOT.y - 12 }
        this.neighbourDrought = true
        const other = c.data.endpoints.find((x) => x.farm !== FARM.name)
        this.addLog('Head farmer', `Found the cause in ${NEIGHBOUR.name}: ${c.data.endpoints.map((x) => x.endpoint).join(' and ')}`, 'info', t.id, other ? `${other.source}: “${other.quote}”` : c.data.why)
      } else {
        this.addLog('Head farmer', `Checked ${this.docsChecked} files on 2 farms: no clash found`, 'auto', t.id, c.data.why)
        this.raiseCrow()
      }
    }
  }

  // ---- simulation ------------------------------------------------------------------------------

  tick(rawDt: number) {
    const dt = Math.min(rawDt, 0.1)
    this.clock += dt
    if (this.seedFly) {
      this.seedFly.t += dt / 1.1
      if (this.seedFly.t >= 1) this.seedFly = null
    }
    const before = this.toasts.length
    this.toasts = this.toasts.filter((t) => this.clock - t.t < 4.5)
    if (this.toasts.length !== before) this.dirty = true

    if (this.intro && this.ready && this.clock - this.beatT > BEATS[this.beat].secs) this.nextBeat()
    this.updateHead(dt)
    this.updateChickens(dt)

    if (this.phase === 'grow' && !this.paused) {
      const sdt = dt * this.speed
      this.t += sdt
      for (const id of ROLE_ORDER) this.updateFarmhand(this.farmhands[id], sdt)
      this.updateWorld(sdt)
      this.dirty = true
    } else if (this.phase === 'harvest') {
      this.updateHarvest(dt)
      this.dirty = true
    } else if (this.phase === 'ship') {
      this.updateShip(dt)
      this.dirty = true
    } else if (this.phase === 'plan') {
      // Each farmhand walks out of the barn once the head farmer has tilled its plot.
      for (const id of ROLE_ORDER) this.planMove(this.farmhands[id], dt)
    } else if (this.phase !== 'grow') {
      for (const id of ROLE_ORDER) this.fidget(this.farmhands[id], dt)
    }
    if (this.headThinking) this.dirty = true
    if (this.dirty && this.clock - this.lastNotify > 0.1) this.notify()
  }

  // ---- the head farmer -----------------------------------------------------------------

  private updateHead(dt: number) {
    const h = this.head
    const moving = this.walkOnly(h, dt, h.speed)
    h.anim = moving ? 'walk' : 'idle'
    if (moving || this.intro) return
    h.speed = WALK_SPEED
    // Reading the brief: lift one scroll per attached file out of the chest.
    if (this.phase === 'clarify' && !this.out.clarify) {
      if (!this.near(h, FARM.chestSpot)) return this.walkTo(h, FARM.chestSpot)
      h.dir = 'up'
      h.scrollT += dt
      return
    }
    // Making the plan: till a patch per task. It never runs ahead of the call:
    // the first patch holds short of done until the plan lands.
    if (this.phase === 'plan' && this.planShown < this.tasks.length) {
      const i = this.planShown
      const r = this.tasks[i].plot
      const spot = { x: r.x + r.w / 2, y: r.y + r.h + 1.6 }
      if (!this.near(h, spot)) {
        h.speed = this.out.plan ? 9 : 5
        return this.walkTo(h, spot)
      }
      h.anim = 'till'
      h.dir = 'up'
      const landed = !!this.out.plan
      h.till[i] = Math.min(landed ? 1 : 0.8, h.till[i] + dt / (landed ? 0.4 : 2.4))
      if (h.till[i] >= 1) {
        this.planShown++
        this.notify()
      }
      return
    }
    if (!this.near(h, FARM.headFarmer)) return this.walkTo(h, FARM.headFarmer)
    h.dir = 'down'
  }

  get scrollsLifted() {
    const n = this.attachments.filter((a) => a.selected).length
    return this.phase === 'clarify' && !this.out.clarify ? Math.min(n, Math.floor(this.head.scrollT / 0.5)) : 0
  }

  private near(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y) < 0.12
  }

  private updateWorld(dt: number) {
    // Gates run a moment after a task's last step; the crop ripens only if they pass.
    for (const [id, at] of Object.entries(this.gateRunAt)) if (this.t - at > 1.6) this.finishGates(this.task(id))
    if (this.crow.state === 'flying') {
      this.crow.t += dt / CROW_FLIGHT
      const k = Math.min(1, this.crow.t)
      const e = 1 - Math.pow(1 - k, 3)
      this.crow.x = CROW_SPOT.x + 14 * (1 - e)
      this.crow.y = CROW_SPOT.y - 12 * (1 - e) - Math.sin(k * Math.PI) * 1.5
      if (k >= 1) {
        this.crow.state = 'landed'
        this.raiseCrow()
      }
    } else if (this.crow.state === 'leaving') {
      this.crow.t += dt / CROW_FLIGHT
      const k = Math.min(1, this.crow.t)
      this.crow.x = CROW_SPOT.x - 20 * k * k
      this.crow.y = CROW_SPOT.y - 14 * k
      if (k >= 1) this.crow.state = 'gone'
    }

    if (!this.harvestReady && this.allDone) {
      this.harvestReady = true
      for (const fh of Object.values(this.farmhands)) {
        fh.job = null
        fh.status = 'done'
      }
      this.panelOpen = true
      this.freeCam = null
      this.addLog('Head farmer', 'Every crop is ripe. The agentic review runs at the harvest.', 'done')
      this.toast('Every crop is ripe. The harvest is ready for you.')
      this.notify()
    }
  }

  private walkTo(w: Walker & { moving?: boolean }, to: { x: number; y: number }) {
    w.path = []
    if (Math.abs(w.x - to.x) > 0.05) w.path.push({ x: to.x, y: w.y })
    w.path.push({ x: to.x, y: to.y })
    w.moving = true
  }

  standSpot(task: Task, subIdx: number) {
    const tiles = cropTiles(task).filter((c) => c.sub === subIdx)
    const pick = tiles[Math.floor(tiles.length / 2)]
    const col = pick ? pick.x : task.plot.x
    return { x: col + 0.5, y: task.plot.y + task.plot.h + 0.55 }
  }

  private nextJob(fh: Farmhand): Job | null {
    if (fh.interrupts.length) return fh.interrupts.shift()!
    for (const t of this.tasks) {
      if (t.assignee !== fh.id) continue
      const s = t.subtasks.find((x) => !x.done)
      if (!s) continue
      if ((s.needs ?? []).every((f) => this.flags.has(f))) return { kind: 'sub', taskId: t.id, subId: s.id }
    }
    return null
  }

  private hasWorkLeft(fh: Farmhand) {
    return this.tasks.some((t) => t.assignee === fh.id && t.subtasks.some((s) => !s.done))
  }

  private walkOnly(w: Walker & { moving?: boolean }, dt: number, speed = WALK_SPEED) {
    if (!w.path.length) return false
    const p = w.path[0]
    const dx = p.x - w.x
    const dy = p.y - w.y
    const d = Math.hypot(dx, dy)
    const step = speed * dt
    if (d > 0.001) w.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    if (d <= step) {
      w.x = p.x
      w.y = p.y
      w.path.shift()
    } else {
      w.x += (dx / d) * step
      w.y += (dy / d) * step
    }
    w.moving = w.path.length > 0
    return w.moving
  }

  // During Plan: out of the barn to its plot once that plot is tilled, back in if you move its task away.
  private planMove(fh: Farmhand, dt: number) {
    const door = FARM.barn.door
    const i = this.tasks.findIndex((t) => t.assignee === fh.id)
    const shown = i >= 0 && i < this.planShown
    if (this.walkOnly(fh, dt)) {
      fh.fade = shown || !this.near(fh, door) ? Math.min(1, fh.fade + dt / 0.4) : Math.max(0, fh.fade - dt / 0.4)
      return
    }
    if (!shown) {
      if (fh.inside) return
      if (!this.near(fh, door)) return this.walkTo(fh, door)
      fh.inside = true
      fh.fade = 0
      return
    }
    if (fh.inside) {
      fh.inside = false
      fh.x = door.x
      fh.y = door.y
      fh.fade = 0
    }
    fh.fade = Math.min(1, fh.fade + dt / 0.4)
    const spot = this.standSpot(this.tasks[i], 0)
    if (!this.near(fh, spot)) return this.walkTo(fh, spot)
    fh.dir = 'down'
    this.fidget(fh, dt)
  }

  // Where a farmhand waits for its own next step: beside its own plot.
  private ownSpot(fh: Farmhand) {
    const t = this.tasks.find((x) => x.assignee === fh.id && x.subtasks.some((s) => !s.done))
    if (!t) return null
    return this.standSpot(t, Math.max(0, t.subtasks.findIndex((s) => !s.done)))
  }

  // A farmhand standing still now and then glances left or right, each on its own timer.
  private fidget(fh: Farmhand, dt: number) {
    if (fh.shiftLeft > 0) {
      fh.shiftLeft -= dt
      if (fh.shiftLeft <= 0) fh.look = null
      return
    }
    fh.nextShift -= dt
    if (fh.nextShift <= 0) {
      fh.nextShift = 2 + Math.random() * 3
      fh.look = Math.random() < 0.5 ? 'left' : 'right'
      fh.shiftLeft = 0.5 + Math.random() * 0.8
    }
  }

  // Done for now: a chore away from the plots, switching every 8 to 15 seconds.
  // Call after walkOnly; this only decides where to go and which way to face.
  private doChores(fh: Farmhand, dt: number) {
    if (fh.inside) {
      fh.inside = false
      fh.x = FARM.barn.door.x
      fh.y = FARM.barn.door.y
    }
    fh.fade = Math.min(1, fh.fade + dt / 0.4)
    if (fh.chore?.id === '' && fh.chore.t > 0) {
      // A short rest where it stands before picking a chore.
      fh.chore.t -= dt
      return this.fidget(fh, dt)
    }
    const c = fh.chore && CHORES.find((x) => x.id === fh.chore!.id)
    if (!c || fh.chore!.t <= 0) return this.pickChore(fh)
    if (!this.near(fh, c.spot)) return this.walkTo(fh, c.spot)
    fh.dir = c.dir
    if (c.partner && !ROLE_ORDER.some((id) => this.farmhands[id].chore?.id === c.partner && this.near(this.farmhands[id], CHORES.find((x) => x.id === c.partner)!.spot))) {
      // Waiting for someone to chat with.
      fh.dir = 'down'
      this.fidget(fh, dt)
    }
    fh.chore!.t -= dt
  }

  private pickChore(fh: Farmhand) {
    const others = ROLE_ORDER.filter((id) => id !== fh.id).map((id) => this.farmhands[id])
    const taken = new Set(others.map((o) => o.chore?.id))
    const free = others.filter((o) => o.status === 'done').length > 0
    const options = CHORES.filter((c) => !taken.has(c.id) && c.id !== fh.chore?.id && (!c.partner || free))
    const join = options.find((c) => c.partner && taken.has(c.partner))
    const c = join ?? options[Math.floor(Math.random() * options.length)] ?? CHORES[0]
    fh.chore = { id: c.id, t: 8 + Math.random() * 7 }
    fh.look = null
    this.walkTo(fh, c.spot)
  }

  choreOf(fh: Farmhand) {
    if (fh.status !== 'done' || !fh.chore || fh.path.length) return null
    const c = CHORES.find((x) => x.id === fh.chore!.id)
    return c && this.near(fh, c.spot) ? c : null
  }

  // ---- things to click on the farm ------------------------------------------------------

  poke(id: string) {
    this.pokes[id] = this.clock
    if (id.startsWith('chicken-')) {
      const c = this.chickens[Number(id.slice(8))]
      if (!c) return
      c.clicks = this.clock - c.lastClick < 2 ? c.clicks + 1 : 1
      c.lastClick = this.clock
      if (c.clicks >= 3) {
        // Enough petting: it runs off.
        c.clicks = 0
        c.flee = 1.4
        c.tx = c.x < CHICKEN_PEN.x + CHICKEN_PEN.w / 2 ? CHICKEN_PEN.x + CHICKEN_PEN.w + 1.5 : CHICKEN_PEN.x - 1.8
        c.ty = CHICKEN_PEN.y + 1.6
      }
    } else if (id === 'pond') {
      if (Math.random() < 0.4) this.fishAt = this.clock
    } else if (id === 'chest') {
      this.panelOpen = true
      this.setNav([{ kind: 'library' }])
    } else if (id === 'house') {
      this.panelOpen = true
      if (this.phase === 'brief') this.setNav([])
      else this.setNav([{ kind: 'step', id: 'plant' }])
    }
    this.notify()
  }

  // A farmhand with nothing to do turns to face you.
  pokeFarmhand(id: RoleId) {
    const fh = this.farmhands[id]
    const idle = fh.status === 'done' || fh.status === 'idle' || this.phase !== 'grow'
    if (!idle || fh.path.length) return this.openFarmhand(id)
    fh.react = this.clock
    fh.dir = 'down'
    fh.look = null
    this.notify()
  }

  private updateChickens(dt: number) {
    for (const c of this.chickens) {
      if (c.wait > 0 && c.flee <= 0) {
        c.wait -= dt
        if (c.wait <= 0) {
          c.tx = CHICKEN_PEN.x + Math.random() * CHICKEN_PEN.w
          c.ty = CHICKEN_PEN.y + Math.random() * CHICKEN_PEN.h
        }
        continue
      }
      const dx = c.tx - c.x
      const dy = c.ty - c.y
      const d = Math.hypot(dx, dy)
      const speed = c.flee > 0 ? 6 : 0.9
      c.flee = Math.max(0, c.flee - dt)
      if (d < 0.05) {
        // After running off it wanders back into the pen.
        c.wait = c.flee > 0 ? 0.1 : 1.5 + Math.random() * 3
        if (c.x < CHICKEN_PEN.x - 0.5 || c.x > CHICKEN_PEN.x + CHICKEN_PEN.w + 0.5) {
          c.tx = CHICKEN_PEN.x + Math.random() * CHICKEN_PEN.w
          c.ty = CHICKEN_PEN.y + Math.random() * CHICKEN_PEN.h
          c.wait = 1.2
        }
        continue
      }
      const step = Math.min(d, speed * dt)
      c.x += (dx / d) * step
      c.y += (dy / d) * step
    }
  }

  private updateFarmhand(fh: Farmhand, dt: number) {
    if (fh.paused) return
    const workLeft = fh.interrupts.length > 0 || this.hasWorkLeft(fh)
    if (fh.inside) {
      // New work (a re-plan, a pest) brings it back out.
      if (!workLeft) return
      fh.inside = false
      fh.status = 'idle'
      fh.x = FARM.barn.door.x
      fh.y = FARM.barn.door.y
    }
    if (fh.fade < 1 && fh.status !== 'done') fh.fade = Math.min(1, fh.fade + dt / 0.4)
    if (this.walkOnly(fh, dt)) {
      if (fh.status !== 'asking' && fh.status !== 'done') fh.status = 'walking'
      return
    }
    // Waiting for you: it stays at its own plot and turns to face you.
    if (fh.status === 'asking') {
      fh.dir = 'down'
      return
    }
    if (fh.status === 'done') {
      if (!workLeft) return this.doChores(fh, dt)
      fh.status = 'idle'
      fh.chore = null
    }

    if (!fh.job) {
      const job = this.nextJob(fh)
      if (!job) {
        if (!workLeft) {
          // Done: it stops using energy, walks back to the barn, then picks up chores near it.
          fh.status = 'done'
          fh.chore = { id: '', t: 1.2 }
          return this.walkTo(fh, { x: FARM.barn.door.x, y: FARM.barn.door.y + 0.9 })
        }
        fh.status = 'waiting'
        // Blocked on another task: it waits at its own plot, so the plot and its farmhand read as one.
        const spot = this.ownSpot(fh)
        if (spot && !this.near(fh, spot)) return this.walkTo(fh, spot)
        fh.dir = 'down'
        this.fidget(fh, dt)
        return
      }
      fh.job = job
      fh.look = null
    }

    const job = fh.job!
    const task = this.task(job.taskId)
    {
      const subIdx = job.kind === 'sub' ? task.subtasks.findIndex((s) => s.id === job.subId) : 0
      const spot = job.kind === 'fix' ? this.pestSpot(task, job.pestId) : this.standSpot(task, subIdx)
      if (!this.near(fh, spot)) {
        this.walkTo(fh, spot)
        fh.status = 'walking'
        return
      }
      fh.dir = 'up'
    }

    if (job.kind === 'fix') {
      fh.status = 'working'
      job.progress = Math.min(1, job.progress + dt / job.secs)
      const target = Math.floor(job.actions * job.progress)
      while (job.emitted < target) {
        job.emitted++
        task.used += job.energy / job.actions
        this.act(fh.role, job.energy / job.actions, task.id)
      }
      const pest = task.pests.find((p) => p.id === job.pestId)
      if (pest) pest.size = Math.max(0.25, 1 - job.progress)
      if (job.progress >= 1) {
        task.pests = task.pests.filter((p) => p.id !== job.pestId)
        this.flags.add('unitFixed')
        this.addLog(fh.role, `Fixed ${job.label}`, 'auto', task.id, UNIT_FAIL.fix)
        fh.job = null
        this.startGates(task)
        this.notify()
      }
      return
    }

    const sub = task.subtasks.find((s) => s.id === job.subId)!
    if (!sub.started) {
      sub.started = true
      fh.transcript.push(`Started “${sub.name}”`)
      if (this.onSubStart(fh, task, sub)) return
    }
    fh.status = 'working'
    sub.progress = Math.min(1, sub.progress + dt / sub.secs)
    // Steps backed by a model call hold just short of done until the call returns.
    // The end-to-end run holds halfway while it fails, until the session API is settled.
    const e2eBlocked = sub.id === 't2' && this.gates[task.id]?.e2e?.state === 'fail'
    if (e2eBlocked && this.flags.has('sessionV2')) {
      this.gates[task.id]!.e2e = { state: 'run', text: E2E_FAIL.again }
      this.addLog(fh.role, 'Running the end-to-end tests again on staging', 'info', task.id)
    }
    const waitingOn = (sub.id === 'f2' && !this.out.session) || (e2eBlocked && !this.flags.has('sessionV2'))
    if (waitingOn) sub.progress = Math.min(sub.progress, e2eBlocked ? 0.55 : 0.9)
    const target = Math.floor(sub.actions * sub.progress)
    const before = task.used
    while (sub.emitted < target) {
      sub.emitted++
      task.used += sub.energy / sub.actions
      this.act(fh.role, sub.energy / sub.actions, task.id)
    }
    if (!task.dry && before < task.budget * 0.75 && task.used >= task.budget * 0.75) {
      task.dry = true
      this.addLog(fh.role, `${task.name} passed 75% of its energy`, 'energy', task.id, 'The plot turns dry as a warning.')
      this.notify()
    }
    if (sub.progress >= 1 && !waitingOn) {
      sub.done = true
      fh.transcript.push(`Finished “${sub.name}”`)
      for (const f of sub.sets ?? []) this.flags.add(f)
      this.onSubDone(fh, task, sub)
      fh.job = null
      if (task.subtasks.every((s) => s.done)) this.startGates(task)
      this.notify()
    }
  }

  private pestSpot(task: Task, pestId: string) {
    const p = task.pests.find((x) => x.id === pestId)
    const x = p ? p.tile.x + 0.5 : task.plot.x + task.plot.w / 2
    return { x, y: task.plot.y + task.plot.h + 0.55 }
  }

  // ---- gates during Grow --------------------------------------------------------------------

  private startGates(task: Task) {
    const gs = this.machineGates(task.id)
    this.gates[task.id] ??= {}
    for (const g of gs) this.gates[task.id]![g] = { state: 'run', text: 'Running' }
    this.gateRunAt[task.id] = this.t
    if (!gs.length) this.finishGates(task)
  }

  private finishGates(task: Task) {
    delete this.gateRunAt[task.id]
    const fh = this.farmhands[task.assignee]
    const results = this.gates[task.id] ?? {}
    for (const g of this.machineGates(task.id)) {
      // Frontend's first unit run misses an error state. It fixes that alone: a pest, not a question.
      if (g === 'unit' && task.id === UNIT_FAIL.taskId && !this.flags.has('unitFixed') && this.demoScenario) {
        results[g] = { state: 'fail', text: UNIT_FAIL.text }
        const pest = { id: 'unit-1', kind: 'beetle' as const, label: UNIT_FAIL.pest, size: 1, tile: { x: task.plot.x + 2, y: task.plot.y + 1 } }
        task.pests.push(pest)
        this.addLog(fh.role, `Unit tests failed: ${UNIT_FAIL.text}`, 'pest', task.id, UNIT_FAIL.pest)
        fh.interrupts.push({ kind: 'fix', taskId: task.id, pestId: pest.id, label: 'the failing unit test', secs: 2.5, energy: 1_500, actions: 6, progress: 0, emitted: 0 })
        continue
      }
      results[g] = { state: 'pass', text: TASK_RESULTS[task.id]?.[g] ?? 'Passed' }
    }
    this.gates[task.id] = results
    const passed = this.machineGates(task.id).filter((g) => results[g]?.state === 'pass')
    if (passed.length) this.addLog('Gates', `${task.name}: ${passed.map((g) => `${GATES[g].name.toLowerCase()} ${results[g]!.text}`).join(', ')}`, 'info', task.id)
    if (this.taskRipe(task)) {
      this.addLog(fh.role, `Ripe: ${task.name}`, 'done', task.id)
      if (task.id === 'tests' && this.flags.has('replanApplied') && !this.pendingSeeds.some((s) => s.file === LESSON_STAGING.file)) this.pendingSeeds.push({ ...LESSON_STAGING })
    }
    this.notify()
  }

  // Returns true when the subtask is blocked on an ask.
  private onSubStart(fh: Farmhand, task: Task, sub: Subtask): boolean {
    if (sub.id === 'b2') {
      this.addLog(fh.role, 'Added /auth/google/callback', 'auto', task.id, 'Follows oauth-security.md: a state parameter and PKCE.')
    }
    if (sub.id === 'f2') {
      // The model call is the work: no scripted steps on top of it.
      sub.actions = 0
      const signposts = [...task.signposts, ...fh.almanac]
      const sawChangelog = expandSignposts(signposts).includes(MISSING.file)
      this.request('session', () =>
        callAgent('session', { goal: this.goal, task: task.name, answers: this.answersText, signposts }, sawChangelog ? RECORDED.sessionV2 : RECORDED.session),
      )
    }
    if (sub.id === 't2' && this.endpoint === CLASH.ours && !this.flags.has('sessionV2')) {
      // Staging no longer has the endpoint Frontend called. The head farmer looks for why across farms.
      this.gates[task.id] ??= {}
      this.gates[task.id]!.e2e = { state: 'fail', text: E2E_FAIL.text }
      this.addLog(fh.role, 'Sign-in failed on staging', 'pest', task.id, CLASH.failed)
      const front = this.task(MISSING.taskId)
      if (!this.requested.has('conflict')) this.addLog('Head farmer', `Checking ${this.docsChecked} files on 2 farms for why`, 'info', task.id)
      this.request('conflict', () =>
        callAgent('conflict', { endpoint: this.endpoint, source: this.out.session?.data.source ?? 'unknown', failure: CLASH.failed, ourDocs: [...front.signposts] }, RECORDED.conflict),
      )
    }
    return false
  }

  private onSubDone(fh: Farmhand, task: Task, sub: Subtask) {
    if (sub.id === 'f2') {
      const d = this.out.session!.data
      const saw = expandSignposts(task.signposts).includes(MISSING.file)
      this.addLog(fh.role, `Started the session with ${d.endpoint}`, 'auto', task.id, `From ${d.source}.${saw ? '' : ' The Session API v2 changelog was not attached.'}`, saw ? undefined : 'endpoint')
    }
    if (sub.id === REPLAN_SUBTASKS.switch.id) {
      this.endpoint = CLASH.theirs
      this.addLog(fh.role, `Switched to ${CLASH.theirs}`, 'info', task.id, 'After your answer. Tests run again on staging.')
    }
    if (sub.id === 'd1') this.addLog(fh.role, 'Wrote docs/auth/google.md', 'info', task.id, 'Uses the callback route Backend added.')
  }

  private raiseCrow() {
    const c = this.out.conflict!
    const t = this.task('tests')
    const fh = this.farmhands[t.assignee]
    const front = this.task(MISSING.taskId)
    const builder = this.farmhands[front.assignee].role
    const ours = c.data.endpoints.find((d) => d.farm === FARM.name) ?? c.data.endpoints[0]
    const theirs = c.data.endpoints.find((d) => d !== ours)
    fh.status = 'asking'
    this.raise({
      id: 'crow',
      label: 'Anomaly',
      from: fh.id,
      fromName: fh.role,
      taskId: t.id,
      question: `Sign-in fails on staging. The ${NEIGHBOUR.name} project retired ${CLASH.ours} yesterday. Which should ${builder} use?`,
      impact: [
        'Your deploy goes out Friday, Nov 13, the day after production drops /v1/session.',
        ...(theirs ? [`${theirs.source}: “${theirs.quote}”`] : []),
        'Nothing has merged yet.',
      ],
      sides: theirs
        ? [
            { title: ours.endpoint, who: `${builder}, from ${ours.source.replace('web-app/', '')}`, source: ours.source, quote: ours.quote },
            { title: theirs.endpoint, who: `The ${NEIGHBOUR.name} project`, source: theirs.source, quote: theirs.quote },
          ]
        : undefined,
      options: [
        { key: '1', label: `Switch to ${CLASH.theirs}`, value: 'v2', recommended: c.data.recommended === CLASH.theirs, kind: 'alt' },
        { key: '2', label: `Keep /v1 and tell that team`, value: 'keep', recommended: c.data.recommended !== CLASH.theirs, kind: 'alt' },
      ],
      confidence: c.data.confidence,
      basis: 'The changelog and the failing test agree.',
      provenance: c.provenance,
      details: {
        reasoning: `Staging: ${CLASH.failed}`,
        sources: [...c.data.endpoints.map((d) => d.source), 'e2e-tests/google-signin.spec.ts'],
      },
    })
  }
}

// Which plot tile holds which subtask's crop. Base subtasks fill the original rows;
// subtasks added by a re-plan get the new row at the bottom, so earlier crops never move.
export function cropTiles(task: Task) {
  const out: { x: number; y: number; sub: number }[] = []
  const extra = task.subtasks.map((s, i) => ({ s, i })).filter((x) => x.s.addedByReplan)
  const base = task.subtasks.map((s, i) => ({ s, i })).filter((x) => !x.s.addedByReplan)
  const baseRows = task.plot.h - (extra.length ? 1 : 0)
  const fill = (rows: number[], subs: { i: number }[]) => {
    const cells: { x: number; y: number }[] = []
    for (let c = 0; c < task.plot.w; c++) for (const r of rows) cells.push({ x: task.plot.x + c, y: task.plot.y + r })
    const per = Math.max(1, Math.floor(cells.length / subs.length))
    cells.forEach((c, k) => out.push({ ...c, sub: subs[Math.min(subs.length - 1, Math.floor(k / per))].i }))
  }
  fill([...Array(baseRows).keys()], base)
  if (extra.length) fill([task.plot.h - 1], extra)
  return out
}

// A reason is a plain word. Outbound steps get no word: they lead with who they reach.
export const REASON_WORD: Record<string, string> = { Cost: 'Costs more', Risk: 'Risky', Failure: 'Failed', Anomaly: 'Looks wrong', Irreversible: 'Deploy' }

export function isShipAsk(id: string) {
  return id === 'deploy' || id.startsWith('deploy-') || id === 'redeploy' || id === 'redirect' || id === 'rollback' || id.startsWith('ci-')
}

// What a resolved Ship ask reads as in Your decisions.
function shipDecided(a: Ask) {
  const deploy = a.id === 'deploy' || a.id.startsWith('deploy-')
  if (deploy || a.id === 'redeploy') return a.answer === 'approve' ? `${a.id === 'redeploy' ? 'Redeployed' : 'Deployed'} ${RELEASE.app} ${RELEASE.version} to production` : 'Held the deploy'
  if (a.id === 'redirect') return a.answer === 'redeploy' ? 'Added the production redirect URI and redeployed' : `Kept ${RELEASE.previous} live`
  return a.answerLabel ?? ''
}

export function fmtTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k tokens` : `${Math.round(n)} tokens`
}

function readLiveAI() {
  try {
    const on = localStorage.getItem('homestead.liveAI') === '1'
    setLiveAI(on)
    return on
  } catch {
    return false
  }
}

export const engine = new Engine()
if (typeof window !== 'undefined') (window as unknown as { engine: Engine }).engine = engine
export { CLARIFY, CREW, FARM }
