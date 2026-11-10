// App state: which screen, the live plan being edited, and the replay of a recorded run.
import { useSyncExternalStore } from 'react'
import { duration, pendingAsk, reduce } from './reduce'
import { SEND_BACK, simulateRun } from './simulate'
import { liveStage, rollBack } from './rollback'
import { simulatePlan } from './simPlan'
import { soloFromRun } from './compare'
import type { Autonomy, AutonomyLevel, FarmerId, FarmerSetup, PlanTask, RunEvent, RunState, Estimate } from './types'
import { AUTONOMY_PRESETS } from './types'
import { MODELS, applyEdit, emptyEdit, type KitEdit } from './kit'

export const SAMPLE_GOAL = 'Build an AI support assistant that answers customer questions from our help docs, and hands off to a person when it is not sure'

export type Screen = { kind: 'home' } | { kind: 'farm'; project: string }
export type Drawer =
  | null
  | { kind: 'task'; id: string }
  | { kind: 'farmer'; id: FarmerId }
  | { kind: 'ask'; id: string }
  | { kind: 'inbox' }
  | { kind: 'usage' }
  | { kind: 'summary' }
  | { kind: 'chat' }
  | { kind: 'control' }

export interface Project {
  id: string
  name: string
  goal: string
  kind: 'sample' | 'own'
  events: RunEvent[] // the recorded run, or the plan events for your own project
  approved: boolean
  planning?: boolean
  error?: string
  level: AutonomyLevel | 'custom'
  autonomy: Autonomy
  liveNote?: string // why a live call fell back to the simulation
  plannedLive?: boolean // the plan came from the real Planner, not the simulation
  sendBacks?: Record<string, { task: string; note: string }> // work you sent back from the pull request review, by ask
  rollbacks?: number[] // run times you rolled a live release back
  everSentBack?: boolean // a send back on this farm, ever: the trust offer never follows one
  trust?: 'offered' | 'yes' | 'no'
  runs?: number // runs watched to the end
  cleanRuns?: number // runs in a row with no rollback, no send back and nothing stopped; after three, the Planner offers once to merge by itself
  // The run you're watching on this farm. Each farm keeps its own place, so leaving and coming back resumes it.
  clock?: number // ms into the run; unset until the run starts
  answers?: Record<string, string> // your answers in this run, by ask id
  // Fixed when the run starts, so a finished run never changes: what it meets, your farmers and rules, and its forecast.
  notes?: Record<string, string> // answers you gave in your own words, by ask id
  run?: { bugFixed: boolean; kit: Partial<Record<FarmerId, KitEdit>>; autonomy: Autonomy; forecast?: Forecast; counted?: boolean }
}

// The plan's numbers: the run simulated on its default path (every suggested answer), and the same work done by one agent.
export interface Forecast {
  crew: Estimate
  solo: Estimate
}

// Which option a free-text answer means. Naming an option's own words wins; then yes or no.
export function readAnswer(text: string, suggested: string, options: string[]): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9%$ ]+/g, ' ')} `
  const words = (o: string) => o.toLowerCase().replace(/[^a-z0-9%$ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !['again', 'with', 'here', 'your', 'from', 'that', 'this'].includes(w))
  const scored = options.map((o) => ({ o, n: words(o).filter((w) => t.includes(` ${w} `) || t.includes(` ${w}`)).length })).sort((a, b) => b.n - a.n)
  if (scored[0]?.n && scored[0].n > (scored[1]?.n ?? 0)) return scored[0].o
  const no = /\b(no|nope|don ?t|do not|stop|hold|wait|later|not yet|cancel|leave it)\b/.test(t)
  const yes = /\b(yes|yep|yeah|sure|ok|okay|go|go ahead|do it|fine|sounds good|agreed|ship it)\b/.test(t)
  if (yes && !no) return suggested
  if (no && !yes) return options.find((o) => /^(not yet|stop|leave|keep it small|stay)/i.test(o)) ?? null
  return null
}

export interface ChatLine {
  from: 'you' | 'planner'
  text: string
  to?: FarmerId
}

class Store {
  screen: Screen = { kind: 'home' }
  drawer: Drawer = null
  projects: Project[] = []
  sampleLoading = true
  // replay
  playing = false
  speed = 1 // run-ms per wall-ms, set from the run's length
  crewSize: Record<string, number> = {} // per own project: how many farmers the plan uses
  chat: Record<string, ChatLine[]> = {}
  settingsOpen = false
  notifications = false
  toast: { id: number; text: string } | null = null
  seen = new Set<string>() // moments you've already read, such as a rollback
  applied = new Set<string>() // usage fixes applied, by key
  kit: Record<string, Partial<Record<FarmerId, KitEdit>>> = {} // your changes to each farmer, per project
  kitAt: Record<string, Partial<Record<FarmerId, number>>> = {} // when you first changed each farmer mid-run
  private lastAsk: string | null = null
  private listeners = new Set<() => void>()

  say(text: string) {
    this.toast = { id: Date.now(), text }
    this.notify()
  }

  async enableNotifications(on: boolean) {
    if (on && typeof Notification !== 'undefined') {
      const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      this.notifications = p === 'granted'
    } else this.notifications = false
    this.notify()
  }

  // A desktop notification for an ask, when the tab is in the background.
  private desktopNotify(p: Project, askId: string) {
    if (!this.notifications || typeof Notification === 'undefined' || !document.hidden) return
    const ask = p.events.find((e) => e.type === 'ask' && e.id === askId)
    if (!ask || ask.type !== 'ask') return
    const who = p.events.find((e) => e.type === 'farmer' && e.id === ask.farmer)
    const n = new Notification(`${who && who.type === 'farmer' ? who.label : 'A farmer'} needs you on ${p.name}`, { body: ask.question, tag: askId, icon: '/apple-touch-icon.png' })
    n.onclick = () => {
      window.focus()
      this.open(p.id)
    }
  }
  private version = 0
  private raf = 0
  private last = 0

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  snapshot = () => this.version
  notify() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  project(id?: string) {
    const pid = id ?? (this.screen.kind === 'farm' ? this.screen.project : undefined)
    return this.projects.find((p) => p.id === pid)
  }

  // The open farm's place in its run, and your answers in it.
  get clock() {
    return this.project()?.clock ?? 0
  }
  set clock(v: number) {
    const p = this.project()
    if (p) p.clock = v
  }
  get viewerAnswers(): Record<string, string> {
    return this.project()?.answers ?? {}
  }
  set viewerAnswers(v: Record<string, string>) {
    const p = this.project()
    if (p) p.answers = v
  }

  state(p = this.project()): RunState | null {
    if (!p) return null
    return reduce(p.events, p.approved ? (p.clock ?? 0) : Number.MAX_SAFE_INTEGER, p.answers ?? {})
  }

  // Has this farm's run reached its end?
  isDone(p = this.project()) {
    return !!p && p.approved && p.clock !== undefined && p.clock >= duration(p.events)
  }

  // The sample farm: a simulated crew run of a plan for SAMPLE_GOAL.
  loadSample() {
    const plan = simulatePlan(SAMPLE_GOAL)
    const events = simulateRun({ goal: SAMPLE_GOAL, ...plan })
    this.projects = [
      { id: 'sample', name: plan.name, goal: SAMPLE_GOAL, kind: 'sample', events, approved: true, level: 'matters', autonomy: AUTONOMY_PRESETS.matters },
      ...this.projects.filter((p) => p.id !== 'sample'),
    ]
    this.sampleLoading = false
    this.notify()
  }

  // Play the whole run in about three minutes of wall time, whatever its simulated length.
  private setSpeed(events: RunEvent[]) {
    this.speed = Math.max(1, duration(events) / 180_000)
  }

  // Open a farm where you left it. A farm whose run hasn't started yet starts it.
  open(project: string) {
    this.pause()
    this.screen = { kind: 'farm', project }
    this.drawer = null
    this.lastAsk = null
    const p = this.project(project)
    if (p?.approved) {
      if (p.clock === undefined || !p.run) this.startRun(p)
      else {
        this.setSpeed(p.events)
        if (!this.isDone(p)) this.play()
      }
    }
    this.notify()
  }

  // A new run of the farm's plan, with your current farmers and rules. What it will meet is decided now,
  // once: a new farm's first run hits the release bug and later runs don't. Nothing you do later changes that.
  startRun(p: Project) {
    this.pause()
    p.clock = 0
    p.answers = {}
    p.sendBacks = {}
    p.rollbacks = []
    this.kitAt[p.id] = {}
    p.run = { bugFixed: this.nextBugFixed(p), kit: structuredClone(this.kit[p.id] ?? {}), autonomy: { ...p.autonomy }, forecast: this.forecast(p) ?? undefined }
    this.rebuild(p)
    if (this.project()?.id === p.id) this.play()
    this.notify()
  }

  runAgain() {
    const p = this.project()
    if (p?.approved) this.startRun(p)
  }

  home() {
    this.pause()
    this.screen = { kind: 'home' }
    this.drawer = null
    this.notify()
  }

  setDrawer(d: Drawer) {
    this.drawer = d
    this.notify()
  }

  play() {
    if (this.playing) return
    this.playing = true
    this.last = performance.now()
    const step = (now: number) => {
      if (!this.playing) return
      const p = this.project()
      if (!p || !p.approved) return
      // A slow frame (a hidden tab, a busy laptop) never jumps the run forward by more than a tenth of a second.
      const dt = Math.min(100, now - this.last)
      this.last = now
      const waiting = pendingAsk(p.events, this.clock, this.viewerAnswers)
      if (!waiting) {
        const end = duration(p.events)
        // And the clock never passes an ask you haven't answered: it stops on it.
        const next = p.events.find((e) => e.type === 'ask' && e.t > this.clock && !this.viewerAnswers[e.id])
        this.clock = Math.min(end, next ? next.t : end, this.clock + dt * this.speed)
        if (this.clock >= end) {
          this.playing = false
          this.finishRun(p)
        }
        this.notify()
      } else if (this.lastAsk !== waiting) {
        // The run stops on the farmer that needs you; the dialogue shows its ask.
        this.lastAsk = waiting
        this.desktopNotify(p, waiting)
        this.notify()
      }
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  pause() {
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.notify()
  }

  togglePlay() {
    if (this.playing) this.pause()
    else this.play()
  }

  answer(askId: string, choice: string) {
    this.viewerAnswers = { ...this.viewerAnswers, [askId]: choice }
    const p = this.project()
    // A different answer from the one in the log: the run forks from here.
    const rec = p?.events.find((e) => e.type === 'answer' && e.id === askId)
    if (p && rec && rec.type === 'answer' && rec.choice !== choice) this.rebuild(p)
    // Jump to the moment the run carried on.
    const ans = p?.events.find((e) => e.type === 'answer' && e.id === askId)
    if (ans && ans.t > this.clock) this.clock = ans.t
    if (this.drawer?.kind === 'ask' && this.drawer.id === askId) this.drawer = null
    this.notify()
  }

  // An answer in your own words. Yes-like words take the suggestion; no-like words, or words that name another
  // option, take that one. The Planner says how it read you. Returns the option, or null when it can't tell.
  answerInWords(askId: string, text: string): string | null {
    const p = this.project()
    const ask = p?.events.find((e) => e.type === 'ask' && e.id === askId)
    if (!p || !ask || ask.type !== 'ask') return null
    // Sending work back needs a task and a note, so it goes through its own form.
    const options = [ask.suggested, ...(ask.alternatives ?? [])].filter((o) => !/^show me/i.test(o) && o !== SEND_BACK)
    const choice = readAnswer(text, ask.suggested, options)
    if (!choice) return null
    if (/^not yet/i.test(choice)) {
      this.chatTo(p.id, { from: 'you', text })
      this.chatTo(p.id, { from: 'planner', text: 'Holding. Nothing moves on this until you say so.' })
      return choice
    }
    this.chatTo(p.id, { from: 'you', text })
    this.chatTo(p.id, { from: 'planner', text: `Got it. I read that as “${choice}”.` })
    p.notes = { ...p.notes, [askId]: text }
    this.answer(askId, choice)
    return choice
  }

  // Run the plan again with everything you've decided so far: your answers, your changes to each farmer,
  // the rules you set, and the work you sent back. The simulation is deterministic, so what came before stays the same.
  private nextBugFixed(p: Project) {
    return p.kind !== 'sample' && (p.runs ?? 0) > 0
  }

  // The simulation's input for this farm's plan, with the given farmers' changes, rules and answers.
  private inputFor(p: Project, kit: Partial<Record<FarmerId, KitEdit>>, autonomy: Autonomy, answers: Record<string, string>, sendBacks: Project['sendBacks'], bugFixed: boolean) {
    const plan = p.events.find((e) => e.type === 'plan')
    if (!plan || plan.type !== 'plan') return null
    const planned = p.events.filter((e): e is Extract<RunEvent, { type: 'farmer' }> => e.type === 'farmer').map(({ t: _t, type: _ty, ...f }) => f)
    const farmers = planned.map((f) => applyEdit(f, kit[f.id]))
    const plannedModels = Object.fromEntries(planned.map((f) => [f.id, f.model]))
    const deployAsks = kit.deployer?.rules.deploy === false
    const basis = plan.basis ?? plan.estimate
    return { planned, farmers, input: { goal: p.goal, farmers, tasks: plan.tasks, estimate: basis, basis, singleAgentEstimate: plan.singleAgentEstimate, autonomy, choices: answers, deployAsks, plannedModels, sendBacks, bugFixed } }
  }

  // What the plan will cost and take, by simulating it on its default path with your current farmers and rules,
  // against one Sonnet agent doing the same work. The plan and the run it starts come from the same simulation.
  private forecasts = new Map<string, Forecast>()
  forecast(p: Project): Forecast | null {
    const kit = this.kit[p.id] ?? {}
    const bugFixed = this.nextBugFixed(p)
    const built = this.inputFor(p, kit, p.autonomy, {}, {}, bugFixed)
    if (!built) return null
    const key = JSON.stringify([p.id, built.input.farmers, built.input.tasks, p.autonomy, bugFixed, built.input.basis])
    const hit = this.forecasts.get(key)
    if (hit) return hit
    const events = simulateRun(built.input)
    const done = events.find((e) => e.type === 'done')
    if (!done || done.type !== 'done') return null
    const f: Forecast = { crew: { usd: done.usd, minutes: done.minutes }, solo: soloFromRun(events) }
    this.forecasts.set(key, f)
    return f
  }

  private rebuild(p: Project) {
    if (!p.run) p.run = { bugFixed: this.nextBugFixed(p), kit: structuredClone(this.kit[p.id] ?? {}), autonomy: { ...p.autonomy } }
    const run = p.run
    const kit = run.kit
    const answers = p.answers ?? {}
    const built = this.inputFor(p, kit, run.autonomy, answers, p.sendBacks, run.bugFixed)
    if (!built) return
    const { planned, farmers } = built
    let events = simulateRun(built.input)
    // The plan shows the forecast made when the run started.
    if (run.forecast) {
      const fc = run.forecast
      events = events.map((e) => (e.type === 'plan' ? { ...e, estimate: fc.crew, singleAgentEstimate: fc.solo } : e))
    }
    // Steps a farmer took before you changed its model were paid at the old rate.
    const at = this.kitAt[p.id] ?? {}
    const rate = (m: string) => MODELS.find((x) => x.model === m)?.rate ?? 1
    events = events.map((e) => {
      if (e.type !== 'usage') return e
      const before = planned.find((f) => f.id === e.farmer)
      const now = farmers.find((f) => f.id === e.farmer)
      const t = at[e.farmer]
      if (!before || !now || t === undefined || e.t >= t || before.model === now.model) return e
      const k = rate(before.model) / rate(now.model)
      return { ...e, usd: +(e.usd * k).toFixed(3), tokensIn: Math.round(e.tokensIn * k), tokensOut: Math.round(e.tokensOut * k) }
    })
    ;(p.rollbacks ?? []).forEach((t0, i) => {
      const id = `ask-rb-${i + 1}`
      events = rollBack(events, t0, id, answers[id])
    })
    p.events = events
    this.setSpeed(events)
  }

  // After a clean merge you made yourself, the Planner offers once to merge future pull requests by itself.
  answerTrust(yes: boolean) {
    const p = this.project()
    if (!p) return
    p.trust = yes ? 'yes' : 'no'
    // Applies to the next run: this one has already shipped.
    if (yes) {
      p.autonomy = { ...p.autonomy, ship: 'auto' }
      p.level = 'custom'
    }
    this.notify()
  }

  // The pull request review: send one task back with what should change. Its farmer changes it,
  // a different farmer checks it, and the pull request comes back to you with one more commit.
  sendBack(askId: string, task: string, note: string) {
    const p = this.project()
    if (!p) return
    p.sendBacks = { ...p.sendBacks, [askId]: { task, note } }
    p.everSentBack = true
    this.answer(askId, SEND_BACK)
    this.play()
  }

  // A run reached its end: count it, and if it was clean, toward the offer to merge by itself.
  // A rollback resets the count, and takes back merging by itself if you'd allowed it.
  private finishRun(p: Project) {
    // Counted once per run, however often it reaches its end again (after a rollback you made, say).
    if (!p.run || p.run.counted) return
    const s = this.state(p)
    if (!s?.done) return
    p.run.counted = true
    p.runs = (p.runs ?? 0) + 1
    const rolled = s.deploy.some((d) => d.stage === 'rollback')
    const clean = !rolled && !s.asks.some((a) => a.answer?.choice === SEND_BACK) && !s.tasks.some((t) => t.stopped)
    p.cleanRuns = clean ? (p.cleanRuns ?? 0) + 1 : 0
    if (rolled && p.autonomy.ship === 'auto' && p.trust === 'yes') {
      p.autonomy = { ...p.autonomy, ship: 'ask' }
      p.trust = undefined
      this.say('A rollback took back merging by itself. Pull requests ask you again.')
    }
    this.notify()
  }

  // Roll back a live release yourself, from the pull request.
  rollBackNow() {
    const p = this.project()
    if (!p || !liveStage(p.events, this.clock)) return
    p.rollbacks = [...(p.rollbacks ?? []), Math.round(this.clock) + 1]
    // A rollback takes back merging by itself straight away, not at the end of the run.
    if (p.trust === 'yes' && p.autonomy.ship === 'auto') {
      p.autonomy = { ...p.autonomy, ship: 'ask' }
      p.trust = undefined
      this.say('Your rollback took back merging by itself. Pull requests ask you again.')
    }
    p.cleanRuns = 0
    this.rebuild(p)
    this.clock = Math.round(this.clock) + 1
    this.play()
  }

  // ---- your own project: a live plan you can change and approve ----

  newProject(goal: string): Project {
    const id = `own-${Date.now().toString(36)}`
    const p: Project = { id, name: 'New project', goal, kind: 'own', events: [{ t: 0, type: 'goal', text: goal }], approved: false, planning: true, level: 'matters', autonomy: { ...AUTONOMY_PRESETS.matters } }
    this.projects = [...this.projects, p]
    this.open(id)
    return p
  }

  setPlan(id: string, name: string, farmers: FarmerSetup[], tasks: PlanTask[], estimate: Estimate, singleAgentEstimate?: Estimate) {
    const p = this.project(id)
    if (!p) return
    p.name = name
    p.planning = false
    p.error = undefined
    p.events = [
      { t: 0, type: 'goal', text: p.goal },
      ...farmers.map((f) => ({ t: 1, type: 'farmer' as const, ...f })),
      { t: 2, type: 'plan', tasks, estimate, singleAgentEstimate },
    ]
    this.crewSize[id] = new Set(tasks.map((t) => t.farmer)).size
    this.notify()
  }

  planFailed(id: string, error: string) {
    const p = this.project(id)
    if (!p) return
    p.planning = false
    p.error = error
    this.notify()
  }

  // Click-to-change on the plan: reassign a task, toggle its gate, edit a farmer's setup.
  editPlan(id: string, fn: (tasks: PlanTask[], farmers: FarmerSetup[]) => void) {
    const p = this.project(id)
    if (!p || p.approved) return
    const plan = p.events.find((e) => e.type === 'plan')
    if (!plan || plan.type !== 'plan') return
    const farmers = p.events.filter((e): e is Extract<RunEvent, { type: 'farmer' }> => e.type === 'farmer')
    fn(plan.tasks, farmers)
    this.notify()
  }

  setAutonomy(id: string, level: AutonomyLevel | 'custom', autonomy: Autonomy) {
    const p = this.project(id)
    if (!p) return
    p.level = level
    p.autonomy = autonomy
    // On a farm mid-run, the new setting replays the run from the start. A finished run stays as it was;
    // the setting applies to the next run.
    if (p.approved && !this.isDone(p)) {
      this.startRun(p)
      return
    }
    this.notify()
  }

  editKit(id: string, farmer: FarmerId, fn: (e: KitEdit) => void) {
    const k = (this.kit[id] ??= {})
    const e = (k[farmer] ??= emptyEdit())
    fn(e)
    this.kit = { ...this.kit, [id]: { ...k } }
    // On a running farm the change applies from now: the run is simulated again with it, and what was already spent stays.
    // A finished run is left alone: the change applies to the next run.
    const p = this.project(id)
    if (p?.approved && p.run && !this.isDone(p)) {
      const at = (this.kitAt[id] ??= {})
      at[farmer] ??= p.clock ?? 0
      p.run.kit = structuredClone(this.kit[id])
      this.rebuild(p)
    } else if (p?.approved && this.isDone(p)) this.say('Saved for the next run. This one is finished.')
    this.notify()
  }

  chatTo(id: string, line: ChatLine) {
    this.chat[id] = [...(this.chat[id] ?? []), line]
    this.notify()
  }

  approve(id: string) {
    const p = this.project(id)
    if (!p) return
    const plan = p.events.find((e) => e.type === 'plan')
    if (!plan || plan.type !== 'plan') return
    p.approved = true
    this.startRun(p)
  }
}

export const store = new Store()

export function useStore() {
  useSyncExternalStore(store.subscribe, store.snapshot)
  return store
}
