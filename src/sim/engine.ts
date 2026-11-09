// The engine behind the demo.
// Three agent steps are real Claude calls (the Writer's draft, the Reviewer's claim check and the
// head farmer's cross-farm date check). The rest of the farmhands' work is simulated, which the brief allows.
// Every number on screen is computed from the ledger: agent actions, energy, and how many times a human was needed.

import { ATTACHMENTS, BRIEF_GOAL, CLARIFY, CREW, CROW_SPOT, FARM, LESSON_DATES, LESSON_SOURCES, REPLAN_SUBTASKS, ROLE_ORDER, START_SEEDS, SUGGESTED_BUDGET, TASKS, type Attachment } from './scenario'
import { callAgent, probeLive, RECORDED, type ClaimsOut, type ConflictOut, type DraftOut, type Outcome } from './live'
import type { Ask, Farmhand, Flag, Job, LedgerEvent, LogEntry, Phase, Rect, Replan, RoleId, Seed, Subtask, Task, Toast } from './types'

const WALK_SPEED = 3.4 // tiles per second
const CROW_FLIGHT = 2.2 // seconds

export type View = 'farm' | 'valley'

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
  view: View = 'farm'
  harvestOpen = false
  showHelp = false
  live: boolean | null = null // null until probed

  // brief
  goal = BRIEF_GOAL
  attachments: Attachment[] = ATTACHMENTS.map((a) => ({ ...a }))
  budget = SUGGESTED_BUDGET
  headThinking = 0
  clarifyAnswers: Record<string, string> = {}
  planRevealT = -1

  // farm
  tasks: Task[] = []
  farmhands = {} as Record<RoleId, Farmhand>
  selected: RoleId | null = null
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
    const homeSpots: Record<RoleId, { x: number; y: number }> = {
      researcher: { x: 9.6, y: 9.4 },
      writer: { x: 11.0, y: 9.9 },
      reviewer: { x: 12.4, y: 9.4 },
      scheduler: { x: 13.8, y: 9.9 },
    }
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

  task(id: string) {
    return this.tasks.find((t) => t.id === id)!
  }

  get actions() {
    return this.ledger.filter((e) => e.kind === 'action').length
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
    if (this.view === 'valley') return { x: 0, y: 0, w: 76, h: 46 }
    if (this.trace) {
      const p = this.task('draft').plot
      return { x: p.x - 7, y: p.y - 5, w: p.w + 14, h: p.h + 9 }
    }
    const crowAsk = this.activeAsk?.id === 'crow' || this.replan?.status === 'open' || this.crow.state === 'flying'
    if (crowAsk) return { x: 14, y: 3, w: 46, h: 21 }
    if (this.phase === 'plan') return { x: 2, y: 5, w: 32, h: 17 }
    return { x: 1, y: 1.5, w: 36, h: 21.5 }
  }

  private act(who: string, tokens: number, taskId?: string, n = 1) {
    for (let i = 0; i < n; i++) this.ledger.push({ t: this.t, who, kind: 'action', tokens: tokens / n, taskId })
  }

  private human(who: string, taskId?: string) {
    this.ledger.push({ t: this.t, who, kind: 'human', tokens: 0, taskId })
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
    if (this.phase !== 'brief') return
    this.phase = 'clarify'
    this.headThinking = 1.4
    const n = this.attachments.filter((a) => a.selected).length
    this.act('Head farmer', 1_200, undefined, 4)
    this.addLog('Head farmer', `Read the brief and ${n} attachments`, 'info', undefined, 'A new head farmer starts every farm. It only knows the brief, its attachments and the seed library.')
    this.notify()
  }

  answerClarify(id: string, value: string) {
    this.clarifyAnswers[id] = value
    this.notify()
  }

  finishClarify() {
    if (this.phase !== 'clarify') return
    const skipped = CLARIFY.filter((q) => !this.clarifyAnswers[q.id])
    for (const q of CLARIFY) this.clarifyAnswers[q.id] ??= q.options[0]
    if (skipped.length) this.addLog('Head farmer', `Assumed ${skipped.length} answer${skipped.length > 1 ? 's' : ''} you skipped`, 'auto', undefined, skipped.map((q) => `${q.q} → ${q.options[0]}`).join('; '))
    this.phase = 'plan'
    this.headThinking = 1.6
    this.planRevealT = this.clock + 1.6
    this.act('Head farmer', 1_800, undefined, 11)
    this.addLog('Head farmer', 'Proposed a quest plan: 5 tasks, a crew of 4', 'info', undefined, 'Split the brief into tasks one farmhand can finish with limited context.')
    this.addLog('Head farmer', 'Planted a saved seed in the Scheduler’s card: lesson-webinar-timezones.md', 'auto', 'invites', 'It matched “webinar” and “pilot customers” in the brief.')
    if (this.clarifyAnswers.webinar === 'On launch day') this.webinarDate = 'March 12'
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

  approvePlan() {
    if (this.phase !== 'plan' || this.headThinking > 0) return
    this.phase = 'grow'
    this.t = 0
    this.human('You')
    const swapped = this.tasks.filter((t) => t.assignee !== t.proposedAssignee)
    this.addLog('You', 'Approved the quest plan' + (swapped.length ? ` with ${swapped.length} change` : ''), 'answer', undefined,
      swapped.length ? `Moved “${swapped[0].name}” to the ${this.farmhands[swapped[0].assignee].role}` : undefined)
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
    this.toast(q > 1 ? `New ${ask.label} ask queued (${q} waiting)` : `${ask.label}: ${ask.fromName} needs you`)
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
    ask.status = 'resolved'
    ask.answer = value
    ask.answerLabel = opt?.label ?? (value === 'approve' ? 'Approved' : value)
    this.addLog('You', `${ask.label}: ${ask.answerLabel}`, 'answer', ask.taskId)
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
      const later = conflict?.dates.find((d) => d.farm !== 'Q1 Launch')?.date ?? 'March 26'
      const earlier = this.launchDate
      const chosen = value === 'keep' ? earlier : later
      const oldWebinar = this.webinarDate
      const newWebinar = chosen === earlier ? oldWebinar : this.clarifyAnswers.webinar === 'On launch day' ? chosen : shiftDate(chosen, -2)
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
                { op: '+', text: 'Signpost eng-standup-notes/ on Draft the announcement' },
                { op: '~', text: `Priya’s crew is told launch comms now say ${chosen}` },
              ]
            : [
                { op: '~', text: `Announcement keeps ${earlier}` },
                { op: '+', text: `Ask sent to Priya’s crew: can v2 still ship ${earlier}?` },
                { op: '+', text: 'Signpost eng-standup-notes/ on Draft the announcement' },
              ],
      }
      this.webinarDate = newWebinar
      this.act('Head farmer', 1_500, 'draft', 8)
    }
    if (ask.id === 'invites') {
      if (value === 'deny') this.addLog('Scheduler', 'Holding the invites. Nothing was sent.', 'info', 'invites')
      if (value === 'acme-first') this.addLog('Scheduler', 'Sending to Acme first (12 people). The rest stay queued.', 'info', 'invites')
      const fh = this.farmhands.scheduler
      if (fh.status === 'asking') fh.status = 'working'
    }
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
    this.addLog('Priya’s crew', `Confirmed: launch comms say ${this.launchDate}`, 'info')
    this.toast('Decision sent to 2 crews')
    this.notify()
  }

  // ---- trace and seeds ------------------------------------------------------------------

  openTrace(id: string) {
    this.trace = id
    this.view = 'farm'
    this.notify()
  }

  closeTrace() {
    this.trace = null
    this.notify()
  }

  saveSeed() {
    if (this.flags.has('seedSaved')) return
    this.flags.add('seedSaved')
    this.seeds.unshift({ ...LESSON_DATES })
    const p = this.task('draft').plot
    this.seedFly = { from: { x: p.x + p.w / 2, y: p.y }, to: { x: FARM.seedLibrary.x + 0.7, y: FARM.seedLibrary.y + 0.5 }, t: 0 }
    this.addLog('You', `Saved a seed: ${LESSON_DATES.file}`, 'seed', 'draft')
    this.toast('Seed saved to the seed library')
    this.trace = null
    this.notify()
  }

  keepPendingSeed(file: string, keep: boolean) {
    const s = this.pendingSeeds.find((x) => x.file === file)
    if (!s) return
    this.pendingSeeds = this.pendingSeeds.filter((x) => x.file !== file)
    if (keep) this.seeds.unshift({ ...s })
    this.notify()
  }

  // ---- UI state --------------------------------------------------------------------------

  setView(v: View) {
    this.view = v
    if (v === 'valley') this.trace = null
    this.notify()
  }

  select(id: RoleId | null) {
    this.selected = this.selected === id ? null : id
    this.notify()
  }

  openHarvest() {
    if (!this.harvestReady) return
    if (!this.harvested) {
      this.harvested = true
      this.act('Head farmer', 800, undefined, 4)
      this.addLog('Head farmer', 'Wrote the harvest report', 'done')
    }
    this.phase = 'harvest'
    this.harvestOpen = true
    this.view = 'farm'
    this.notify()
  }

  closeHarvest() {
    this.harvestOpen = false
    this.notify()
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
      if (o.error) this.addLog('System', `Live call failed, using a recorded run: ${o.error}`, 'info')
      this.onOutput(key)
      this.notify()
    })
  }

  private onOutput(key: keyof Outputs) {
    if (key === 'draft') {
      const d = this.out.draft!
      const sub = this.task('draft').subtasks.find((s) => s.id === 'd2')!
      sub.energy = d.tokens
      this.launchDate = d.data.launch_date
      const unsourced = d.data.claims.filter((c) => !c.source).length
      this.addLog('Writer', `Drafted “${d.data.headline}” (${d.data.claims.length} claims, ${unsourced} without a source)`, 'info', 'draft', `${d.provenance === 'live' ? 'Live call' : 'Replay of a recorded call'} · ${fmtTokens(d.tokens)}`)
    }
    if (key === 'claims') {
      const c = this.out.claims!
      const sub = this.task('factcheck').subtasks.find((s) => s.id === 'f1')!
      sub.energy = c.tokens
    }
    if (key === 'conflict') {
      const c = this.out.conflict!
      this.act('Head farmer', c.tokens, 'draft', 3)
      if (c.data.conflict) {
        this.crow = { state: 'flying', t: 0, x: CROW_SPOT.x + 14, y: CROW_SPOT.y - 12 }
        this.neighbourDrought = true
        const other = c.data.dates.find((x) => x.farm !== 'Q1 Launch')
        this.addLog('Head farmer', `Found a conflict: ${c.data.dates.map((x) => x.date).join(' vs ')}`, 'info', 'draft', other ? `${other.source}: “${other.quote}”` : c.data.why)
      } else {
        this.addLog('Head farmer', 'Cross-checked dates with neighbouring farms: no conflict', 'auto', 'draft')
        this.flags.add('dateResolved')
        this.flags.add('replanApplied')
      }
    }
  }

  // ---- simulation ------------------------------------------------------------------------------

  tick(rawDt: number) {
    const dt = Math.min(rawDt, 0.1)
    this.clock += dt
    if (this.headThinking > 0) {
      this.headThinking = Math.max(0, this.headThinking - dt)
      if (this.headThinking === 0) this.notify()
    }
    if (this.seedFly) {
      this.seedFly.t += dt / 1.1
      if (this.seedFly.t >= 1) this.seedFly = null
    }
    const before = this.toasts.length
    this.toasts = this.toasts.filter((t) => this.clock - t.t < 4.5)
    if (this.toasts.length !== before) this.dirty = true

    if (this.phase === 'grow' && !this.paused) {
      const sdt = dt * this.speed
      this.t += sdt
      for (const id of ROLE_ORDER) this.updateFarmhand(this.farmhands[id], sdt)
      this.updateWorld(sdt)
      this.dirty = true
    } else if (this.phase === 'harvest') {
      for (const id of ROLE_ORDER) this.walkOnly(this.farmhands[id], dt)
    }
    if (this.dirty && this.clock - this.lastNotify > 0.1) this.notify()
  }

  private updateWorld(dt: number) {
    // Once the draft carries a date and the Reviewer's beetle is gone, the head farmer
    // cross-checks the date with the neighbouring farm. A crow appears only if the model finds a conflict.
    const draft = this.task('draft')
    if (this.flags.has('dateUsed') && draft.pests.length === 0 && this.out.draft && this.flags.has('factcheckDone')) {
      if (!this.requested.has('conflict')) this.addLog('Head farmer', 'Cross-checking the launch date with neighbouring farms', 'info', 'draft')
      this.request('conflict', () =>
        callAgent('conflict', { draftDate: this.out.draft!.data.launch_date, draftSource: this.out.draft!.data.launch_date_source }, RECORDED.conflict),
      )
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
        this.walkTo(fh, fh.home)
        fh.status = 'done'
      }
      this.addLog('Head farmer', 'Every crop is ripe. The harvest report is ready.', 'done')
      this.toast('Every crop is ripe. Press H for the harvest report')
      this.chime()
      this.notify()
    }
  }

  private walkTo(fh: Farmhand, to: { x: number; y: number }) {
    fh.path = []
    if (Math.abs(fh.x - to.x) > 0.05) fh.path.push({ x: to.x, y: fh.y })
    fh.path.push({ x: to.x, y: to.y })
    fh.moving = true
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

  private walkOnly(fh: Farmhand, dt: number) {
    if (!fh.path.length) return false
    const p = fh.path[0]
    const dx = p.x - fh.x
    const dy = p.y - fh.y
    const d = Math.hypot(dx, dy)
    const step = WALK_SPEED * dt
    if (Math.abs(dx) > 0.01) fh.facing = dx > 0 ? 1 : -1
    if (d <= step) {
      fh.x = p.x
      fh.y = p.y
      fh.path.shift()
    } else {
      fh.x += (dx / d) * step
      fh.y += (dy / d) * step
    }
    fh.moving = fh.path.length > 0
    return fh.moving
  }

  private updateFarmhand(fh: Farmhand, dt: number) {
    if (fh.paused) return
    if (this.walkOnly(fh, dt)) {
      if (fh.status !== 'asking' && fh.status !== 'done') fh.status = 'walking'
      return
    }
    if (fh.status === 'asking' || fh.status === 'done') return

    if (!fh.job) {
      const job = this.nextJob(fh)
      if (!job) {
        if (!this.hasWorkLeft(fh)) {
          if (fh.status !== 'idle') this.walkTo(fh, fh.home)
          fh.status = 'idle'
        } else fh.status = 'waiting'
        return
      }
      fh.job = job
      const task = this.task(job.taskId)
      const subIdx = job.kind === 'sub' ? task.subtasks.findIndex((s) => s.id === job.subId) : 0
      const spot = job.kind === 'fix' ? this.pestSpot(task, job.pestId) : this.standSpot(task, subIdx)
      if (Math.hypot(spot.x - fh.x, spot.y - fh.y) > 0.1) {
        this.walkTo(fh, spot)
        fh.status = 'walking'
        return
      }
    }

    const job = fh.job!
    const task = this.task(job.taskId)

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
        const fix = this.out.claims?.data.issues[0]?.fix
        this.addLog(fh.role, `Fixed: ${job.label}`, 'auto', task.id, fix ?? 'Added the missing source.')
        this.pendingSeeds.push({ ...LESSON_SOURCES })
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
      this.addLog(fh.role, `${task.name} passed 75% of its energy`, 'energy', task.id, 'The plot turns dry so spend shows before it happens.')
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
    if (sub.id === 'r3' && task.dry) {
      // The rule in player.md: ask only when a task would run more than 25% over budget.
      // Reading 12 more posts would; finishing with what it has would not, so it decides alone.
      this.energyCaught += 9_000
      this.addLog(fh.role, 'Finished with the 5 competitor posts already read instead of 12 more', 'auto', task.id,
        'The plot was at 75% of its energy. Reading 12 more posts would cost about 9k, ending 42% over budget. Without them the comparison stays qualitative.')
    }
    if (sub.id === 'd2') {
      const audience = this.clarifyAnswers.audience ?? 'the 6 pilot customers'
      this.request('draft', () => callAgent('draft', { audience, signposts: [...task.signposts, 'brand-voice.md'] }, RECORDED.draft))
    }
    if (sub.id === 'f1') {
      this.request('claims', () => {
        const d = this.out.draft?.data ?? RECORDED.draft
        return callAgent('claims', { draft: `${d.headline}\n\n${d.paragraphs.join('\n\n')}` }, RECORDED.claims)
      })
    }
    if (sub.id === 'i2') {
      this.addLog(fh.role, `Picked ${this.webinarDate}, 10:00 PT and showed each recipient their own time zone`, 'auto', task.id, 'From the saved seed lesson-webinar-timezones.md')
    }
    if (sub.id === 'i3') {
      fh.status = 'asking'
      const total = 42
      this.raise({
        id: 'invites',
        label: 'Irreversible',
        from: fh.id,
        fromName: fh.role,
        taskId: task.id,
        question: `Send the webinar invite to ${total} people at 6 pilot customers?`,
        impact: [`≈ 1.5k energy`, `Sends ${total} emails from your address, with a calendar hold for ${this.webinarDate}`, 'Can’t be undone', 'Reaches 6 external companies'],
        options: [
          { key: 'a', label: `Send to ${total}`, value: 'approve', kind: 'approve', recommended: true },
          { key: '1', label: 'Send to Acme first (12)', value: 'acme-first', kind: 'alt' },
          { key: 'd', label: 'Don’t send', value: 'deny', kind: 'deny' },
        ],
        confirm: `Confirm: send to ${total} recipients`,
        confidence: 'High',
        provenance: 'replay',
        details: {
          reasoning: `The date is settled (${this.launchDate}) and the list matches pilot-customers.csv. Times use each recipient’s zone, from a saved seed.`,
          sources: ['pilot-customers.csv', 'lesson-webinar-timezones.md (saved seed)'],
          preview: `Subject: You’re invited: Relay v2 launch webinar, ${this.webinarDate}\n\nHi {first_name},\n\nRelay v2 arrives ${this.launchDate}. Join us ${this.webinarDate} at {local_time} ({pt_time} PT) for a 30-minute walkthrough of faster sync and single sign-on.\n\nSee you there,\nThe Relay team`,
        },
      })
      return true
    }
    return false
  }

  private onSubDone(fh: Farmhand, task: Task, sub: Subtask) {
    if (sub.id === 'd2') {
      const d = this.out.draft!.data
      this.addLog(fh.role, `Set the launch date to ${d.launch_date} in the draft`, 'auto', 'draft', `Source: ${d.launch_date_source}. No engineering notes were attached to this plot.`, 'date')
    }
    if (sub.id === 'f1') {
      const c = this.out.claims!
      this.addLog(fh.role, `Checked ${c.data.checked} claims: ${c.data.issues.length} without a source`, 'info', 'factcheck', `${c.provenance === 'live' ? 'Live call' : 'Replay of a recorded call'} · ${fmtTokens(c.tokens)}`)
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
    if (sub.id === 'i3') {
      const ask = this.asks.find((a) => a.id === 'invites')
      if (ask?.answer === 'approve') this.addLog(fh.role, 'Sent 42 invites and held the calendar', 'done', 'invites')
    }
    if (sub.id === 'b1') this.addLog(fh.role, 'Tone check: removed “revolutionary” from the headline options', 'auto', 'brand', 'brand-voice.md bans it.')
    if (task.subtasks.every((s) => s.done)) this.addLog(fh.role, `${task.name}: ripe`, 'done', task.id)
  }

  private raiseCrow() {
    const c = this.out.conflict!
    const ours = c.data.dates.find((d) => d.farm === 'Q1 Launch') ?? c.data.dates[0]
    const theirs = c.data.dates.find((d) => d !== ours) ?? c.data.dates[1]
    const recommendTheirs = c.data.recommended_date === theirs?.date
    this.raise({
      id: 'crow',
      label: 'Anomaly',
      from: 'head',
      fromName: 'Head farmer',
      taskId: 'draft',
      question: 'Two launch dates are in play. Which one should the announcement use?',
      impact: ['Affects 2 crews: the announcement, the webinar date and the invite emails', 'Nothing has been sent yet', 'Can be undone until the invites go out'],
      sides: [
        { title: ours.date, who: 'Writer · Q1 Launch (your farm)', source: ours.source, quote: ours.quote },
        { title: theirs.date, who: 'Engineering crew · Auth SDK v2 (Priya)', source: theirs.source, quote: theirs.quote },
      ],
      options: [
        { key: '1', label: `Use ${theirs.date}`, value: 'theirs', recommended: recommendTheirs, kind: 'alt' },
        { key: '2', label: `Keep ${ours.date}`, value: 'keep', recommended: !recommendTheirs, kind: 'alt' },
      ],
      confidence: c.data.confidence,
      provenance: c.provenance,
      details: { reasoning: c.data.why, sources: c.data.dates.map((d) => d.source) },
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

export function fmtTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k tokens` : `${Math.round(n)} tokens`
}

export const engine = new Engine()
if (typeof window !== 'undefined') (window as unknown as { engine: Engine }).engine = engine
export { CLARIFY, CREW, FARM }
