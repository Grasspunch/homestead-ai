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

export interface ModelChoice {
  model: string
  agent: string
  label: string
  about: string
  rate: number // cost relative to Claude Opus 5.5
}

export const MODELS: ModelChoice[] = [
// Rates follow Anthropic's list prices per million tokens: Opus $4 in, $20 out; Sonnet $2, $10; Haiku $0.10, $0.50.
  { model: 'Claude Opus 5.5', agent: 'claude-code', label: 'Claude Opus 5.5', about: 'Best at plans, design and judgment', rate: 1 },
  { model: 'Claude Sonnet 5.5', agent: 'claude-code', label: 'Claude Sonnet 5.5', about: 'Everyday coding at half the price', rate: 0.5 },
  { model: 'Claude Haiku 5.5', agent: 'claude-code', label: 'Claude Haiku 5.5', about: 'Checks, routing and shipping, for very little', rate: 0.025 },
]

export const RULES: { id: string; label: string }[] = [
  { id: 'deploy', label: 'May deploy' },
  { id: 'network', label: 'May call production' },
  { id: 'outside', label: 'May write outside its folders' },
  { id: 'install', label: 'May add dependencies' },
]

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

// The farmer as you've set it up: the plan's setup with your changes on top.
export function applyEdit(f: FarmerSetup, e?: KitEdit): FarmerSetup {
  if (!e) return f
  return {
    ...f,
    model: e.model ?? f.model,
    agent: e.agent ?? f.agent,
    context: [...f.context.filter((c) => !e.contextOff.includes(c)), ...e.contextAdd],
    limits: e.limits ?? f.limits,
  }
}
