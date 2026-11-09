// The engine behind the demo.
// Three agent steps are real Claude calls (the Writer's draft, the Reviewer's claim check and the
// head farmer's cross-farm date check). The rest of the farmhands' work is simulated, which the brief allows.
// Every number on screen is computed from the ledger: agent actions, energy, and how many times a human was needed.

import { ATTACHMENTS, BRIEF_GOAL, CHICKEN_PEN, CHORES, CLARIFY, CREW, CROW_SPOT, FARM, INVITE_LIST, LESSON_DATES, LESSON_SOURCES, NEIGHBOUR, REPLAN_SUBTASKS, ROLE_ORDER, START_SEEDS, SUGGESTED_BUDGET, TASKS, type Attachment, type ClarifyQ } from './scenario'
import { callAgent, probeLive, setLiveAI, RECORDED, type ClaimsOut, type ClarifyOut, type ConflictOut, type DraftOut, type Outcome, type PlanOut } from './live'
import { conflictDocs, SLOTS } from '../agent/agents'
import { LIBRARY, libItem } from './library'
import { DONE_WHEN, OUTPUTS, TASK_OUTPUT, type CheckResult, type OutputId, type RunFacts } from './review'
import { expandSignposts } from '../agent/docs'
import type { Ask, CropKind, Dir, Farmhand, Flag, Job, LedgerEvent, LogEntry, Phase, Rect, Replan, RoleId, Seed, Subtask, Task, Toast } from './types'

const WALK_SPEED = 3.4 // tiles per second
const CROW_FLIGHT = 2.2 // seconds

export type View = 'farm' | 'valley'

// Where the side panel is. An empty stack is the overview; each entry is one level deeper.
export type Nav =
  | { kind: 'step'; id: Phase }
  | { kind: 'task'; id: string }
  | { kind: 'log'; tab: LogTab }
  | { kind: 'why'; id: string }
  | { kind: 'trace' }
  | { kind: 'out'; id: OutputId | 'decisions' | 'lessons' }
  | { kind: 'lib'; id: string }
  | { kind: 'pick'; id: string }
  | { kind: 'library' }
export type LogTab = 'all' | 'asks' | 'auto'

export type Hint = 'plot' | 'ask' | 'auto'

export interface Check {
  id: string
  taskId: string
  output: OutputId
  text: string
  custom?: boolean
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

// The opening: three camera beats with one caption each.
export const BEATS = [
  { secs: 4.2, caption: 'Every team in this valley runs its own crew of agents.' },
  { secs: 4.8, caption: 'Your farm is launching March 12. Engineering moved it to March 26.' },
  { secs: 4.2, caption: 'Your agents only read what you give them.' },
]

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
  draft?: Outcome<DraftOut>
  claims?: Outcome<ClaimsOut>
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
  checks: Check[] = []
  ticked = new Set<string>()
  approved = false
  sendState: 'none' | 'confirming' | 'sent' = 'none'
  sourceFixed = false
  showHelp = false
  live: boolean | null = null // whether a key is configured; null until probed
  liveAI = readLiveAI() // real model calls; off by default so testing spends no tokens

  // brief
  goal = BRIEF_GOAL
  attachments: Attachment[] = ATTACHMENTS.map((a) => ({ ...a }))
  budget = SUGGESTED_BUDGET
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
  chickens: Chicken[] = [0, 1, 2].map((i) => ({ x: CHICKEN_PEN.x + 0.6 + i * 1.6, y: CHICKEN_PEN.y + (i % 2) * 0.8, tx: 0, ty: 0, wait: i, clicks: 0, lastClick: -9, flee: 0 }))
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
  webinarDate = 'March 10'
  launchDate = 'March 12'
  out: Outputs = {}
  private requested = new Set<string>()
  private logId = 1
  private toastId = 1

  constructor() {
    this.resetFarm()
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
    // Outside the barn until there is work.
    const homeSpots: Record<RoleId, { x: number; y: number }> = {
      researcher: { x: 19.4, y: 8.5 },
      writer: { x: 21.1, y: 9.1 },
      reviewer: { x: 22.8, y: 8.5 },
      scheduler: { x: 24.5, y: 9.1 },
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
        x: home.x,
        y: home.y,
        home,
        path: [],
        facing: 1,
        dir: 'down',
        look: null,
        nextShift: 1 + Math.random() * 4,
        shiftLeft: 0,
        fade: 1,
        inside: false,
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
    const { mine, theirs } = conflictDocs(this.task('draft').signposts)
    return mine.length + theirs.length
  }

  get demoScenario() {
    return /relay v2/i.test(this.goal)
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
    return this.tasks.every((t) => t.subtasks.every((s) => s.done))
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
      const p = this.task('draft').plot
      return { x: p.x - 7, y: p.y - 5, w: p.w + 14, h: p.h + 9 }
    }
    const crowAsk = this.activeAsk?.id === 'crow' || this.replan?.status === 'open' || this.crow.state === 'flying'
    if (crowAsk) return { x: 11, y: 4, w: 47, h: 17 }
    if (this.phase === 'plan') return { x: 2, y: 5, w: 32, h: 17 }
    const farm = { x: 1, y: 1.5, w: 36, h: 21.5 }
    // A new ask leans the camera a little toward its plot while it waits.
    if (this.nudge && this.activeAsk) {
      return { ...farm, x: farm.x + (this.nudge.x - (farm.x + farm.w / 2)) * 0.18, y: farm.y + (this.nudge.y - (farm.y + farm.h / 2)) * 0.18 }
    }
    return farm
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

  submitBrief() {
    if (this.phase !== 'brief' || !this.goal.trim()) return
    this.phase = 'clarify'
    this.nav = []
    this.callStart = this.clock
    this.head.scrollT = 0
    const n = this.attachments.filter((a) => a.selected).length
    this.request('clarify', () => callAgent('clarify', { goal: this.goal, attached: this.attachedNames() }, RECORDED.clarify))
    this.addLog('Head farmer', `Read the brief and ${n} attachments`, 'info', undefined, 'A new head farmer starts every farm. It only knows the brief, its attachments and the seed library.')
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

  // The webinar follows the launch date: two days before, or on the day if the owner said so.
  private webinarFor(launch: string) {
    return Object.values(this.clarifyAnswers).some((a) => /launch day/i.test(a)) ? launch : shiftDate(launch, -2)
  }

  get answersText() {
    return this.questions.map((q) => `- ${q.q} ${this.clarifyAnswers[q.id] ?? q.options[0]}`).join('\n')
  }

  private applyPlan(p: PlanOut) {
    const ids = ['research', 'draft', 'factcheck', 'brand', 'invites']
    const attached = this.attachedNames()
    SLOTS.forEach((slot, i) => {
      const src = p.tasks[slot.key]
      const t = this.task(ids[i])
      if (!src) return
      t.name = src.name || t.name
      t.subtasks.forEach((s, k) => {
        if (src.subtasks[k]) s.name = src.subtasks[k]
      })
      if (this.farmhands[src.assignee]) {
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
    return [...names].map((name) => ({ name, ...libItem(name, this.seeds) }))
  }

  lib(name: string) {
    return libItem(name, this.seeds)
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
    this.addLog('Head farmer', 'Planted 5 plots and sent the crew out', 'info')
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
    this.toast(q > 1 ? `The ${ask.fromName} needs you too (${q} waiting)` : `The ${ask.fromName} needs you`)
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
    if (ask.id === 'crow') {
      const conflict = this.out.conflict?.data
      const later = conflict?.dates.find((d) => d.farm !== FARM.name)?.date ?? 'March 26'
      const earlier = this.launchDate
      const chosen = value === 'keep' ? earlier : later
      const oldWebinar = this.webinarDate
      const newWebinar = chosen === earlier ? oldWebinar : this.webinarFor(chosen)
      this.launchDate = chosen
      this.replan = {
        id: 'replan-date',
        title: chosen !== earlier ? `Move launch comms to ${chosen}` : `Keep ${earlier}, ask engineering to confirm`,
        status: 'open',
        lines:
          chosen !== earlier
            ? [
                { op: '~', text: `Announcement launch date: ${earlier} → ${chosen}` },
                { op: '~', text: `Webinar: ${oldWebinar} → ${newWebinar}, 10:00 PT` },
                { op: '+', text: 'New crop on Draft the announcement: “Update the launch date” (Writer)' },
                { op: '+', text: 'New crop on Draft the announcement: “Tell Acme the new date” (Writer)' },
                { op: '+', text: 'Draft the announcement reads eng-standup-notes/' },
                { op: '~', text: `The ${NEIGHBOUR.name} crew is told launch comms now say ${chosen}` },
              ]
            : [
                { op: '~', text: `Announcement keeps ${earlier}` },
                { op: '+', text: `Ask sent to the ${NEIGHBOUR.name} crew: can v2 still ship ${earlier}?` },
                { op: '+', text: 'Draft the announcement reads eng-standup-notes/' },
              ],
      }
      this.webinarDate = newWebinar
      this.act('Head farmer', 1_500, 'draft', 8)
    }
    if (ask.id === 'quote') {
      this.addLog(ask.fromName, value === 'keep' ? 'Kept the Acme quote, attributed by role' : 'Paraphrased the Acme quote without a name', 'info', 'factcheck')
    }
    if (ask.id === 'invites') {
      if (value === 'deny') this.addLog('Scheduler', 'Holding the invites. Nothing was sent.', 'info', 'invites')
      if (value === 'acme-first') this.addLog('Scheduler', 'Sending to Acme first (12 people). The rest stay queued.', 'info', 'invites')
    }
    // Whoever asked goes back to work, whichever farmhand the plan gave the task to.
    const asker = ask.from !== 'head' ? this.farmhands[ask.from] : null
    if (asker?.status === 'asking') asker.status = 'working'
  }

  applyReplan() {
    if (!this.replan || this.replan.status !== 'open') return
    this.replan.status = 'applied'
    this.flags.add('dateResolved')
    this.flags.add('replanApplied')
    const draft = this.task('draft')
    if (!draft.signposts.includes('eng-standup-notes/')) draft.signposts.push('eng-standup-notes/')
    if (this.replan.lines.length > 3) {
      draft.plot = { ...draft.plot, h: draft.plot.h + 1 }
      for (const s of [REPLAN_SUBTASKS.writer, REPLAN_SUBTASKS.acme]) draft.subtasks.push({ ...s, progress: 0, started: false, done: false, emitted: 0, addedByReplan: true })
    }
    this.farmhands.writer.context.push('eng-standup-notes/')
    this.crow.state = 'leaving'
    this.crow.t = 0
    this.addLog('Head farmer', 'Applied the re-plan and sent the decision to 2 crews', 'replan', 'draft', 'Both farms now use one launch date.')
    this.addLog(`${NEIGHBOUR.name} crew`, `Confirmed: launch comms say ${this.launchDate}`, 'info')
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
    this.seeds.unshift({ ...LESSON_DATES })
    const p = this.task('draft').plot
    this.seedFly = { from: { x: p.x + p.w / 2, y: p.y }, to: { x: FARM.seedLibrary.x + 0.7, y: FARM.seedLibrary.y + 0.5 }, t: 0 }
    this.addLog('You', `Saved a seed: ${LESSON_DATES.file}`, 'seed', 'draft')
    this.toast('Seed saved to the seed library')
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
    if (n.kind === 'trace') return this.openTrace('date')
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
    if (task) this.openTask(task)
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
      return { taskId: 'draft', label: yours ? 'your call on the date' : 'the date check' }
    }
    return null
  }

  fhStatus(fh: Farmhand): string {
    if (fh.paused) return 'Paused'
    if (fh.status === 'asking') return 'Waiting for you'
    if (fh.status === 'done') return `Done. ${CHORES.find((c) => c.id === fh.chore?.id)?.label ?? 'Taking a break'}`
    if (fh.inside) return 'In the barn'
    const job = fh.job
    if (job?.kind === 'fix') return 'Fixing a missing source'
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

  taskStatus(t: Task): { text: string; tone: '' | 'done' | 'needs' | 'warn' } {
    const done = t.subtasks.filter((s) => s.done).length
    if (done === t.subtasks.length) return { text: 'Done', tone: 'done' }
    if (this.openAsks.some((a) => a.taskId === t.id) || (t.id === 'draft' && this.replan?.status === 'open')) return { text: 'Needs you', tone: 'needs' }
    if (t.pests.length) return { text: 'Missing a source', tone: 'warn' }
    if (this.farmhands[t.assignee].paused) return { text: 'Paused', tone: '' }
    if (done > 0) return { text: `${done} of ${t.subtasks.length}`, tone: '' }
    if (t.subtasks.some((s) => s.started)) return { text: 'Working', tone: '' }
    const s = t.subtasks[0]
    if ((s.needs ?? []).some((f) => !this.flags.has(f))) return { text: 'Waiting', tone: '' }
    return { text: 'Up next', tone: '' }
  }

  get ripeCount() {
    return this.tasks.filter((t) => t.subtasks.every((s) => s.done)).length
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
    this.notify()
  }

  private dropSpot(i: number) {
    return { x: FARM.shipping.x - 1.2 + i * 1.1, y: FARM.shipping.y + 1.25 }
  }

  private updateHarvest(dt: number) {
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
    const caught = this.asks.find((a) => a.id === 'crow')?.answer === 'theirs'
    const { count } = this.irreversible
    return caught ? `A wrong launch date was stopped before it reached ${count} people.` : `${this.questTitle} is ready for your review.`
  }

  // ---- review: look, verify, approve, then send ----------------------------------------

  get facts(): RunFacts {
    const dates = this.out.conflict?.data.dates ?? []
    const engDate = dates.find((d) => d.source.startsWith('eng-standup'))?.date ?? 'March 26'
    return {
      launchDate: this.launchDate,
      engDate,
      webinarDate: this.webinarDate,
      expectedWebinar: this.webinarFor(this.launchDate),
      sourceFixed: this.sourceFixed || !this.out.claims?.data.issues.length,
      quote: this.asks.find((a) => a.id === 'quote')?.answer,
      brandChecked: this.task('brand').subtasks.every((s) => s.done),
      recipients: INVITE_LIST.reduce((n, r) => n + r.contacts, 0),
      companies: INVITE_LIST.length,
    }
  }

  checkResult(c: Check): CheckResult {
    if (c.custom) return { state: 'manual', evidence: 'Added by you. Read it, then tick it.' }
    const seed = DONE_WHEN.find((d) => d.id === c.id)
    return seed ? seed.judge(this.facts) : { state: 'manual', evidence: '' }
  }

  checksFor(output: OutputId) {
    return this.checks.filter((c) => c.output === output)
  }

  get outputs() {
    return OUTPUTS
  }

  get allTicked() {
    return this.checks.length > 0 && this.checks.every((c) => this.ticked.has(c.id))
  }

  toggleTick(id: string) {
    const c = this.checks.find((x) => x.id === id)
    if (!c || this.approved) return
    const r = this.checkResult(c)
    if (r.state === 'fail' || r.state === 'blocked') return
    if (this.ticked.has(id)) this.ticked.delete(id)
    else this.ticked.add(id)
    this.notify()
  }

  // A failed check goes back to the crew, which fixes it. You still tick it yourself.
  sendBack(id: string) {
    const c = this.checks.find((x) => x.id === id)
    if (!c || this.approved) return
    const who = this.farmhands[this.task(c.taskId).assignee].role
    if (id === 'c-date') {
      this.launchDate = this.facts.engDate
      this.webinarDate = this.webinarFor(this.launchDate)
    }
    if (id === 'c-sources') this.sourceFixed = true
    if (id === 'c-webinar') this.webinarDate = this.webinarFor(this.launchDate)
    this.act(who, 1_200, c.taskId, 4)
    this.addLog('You', `Sent back: ${c.text}`, 'answer', c.taskId)
    this.addLog(who, `Fixed: ${c.text}`, 'info', c.taskId)
    this.toast(`The ${who} fixed it. Check it again.`)
    this.notify()
  }

  removeCheck(id: string) {
    if (this.phase !== 'plan') return
    this.checks = this.checks.filter((c) => c.id !== id)
    this.notify()
  }

  addCheck(taskId: string, text: string) {
    if (this.phase !== 'plan' || !text.trim()) return
    this.checks.push({ id: `mine-${this.checks.length}-${Date.now() % 10000}`, taskId, output: TASK_OUTPUT[taskId] ?? 'announcement', text: text.trim(), custom: true })
    this.notify()
  }

  approveHarvest() {
    if (!this.allTicked || this.approved) return
    this.approved = true
    this.human('You')
    this.addLog('You', `Approved the harvest: ${this.checks.length} checks ticked. Nothing sent yet.`, 'answer')
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
    this.human('You')
    this.act('Scheduler', 1_500, 'invites', 6)
    this.addLog('You', `Sent the announcement and the webinar invite to ${this.irreversible.count} people (simulated)`, 'done', 'invites')
    this.toast(`Sent to ${this.irreversible.count} people`)
    this.notify()
  }

  get recipientNames() {
    return INVITE_LIST.map((r) => r.company).join(', ')
  }

  get decisions() {
    const changed = this.tasks.some((t) => t.assignee !== t.proposedAssignee) || this.signpostEdits.length > 0
    return [
      { word: 'Plan', text: changed ? 'Approved the plan with your change' : 'Approved the plan as proposed' },
      ...this.asks.filter((a) => a.status === 'resolved').map((a) => ({ word: REASON_WORD[a.label] ?? a.label, text: `${a.answerLabel}` , q: a.question })),
      ...(this.approved ? [{ word: 'Review', text: `Ticked ${this.checks.length} checks and approved` }] : []),
      ...(this.sendState === 'sent' ? [{ word: 'Sent', text: `Sent to ${this.irreversible.count} people` }] : []),
    ]
  }

  toast(text: string) {
    this.toasts.push({ id: this.toastId++, text, t: this.clock })
    if (this.toasts.length > 3) this.toasts.shift()
  }

  muted = true
  private audio: AudioContext | null = null
  chime() {
    if (this.muted || typeof window === 'undefined') return
    try {
      this.audio ??= new AudioContext()
      const ctx = this.audio
      const now = ctx.currentTime
      ;[880, 1318.5].forEach((f, i) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'triangle'
        o.frequency.value = f
        g.gain.setValueAtTime(0.0001, now + i * 0.09)
        g.gain.exponentialRampToValueAtTime(0.08, now + i * 0.09 + 0.02)
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
      if (o.error) this.addLog('System', `Live call failed, using a simulated response: ${o.error}`, 'info')
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
      this.checks = DONE_WHEN.map(({ id, taskId, output, text }) => ({ id, taskId, output, text }))
      this.planRevealT = this.clock
      this.addLog('Head farmer', `Proposed a quest plan: 5 tasks, a crew of 4`, 'info', undefined, p.provenance === 'live' ? `Live call, ${fmtTokens(p.tokens)}` : undefined)
      if (/webinar|invite/i.test(this.goal)) this.addLog('Head farmer', 'Gave the Scheduler a saved lesson: lesson-webinar-timezones.md', 'auto', 'invites', 'It matched “webinar” in the brief.')
      this.webinarDate = this.webinarFor(this.launchDate)
    }
    if (key === 'draft') {
      const d = this.out.draft!
      this.call('Writer', d, 'draft')
      if (d.data.launch_date) {
        this.launchDate = d.data.launch_date
        this.webinarDate = this.webinarFor(this.launchDate)
      }
      const unsourced = d.data.claims.filter((c) => !c.source).length
      this.addLog('Writer', `Drafted “${d.data.headline}” (${d.data.claims.length} claims, ${unsourced} without a source)`, 'info', 'draft', d.provenance === 'live' ? `Live call, ${fmtTokens(d.tokens)}` : undefined)
    }
    if (key === 'claims') {
      this.call('Reviewer', this.out.claims!, 'factcheck')
    }
    if (key === 'conflict') {
      const c = this.out.conflict!
      this.call('Head farmer', c, 'draft')
      if (c.data.conflict) {
        this.crow = { state: 'flying', t: 0, x: CROW_SPOT.x + 14, y: CROW_SPOT.y - 12 }
        this.neighbourDrought = true
        const other = c.data.dates.find((x) => x.farm !== FARM.name)
        this.addLog('Head farmer', `Found two launch dates: ${c.data.dates.map((x) => x.date).join(' and ')}`, 'info', 'draft', other ? `${other.source}: “${other.quote}”` : c.data.why)
      } else {
        this.addLog('Head farmer', `Cross-checked the date with ${this.docsChecked} documents on 2 farms: no conflict`, 'auto', 'draft', c.data.why)
        this.flags.add('dateResolved')
        this.flags.add('replanApplied')
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
    } else if (this.phase !== 'grow') {
      // Before the work starts the crew waits outside the barn.
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
    // Once the draft carries a date and the Reviewer's beetle is gone, the head farmer
    // cross-checks the date with the neighbouring farm. A crow appears only if the model finds a conflict.
    const draft = this.task('draft')
    if (this.flags.has('dateUsed') && draft.pests.length === 0 && this.out.draft && this.flags.has('factcheckDone') && !this.flags.has('dateResolved')) {
      const d = this.out.draft.data
      if (!d.launch_date) {
        // Nothing dated to cross-check.
        this.flags.add('dateResolved')
        this.flags.add('replanApplied')
      } else {
        if (!this.requested.has('conflict')) this.addLog('Head farmer', `Cross-checking ${d.launch_date} with ${this.docsChecked} documents on 2 farms`, 'info', 'draft')
        const recorded = d.launch_date === 'March 26' ? RECORDED.noConflict : RECORDED.conflict
        this.request('conflict', () =>
          callAgent('conflict', { draftDate: d.launch_date, draftSource: d.launch_date_source ?? 'unknown', ourDocs: [...draft.signposts] }, recorded),
        )
      }
    }
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
      this.addLog('Head farmer', 'Every crop is ripe', 'done')
      this.toast('Every crop is ripe. Press H for the harvest report')
      this.chime()
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
      else this.setNav([{ kind: 'step', id: 'brief' }])
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

  // Waiting on another task: stand at the top edge of that plot, facing it.
  private waitSpot(fh: Farmhand, taskId: string) {
    const r = this.task(taskId).plot
    const waiting = ROLE_ORDER.filter((id) => id === fh.id || (this.farmhands[id].status === 'waiting' && this.blockerOf(this.farmhands[id])?.taskId === taskId))
    return { x: r.x + 0.8 + waiting.indexOf(fh.id) * 1.4, y: r.y - 1.6 }
  }

  private porchSpot(fh: Farmhand) {
    const askers = ROLE_ORDER.filter((id) => this.farmhands[id].status === 'asking')
    return FARM.porch[Math.max(0, askers.indexOf(fh.id)) % FARM.porch.length]
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
    // Waiting for you: on the farmhouse porch, facing the door.
    if (fh.status === 'asking') {
      const spot = this.porchSpot(fh)
      if (!this.near(fh, spot)) return this.walkTo(fh, spot)
      fh.dir = 'up'
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
          // Done: it stops using energy and goes off to do chores away from the plots.
          fh.status = 'done'
          fh.chore = null
          return
        }
        fh.status = 'waiting'
        const b = this.blockerOf(fh)
        if (b) {
          const spot = this.waitSpot(fh, b.taskId)
          if (!this.near(fh, spot)) return this.walkTo(fh, spot)
        }
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
        this.sourceFixed = true
        const fix = this.out.claims?.data.issues[0]?.fix
        this.addLog(fh.role, `Fixed: ${job.label}`, 'auto', task.id, fix ?? 'Added the missing source.')
        if (this.demoScenario) this.pendingSeeds.push({ ...LESSON_SOURCES })
        fh.job = null
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
    // Steps backed by a live call hold just short of ripe until the call returns.
    const waitingOn = (sub.id === 'd2' && !this.out.draft) || (sub.id === 'f1' && !this.out.claims)
    if (waitingOn) sub.progress = Math.min(sub.progress, 0.9)
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
      this.notify()
    }
  }

  private pestSpot(task: Task, pestId: string) {
    const p = task.pests.find((x) => x.id === pestId)
    const x = p ? p.tile.x + 0.5 : task.plot.x + task.plot.w / 2
    return { x, y: task.plot.y + task.plot.h + 0.55 }
  }

  // Returns true when the subtask is blocked on an ask.
  private onSubStart(fh: Farmhand, task: Task, sub: Subtask): boolean {
    if (sub.id === 'r3' && task.dry && this.demoScenario) {
      // The rule in player.md: ask only when a task would run more than 25% over budget.
      // Reading 12 more posts would; finishing with what it has would not, so it decides alone.
      this.energyCaught += 9_000
      this.addLog(fh.role, 'Finished with the 5 competitor posts already read instead of 12 more', 'auto', task.id,
        'The plot was at 75% of its energy. Reading 12 more posts would cost about 9k, ending 42% over budget. Without them the comparison stays qualitative.')
    }
    if (sub.id === 'd2') {
      // The model call is the work: no scripted steps on top of it.
      sub.actions = 0
      const signposts = [...task.signposts, ...this.farmhands[fh.id].almanac]
      const sawEng = expandSignposts(signposts).includes('eng-standup-notes/2026-02-03.md')
      this.request('draft', () =>
        callAgent('draft', { goal: this.goal, task: task.name, answers: this.answersText, signposts }, sawEng ? RECORDED.draftWithEngNotes : RECORDED.draft),
      )
    }
    if (sub.id === 'f1') {
      sub.actions = 0
      this.request('claims', () => {
        const d = this.out.draft?.data ?? RECORDED.draft
        return callAgent('claims', { draft: `${d.headline}\n\n${d.paragraphs.join('\n\n')}` }, RECORDED.claims)
      })
    }
    if (sub.id === 'i2' && this.demoScenario) {
      this.addLog(fh.role, `Picked ${this.webinarDate}, 10:00 PT and showed each recipient their own time zone`, 'auto', task.id, 'From the saved seed lesson-webinar-timezones.md')
    }
    if (sub.id === 'f2' && this.demoScenario) {
      // Calibration: the quote has a verbal OK on a call, not a written one, so the Reviewer is only
      // moderately sure and asks. Claims it is sure about (the benchmark source) it fixes alone.
      fh.status = 'asking'
      this.raise({
        id: 'quote',
        label: 'Risk',
        from: fh.id,
        fromName: fh.role,
        taskId: task.id,
        question: 'The announcement quotes Acme’s ops lead. Keep the quote?',
        impact: ['Goes to 6 external companies, Acme included', 'Easy to change until the invites go out'],
        options: [
          { key: '1', label: 'Keep it, by role', value: 'keep', kind: 'alt', recommended: true },
          { key: '2', label: 'Paraphrase it', value: 'paraphrase', kind: 'alt' },
        ],
        confidence: 'Medium',
        basis: 'The call notes say “OK to quote the ops lead by role”, but that was said on a call. The saved seed lesson-quote-approval.md asks for an explicit OK, so I’m not sure enough to decide alone.',
        provenance: 'sim',
        details: {
          reasoning: 'Quotes reach customers. A verbal OK recorded by our own team is good evidence, not proof.',
          sources: ['customer-call-notes.md (Jan 28)', 'lesson-quote-approval.md (saved seed)'],
        },
      })
      return true
    }
    if (sub.id === 'i3') {
      // The send waits for the harvest review. Grow only prepares it.
      this.addLog(fh.role, `Queued ${this.irreversible.count} invites. Nothing goes out until you approve the harvest.`, 'info', task.id)
      return false
    }
    if (sub.id === 'i3-ask') {
      fh.status = 'asking'
      const { action, audience, count: total } = this.irreversible
      const demo = this.demoScenario
      this.raise({
        id: 'invites',
        label: 'Irreversible',
        from: fh.id,
        fromName: fh.role,
        taskId: task.id,
        question: `${action} to ${total} ${audience}?`,
        // Leaves the company: the card leads with who it reaches, not a warning word.
        impact: demo
          ? [`Goes to ${total} ${audience}`, `${total} emails from your address, with a calendar hold for ${this.webinarDate}`]
          : [`Goes to ${total} ${audience}`],
        options: [
          { key: 'a', label: `Send to ${total} people`, value: 'approve', kind: 'approve', recommended: true },
          ...(demo ? [{ key: '1', label: 'Send to Acme first (12)', value: 'acme-first', kind: 'alt' as const }] : []),
          { key: 'd', label: 'Don’t send', value: 'deny', kind: 'deny' },
        ],
        confirm: 'After this, fixing a mistake means sending a correction.',
        confidence: 'High',
        provenance: 'sim',
        basis: demo ? 'The list matches pilot-customers.csv, and the date is settled.' : 'The plan’s send step, after every other task is done.',
        details: demo
          ? {
              reasoning: `The date is settled (${this.launchDate}) and the list matches pilot-customers.csv. Times use each recipient’s zone, from a saved seed.`,
              sources: ['pilot-customers.csv', 'lesson-webinar-timezones.md (saved seed)'],
              preview: `Subject: You’re invited: Relay v2 launch webinar, ${this.webinarDate}\n\nHi {first_name},\n\nRelay v2 arrives ${this.launchDate}. Join us ${this.webinarDate} at {local_time} ({pt_time} PT) for a 30-minute walkthrough of faster sync and single sign-on.\n\nSee you there,\nThe Relay team`,
            }
          : {
              reasoning: `Every other task is done. This is the plan’s one outward step.`,
              sources: task.signposts,
              preview: this.out.draft ? `${this.out.draft.data.headline}\n\n${this.out.draft.data.paragraphs[0] ?? ''}` : undefined,
            },
      })
      return true
    }
    return false
  }

  private onSubDone(fh: Farmhand, task: Task, sub: Subtask) {
    if (sub.id === 'd2') {
      const d = this.out.draft!.data
      const sawEng = expandSignposts(task.signposts).some((x) => x.startsWith('eng-standup-notes/'))
      if (d.launch_date)
        this.addLog(fh.role, `Set the date to ${d.launch_date} in the draft`, 'auto', 'draft', `Source: ${d.launch_date_source}.${sawEng ? '' : ' No engineering notes were attached to this plot.'}`, sawEng ? undefined : 'date')
    }
    if (sub.id === 'f1') {
      const c = this.out.claims!
      this.addLog(fh.role, `Checked ${c.data.checked} claims: ${c.data.issues.length} without a source`, 'info', 'factcheck', c.provenance === 'live' ? `Live call, ${fmtTokens(c.tokens)}` : undefined)
      const issue = c.data.issues[0]
      if (issue) {
        const draft = this.task('draft')
        const pest = { id: 'beetle-1', kind: 'beetle' as const, label: `${issue.claim}: ${issue.problem}`, size: 1, tile: { x: draft.plot.x + 3, y: draft.plot.y + 1 } }
        draft.pests.push(pest)
        this.addLog(fh.role, `Pest on Draft the announcement: “${issue.claim}”`, 'pest', 'draft', issue.problem)
        this.farmhands[draft.assignee].interrupts.push({
          kind: 'fix', taskId: 'draft', pestId: pest.id, label: `source for “${shorten(issue.claim, 40)}”`, secs: 2.5, energy: 1_500, actions: 6, progress: 0, emitted: 0,
        })
      }
    }
    if (sub.id === 'b1' && this.demoScenario) this.addLog(fh.role, 'Tone check: removed “revolutionary” from the headline options', 'auto', 'brand', 'brand-voice.md bans it.')
    if (task.subtasks.every((s) => s.done)) this.addLog(fh.role, `Ripe: ${task.name}`, 'done', task.id)
  }

  private raiseCrow() {
    const c = this.out.conflict!
    const ours = c.data.dates.find((d) => d.farm === FARM.name) ?? c.data.dates[0]
    const theirs = c.data.dates.find((d) => d !== ours) ?? c.data.dates[1]
    const recommendTheirs = c.data.recommended_date === theirs?.date
    this.raise({
      id: 'crow',
      label: 'Anomaly',
      from: 'head',
      fromName: 'Head farmer',
      taskId: 'draft',
      question: 'Two launch dates are in play. Which one should the announcement use?',
      impact: [`Changes the announcement, the webinar date and the invites, and tells the ${NEIGHBOUR.name} crew`, 'Nothing has gone out yet'],
      sides: [
        { title: ours.date, who: 'Your Writer, from the call notes', source: ours.source, quote: ours.quote },
        { title: theirs.date, who: `The ${NEIGHBOUR.name} crew`, source: theirs.source, quote: theirs.quote },
      ],
      options: [
        { key: '1', label: `Use ${theirs.date}`, value: 'theirs', recommended: recommendTheirs, kind: 'alt' },
        { key: '2', label: `Keep ${ours.date}`, value: 'keep', recommended: !recommendTheirs, kind: 'alt' },
      ],
      confidence: c.data.confidence,
      basis: `Checked ${this.docsChecked} documents on 2 farms. ${c.data.why}`,
      provenance: c.provenance,
      details: { reasoning: `Checked ${this.docsChecked} documents on 2 farms. ${c.data.why}`, sources: c.data.dates.map((d) => d.source) },
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

function shiftDate(d: string, days: number) {
  const m = d.match(/^(\w+) (\d+)$/)
  if (!m) return d
  return `${m[1]} ${Number(m[2]) + days}`
}

function shorten(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// A reason is a plain word. Outbound steps get no word: they lead with who they reach.
export const REASON_WORD: Record<string, string> = { Cost: 'Costs more', Risk: 'Risky', Failure: 'Failed', Anomaly: 'Looks wrong', Irreversible: 'Send' }

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
