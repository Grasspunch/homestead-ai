// App state: which screen, the live plan being edited, and the replay of a recorded run.
import { useSyncExternalStore } from 'react'
import { duration, pendingAsk, reduce } from './reduce'
import { simulateRun } from './simulate'
import { simulatePlan } from './simPlan'
import type { Review, Autonomy, AutonomyLevel, FarmerId, FarmerSetup, PlanTask, RunEvent, RunState, Estimate } from './types'
import { AUTONOMY_PRESETS } from './types'
import { applyEdit, emptyEdit, type KitEdit } from './kit'

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
  // Finished work you accepted or sent back while watching, by task id.
  reviews: Record<string, Review> = {}
  // Trust that grows: after five accepts with nothing sent back, the Planner offers once to let the checker accept.
  trustOffer: string | null = null
  trustOffered = new Set<string>()
  autoAccept = new Set<string>()
  crewSize: Record<string, number> = {} // per own project: how many farmers the plan uses
  chat: Record<string, ChatLine[]> = {}
  settingsOpen = false
  notifications = false
  toast: { id: number; text: string } | null = null
  applied = new Set<string>() // usage fixes applied, by key
  kit: Record<string, Partial<Record<FarmerId, KitEdit>>> = {} // your changes to each farmer, per project
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
    const s = reduce(p.events, p.approved ? this.clock : Number.MAX_SAFE_INTEGER, this.viewerAnswers, this.reviews)
    if (this.autoAccept.has(p.id))
      for (const t of s.tasks)
        if (t.status === 'ripe' && !t.gate && !this.reviews[t.id]) {
          t.status = 'accepted'
          t.acceptedBy = s.farmers.tester ? 'tester' : 'planner'
        }
    return s
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
    this.reviews = {}
    const p = this.project(project)
    if (p?.approved) {
      this.setSpeed(p.events)
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
    // Jump to the moment the run carried on.
    const p = this.project()
    const ans = p?.events.find((e) => e.type === 'answer' && e.id === askId)
    if (ans && ans.t > this.clock) this.clock = ans.t
    if (this.drawer?.kind === 'ask' && this.drawer.id === askId) this.drawer = null
    this.notify()
  }

  accept(task: string) {
    this.reviews = { ...this.reviews, [task]: { kind: 'accept' } }
    const p = this.project()
    const all = Object.values(this.reviews)
    if (p && !this.trustOffered.has(p.id) && all.filter((r) => r.kind === 'accept').length >= 5 && !all.some((r) => r.kind === 'back')) {
      this.trustOffered.add(p.id)
      this.trustOffer = p.id
    }
    this.notify()
  }

  answerTrust(yes: boolean) {
    const p = this.project()
    if (p && yes) {
      this.autoAccept.add(p.id)
      p.autonomy = { ...p.autonomy, review: 'auto' }
      p.level = 'custom'
    }
    this.trustOffer = null
    this.notify()
  }

  // Sent back with a note: the farmer regrows it, then it's ready for you again.
  sendBack(task: string, note: string) {
    this.reviews = { ...this.reviews, [task]: { kind: 'back', note, done: false } }
    this.notify()
    setTimeout(() => {
      const r = this.reviews[task]
      if (r?.kind === 'back' && r.note === note) this.reviews = { ...this.reviews, [task]: { ...r, done: true } }
      this.notify()
    }, 4000)
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
      const plan = p.events.find((e) => e.type === 'plan')
      if (plan && plan.type === 'plan') {
        const farmers = p.events.filter((e): e is Extract<RunEvent, { type: 'farmer' }> => e.type === 'farmer').map(({ t: _t, type: _ty, ...f }) => f)
        p.events = simulateRun({ goal: p.goal, farmers, tasks: plan.tasks, estimate: plan.estimate, singleAgentEstimate: plan.singleAgentEstimate, autonomy })
        this.open(id)
        return
      }
    }
    this.notify()
  }

  editKit(id: string, farmer: FarmerId, fn: (e: KitEdit) => void) {
    const k = (this.kit[id] ??= {})
    const e = (k[farmer] ??= emptyEdit())
    fn(e)
    this.kit = { ...this.kit, [id]: { ...k } }
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
    const farmers = p.events.filter((e): e is Extract<RunEvent, { type: 'farmer' }> => e.type === 'farmer').map(({ t: _t, type: _ty, ...f }) => applyEdit(f, this.kit[id]?.[f.id]))
    p.events = simulateRun({ goal: p.goal, farmers, tasks: plan.tasks, estimate: plan.estimate, singleAgentEstimate: plan.singleAgentEstimate, autonomy: p.autonomy })
    p.approved = true
    this.clock = 0
    this.viewerAnswers = {}
    this.reviews = {}
    this.setSpeed(p.events)
    this.play()
  }
}

export const store = new Store()

export function useStore() {
  useSyncExternalStore(store.subscribe, store.snapshot)
  return store
}
