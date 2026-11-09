// Shared types for the Homestead AI simulation.
// Work concepts keep their names (quest, task, subtask); the farm is how they are drawn.

export type RoleId = 'backend' | 'frontend' | 'tests' | 'docs' | 'reviewer'
export type ReasonLabel = 'Cost' | 'Risk' | 'Irreversible' | 'Failure' | 'Anomaly'
export type CropKind = 'wheat' | 'carrot' | 'cabbage' | 'tulip' | 'pumpkin'
export type Phase = 'brief' | 'clarify' | 'plan' | 'grow' | 'harvest' | 'ship'
export type Flag =
  | 'callbackReady'
  | 'buttonReady'
  | 'sessionStarted'
  | 'e2eWritten'
  | 'sessionV2'
  | 'unitFixed'
  | 'replanApplied'
  | 'seedSaved'

export type Dir = 'down' | 'up' | 'left' | 'right'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Subtask {
  id: string
  name: string
  secs: number
  energy: number // tokens
  actions: number // agent actions (tool calls, reads, writes) this subtask takes
  needs?: Flag[]
  sets?: Flag[]
  progress: number // 0..1
  started: boolean
  done: boolean
  emitted: number // agent actions already written to the ledger
  addedByReplan?: boolean
}

export interface Pest {
  id: string
  kind: 'beetle' | 'aphid' | 'moth'
  label: string
  size: number // 0..1, shrinks as the fix lands
  tile: { x: number; y: number }
}

export interface Task {
  id: string
  name: string
  crop: CropKind
  plot: Rect
  budget: number
  used: number
  assignee: RoleId
  proposedAssignee: RoleId
  proposalNote?: string
  subtasks: Subtask[]
  signposts: string[]
  dry: boolean
  pests: Pest[]
}

export interface Farmhand {
  id: RoleId
  role: string
  name: string
  color: string
  colorDark: string
  tools: string[]
  almanac: string[]
  seeds: string[]
  context: string[]
  // world state (tiles)
  x: number
  y: number
  home: { x: number; y: number }
  path: { x: number; y: number }[]
  facing: 1 | -1
  dir: Dir // which way it faces when standing
  look: 'left' | 'right' | null // a short glance while it waits
  nextShift: number // seconds until the next glance
  shiftLeft: number // seconds the current glance lasts
  fade: number // 1 visible, 0 inside the barn
  inside: boolean
  seed: number // per-farmhand offset so no two move in sync
  chore: { id: string; t: number } | null // what it does once its work is done
  react: number // clock when you last clicked it
  moving: boolean
  status: 'idle' | 'walking' | 'working' | 'waiting' | 'asking' | 'done'
  paused: boolean
  job: Job | null
  interrupts: Job[]
  transcript: string[]
}

export type Job =
  | { kind: 'sub'; taskId: string; subId: string }
  | {
      kind: 'fix'
      taskId: string
      pestId: string
      label: string
      secs: number
      energy: number
      actions: number
      progress: number
      emitted: number
    }

export interface AskOption {
  key: string // keyboard key
  label: string
  value: string
  recommended?: boolean
  kind?: 'approve' | 'deny' | 'alt'
}

export interface AskSide {
  title: string
  who: string
  source: string
  quote: string
}

export interface Ask {
  id: string
  label: ReasonLabel
  from: RoleId | 'head'
  fromName: string
  taskId: string
  question: string
  impact: string[]
  options: AskOption[]
  confirm?: string // Irreversible second confirm text
  confirmLabel?: string // the confirm button, when it says more than the approve option
  confirmList?: string[] // what the confirm commits to, one line each
  link?: { label: string; out: string } // a page the ask points at, opened in the panel
  details: { reasoning: string; sources: string[]; preview?: string }
  sides?: AskSide[]
  confidence: 'High' | 'Medium' | 'Low'
  basis?: string // what the confidence rests on, in one line
  provenance: 'live' | 'replay' | 'sim' // live or recorded model call, or a scripted step
  status: 'open' | 'confirming' | 'resolved'
  answer?: string
  answerLabel?: string
  raisedAt: number
}

export interface Replan {
  id: string
  title: string
  lines: { op: '+' | '-' | '~'; text: string }[]
  status: 'open' | 'applied'
}

export interface LogEntry {
  id: number
  t: number
  who: string
  text: string
  kind: 'info' | 'ask' | 'answer' | 'auto' | 'pest' | 'replan' | 'seed' | 'done' | 'energy'
  taskId?: string
  reason?: string
  traceId?: string
}

export interface Seed {
  file: string
  title: string
  body: string
  from: string
  isNew?: boolean
}

export interface Toast {
  id: number
  text: string
  t: number
}

// Every agent action and every human decision lands in the ledger.
// All numbers on screen (actions, energy, "needed you") are computed from it.
export interface LedgerEvent {
  t: number
  who: string
  kind: 'action' | 'human'
  tokens: number
  // live: a real model call in this run; replay: a recorded model call; sim: a scripted step
  src: 'live' | 'replay' | 'sim'
  taskId?: string
}
