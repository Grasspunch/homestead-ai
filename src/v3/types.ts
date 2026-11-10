// The whole model: a project is a farm, a task is a plot, an agent is a farmer.
// Everything here is plain data so a farm can be saved and picked up after a refresh.

export type Kind = 'research' | 'writing' | 'review' | 'scheduling' | 'other'

/** What a farmer may use. `send` covers anything outward: email, posting, publishing. */
export type ToolId = 'web' | 'files' | 'write' | 'send'

export interface Tint {
  body: string
  shade: string
}

export interface Template {
  id: string
  name: string
  /** One line the planner reads when choosing who does what. */
  does: string
  instructions: string
  tools: ToolId[]
  tint: Tint | null
  builtin?: boolean
}

export interface Rule {
  id: string
  text: string
  /** Set when the rule came from "always allow": asks with this key are answered for you. */
  allow?: string
}

export interface Farmer {
  id: string
  templateId: string
  name: string
  does: string
  instructions: string
  tools: ToolId[]
  rules: Rule[]
  tint: Tint | null
  tokens: number
  cost: number
  /** Still only proposed by the plan. */
  proposed?: boolean
}

export type StepStatus = 'todo' | 'doing' | 'done' | 'failed'

export interface Step {
  name: string
  status: StepStatus
  /** One line on what happened in this step. */
  summary?: string
  content?: string
  tokens?: number
  cost?: number
  ms?: number
  startedAt?: number
  /** True when the text came from the built-in stand-in, not a live agent. */
  practice?: boolean
}

export type PlotStatus =
  | 'staked' // planned, or waiting on another plot
  | 'working'
  | 'asking' // stopped at a checkpoint
  | 'ready' // finished, waiting for you to accept it
  | 'failed'

export interface Plot {
  id: string
  name: string
  brief: string
  kind: Kind
  farmerId: string | null
  /** Plots that must be accepted first. */
  needs: string[]
  steps: Step[]
  status: PlotStatus
  /** The outward action this task ends with, if any. */
  irreversible: { action: string; audience: string } | null
  /** Why the head farmer thinks this one is expensive, if it does. */
  costly: string | null
  costOk?: boolean
  undoOk?: boolean
  fileIds: string[]
  notes: string[]
  sentBack: number
  paused?: boolean
  error?: string
  /** For review plots: which plot's output is being checked. */
  reviews?: string | null
  slot: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
  /** Short flash after you accept or send back, for the farmer's emote. */
  flash?: { what: 'hearts' | 'down'; until: number }
}

export type AskReason = 'undo' | 'cost' | 'broken' | 'odd' | 'disagree'

export interface AskOption {
  id: string
  label: string
  primary?: boolean
}

export interface Ask {
  id: string
  reason: AskReason
  farmerId: string | null
  plotIds: string[]
  text: string
  /** Extra detail you can open, such as the post about to be sent. */
  detail?: string
  options: AskOption[]
  /** If set, the ask offers "Always allow ...", and ticking it adds a rule with this key. */
  allow?: { key: string; label: string }
  /** For disagreements: the two positions. */
  sides?: { who: string; says: string }[]
  createdAt: number
}

export interface OutputVersion {
  text: string
  at: number
  by: string
}

export interface Output {
  id: string
  plotId: string
  name: string
  kind: Kind
  by: string
  checkedBy: string
  at: number
  cost: number
  versions: OutputVersion[]
  /** Set for results laid by an always-on agent. */
  egg?: boolean
}

export interface FileDoc {
  id: string
  name: string
  text: string
  sourceId: string
}

export interface Source {
  id: string
  kind: 'files' | 'github'
  name: string
  status: 'connecting' | 'ok' | 'expired'
  /** Time new data last arrived, for the milk bottle. */
  freshAt?: number
  color: 'brown' | 'light' | 'pink'
}

/** An always-on agent: runs its job on a timer and lays an egg (a result) each time. */
export interface Hen {
  id: string
  name: string
  brief: string
  everyMin: number
  farmerId: string | null
  runs: number
  lastRunAt?: number
  running?: boolean
}

export interface LogEntry {
  at: number
  who: string
  text: string
}

export type Stage = 'planning' | 'clarify' | 'plan' | 'running'

export interface Clarify {
  q: string
  why: string
  options: string[]
}

export interface Farm {
  id: string
  name: string
  goal: string
  house: number
  stage: Stage
  clarify: Clarify | null
  clarifyAnswer: string | null
  planNote: string | null
  planError: string | null
  estimate: string | null
  farmers: Farmer[]
  plots: Plot[]
  asks: Ask[]
  outputs: Output[]
  files: FileDoc[]
  sources: Source[]
  hens: Hen[]
  log: LogEntry[]
  paused: boolean
  /** Total tokens and dollars, including the head farmer's planning. */
  tokens: number
  cost: number
  practice: boolean
  createdAt: number
  nextSlot: number
}

export interface World {
  farms: Farm[]
  templates: Template[]
  openFarmId: string | null
}

/** What the picture shows above a farmer's head. */
export type Emote =
  | 'alert'
  | 'q'
  | 'notes'
  | 'zzz'
  | 'check'
  | 'x'
  | 'hearts'
  | 'coin'
  | 'down'
  | 'up'
  | 'read'
  | 'sweat'
  | 'dizzy'
  | 'angry'
  | 'dots'
