import type { Talk } from './discuss'
// The recorded-run log (see /mnt/project-files/homestead/fresh/run-log-format.md) and the
// state the app derives from it. A live plan and a replayed run share these shapes.

export type FarmerId = 'planner' | 'builder' | 'designer' | 'tester' | 'deployer'
export const FARMER_ORDER: FarmerId[] = ['planner', 'builder', 'designer', 'tester', 'deployer']
export type AskReason = 'cost' | 'risk' | 'irreversible' | 'disagree' | 'anomaly' | 'big'
export type UsageKind = 'read' | 'write' | 'retry'
export type DeployStage = '10%' | '100%' | 'rollback'

export interface Limits {
  usd: number
  minutes: number
}

export interface FarmerSetup {
  id: FarmerId
  label: string
  agent: string // 'claude-code'
  model: string
  context: string[]
  constraints: string[]
  limits: Limits
  why?: string // why the Planner put it on this crew, on this model
  plannedModel?: string // the model the plan priced it on, when you've changed it since
}

export interface PlanTask {
  id: string
  name: string
  farmer: FarmerId
  doneWhen: string
  gate: boolean
}

export interface Estimate {
  usd: number
  minutes: number
}

// What a check rests on: test results, screenshots of the screens, or the rollout's live numbers.
export interface TestResult {
  name: string
  pass: boolean
  ms: number
  error?: string
}
export type Shot = { device: 'phone' | 'desktop'; state: 'ok' | 'overlap' | 'alt' }
// Which captured screen a screenshot shows: the support widget, a checkout form, or a metrics board.
export type Screen = 'chat' | 'app' | 'dash'
export interface Proof {
  kind: 'unit' | 'integration' | 'screens' | 'rollout'
  tests?: TestResult[]
  shots?: Shot[]
  screen?: Screen
}

export interface Metrics {
  // errorRate is a fraction (0.02 is 2%); answerScore is 0..1
  errorRate?: number
  p95ms?: number
  answerScore?: number
  synth?: { pass: number; total: number } // synthetic tests in prod, when the rollout is judged by them
}

export type RunEvent =
  | { t: number; type: 'goal'; text: string }
  | ({ t: number; type: 'farmer' } & FarmerSetup)
  | { t: number; type: 'plan'; tasks: PlanTask[]; estimate: Estimate; singleAgentEstimate?: Estimate; basis?: Estimate } // basis: the Planner's own estimate, which sizes the simulated work
  | { t: number; type: 'task_start'; task: string; farmer: FarmerId }
  | { t: number; type: 'tool'; farmer: FarmerId; task?: string; tool: string; summary: string }
  | { t: number; type: 'usage'; farmer: FarmerId; task?: string; tokensIn: number; tokensOut: number; usd: number; kind?: UsageKind }
  | { t: number; type: 'progress'; task: string; value: number }
  | { t: number; type: 'task_built'; task: string }
  | { t: number; type: 'check'; task: string; by: FarmerId; pass: boolean; notes: string; evidence?: string[]; proof?: Proof }
  | { t: number; type: 'auto_fix'; task?: string; what: string }
  | { t: number; type: 'disagree'; task: string; sides: { farmer: FarmerId; position: string; why?: string }[] }
  | { t: number; type: 'accept'; task: string; by: FarmerId }
  | {
      t: number
      type: 'ask'
      id: string
      farmer: FarmerId
      task?: string
      reason: AskReason
      question: string
      impact?: string
      suggested: string
      alternatives?: string[]
      touches?: string[] // tasks whose code a big change reaches
      files?: number
      limitFor?: FarmerId // a farmer paused at its spend limit
      limitTo?: number // the limit the suggested answer raises it to
      confidence?: Confidence // how sure the farmer is of its suggested answer
      basis?: string // what that rests on, in one short line
      talk?: Talk // a disagreement: both sides and their costs, so you can ask about them
    }
  | { t: number; type: 'answer'; id: string; choice: string; by: 'human' | 'session' }
  | { t: number; type: 'task_ripe'; task: string; evidence?: string[]; summary?: string; change?: string }
  | { t: number; type: 'verify'; task: string; by: FarmerId; pass: boolean; notes?: string }
  | { t: number; type: 'deploy'; stage: DeployStage; url?: string; reason?: string; metrics?: Metrics }
  | { t: number; type: 'monitor'; stage: '10%' | '100%'; metrics: Metrics }
  | { t: number; type: 'replan'; reason: string; tasks: PlanTask[] }
  // You changed the farm by asking the Planner: what it took out and what it changed, from this moment.
  | { t: number; type: 'reshape'; titles: string[]; removed: string[]; skipped: string[]; off: FarmerId[]; owner: Record<string, FarmerId>; doneWhen: Record<string, string>; renamed?: Record<string, string>; synthetics: boolean; everyone: boolean; noReview: boolean }
  // You stopped a task: it stays out of the pull request.
  | { t: number; type: 'stop'; task: string; reason: string }
  | { t: number; type: 'done'; usd: number; minutes: number; asks: number; autoFixes: number; actions: number }

export type Confidence = 'high' | 'medium' | 'low'

export type TaskStatus = 'waiting' | 'growing' | 'checking' | 'wilted' | 'ripe' | 'accepted'

export interface TaskState extends PlanTask {
  status: TaskStatus
  progress: number // 0..1
  usd: number
  tokens: number
  checks: { by: FarmerId; pass: boolean; notes: string; evidence: string[]; proof?: Proof; t: number }[]
  evidence: string[]
  summary?: string
  verified?: boolean
  acceptedBy?: FarmerId | 'you'
  changes?: string[] // what you asked to change when you sent it back, one commit each
  stopped?: string // why it was stopped, when you stopped it
}

export type FarmerState = 'idle' | 'working' | 'stuck' | 'needs' | 'done'

export interface FarmerRun extends FarmerSetup {
  state: FarmerState
  task?: string // the task it is on now
  usd: number
  tokens: number
  lastTool?: string
}

export interface Ask {
  id: string
  farmer: FarmerId
  task?: string
  reason: AskReason
  question: string
  impact?: string
  suggested: string
  alternatives: string[]
  touches?: string[]
  files?: number
  limitFor?: FarmerId
  limitTo?: number
  confidence?: Confidence
  basis?: string
  talk?: Talk
  t: number
  answer?: { choice: string; by: 'human' | 'session' | 'viewer'; t: number }
}

export interface ActivityLine {
  t: number
  farmer?: FarmerId
  task?: string
  text: string
  kind: 'tool' | 'check' | 'fix' | 'ask' | 'answer' | 'deploy' | 'ripe' | 'disagree' | 'info'
}

export interface RunState {
  t: number
  goal: string
  farmers: Record<FarmerId, FarmerRun | undefined>
  tasks: TaskState[]
  estimate?: Estimate
  singleAgentEstimate?: Estimate
  // At the end: one Sonnet 5 agent doing this run's own work alone, with no checker.
  soloActual?: Estimate
  checkUsd?: number // what the checks cost in this run
  asks: Ask[]
  autoFixes: { t: number; task?: string; what: string }[]
  disagreements: { t: number; task: string; sides: { farmer: FarmerId; position: string; why?: string }[] }[]
  usage: { usd: number; tokens: number; byKind: Record<UsageKind, { usd: number; tokens: number }> }
  deploy: { stage: DeployStage; t: number; url?: string; reason?: string; metrics?: Metrics }[]
  monitor: { t: number; stage: '10%' | '100%'; metrics: Metrics }[]
  replans: { t: number; reason: string; added: string[]; removed: string[] }[]
  activity: ActivityLine[]
  done?: { usd: number; minutes: number; asks: number; autoFixes: number; actions: number }
  actions: number
  // The changes you asked the Planner for, once they took effect.
  reshape?: { titles: string[]; skipped: string[]; synthetics: boolean; everyone: boolean; noReview: boolean; off: FarmerId[] }
}

// How often the crew stops for you: each kind of moment either asks you or is handled by the crew.
export type Moment = 'cost' | 'disagree' | 'failed' | 'big' | 'ship' | 'reship'
export type Autonomy = Record<Moment, 'ask' | 'auto'>
export type AutonomyLevel = 'often' | 'matters' | 'undoable'

export const AUTONOMY_PRESETS: Record<AutonomyLevel, Autonomy> = {
  often: { cost: 'ask', disagree: 'ask', failed: 'ask', big: 'ask', ship: 'ask', reship: 'ask' },
  matters: { cost: 'ask', disagree: 'ask', failed: 'auto', big: 'ask', ship: 'ask', reship: 'auto' },
  undoable: { cost: 'auto', disagree: 'auto', failed: 'auto', big: 'ask', ship: 'ask', reship: 'auto' },
}
