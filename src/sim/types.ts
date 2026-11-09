// Shared types for the Homestead AI simulation.
// Work concepts keep their names (quest, task, subtask); the farm is how they are drawn.

export type RoleId = 'researcher' | 'writer' | 'reviewer' | 'scheduler'
export type ReasonLabel = 'Cost' | 'Risk' | 'Irreversible' | 'Failure' | 'Anomaly'
export type CropKind = 'wheat' | 'carrot' | 'cabbage' | 'tulip' | 'pumpkin'
export type Phase = 'brief' | 'clarify' | 'plan' | 'grow' | 'harvest'
export type Flag =
  | 'factsReady'
  | 'outlineDone'
  | 'draftWritten'
  | 'factcheckDone'
  | 'dateUsed'
  | 'dateResolved'
  | 'replanApplied'
  | 'invitesSent'
  | 'seedSaved'

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
  details: { reasoning: string; sources: string[]; preview?: string }
  sides?: AskSide[]
  confidence: 'High' | 'Medium' | 'Low'
  provenance: 'live' | 'replay'
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
  taskId?: string
}
