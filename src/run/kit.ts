// What each farmer carries: its model, skills, tools and connectors, the files it may read, and its rules.
// The plan gives model, context, rules and limits; skills come from the role. Your changes sit on top.

import type { FarmerId, FarmerSetup } from './types'

export interface KitItem {
  id: string
  name: string
  kind: 'skill' | 'tool' | 'connector'
  about: string
  tokens: number // what it adds to every call, roughly
}

export const SKILLS: Record<FarmerId, KitItem[]> = {
  planner: [
    { id: 'split', name: 'Split a goal into tasks', kind: 'skill', about: 'Turns a goal into checkable tasks with a done-when each', tokens: 1800 },
    { id: 'estimate', name: 'Estimate time and cost', kind: 'skill', about: 'Prices a plan for a crew and for one agent', tokens: 900 },
    { id: 'route', name: 'Route your messages', kind: 'skill', about: 'Hands what you say to the farmer best placed to act', tokens: 700 },
    { id: 'github', name: 'GitHub', kind: 'connector', about: 'Reads issues and pull requests, read only', tokens: 1200 },
  ],
  builder: [
    { id: 'edit', name: 'Edit files', kind: 'tool', about: 'Reads and writes files inside its folders', tokens: 600 },
    { id: 'shell', name: 'Run commands', kind: 'tool', about: 'Runs the build and the tests in a sandbox', tokens: 500 },
    { id: 'search', name: 'Search the code', kind: 'skill', about: 'Finds where something is defined and used', tokens: 800 },
    { id: 'tests', name: 'Write tests first', kind: 'skill', about: 'Writes a failing test before each change', tokens: 1100 },
    { id: 'github', name: 'GitHub', kind: 'connector', about: 'Opens one pull request for the project, one commit per task', tokens: 1200 },
  ],
  designer: [
    { id: 'style', name: 'House style', kind: 'skill', about: 'Your colours, type and voice, from docs/brand.md', tokens: 2400 },
    { id: 'shots', name: 'Screenshot pages', kind: 'tool', about: 'Takes screenshots of a page', tokens: 400 },
    { id: 'figma', name: 'Figma', kind: 'connector', about: 'Reads frames from your design file', tokens: 3000 },
    { id: 'a11y', name: 'Accessibility check', kind: 'skill', about: 'Contrast, labels and keyboard use', tokens: 900 },
  ],
  tester: [
    { id: 'run', name: 'Run tests', kind: 'tool', about: 'Runs unit and end-to-end tests', tokens: 500 },
    { id: 'browser', name: 'Drive a browser', kind: 'tool', about: 'Clicks through the app like a person would', tokens: 700 },
    { id: 'evals', name: 'Answer evals', kind: 'skill', about: 'Scores answers against eval/questions.jsonl', tokens: 1600 },
    { id: 'donewhen', name: 'Check done-when', kind: 'skill', about: 'Checks each task against its done-when, with proof', tokens: 800 },
  ],
  deployer: [
    { id: 'deploy', name: 'Deploy', kind: 'tool', about: 'Ships a build to a share of users', tokens: 500 },
    { id: 'metrics', name: 'Production metrics', kind: 'connector', about: 'Error rate, speed and answer quality', tokens: 1400 },
    { id: 'rollback', name: 'Roll back', kind: 'skill', about: 'Rolls back by itself when errors pass the limit', tokens: 600 },
  ],
}

export type Provider = 'anthropic' | 'openai'

export interface ModelChoice {
  model: string
  agent: 'claude-code' | 'codex'
  provider: Provider
  api: string // the provider's own model id, for direct calls in local dev
  gateway: string // the id on Lovable's AI gateway, for live calls on Lovable
  label: string
  about: string
  rate: number // cost relative to Claude Opus 5.5
}

// The models Lovable's AI gateway offers. Every rate is per token, against Claude Opus 5.5 ($4 in, $20 out per
// million tokens); input and output scale together for each, so one ratio covers both.
// The gateway ids are the provider-prefixed names Lovable's gateway uses. They need checking in Lovable: a wrong
// one fails on screen with the id it tried, and the call is simulated instead.
// GPT-6 Sol is on Lovable's list too, but has no published price here, so it stays out of the picker.
export const MODELS: ModelChoice[] = [
  // Anthropic, per million tokens: Opus 5.5 $4 in, $20 out; Opus 5 $5, $25; Sonnet 5 $2, $10; Haiku 4.5 $1, $5; Fable 5.1 $10, $50.
  { model: 'Claude Opus 5.5', agent: 'claude-code', provider: 'anthropic', api: 'claude-opus-5-5', gateway: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5', about: 'Best at plans, design and judgment', rate: 1 },
  { model: 'Claude Opus 5', agent: 'claude-code', provider: 'anthropic', api: 'claude-opus-5', gateway: 'anthropic/claude-opus-5', label: 'Claude Opus 5', about: 'The previous Opus, at a quarter more', rate: 1.25 },
  { model: 'Claude Sonnet 5', agent: 'claude-code', provider: 'anthropic', api: 'claude-sonnet-5', gateway: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', about: 'Everyday coding and design at half the price', rate: 0.5 },
  { model: 'Claude Haiku 4.5', agent: 'claude-code', provider: 'anthropic', api: 'claude-haiku-4-5', gateway: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', about: 'Quick checks at a quarter of the price', rate: 0.25 },
  { model: 'Claude Fable 5.1', agent: 'claude-code', provider: 'anthropic', api: 'claude-fable-5-1', gateway: 'anthropic/claude-fable-5-1', label: 'Claude Fable 5.1', about: 'The hardest problems, at 2.5 times the price', rate: 2.5 },
  // OpenAI's models in Codex, per million tokens: Astra $10 in, $50 out; Sol $2, $10; Terra $1, $5; Luna $0.10, $0.50.
  { model: 'GPT-6.1 Sol', agent: 'codex', provider: 'openai', api: 'gpt-6.1-sol', gateway: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', about: 'Codex’s default for coding, at Sonnet’s price', rate: 0.5 },
  { model: 'GPT-6.1 Terra', agent: 'codex', provider: 'openai', api: 'gpt-6.1-terra', gateway: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', about: 'Smaller coding jobs at a quarter of the price', rate: 0.25 },
  { model: 'GPT-6 Luna', agent: 'codex', provider: 'openai', api: 'gpt-6-luna', gateway: 'openai/gpt-6-luna', label: 'GPT-6 Luna', about: 'Checks, routing and shipping, for very little', rate: 0.025 },
  { model: 'GPT-6 Astra', agent: 'codex', provider: 'openai', api: 'gpt-6-astra', gateway: 'openai/gpt-6-astra', label: 'GPT-6 Astra', about: 'OpenAI’s most capable, at 2.5 times the price', rate: 2.5 },
]

// The picker groups models by who makes them.
export const MODEL_GROUPS: { label: string; provider: Provider }[] = [
  { label: 'Claude', provider: 'anthropic' },
  { label: 'OpenAI (Codex)', provider: 'openai' },
]

export const modelOf = (name?: string) => MODELS.find((m) => m.model === name)
export const providerOf = (name?: string): Provider => modelOf(name)?.provider ?? 'anthropic'
export const agentName = (agent?: string) => (agent === 'codex' ? 'Codex' : agent === 'claude-code' ? 'Claude Code' : agent ?? '')

export const RULES: { id: string; label: string }[] = [
  { id: 'deploy', label: 'May deploy' },
  { id: 'network', label: 'May call production' },
  { id: 'outside', label: 'May write outside its folders' },
  { id: 'install', label: 'May add dependencies' },
]

// What a path in a farmer's context is, in a few words, when it's a doc rather than code.
export function contextName(path: string): string | undefined {
  if (/brand/i.test(path)) return 'Brand guide'
  if (/docs\/help/i.test(path)) return 'Help docs'
  if (/eval\//i.test(path)) return 'Eval questions'
  if (/pricing\.md$/i.test(path)) return 'Pricing doc'
  if (/schema\.sql$/i.test(path)) return 'Database schema'
  return undefined
}

// A rough token size for a file or folder in its context, so the cost of reading it shows.
export function contextTokens(path: string) {
  let h = 0
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return path.endsWith('/') ? 18_000 + (h % 40_000) : 1_500 + (h % 6_000)
}

export interface KitEdit {
  model?: string
  agent?: string
  off: string[] // skills turned off
  contextOff: string[]
  contextAdd: string[]
  rules: Record<string, boolean>
  limits?: { usd: number; minutes: number }
}

export const emptyEdit = (): KitEdit => ({ off: [], contextOff: [], contextAdd: [], rules: {} })

export function defaultRules(f: FarmerSetup): Record<string, boolean> {
  return { deploy: f.id === 'deployer', network: f.id === 'deployer', outside: false, install: f.id === 'builder' }
}

// The farmer as you've set it up: the plan's setup with your changes on top. Always from what the plan gave it,
// so a path you turn off and on again mid-run comes back. Skills you turned off ride along, so the run sees them.
export function applyEdit(f: FarmerSetup, e?: KitEdit): FarmerSetup {
  if (!e) return f
  const { planContext, skillsOff: _off, ...rest } = f
  const from = planContext ?? f.context
  const context = [...new Set([...from.filter((c) => !e.contextOff.includes(c)), ...e.contextAdd])]
  const same = context.length === from.length && context.every((c, i) => c === from[i])
  return {
    ...rest,
    model: e.model ?? f.model,
    agent: e.agent ?? f.agent,
    context,
    limits: e.limits ?? f.limits,
    ...(same ? {} : { planContext: from }),
    ...(e.off.length ? { skillsOff: [...e.off] } : {}),
  }
}

// Switch a path in a farmer's context on or off, whichever list it was in. On: a path the plan gave it is simply
// not switched off any more, and one you added is added once. Off: a plan path is switched off, and one you added
// leaves the list. Adding a path that is switched off is the same as switching it back on.
export function turnPath(e: KitEdit, path: string, on: boolean, plan: string[]) {
  e.contextOff = e.contextOff.filter((x) => x !== path)
  e.contextAdd = e.contextAdd.filter((x) => x !== path)
  if (on && !plan.includes(path)) e.contextAdd = [...e.contextAdd, path]
  if (!on && plan.includes(path)) e.contextOff = [...e.contextOff, path]
}

// The brand guide in a farmer's context, or the one the project has.
export const brandIn = (paths: string[]) => paths.find((c) => contextName(c) === 'Brand guide')

// Toggles that can't change the run stay on, with why. The first path the plan gives the Builder, Designer or
// Tester is where it works; the Planner's files made a plan that is already made.
const SKILL_LOCKS: Partial<Record<FarmerId, Record<string, string>>> = {
  planner: { split: 'The plan is already split', estimate: 'The plan is already priced', route: 'Your messages reach the crew through it', github: 'Read only. The run doesn’t use it' },
  builder: { edit: 'It writes the code with it', shell: 'It runs the build and the tests with it', github: 'The pull request goes through it' },
  designer: { figma: 'No design file is linked to this project' },
  tester: { run: 'Every check runs through it', donewhen: 'Every check is against a done-when' },
  deployer: { deploy: 'Only the Deployer ships, through this', metrics: 'The 10% rollout is measured with it', rollback: 'Rolling back past 2% is one of its rules' },
}
const HOME: Partial<Record<FarmerId, string>> = { builder: 'It writes its code here', designer: 'It builds its screens here', tester: 'Its tests live here' }

export function lockedPath(farmer: FarmerId, path: string, plan: string[]): string | undefined {
  if (!plan.includes(path)) return undefined // one you added
  if (farmer === 'planner') return 'It made the plan from these'
  if (farmer === 'deployer') return path === 'deploy/' ? 'It ships from here' : 'The release reads its settings from here'
  return plan[0] === path ? HOME[farmer] : undefined
}

export function lockedSkill(farmer: FarmerId, skill: string, context: string[]): { why: string; on: boolean } | undefined {
  if (farmer === 'tester' && skill === 'evals' && !context.some((c) => contextName(c) === 'Eval questions')) return { why: 'No eval questions in its context', on: false }
  const why = SKILL_LOCKS[farmer]?.[skill]
  return why ? { why, on: true } : undefined
}
