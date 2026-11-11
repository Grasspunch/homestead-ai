// App state: which screen, the live plan being edited, and the replay of a recorded run.
import { useSyncExternalStore } from 'react'
import { duration, pendingAsk, reduce } from './reduce'
import { SEND_BACK, fitLimits, simulateRun } from './simulate'
import { liveStage, rollBack } from './rollback'
import { simulatePlan } from './simPlan'
import { soloFromRun } from './compare'
import type { Autonomy, AutonomyLevel, FarmerId, FarmerSetup, PlanTask, RunEvent, RunState, Estimate } from './types'
import { AUTONOMY_PRESETS } from './types'
import { OWN, confirmOwn, isOwnWay, ownText, ownWayOf, type TalkLine } from './discuss'
import { applyEdit, emptyEdit, type KitEdit } from './kit'
import { key, readChanges, reshapedOf, shortOf, type Change, type FlowItem, type Proposal, type Scope, type Suggestion } from './reshape'
import { isUi, propOf, uiLookOf, type UiId, type UiLook } from './ui'
import { AREAS, MATES, areaFor, mateEvents, snapAt } from './team'

export const SAMPLE_GOAL = 'Build an AI support assistant that answers customer questions from a shop’s help pages, and hands off to a person when it is not sure'

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
  liveSource?: string // who answered it: Lovable AI, or your own Anthropic or OpenAI key
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
  talks?: Record<string, (TalkLine | { from: 'you'; text: string })[]> // talking a disagreement through, by ask id
  run?: { bugFixed: boolean; kit: Partial<Record<FarmerId, KitEdit>>; autonomy: Autonomy; forecast?: Forecast; counted?: boolean }
  // Changes you asked the Planner for. Each lasts for the farm until you turn it off; Undo restores the run
  // exactly as it was before it. A change for every farm also goes to Your flow, and new farms start with it.
  reshapes?: ReshapeOn[]
  // The team view: the area a project belongs to, and its spend limit, which starts as the area's budget.
  area?: string
  spendLimit?: number
  owner?: string // a teammate's simulated project you opened from the team view
}

export interface ReshapeOn {
  id: string
  title: string
  request: string
  changes: Change[]
  scope: Scope
  at: number // ms into the run it took effect; 0 from the next run on
  notify?: 'desktop' | 'toast' // how stage alerts reach you, when one of the changes asks for them
  flow?: string[] // set when a new farm started with Your flow: each item in a few words
  before?: { events: RunEvent[]; answers: Record<string, string>; run: Project['run'] } // the run as it was, for Undo
}

// A request read into changes, waiting on the card for your yes.
export interface PendingChange {
  pid: string
  request: string
  proposal: Proposal
  wasPlaying: boolean
  denied?: boolean // you applied a stage alert and the browser blocked notifications
}

// The plan's numbers: the run simulated on its default path (every suggested answer), and the same work done by one agent.
export interface Forecast {
  crew: Estimate
  solo: Estimate
}

// Which option a free-text answer means. It only ever picks one of the ask's options, and errs toward asking again.
// - A question ("should we split it", "what does that cost?") is not an answer.
// - A no (no, not, never, any n't or its spelling without the apostrophe, "rather not") never matches an option by
//   its words: it holds when the ask can hold, takes Stop only when you say stop, and otherwise asks again.
// - An amount that isn't one of the options ("raise it to $100") is never rounded to one: you're told and asked again.
// - Otherwise naming an option's own words wins, then a plain yes takes the suggestion.
const CONTRACTED = /\b(dont|dnt|didnt|doesnt|dosnt|dosent|doesent|shant|shouldnt|wouldnt|couldnt|cant|cannot|isnt|arent|wasnt|werent|wont|havent|hasnt|hadnt|mustnt|neednt|aint)\b/
const NEGATION = /\b(no|nah|nope|not|never|stop|wait|hold|later|cancel|halt|leave it|rather not|avoid|avoiding|reject|refuse|against|bad idea|terrible idea|skip|skipping|drop|forget|decline|veto|scrap|nix|ditch|pass on)\b/
// Short replies that start like a question but answer: "do it", "can do", "is fine".
const AFFIRM = /^\s*(do it|do that|do so|can do|will do|is fine|is ok|is okay|are fine)\b/i
const QUESTION =/\?|^\s*(should|shall|do|does|did|can|could|would|will|is|are|what|how|why|when|which)\b(?![´`’‘ʼ′']t\b)|\b(what|how|why|explain|can you|could you)\b/i
// Every apostrophe-like character reads as one: ´ ` ’ ‘ ʼ ′.
const APOS = /[´`’‘ʼ′]/g
const norm = (text: string) => ` ${text.toLowerCase().replace(APOS, "'").replace(/n[’']t\b/g, 'nt').replace(/[’']/g, '').replace(/[^a-z0-9%$. ]+/g, ' ')} `

export type Reading = { choice: string } | { none: 'question' | 'no' | 'amount' | 'unclear'; amount?: string }

// sides: who stands behind which option, such as the Builder and the Designer when they disagree.
export function readAnswerWhy(text: string, suggested: string, options: string[], sides: Record<string, string> = {}): Reading {
  const plain = (x: string) => norm(x).replace(/[.!]+/g, ' ').replace(/\s+/g, ' ').trim()
  // An option's own words, typed as they are, are that option: "Fix it", "Leave it rolled back".
  const exact = options.find((o) => plain(o) === plain(text))
  if (exact) return { choice: exact }
  if (QUESTION.test(text.trim()) && !(AFFIRM.test(text.replace(APOS, "'")) && !text.includes('?'))) return { none: 'question' }
  // "not just 10%" and "not only" widen, they don't refuse.
  const t = norm(text).replace(/\bnot (just|only)\b/g, ' ')
  const rather = /\brather\b/.test(t) && /\b(not|didnt|wouldnt|dont)\b/.test(t)
  const no = rather || CONTRACTED.test(t) || NEGATION.test(t)
  // Naming who you side with: "go with the builder". Naming who is wrong takes the other side:
  // "the designer is wrong", "overrule the designer", "not the designer's way".
  const named = Object.entries(sides).filter(([who]) => new RegExp(`\\b${who.toLowerCase()}s?\\b`).test(t))
  if (named.length === 1 && options.includes(named[0][1])) {
    const against = no || /\b(wrong|overrule|overruled|overrules|disagree with|mistaken|instead of)\b/.test(t)
    const other = Object.values(sides).find((o) => o !== named[0][1] && options.includes(o))
    if (!against) return { choice: named[0][1] }
    if (other) return { choice: other }
  }
  // A number of parts no option has: "split it in three" is not "Split it in two".
  const NUM = /\b(one|two|three|four|five|six|half|halves|thirds?|quarters?)\b/g
  const said = t.match(NUM) ?? []
  const offered = options.flatMap((o) => norm(o).match(NUM) ?? [])
  if (said.length && offered.length && said.some((w) => !offered.includes(w))) return { none: 'unclear' }
  if (no) {
    // An option that is itself a no, named by what it refuses: "no refactor" is "Keep it small, no refactor".
    const refusing = options.filter((o) => {
      const m = norm(o).match(/\b(?:no|not|never|without) ([a-z]{4,})/)
      return !!m && new RegExp(`\\b(no|not|never|without|dont|skip) (the |a )?${m[1].slice(0, 6)}`).test(t)
    })
    if (refusing.length === 1) return { choice: refusing[0] }
    const stop = options.find((o) => /^stop/i.test(o))
    const sayStop = /\bstop\b/.test(t) && !/\b(dont|dnt|do not|not|never|didnt|shouldnt|wouldnt) stop\b/.test(t)
    if (stop && sayStop) return { choice: stop }
    const hold = options.find((o) => /^not yet/i.test(o))
    return hold ? { choice: hold } : { none: 'no' }
  }
  // An amount you typed must be one of the options' amounts.
  const typed = t.match(/\$?\b\d+(\.\d+)?\b/g)?.filter((n) => n.includes('$') || /dollar|limit|raise|\$/.test(t))
  if (typed?.length) {
    const amounts = options.flatMap((o) => o.match(/\$\d+(\.\d+)?/g) ?? []).map((a) => Number(a.slice(1)))
    const wanted = typed.map((n) => Number(n.replace('$', '')))
    if (!wanted.every((w) => amounts.includes(w))) return { none: 'amount', amount: `$${wanted.find((w) => !amounts.includes(w))}` }
    // An amount that is one option's own amount picks that option: "$29 is fine" is the raise.
    const withIt = options.filter((o) => (o.match(/\$\d+(\.\d+)?/g) ?? []).some((a) => wanted.includes(Number(a.slice(1)))))
    if (withIt.length === 1) return { choice: withIt[0] }
  }
  const words = (o: string) => o.toLowerCase().replace(/[^a-z0-9%$ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !['again', 'with', 'here', 'your', 'from', 'that', 'this'].includes(w))
  const scored = options.map((o) => ({ o, n: words(o).filter((w) => t.includes(` ${w}`)).length })).sort((a, b) => b.n - a.n)
  if (scored[0]?.n && scored[0].n > (scored[1]?.n ?? 0)) return { choice: scored[0].o }
  if (/\b(yes|yep|yeah|sure|ok|okay|go|go ahead|do it|do that|do so|can do|will do|fine|sounds good|agreed)\b/.test(t)) return { choice: suggested }
  return { none: 'unclear' }
}

export function readAnswer(text: string, suggested: string, options: string[]): string | null {
  const r = readAnswerWhy(text, suggested, options)
  return 'choice' in r ? r.choice : null
}

// A no, for the Planner's reply when nothing matched.
export function saysNo(text: string) {
  const r = readAnswerWhy(text, '', [])
  return 'none' in r && r.none === 'no'
}

// From free text, anything hard to undo, anything that moves money, and staying at 10% is confirmed first.
// Only a hold ("Not yet") isn't: it changes nothing.
export function needsConfirm(choice: string, reason?: string) {
  if (/^not yet/i.test(choice)) return false
  return reason === 'irreversible' || /\$|\b(ship|merge|deploy|release|everyone|stop|stay|leave|keep it small|raise|limit)\b/i.test(choice)
}

export type InWords =
  | { kind: 'answered' | 'hold' | 'confirm'; choice: string; ask?: string }
  | { kind: 'discuss' } // a question about a disagreement: the sides answer it, and the ask stays open
  | { kind: 'none'; why: 'question' | 'no' | 'amount' | 'unclear'; amount?: string }

// Long answers are quoted short.
export const clip = (text: string, n = 80) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

export interface ChatLine {
  from: 'you' | 'planner'
  text: string
  to?: FarmerId
  closest?: string // for a change the Planner can't make: the nearest one it can
  chips?: Suggestion[] // requests it can make, sent when you click one
}

interface Saved {
  v: 1
  projects: Project[]
  kit: Record<string, Partial<Record<FarmerId, KitEdit>>>
  kitAt: Record<string, Partial<Record<FarmerId, number>>>
  chat: Record<string, ChatLine[]>
  crewNotes: Record<string, Partial<Record<FarmerId, string[]>>>
  crewSize: Record<string, number>
  seen: string[]
  screen?: Screen
  paused?: boolean
  flow?: FlowItem[] // changes for every farm, which new farms start with
  budgets?: Record<string, number> // each area's budget per project
  homeView?: 'mine' | 'team'
}

// Saved farms as they were written, or null when anything in them can't be read.
function valid(d: unknown): Saved | null {
  const o = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, never>) : {})
  if (!d || typeof d !== 'object') return null
  const x = d as Record<string, unknown>
  if (x.v !== 1 || !Array.isArray(x.projects) || !x.projects.length) return null
  // The fields each kind of event is drawn from: an ask with no words, say, is a save that can't be shown.
  const okEvent = (e: RunEvent) => {
    if (!e || typeof e.t !== 'number' || typeof e.type !== 'string') return false
    if (e.type === 'ask') return typeof e.id === 'string' && typeof e.question === 'string' && typeof e.suggested === 'string' && (e.alternatives === undefined || Array.isArray(e.alternatives))
    if (e.type === 'usage') return typeof e.usd === 'number' && typeof e.farmer === 'string'
    if (e.type === 'plan') return Array.isArray(e.tasks)
    if (e.type === 'farmer') return typeof e.id === 'string' && !!e.limits
    return true
  }
  const okProject = (p: unknown) => {
    const q = p as Project
    return !!q && typeof q.id === 'string' && typeof q.name === 'string' && typeof q.goal === 'string' && Array.isArray(q.events) && q.events.every(okEvent) && !!q.autonomy && typeof q.autonomy === 'object'
  }
  if (!x.projects.every(okProject)) return null
  const seen = Array.isArray(x.seen) ? x.seen.filter((k): k is string => typeof k === 'string') : []
  const sc = x.screen as Screen | undefined
  const screen = sc && (sc.kind === 'home' || (sc.kind === 'farm' && typeof sc.project === 'string')) ? sc : undefined
  const flow = Array.isArray(x.flow) ? (x.flow as FlowItem[]).filter((f) => !!f && typeof f.id === 'string' && typeof f.label === 'string' && !!f.change && typeof f.change.kind === 'string') : []
  const budgets = Object.fromEntries(Object.entries(o(x.budgets)).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<string, number>
  return { v: 1, projects: x.projects as Project[], kit: o(x.kit), kitAt: o(x.kitAt), chat: o(x.chat), crewNotes: o(x.crewNotes), crewSize: o(x.crewSize), seen, screen, paused: x.paused === true, flow, budgets, homeView: x.homeView === 'team' ? 'team' : 'mine' }
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
  flow: FlowItem[] = [] // Your flow: changes for every farm
  budgets: Record<string, number> = Object.fromEntries(AREAS.map((a) => [a.id, a.budget])) // each area's budget per project
  homeView: 'mine' | 'team' = 'mine'
  fresh: { id: string; until: number } | null = null // a change just applied: its chip shows Undo until then
  static FRESH_MS = 8000
  notifications = false
  toast: { id: number; text: string; undo?: string } | null = null
  seen = new Set<string>() // moments you've already read, such as a rollback
  applied = new Set<string>() // usage fixes applied, by key
  kit: Record<string, Partial<Record<FarmerId, KitEdit>>> = {} // your changes to each farmer, per project
  kitAt: Record<string, Partial<Record<FarmerId, number>>> = {} // when you first changed each farmer mid-run
  private lastAsk: string | null = null
  private listeners = new Set<() => void>()

  // How the screen looks after what you asked the Planner: hidden, moved, resized, renamed or recoloured parts.
  // This farm's changes come first, then Your flow, so a change for every farm reaches farms you made before,
  // too. The latest change wins, per part and per property.
  uiLook(p = this.project()): UiLook {
    return uiLookOf((p?.reshapes ?? []).flatMap((r) => r.changes), this.flow.filter((f) => f.on).map((f) => f.change))
  }
  uiHidden(el: UiId, p = this.project()): boolean {
    return this.uiLook(p).hidden.includes(el)
  }

  say(text: string) {
    this.toast = { id: Date.now(), text }
    this.notify()
  }

  async enableNotifications(on: boolean) {
    this.notifications = false
    if (on) {
      let framed = false
      try {
        framed = window.top !== window.self
      } catch {
        framed = true
      }
      // A browser never asks inside a frame, such as Lovable's preview, and a block it remembers stays silent; say so.
      if (typeof Notification === 'undefined') this.say('This browser can’t show desktop notifications.')
      else if (framed && Notification.permission !== 'granted') this.say('Open the app in its own tab to turn on desktop notifications.')
      else {
        const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
        if (p === 'granted') {
          this.notifications = true
          new Notification('Desktop notifications are on', { body: 'You’ll get one when an agent needs you and this tab is in the background.', icon: '/apple-touch-icon.png' })
        } else this.say('Your browser blocks notifications for this site. Allow them in the site settings, then try again.')
      }
    }
    this.notify()
  }

  // A desktop notification for an ask, when the tab is in the background.
  private desktopNotify(p: Project, askId: string) {
    if (!this.notifications || typeof Notification === 'undefined' || !document.hidden) return
    const ask = p.events.find((e) => e.type === 'ask' && e.id === askId)
    if (!ask || ask.type !== 'ask') return
    const who = p.events.find((e) => e.type === 'farmer' && e.id === ask.farmer)
    const n = new Notification(`${who && who.type === 'farmer' ? who.label : 'An agent'} needs you on ${p.name}`, { body: ask.question, tag: askId, icon: '/apple-touch-icon.png' })
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
    this.persistSoon()
  }

  // Your farms survive a reload: saved to this browser at most once a second, and on leaving the page.
  private static KEY = 'homestead.v3.farms'
  private saveAt = 0
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private persistSoon() {
    if (this.saveTimer) return
    const wait = Math.max(0, 1000 - (Date.now() - this.saveAt))
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.persist()
    }, wait)
  }
  // Another tab may have saved farms this one hasn't seen. Saving keeps them: each farm is whatever the tab
  // that last touched it saved, and a farm made in the other tab is never wiped by this one.
  private readSaved(): Saved | null {
    try {
      if (typeof localStorage === 'undefined') return null
      const raw = localStorage.getItem(Store.KEY)
      return raw ? valid(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }
  persist() {
    this.saveAt = Date.now()
    try {
      if (typeof localStorage === 'undefined') return
      const old = this.readSaved()
      const mine = new Set(this.projects.map((p) => p.id))
      const theirs = (old?.projects ?? []).filter((p) => !mine.has(p.id))
      const keep = <T,>(o: Record<string, T> | undefined, m: Record<string, T>) => ({ ...Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !mine.has(k))), ...m })
      const data: Saved = {
        v: 1,
        projects: [...this.projects, ...theirs],
        kit: keep(old?.kit, this.kit),
        kitAt: keep(old?.kitAt, this.kitAt),
        chat: keep(old?.chat, this.chat),
        crewNotes: keep(old?.crewNotes, this.crewNotes),
        crewSize: keep(old?.crewSize, this.crewSize),
        seen: [...new Set([...(old?.seen ?? []).filter((k) => !mine.has(k.split(':')[0])), ...this.seen])],
        screen: this.screen,
        paused: this.screen.kind === 'farm' && !this.playing,
        flow: this.flow,
        budgets: this.budgets,
        homeView: this.homeView,
      }
      localStorage.setItem(Store.KEY, JSON.stringify(data))
    } catch {
      // Storage full or blocked: the farms still work, they just won't survive a reload.
    }
  }
  // A save from another tab: take its farms, except the one open here, which this tab is driving.
  fromOtherTab(raw: string | null) {
    let d: Saved | null = null
    try {
      d = raw ? valid(JSON.parse(raw)) : null
    } catch {
      d = null
    }
    if (!d) return
    const open = this.screen.kind === 'farm' ? this.screen.project : undefined
    const byId = new Map(this.projects.map((p) => [p.id, p]))
    for (const p of d.projects) if (p.id !== open) byId.set(p.id, p)
    this.projects = [...byId.values()]
    for (const [k, v] of Object.entries(d.kit)) if (k !== open) this.kit[k] = v
    for (const [k, v] of Object.entries(d.chat)) if (k !== open) this.chat[k] = v
    for (const [k, v] of Object.entries(d.crewNotes)) if (k !== open) this.crewNotes[k] = v
    for (const [k, v] of Object.entries(d.crewSize)) if (k !== open) this.crewSize[k] = v
    this.flow = d.flow ?? []
    // Shown without saving again, so two tabs never answer each other's saves forever.
    this.version++
    for (const fn of this.listeners) fn()
  }
  // Returns true when saved farms were found. Saved farms that can't be read are cleared, and you start at Home.
  restore(): boolean {
    let raw: string | null = null
    try {
      if (typeof localStorage === 'undefined') return false
      raw = localStorage.getItem(Store.KEY)
    } catch {
      return false
    }
    if (!raw) return false
    let d: Saved | null = null
    try {
      d = valid(JSON.parse(raw))
    } catch {
      d = null
    }
    if (!d) {
      try {
        localStorage.removeItem(Store.KEY)
      } catch {
        // Nothing more to do: the sample loads as on a first visit.
      }
      this.toast = { id: Date.now(), text: 'Your saved farms couldn’t be read, so this starts fresh.' }
      return false
    }
    this.projects = d.projects.map((p) =>
      // A plan that was still being made when the page closed: say so, and offer to try again.
      p.planning ? { ...p, planning: false, error: p.events.some((e) => e.type === 'plan') ? undefined : 'Planning stopped when the page closed.' } : p,
    )
    this.kit = d.kit
    this.kitAt = d.kitAt
    this.chat = d.chat
    this.crewNotes = d.crewNotes
    this.crewSize = d.crewSize
    this.seen = new Set(d.seen)
    this.flow = d.flow ?? []
    this.budgets = { ...this.budgets, ...d.budgets }
    this.homeView = d.homeView ?? 'mine'
    this.sampleLoading = false
    const screen = d.screen
    if (screen?.kind === 'farm' && this.projects.some((p) => p.id === screen.project)) {
      this.open(screen.project)
      // Paused when the page closed: still paused.
      if (d.paused) this.pause()
    } else this.notify()
    return true
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
    if (this.restore()) return
    const plan = simulatePlan(SAMPLE_GOAL)
    plan.farmers = fitLimits({ goal: SAMPLE_GOAL, ...plan })
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
    // Every run shows its own moments again, such as its rollback.
    for (const k of [...this.seen]) if (k.startsWith(`${p.id}:`)) this.seen.delete(k)
    // Changes you asked for last for the farm: from the start of this run, with nothing earlier to undo to.
    p.reshapes = (p.reshapes ?? []).map((r) => ({ ...r, at: 0, before: undefined }))
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
        const from = this.clock
        this.clock = Math.min(end, next ? next.t : end, this.clock + dt * this.paceTo(p, next ? next.t : end))
        this.stagesPassed(p, from, this.clock)
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

  // Between the moments that matter, the run moves faster: no stretch takes more than about 15 seconds,
  // and a release going out (or coming back) is its own moment.
  private stretch: { from: number; to: number; speed: number } | null = null
  private paceTo(p: Project, nextAsk: number) {
    const deploy = p.events.find((e) => e.type === 'deploy' && e.t > this.clock)
    const to = Math.min(nextAsk, deploy ? deploy.t : nextAsk)
    if (!this.stretch || this.stretch.to !== to || this.clock < this.stretch.from) this.stretch = { from: this.clock, to, speed: Math.max(this.speed, (to - this.clock) / 15_000) }
    return this.stretch.speed
  }

  // Jump to the next thing worth seeing: the next ask, a release rolling back, a check failing, or the end.
  // Never past one: it does nothing while an ask or a rollback is open, so a double click can't skip two.
  canSkip(p = this.project()) {
    if (!p?.approved || this.isDone(p)) return false
    if (pendingAsk(p.events, this.clock, this.viewerAnswers)) return false
    return !this.openRollback(p)
  }
  openRollback(p: Project) {
    const rb = [...p.events].reverse().find((e) => e.type === 'deploy' && e.t <= this.clock)
    return !!rb && rb.type === 'deploy' && rb.stage === 'rollback' && !this.seen.has(`${p.id}:${rb.t}`)
  }
  // A second click within a second of a skip is the same click: it never skips twice.
  private skippedAt = 0
  skipToNext() {
    const p = this.project()
    if (!p || !this.canSkip(p) || Date.now() - this.skippedAt < 1000) return
    this.skippedAt = Date.now()
    const next = p.events.find(
      (e) =>
        e.t > this.clock &&
        ((e.type === 'ask' && !this.viewerAnswers[e.id]) || (e.type === 'deploy' && e.stage === 'rollback') || (e.type === 'check' && !e.pass)),
    )
    // A failed check: land just after it, so its proof is up.
    const from = this.clock
    this.clock = next ? next.t + (next.type === 'check' ? 1 : 0) : duration(p.events)
    this.stagesPassed(p, from, this.clock)
    this.drawer = null
    if (!this.playing) this.play()
    this.notify()
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
    // Jump to the moment the run carried on, but never past an ask you haven't answered yet,
    // such as a new spend limit ask that a model change brought in.
    const ans = p?.events.find((e) => e.type === 'answer' && e.id === askId)
    if (p && ans && ans.t > this.clock) {
      const next = p.events.find((e) => e.type === 'ask' && e.t > this.clock && e.t < ans.t && !this.viewerAnswers[e.id])
      this.clock = next ? next.t : ans.t
    }
    if (this.drawer?.kind === 'ask' && this.drawer.id === askId) this.drawer = null
    this.notify()
    // An answer is saved at once, so a reload straight after it keeps it.
    this.persist()
  }

  // An answer in your own words. Yes-like words take the suggestion; no-like words, or words that name another
  // option, take that one. The Planner says how it read you. Returns the option, or null when it can't tell.
  // Free text only ever picks one of the ask's options. Something hard to undo is confirmed first.
  answerInWords(askId: string, text: string): InWords {
    const p = this.project()
    const ask = p?.events.find((e) => e.type === 'ask' && e.id === askId)
    if (!p || !ask || ask.type !== 'ask') return { kind: 'none', why: 'unclear' }
    // Sending work back needs a task and a note, so it goes through its own form.
    const options = [ask.suggested, ...(ask.alternatives ?? [])].filter((o) => !/^show me/i.test(o) && o !== SEND_BACK)
    // When two farmers disagree, naming one picks their way.
    const dis = ask.reason === 'disagree' ? p.events.find((e) => e.type === 'disagree' && e.task === ask.task) : undefined
    const other = dis && dis.type === 'disagree' ? dis.sides.find((x) => x.farmer !== ask.farmer)?.farmer : undefined
    const sides: Record<string, string> = dis && other && ask.alternatives?.[0] ? { [ask.farmer]: ask.suggested, [other]: ask.alternatives[0] } : {}
    const r = readAnswerWhy(text, ask.suggested, options, sides)
    // A disagreement can be talked through: a way of your own is confirmed first, and a question gets answered.
    const talk = ask.talk
    if (talk && !('choice' in r) && r.none !== 'no' && r.none !== 'amount') {
      const way = ownWayOf(text, talk.sides)
      if (way) return { kind: 'confirm', choice: `${OWN}${way}`, ask: confirmOwn(way, talk, (f) => this.state(p)?.farmers[f]?.label ?? f) }
      return { kind: 'discuss' }
    }
    if (!('choice' in r)) return { kind: 'none', why: r.none, amount: r.amount }
    const choice = r.choice
    if (/^not yet/i.test(choice)) {
      this.chatTo(p.id, { from: 'you', text: clip(text) })
      this.chatTo(p.id, { from: 'planner', text: 'Holding. Nothing moves on this until you say so.' })
      return { kind: 'hold', choice }
    }
    // Every reading is said back first, so a misreading never applies by itself.
    return { kind: 'confirm', choice }
  }

  // A question about a disagreement and the sides' answers, kept with the ask so it reads as a short chat.
  talkOn(askId: string, text: string, lines: TalkLine[]) {
    const p = this.project()
    if (!p) return
    p.talks = { ...p.talks, [askId]: [...(p.talks?.[askId] ?? []), { from: 'you', text: clip(text) }, ...lines] }
    this.notify()
    this.persist()
  }

  confirmInWords(askId: string, text: string, choice: string) {
    const p = this.project()
    if (!p) return
    this.chatTo(p.id, { from: 'you', text: clip(text) })
    this.chatTo(p.id, { from: 'planner', text: isOwnWay(choice) ? `Going with your way: ${ownText(choice)}.` : `Got it. I read that as “${choice}”.` })
    p.notes = { ...p.notes, [askId]: text }
    this.answer(askId, choice)
  }

  // Run the plan again with everything you've decided so far: your answers, your changes to each farmer,
  // the rules you set, and the work you sent back. The simulation is deterministic, so what came before stays the same.
  private nextBugFixed(p: Project) {
    return p.kind !== 'sample' && (p.runs ?? 0) > 0
  }

  // The simulation's input for this farm's plan, with the given farmers' changes, rules and answers.
  private inputFor(p: Project, kit: Partial<Record<FarmerId, KitEdit>>, autonomy: Autonomy, answers: Record<string, string>, sendBacks: Project['sendBacks'], bugFixed: boolean, modelFrom: Partial<Record<FarmerId, number>> = {}) {
    const plan = p.events.find((e) => e.type === 'plan')
    if (!plan || plan.type !== 'plan') return null
    const planned = p.events.filter((e): e is Extract<RunEvent, { type: 'farmer' }> => e.type === 'farmer').map(({ t: _t, type: _ty, ...f }) => f)
    const farmers = planned.map((f) => applyEdit(f, kit[f.id]))
    // Priced on the plan's models, however many times the run was rebuilt since a change.
    const plannedModels = Object.fromEntries(planned.map((f) => [f.id, f.plannedModel ?? f.model]))
    const deployAsks = kit.deployer?.rules.deploy === false
    const basis = plan.basis ?? plan.estimate
    return { planned, farmers, input: { goal: p.goal, farmers, tasks: plan.tasks, estimate: basis, basis, singleAgentEstimate: plan.singleAgentEstimate, autonomy, choices: answers, deployAsks, plannedModels, sendBacks, bugFixed, modelFrom, reshape: reshapedOf(p.reshapes ?? []) } }
  }

  // What the plan will cost and take, by simulating it on its default path with your current farmers and rules,
  // against one Sonnet 5 agent doing the same work. The plan and the run it starts come from the same simulation.
  private forecasts = new Map<string, Forecast>()
  forecast(p: Project): Forecast | null {
    const kit = this.kit[p.id] ?? {}
    const bugFixed = this.nextBugFixed(p)
    const built = this.inputFor(p, kit, p.autonomy, {}, {}, bugFixed)
    if (!built) return null
    const key = JSON.stringify([p.id, built.input.farmers, built.input.tasks, p.autonomy, bugFixed, built.input.basis, built.input.reshape])
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
    // Steps a farmer took before you changed its model were paid at the old rate.
    const built = this.inputFor(p, kit, run.autonomy, answers, p.sendBacks, run.bugFixed, this.kitAt[p.id] ?? {})
    if (!built) return
    // What really happened so far: each farmer's spend, the raises you approved, and the limit asks it had.
    const t0 = p.clock ?? 0
    if (t0 > 0) {
      const past = { t: t0, spent: {} as Partial<Record<FarmerId, number>>, limit: {} as Partial<Record<FarmerId, number>>, asked: {} as Partial<Record<FarmerId, number>> }
      for (const e of p.events) {
        if (e.t > t0) continue
        if (e.type === 'usage') past.spent[e.farmer] = (past.spent[e.farmer] ?? 0) + e.usd
        if (e.type === 'ask' && e.limitFor) {
          past.asked[e.limitFor] = (past.asked[e.limitFor] ?? 0) + 1
          const c = answers[e.id]
          const m = c && /^raise/i.test(c) ? /\$(\d+(\.\d+)?)/.exec(c) : null
          if (m) past.limit[e.limitFor] = Number(m[1])
          // Stopped there: halted from that minute, as the run you watched had it.
          if (c && /^stop/i.test(c)) {
            const inp = built.input as { halts?: Partial<Record<FarmerId, number>>; haltTotals?: Partial<Record<FarmerId, number>> }
            inp.halts = { ...inp.halts, [e.limitFor]: e.t / 60_000 - 0.01 }
            const whole = Number(/\$(\d+(\.\d+)?) in all/.exec(e.impact ?? '')?.[1] ?? 0)
            if (whole) inp.haltTotals = { ...inp.haltTotals, [e.limitFor]: whole }
          }
        }
        // A raise the lead made by itself.
        if (e.type === 'auto_fix') {
          const m = /^The (\w+) reached its .* raised it to \$(\d+)/.exec(e.what)
          const f = m ? built.farmers.find((x) => x.label === m[1]) : undefined
          if (f && m) past.limit[f.id] = Number(m[2])
        }
      }
      // An ask open now is asked again by the new run, in its own place: it isn't counted as had.
      const open = pendingAsk(p.events, t0, answers)
      const oa = open ? p.events.find((e) => e.type === 'ask' && e.id === open) : undefined
      if (oa && oa.type === 'ask' && oa.limitFor) past.asked[oa.limitFor] = (past.asked[oa.limitFor] ?? 1) - 1
      ;(built.input as { past?: typeof past }).past = past
    }
    let events = simulateRun(built.input)
    // An ask you've answered keeps the words you answered: a later change (a model, say) never rewrites it.
    // An ask already on screen keeps its numbers too, until you answer it.
    const now = p.clock ?? 0
    const said = new Map(p.events.filter((e): e is Extract<RunEvent, { type: 'ask' }> => e.type === 'ask' && (!!answers[e.id] || e.t <= now)).map((e) => [e.id, e]))
    events = events.map((e) => {
      const was = e.type === 'ask' ? said.get(e.id) : undefined
      return was && e.type === 'ask' ? { ...e, question: was.question, impact: was.impact, suggested: was.suggested, alternatives: was.alternatives, confidence: was.confidence, basis: was.basis, limitTo: was.limitTo } : e
    })
    // The plan shows the forecast made when the run started.
    if (run.forecast) {
      const fc = run.forecast
      events = events.map((e) => (e.type === 'plan' ? { ...e, estimate: fc.crew, singleAgentEstimate: fc.solo } : e))
    }
    ;(p.rollbacks ?? []).forEach((t0, i) => {
      const id = `ask-rb-${i + 1}`
      events = rollBack(events, t0, id, answers[id])
    })
    // What already happened stays as it happened: every event up to now comes from the run you watched, so a
    // change mid-run never reprices money spent, never moves an ask you can see, and never rewrites a raise you
    // approved. Only the farmers and the plan come from the new run. From now on, the new run takes over.
    if (now > 0 && p.events.length) {
      const old = p.events
      // The farmers, the plan and the changes you asked for come from the new run, wherever they sit in time.
      const head = (e: RunEvent) => e.type === 'goal' || e.type === 'plan' || e.type === 'farmer' || e.type === 'reshape'
      const kept = old.filter((e) => e.t <= now && !head(e) && e.type !== 'done')
      const has = (e: RunEvent) =>
        kept.some((k) =>
          k.type === e.type &&
          ((e.type === 'ask' && k.type === 'ask' && k.id === e.id) ||
            (e.type === 'answer' && k.type === 'answer' && k.id === e.id) ||
            (e.type === 'stop' && k.type === 'stop' && k.task === e.task) ||
            (e.type === 'auto_fix' && k.type === 'auto_fix' && k.what === e.what)),
        )
      const shown = new Set(kept.filter((e) => e.type === 'ask').map((e) => (e.type === 'ask' ? e.id : '')))
      // Something the new run says should have happened before now, and didn't: a farmer passing a lower limit
      // sooner, say. It happens now instead, in the same order.
      let n = 0
      const late = events.filter((e) => e.t <= now && (e.type === 'ask' || e.type === 'answer' || e.type === 'stop' || e.type === 'auto_fix') && !has(e)).map((e) => ({ ...e, t: now + 1000 + 50 * n++ }))
      const after = events.filter((e) => e.t > now && !head(e) && !(e.type === 'ask' && shown.has(e.id)))
      events = [...events.filter(head), ...kept, ...late, ...after].sort((a, b) => a.t - b.t)
      // An ask you answered just now keeps its answer in the log, even when the new run never asks it again.
      for (const a of kept) {
        if (a.type !== 'ask' || !answers[a.id] || events.some((e) => e.type === 'answer' && e.id === a.id)) continue
        const i = events.indexOf(a)
        events.splice(i + 1, 0, { t: Math.max(a.t, now), type: 'answer', id: a.id, choice: answers[a.id], by: 'human' })
      }
      // A spend limit ask that moved to now says what is spent now.
      for (const a of late) {
        if (a.type !== 'ask' || !a.limitFor) continue
        const spentNow = events.reduce((m, e) => m + (e.type === 'usage' && e.farmer === a.limitFor && e.t <= a.t ? e.usd : 0), 0)
        const whole = Math.max(spentNow, Number(/\$(\d+(\.\d+)?) in all/.exec(a.impact ?? "")?.[1] ?? spentNow))
        const fmt = (x: number) => (whole >= 10 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`)
        const lim = /its (\$\d+(\.\d+)?) limit/.exec(a.question)?.[1] ?? ''
        const over = spentNow > Number(lim.slice(1))
        const who = /^The (\w+)/.exec(a.question)?.[1] ?? 'farmer'
        const q = `The ${who} ${over ? 'has passed' : 'is about to pass'} its ${lim} limit, with ${fmt(spentNow)} spent, so I paused it.`
        const im = `Finishing its work needs about ${fmt(whole - spentNow)} more, ${fmt(whole)} in all. Stopping it leaves its unfinished tasks out of the pull request.`
        events = events.map((e) => (e === a || (e.type === 'ask' && e.id === a.id) ? { ...a, question: q, impact: im } : e))
      }
      const last = events.filter((e) => e.type !== 'done').reduce((m, e) => Math.max(m, e.t), 0)
      events = events.map((e) => (e.type === 'done' && e.t <= last ? { ...e, t: last + 30_000 } : e))
    }
    // Done's total is what Spend adds up: every step at the rate it was paid.
    const usd = +events.reduce((n, e) => n + (e.type === 'usage' ? e.usd : 0), 0).toFixed(2)
    events = events.map((e) => (e.type === 'done' ? { ...e, usd } : e))
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

  // ---- changing the farm by asking the Planner ----

  pending: PendingChange | null = null

  // Read a message as a change to the farm. Returns false when it isn't one, so it goes to the crew as a note.
  async proposeChanges(pid: string, text: string, live?: (text: string, ctx: Parameters<typeof readChanges>[1]) => Promise<{ proposal: Proposal | null; note?: string }>): Promise<'card' | 'reply' | false> {
    const p = this.project(pid)
    if (!p) return false
    const ctx = this.reshapeCtx(p)
    let proposal: Proposal | null = null
    let note: string | undefined
    if (live) {
      const r = await live(text, ctx)
      proposal = r.proposal
      note = r.note
    }
    if (!proposal) {
      const r = readChanges(text, ctx)
      if (r.kind === 'not-a-change') return false
      if (r.kind === 'none') {
        this.chatTo(pid, { from: 'you', text: clip(text) })
        this.chatTo(pid, { from: 'planner', text: r.reply, closest: r.closest, chips: r.chips.length ? r.chips : undefined })
        return 'reply'
      }
      proposal = { ...r.proposal, note }
    }
    const wasPlaying = this.playing
    this.pause()
    this.pending = { pid, request: text, proposal, wasPlaying }
    this.chatTo(pid, { from: 'you', text: clip(text) })
    return 'card'
  }

  reshapeCtx(p: Project) {
    const s = this.state(p)
    return {
      tasks: (s?.tasks ?? []).map((k) => ({ id: k.id, name: k.name, farmer: k.farmer, gate: k.gate, status: k.status })),
      farmers: Object.values(s?.farmers ?? {}).filter((f): f is NonNullable<typeof f> => !!f).map((f) => f.id),
      active: (p.reshapes ?? []).flatMap((r) => r.changes),
      ui: this.uiLook(p),
    }
  }

  cancelChanges() {
    const pd = this.pending
    this.pending = null
    if (pd?.wasPlaying) this.play()
    this.notify()
  }

  // Apply the rows you kept. A stage alert asks the browser for permission first; blocked, it falls back to a
  // message in the app, and the card says so before it closes.
  async applyChanges(rowIds: string[], scopes: Record<string, Scope> = {}) {
    const pd = this.pending
    const p = pd && this.project(pd.pid)
    if (!pd || !p) return
    const rows = pd.proposal.rows.filter((r) => rowIds.includes(r.id))
    if (!rows.length) return this.cancelChanges()
    let notify: ReshapeOn['notify']
    if (rows.some((r) => r.change.kind === 'notifyOn')) {
      let ok = false
      try {
        if (typeof Notification !== 'undefined') ok = (Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission) === 'granted'
      } catch {
        ok = false
      }
      notify = ok ? 'desktop' : 'toast'
      if (!ok && !pd.denied) {
        this.pending = { ...pd, denied: true, proposal: { ...pd.proposal, rows: pd.proposal.rows.filter((r) => rowIds.includes(r.id)) } }
        this.notify()
        return
      }
    }
    const done = this.isDone(p)
    const scopeOf = (row: (typeof rows)[number]) => scopes[row.id] ?? row.scope ?? 'farm'
    const every = rows.filter((x) => scopeOf(x) === 'every')
    const r: ReshapeOn = {
      id: `rs-${(p.reshapes?.length ?? 0) + 1}-${Date.now().toString(36)}`,
      title: pd.proposal.title,
      request: pd.request,
      changes: rows.map((x) => x.change),
      scope: every.length === rows.length ? 'every' : 'farm',
      at: done ? 0 : Math.round(p.clock ?? 0),
      notify,
      before: done ? undefined : { events: p.events, answers: { ...(p.answers ?? {}) }, run: p.run && { ...p.run } },
    }
    p.reshapes = [...(p.reshapes ?? []), r]
    // Every-farm changes join Your flow, replacing one that does the same thing.
    if (every.length) {
      const name = (id: string) => this.reshapeCtx(p).tasks.find((t) => t.id === id)?.name ?? id
      // A screen change replaces the one for the same part and property; a reset takes the part out of it.
      const slot = (c: Change) => (isUi(c) ? `ui:${c.el}:${propOf(c)}` : key(c))
      const resets = new Set(every.flatMap((x) => (x.change.kind === 'uiReset' ? [x.change.el] : [])))
      const kept = this.flow.filter((f) => !(isUi(f.change) && resets.has(f.change.el)))
      const adds: FlowItem[] = every.filter((x) => x.change.kind !== 'uiReset').map((x, i) => ({ id: `fl-${Date.now().toString(36)}-${i}`, change: x.change, label: x.label, short: shortOf(x.change, name), on: true, from: r.id, notify: x.change.kind === 'notifyOn' ? notify : undefined }))
      const keys = new Set(adds.map((a) => slot(a.change)))
      this.flow = [...kept.filter((f) => !keys.has(slot(f.change))), ...adds]
    }
    this.pending = null
    // Run again, or a finished run: the changes start with the next run, and the finished one stays as it was.
    const screenOnly = rows.every((x) => isUi(x.change))
    if (!done && p.approved && !screenOnly) this.rebuild(p)
    const n = rows.length
    const flowNote = every.length ? (every.length === n ? ' It’s in your flow for every new project.' : ` ${every.length} of them ${every.length === 1 ? 'is' : 'are'} in your flow for every new project.`) : ''
    if (screenOnly) this.chatTo(p.id, { from: 'planner', text: `Done: ${rows.map((x) => x.label.charAt(0).toLowerCase() + x.label.slice(1)).join(', ')}${every.length ? ', on every project' : ' on this project'}. Ask me to put it back any time.` })
    else this.chatTo(p.id, { from: 'planner', text: (done ? `${r.title} is on from the next run: ${n} change${n === 1 ? '' : 's'}.` : `${r.title} is on: ${n} change${n === 1 ? '' : 's'}, from now.`) + flowNote })
    // No toast: it would cover the plots. The new chip carries Undo for a few seconds instead.
    this.fresh = { id: r.id, until: Date.now() + Store.FRESH_MS }
    setTimeout(() => this.notify(), Store.FRESH_MS + 50)
    if (pd.wasPlaying && !done) this.play()
    this.notify()
    this.persist()
  }

  // Turn a change off. The latest one comes off exactly: the run goes back to what it was before it.
  undoChanges(id: string) {
    const p = this.project()
    const list = p?.reshapes ?? []
    const i = list.findIndex((r) => r.id === id)
    if (!p || i < 0) return
    const r = list[i]
    p.reshapes = list.filter((x) => x.id !== id)
    // Undo takes back what it added to Your flow too.
    this.flow = this.flow.filter((f) => f.from !== id)
    if (i === list.length - 1 && r.before) {
      const keep = new Set(r.before.events.filter((e) => e.type === 'ask').map((e) => (e.type === 'ask' ? e.id : '')))
      const answers = { ...r.before.answers }
      for (const [k, v] of Object.entries(p.answers ?? {})) if (keep.has(k)) answers[k] = v
      p.events = r.before.events
      p.answers = answers
      p.run = r.before.run
      // An answer you gave since, different from the old run's own, moves the run on from there as usual.
      const differs = Object.entries(answers).some(([k, v]) => {
        const rec = p.events.find((e) => e.type === 'answer' && e.id === k)
        return rec && rec.type === 'answer' && rec.choice !== v
      })
      if (differs) this.rebuild(p)
      this.setSpeed(p.events)
    } else if (p.approved && !this.isDone(p)) this.rebuild(p)
    if (this.fresh?.id === id) this.fresh = null
    this.chatTo(p.id, { from: 'planner', text: `${r.title} is off. This project runs as it did before.` })
    this.notify()
    this.persist()
  }

  // Your flow, from Settings: turn an item off (new farms start without it) or take it out.
  setFlowOn(id: string, on: boolean) {
    this.flow = this.flow.map((f) => (f.id === id ? { ...f, on } : f))
    this.notify()
    this.persist()
  }
  removeFlow(id: string) {
    this.flow = this.flow.filter((f) => f.id !== id)
    this.notify()
    this.persist()
  }

  // A stage alert for each release moment the clock just passed: 10%, a rollback, 10% again, everyone.
  private stagesPassed(p: Project, from: number, to: number) {
    const how = (p.reshapes ?? []).find((r) => r.changes.some((c) => c.kind === 'notifyOn'))?.notify
    if (!how || to <= from) return
    // In-app, the stages a skip jumped past share one message, so none is lost.
    const said: string[] = []
    for (const e of p.events) {
      if (e.type !== 'deploy' || e.t <= from || e.t > to) continue
      const again = e.stage === '10%' && p.events.some((x) => x.type === 'deploy' && x.stage === 'rollback' && x.t < e.t)
      const text = e.stage === 'rollback' ? 'Rolled back' : e.stage === '100%' ? 'Live for everyone' : again ? 'Live for 10% again' : 'Live for 10% of users'
      if (how === 'desktop' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(`${p.name}: ${text}`, { body: e.reason ?? 'The rollout moved to its next stage.', tag: `${p.id}-${e.t}` })
        } catch {
          said.push(text)
        }
      } else said.push(text)
    }
    if (said.length) this.toast = { id: Date.now(), text: `${p.name}: ${said.join(', then ')}` }
  }

  // No two farms share a name: "Support assistant", then "Support assistant 2".
  private uniqueName(name: string, id: string) {
    const taken = new Set(this.projects.filter((x) => x.id !== id).map((x) => x.name))
    if (!taken.has(name)) return name
    let n = 2
    while (taken.has(`${name} ${n}`)) n++
    return `${name} ${n}`
  }

  newProject(goal: string): Project {
    // Two farms made in the same millisecond still get their own ids.
    let id = `own-${Date.now().toString(36)}`
    while (this.project(id)) id += 'x'
    // It belongs to an area, and starts with that area's budget as its spend limit.
    const area = areaFor(goal)
    const p: Project = { id, name: 'New project', goal, kind: 'own', events: [{ t: 0, type: 'goal', text: goal }], approved: false, planning: true, level: 'matters', autonomy: { ...AUTONOMY_PRESETS.matters }, area, spendLimit: this.budgets[area] }
    // A new farm starts with Your flow.
    const flow = this.flow.filter((f) => f.on)
    if (flow.length)
      p.reshapes = [{ id: `rs-flow-${Date.now().toString(36)}`, title: 'Your flow', request: 'Your flow', changes: flow.map((f) => f.change), scope: 'every', at: 0, notify: flow.find((f) => f.notify)?.notify, flow: flow.map((f) => f.short) }]
    // The sample stays, whatever you plan next; a farm of your own gets a name of its own (see setPlan).
    this.projects = [...this.projects, p]
    this.open(id)
    return p
  }

  // An area's budget per project. Projects still on the old budget follow it; one given its own limit keeps it.
  setBudget(area: string, usd: number) {
    const was = this.budgets[area]
    if (!(usd > 0) || usd === was) return
    this.budgets = { ...this.budgets, [area]: usd }
    for (const p of this.projects) if ((p.area ?? areaFor(p.goal)) === area && (p.spendLimit === undefined || p.spendLimit === was)) p.spendLimit = usd
    this.notify()
  }

  setHomeView(v: 'mine' | 'team') {
    this.homeView = v
    this.notify()
  }

  // Open a teammate's simulated project where it stands: at the moment the team view points to.
  openTeam(id: string) {
    const m = MATES.find((x) => x.id === id)
    if (!m) return this.open(id)
    let p = this.project(id)
    if (!p) {
      const events = structuredClone(mateEvents(m))
      p = { id, name: m.name, goal: m.goal, kind: 'sample', owner: m.owner, area: m.area, spendLimit: this.budgets[m.area], events, approved: true, level: 'matters', autonomy: { ...AUTONOMY_PRESETS.matters } }
      this.projects = [...this.projects, p]
      this.startRun(p)
      const snap = snapAt(p.events, m.at)
      p.clock = snap.t
      p.answers = snap.answers
    }
    this.open(id)
  }

  setPlan(id: string, name: string, farmers: FarmerSetup[], tasks: PlanTask[], estimate: Estimate, singleAgentEstimate?: Estimate) {
    const p = this.project(id)
    if (!p) return
    p.name = this.uniqueName(name, id)
    p.planning = false
    p.error = undefined
    // Limits at or above what each farmer spends on the plan's own path.
    const fitted = fitLimits({ goal: p.goal, farmers, tasks, estimate, singleAgentEstimate })
    p.events = [
      { t: 0, type: 'goal', text: p.goal },
      ...fitted.map((f) => ({ t: 1, type: 'farmer' as const, ...f })),
      { t: 2, type: 'plan', tasks, estimate, singleAgentEstimate },
    ]
    this.crewSize[id] = new Set(tasks.map((t) => t.farmer)).size
    // Your flow came from another farm: point its task changes at this plan's tasks, and drop what has no match.
    if (p.reshapes?.length) {
      const ids = new Set(tasks.map((t) => t.id))
      const gate = tasks.find((t) => t.gate)?.id
      p.reshapes = p.reshapes.map((r) => ({
        ...r,
        changes: r.changes.flatMap((c): Change[] => (c.kind === 'removeTask' ? (ids.has(c.task) ? [c] : []) : c.kind === 'setDoneWhen' ? (ids.has(c.task) ? [c] : gate ? [{ ...c, task: gate }] : []) : [c])),
      }))
    }
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

  // Notes you sent the crew, by farmer: shown on that farmer's page.
  crewNotes: Record<string, Partial<Record<FarmerId, string[]>>> = {}
  noteFor(id: string, farmer: FarmerId, text: string) {
    const k = (this.crewNotes[id] ??= {})
    k[farmer] = [...(k[farmer] ?? []), text]
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
