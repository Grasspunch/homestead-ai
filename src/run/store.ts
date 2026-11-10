// App state: which screen, the live plan being edited, and the replay of a recorded run.
import { useSyncExternalStore } from 'react'
import { duration, pendingAsk, reduce } from './reduce'
import { SEND_BACK, simulateRun } from './simulate'
import { liveStage, rollBack } from './rollback'
import { simulatePlan } from './simPlan'
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
  trust?: 'offered' | 'yes' | 'no' // after a clean merge, the Planner offers once to merge by itself
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
  clock = 0 // ms into the run
  playing = false
  speed = 1 // run-ms per wall-ms, set from the run's length
  viewerAnswers: Record<string, string> = {}
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

  state(p = this.project()): RunState | null {
    if (!p) return null
    return reduce(p.events, p.approved ? this.clock : Number.MAX_SAFE_INTEGER, this.viewerAnswers)
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

  open(project: string) {
    this.screen = { kind: 'farm', project }
    this.drawer = null
    this.pause()
    this.clock = 0
    this.viewerAnswers = {}
    const p = this.project(project)
    if (p?.approved) {
      // A fresh watch: the run as planned, before any of your answers. Your changes to farmers apply from the start.
      p.sendBacks = {}
      p.rollbacks = []
      this.kitAt[p.id] = {}
      this.rebuild(p)
      this.play()
    }
    this.notify()
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
      const dt = now - this.last
      this.last = now
      const waiting = pendingAsk(p.events, this.clock, this.viewerAnswers)
      if (!waiting) {
        const end = duration(p.events)
        this.clock = Math.min(end, this.clock + dt * this.speed)
        if (this.clock >= end) this.playing = false
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

  // Run the plan again with everything you've decided so far: your answers, your changes to each farmer,
  // the rules you set, and the work you sent back. The simulation is deterministic, so what came before stays the same.
  private rebuild(p: Project) {
    const plan = p.events.find((e) => e.type === 'plan')
    if (!plan || plan.type !== 'plan') return
    const kit = this.kit[p.id] ?? {}
    const planned = p.events.filter((e): e is Extract<RunEvent, { type: 'farmer' }> => e.type === 'farmer').map(({ t: _t, type: _ty, ...f }) => f)
    const farmers = planned.map((f) => applyEdit(f, kit[f.id]))
    const plannedModels = Object.fromEntries(planned.map((f) => [f.id, f.model]))
    const deployAsks = kit.deployer?.rules.deploy === false
    let events = simulateRun({ goal: p.goal, farmers, tasks: plan.tasks, estimate: plan.estimate, singleAgentEstimate: plan.singleAgentEstimate, autonomy: p.autonomy, choices: this.viewerAnswers, deployAsks, plannedModels, sendBacks: p.sendBacks })
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
      events = rollBack(events, t0, id, this.viewerAnswers[id])
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
    this.answer(askId, SEND_BACK)
    this.play()
  }

  // Roll back a live release yourself, from the pull request.
  rollBackNow() {
    const p = this.project()
    if (!p || !liveStage(p.events, this.clock)) return
    p.rollbacks = [...(p.rollbacks ?? []), Math.round(this.clock) + 1]
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
    // On a farm that is already running, the new setting replays the run from the start.
    if (p.approved) {
      p.sendBacks = {}
      p.rollbacks = []
      this.viewerAnswers = {}
      this.rebuild(p)
      this.open(id)
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
    const p = this.project(id)
    if (p?.approved) {
      const at = (this.kitAt[id] ??= {})
      at[farmer] ??= this.clock
      this.rebuild(p)
    }
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
    p.sendBacks = {}
      p.rollbacks = []
    this.clock = 0
    this.viewerAnswers = {}
    this.rebuild(p)
    this.play()
  }
}

export const store = new Store()

export function useStore() {
  useSyncExternalStore(store.subscribe, store.snapshot)
  return store
}
