// Agent and team templates. An agent template is a farmhand you can reuse; a team template is a crew.
// In the repo each agent is .homestead/agents/<file>.md and each team is .homestead/teams/<file>.toml.
import type { CropKind } from './types'

export type Step = 'brief' | 'clarify' | 'plan' | 'grow' | 'harvest' | 'ship'
export type GateKey = 'shots' | 'unit' | 'integration' | 'e2e' | 'review' | 'security'
export type Perm = 'read' | 'write' | 'run'

export const STEP_NAME: Record<Step, string> = { brief: 'Plant', clarify: 'Plant', plan: 'Plant', grow: 'Grow', harvest: 'Harvest', ship: 'Harvest' }
export const GATE_NAME: Record<GateKey, string> = {
  shots: 'Screenshots',
  unit: 'Unit tests',
  integration: 'Integration tests',
  e2e: 'End-to-end on staging',
  review: 'Agentic review',
  security: 'Security review',
}

export interface AgentTemplate {
  id: string
  file: string // .homestead/agents/<file>.md
  name: string
  does: string
  steps: Step[]
  harness: string
  model: string
  skills: string[] // skill files it loads, by command
  mcp: { server: string; perm: Perm }[]
  gates: GateKey[] // Done-when gates it brings
  asks: string // when it may interrupt you
  instructions: string
  upstream?: boolean // its skills come from the pinned upstream pack below
  style: FieldStyle // how its field looks in the valley
  farmstead?: boolean // reviews the whole crew's work rather than building; it still has a field of its own
}

// An agent template is also a field: its fence, its farmhand's colours and its crop.
export interface FieldStyle {
  fence: string
  body: string // farmhand tint
  shade: string
  crop: CropKind
}

export interface TeamTemplate {
  id: string
  file: string // .homestead/teams/<file>.toml
  name: string
  line: string // one line about who it suits
  members: { agent: string; steps: Step[] }[]
  gates: GateKey[]
  budget: number
  sandbox?: string[] // guardrail skills that switch the Sandbox rules on
  staffs: Record<string, string> // which agent template takes each of the plan's roles, by role id
  upstream?: boolean
  custom?: boolean
}

// The upstream skill pack behind the Full-cycle crew, pinned to a release. Checked against the repo:
// every command below has a SKILL.md at this version.
export const UPSTREAM = {
  repo: 'github.com/garrytan/gstack',
  version: '1.98.0',
  licence: 'MIT License. Copyright (c) 2026 Garry Tan.',
  notice: 'Skills from gstack 1.98.0 (github.com/garrytan/gstack), used under the MIT License. Copyright (c) 2026 Garry Tan.',
}

const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const HAIKU = 'claude-haiku-5-5'

const BASE: Omit<AgentTemplate, 'style'>[] = [
  // ---- Feature crew --------------------------------------------------------
  {
    id: 'head-farmer',
    file: 'head-farmer',
    farmstead: true,
    name: 'Head farmer',
    does: 'Plans, assigns, asks you',
    steps: ['brief', 'clarify', 'plan', 'grow', 'harvest', 'ship'],
    harness: 'claude-code',
    model: OPUS,
    skills: [],
    mcp: [{ server: 'github', perm: 'read' }],
    gates: [],
    asks: 'Relays every ask from the crew. Asks itself only to change the plan.',
    instructions: 'Turn the brief into tasks, one plot each. Staff every task from the crew, attach only the files, skills and tools it needs, and propose its Done-when gates. Ask two questions at most before planning.',
  },
  {
    id: 'backend',
    file: 'backend',
    name: 'Backend',
    does: 'Server code',
    steps: ['grow'],
    harness: 'claude-code',
    model: SONNET,
    skills: ['api-conventions'],
    mcp: [{ server: 'github', perm: 'write' }],
    gates: ['unit', 'integration'],
    asks: 'When a gate fails twice, or a change needs a new permission.',
    instructions: 'Build the server side of the task. Write unit tests with the change. Never log tokens or secrets.',
  },
  {
    id: 'frontend',
    file: 'frontend',
    name: 'Frontend',
    does: 'UI code',
    steps: ['grow'],
    harness: 'claude-code',
    model: SONNET,
    skills: ['design-system'],
    mcp: [{ server: 'github', perm: 'write' }],
    gates: ['shots', 'unit'],
    asks: 'When a gate fails twice, or another team owns what it needs.',
    instructions: 'Build the UI for the task with the design system. Take a screenshot of every state you change.',
  },
  {
    id: 'tests',
    file: 'tests',
    name: 'Tests',
    does: 'Writes and runs tests',
    steps: ['grow'],
    harness: 'codex',
    model: 'harness default',
    skills: ['testing-guide'],
    mcp: [{ server: 'playwright', perm: 'run' }],
    gates: ['integration', 'e2e'],
    asks: 'When staging disagrees with the code, or a test is flaky twice.',
    instructions: 'Write the end-to-end tests for the task and run them on staging. Report what failed, with the request and the response.',
  },
  {
    id: 'docs',
    file: 'docs',
    name: 'Docs',
    does: 'Guides and changelogs',
    steps: ['grow'],
    harness: 'claude-code',
    model: HAIKU,
    skills: ['docs-style'],
    mcp: [{ server: 'github', perm: 'write' }],
    gates: [],
    asks: 'Never. It logs what it decided.',
    instructions: 'Write the setup guide and the changelog entry. Every step a person must do by hand gets its own numbered step.',
  },
  {
    id: 'reviewer',
    file: 'reviewer',
    name: 'Reviewer',
    does: 'Agentic review, writes no code',
    steps: ['harvest'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['review-rubric'],
    mcp: [{ server: 'github', perm: 'read' }],
    gates: ['review'],
    asks: 'Never. A blocking finding fails the gate and goes back to the builder.',
    instructions: 'Review the whole diff against the rubric and the attached skills. Block only on bugs, security and broken rules. Everything else is a note.',
  },
  // ---- Full-cycle crew (upstream skills) ----------------------------------------
  {
    id: 'ceo',
    file: 'ceo',
    farmstead: true,
    name: 'CEO',
    does: 'Challenges the scope before you approve',
    steps: ['clarify', 'plan'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['/office-hours', '/plan-ceo-review'],
    mcp: [],
    gates: [],
    asks: 'Only when it wants to change the goal.',
    instructions: 'Run office hours on the brief, then the CEO plan review on the plan. Hold scope unless the goal itself is wrong; then ask.',
    upstream: true,
  },
  {
    id: 'eng-manager',
    file: 'eng-manager',
    farmstead: true,
    name: 'Eng manager',
    does: 'Locks the architecture and the test plan',
    steps: ['plan'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['/plan-eng-review'],
    mcp: [{ server: 'github', perm: 'read' }],
    gates: ['unit', 'integration'],
    asks: 'Never. Its test plan becomes the Done-when gates you approve with the plan.',
    instructions: 'Run the eng plan review. Turn its test plan into each task’s Done-when gates.',
    upstream: true,
  },
  {
    id: 'designer',
    file: 'designer',
    farmstead: true,
    name: 'Designer',
    does: 'Rates the design plan, UI tasks only',
    steps: ['plan'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['/plan-design-review'],
    mcp: [{ server: 'figma', perm: 'read' }],
    gates: ['shots'],
    asks: 'Never. Its ratings go on the task.',
    instructions: 'Run the design plan review on every UI task against the design system skill.',
    upstream: true,
  },
  {
    id: 'staff-engineer',
    file: 'staff-engineer',
    farmstead: true,
    name: 'Staff engineer',
    does: 'Is the Agentic review gate',
    steps: ['harvest'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['/review'],
    mcp: [{ server: 'github', perm: 'read' }],
    gates: ['review'],
    asks: 'Never. A blocking finding fails the gate.',
    instructions: 'Run the review on the whole diff. Every weakened test or suppression is named in the gate output.',
    upstream: true,
  },
  {
    id: 'security-officer',
    file: 'security-officer',
    farmstead: true,
    name: 'Security officer',
    does: 'Adds a Security review gate',
    steps: ['harvest'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['/cso'],
    mcp: [{ server: 'github', perm: 'read' }],
    gates: ['security'],
    asks: 'When a finding needs a secret rotated.',
    instructions: 'Run the security audit on the diff. A supported high finding fails the Security review gate.',
    upstream: true,
  },
  {
    id: 'qa',
    file: 'qa',
    farmstead: true,
    name: 'QA',
    does: 'Produces the Screenshots and End-to-end gates',
    steps: ['grow', 'harvest'],
    harness: 'claude-code',
    model: SONNET,
    skills: ['/qa'],
    mcp: [{ server: 'playwright', perm: 'run' }],
    gates: ['shots', 'e2e'],
    asks: 'When a gate fails twice.',
    instructions: 'Run QA on staging. Reproduce each bug, write the failing regression, then hand the fix to the builder.',
    upstream: true,
  },
  {
    id: 'release-manager',
    file: 'release-manager',
    farmstead: true,
    name: 'Release manager',
    does: 'Runs merge, deploy, the canary and the rollback',
    steps: ['ship'],
    harness: 'claude-code',
    model: SONNET,
    skills: ['/ship', '/land-and-deploy', '/canary'],
    mcp: [
      { server: 'github', perm: 'write' },
      { server: 'sentry', perm: 'read' },
    ],
    gates: [],
    asks: 'Before every deploy to production. Never to roll back.',
    instructions: 'Merge when approved, watch CI on main, deploy behind the canary, and roll back on its own when a health check fails.',
    upstream: true,
  },
  {
    id: 'tech-writer',
    file: 'tech-writer',
    name: 'Technical writer',
    does: 'Keeps the docs in step with the change',
    steps: ['grow'],
    harness: 'claude-code',
    model: HAIKU,
    skills: ['/document-release'],
    mcp: [{ server: 'github', perm: 'write' }],
    gates: [],
    asks: 'Never.',
    instructions: 'Audit the changed behaviour against the docs and update the guide and the changelog.',
    upstream: true,
  },
  {
    id: 'retro',
    file: 'retro',
    farmstead: true,
    name: 'Retro',
    does: 'Writes the run’s Lessons saved',
    steps: ['ship'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['/retro', '/learn'],
    mcp: [],
    gates: [],
    asks: 'Never.',
    instructions: 'After Ship, run the retro on the run and save what the crew learned as lessons.',
    upstream: true,
  },
  {
    id: 'messaging',
    file: 'messaging',
    name: 'Messaging',
    does: 'Reminder texts and emails',
    steps: ['grow'],
    harness: 'claude-code',
    model: SONNET,
    skills: ['message-templates'],
    mcp: [
      { server: 'sms-provider', perm: 'run' },
      { server: 'github', perm: 'write' },
    ],
    gates: ['unit', 'integration'],
    asks: 'Before it texts a real phone number outside staging.',
    instructions: 'Build the reminder texts and emails. Send through the SMS provider tool, only to test numbers on staging. Every message says how to cancel or reply stop.',
  },
  // ---- Bug fix ------------------------------------------------------------------
  {
    id: 'investigator',
    file: 'investigator',
    name: 'Investigator',
    does: 'Finds the root cause first',
    steps: ['plan', 'grow'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['debugging'],
    mcp: [
      { server: 'sentry', perm: 'read' },
      { server: 'github', perm: 'read' },
    ],
    gates: [],
    asks: 'When it can’t reproduce the bug.',
    instructions: 'Reproduce the failing behaviour, find the root cause and write it on the task before anyone changes code.',
  },
  {
    id: 'fixer',
    file: 'fixer',
    name: 'Fixer',
    does: 'Fixes the cause, with a regression test',
    steps: ['grow'],
    harness: 'claude-code',
    model: SONNET,
    skills: ['api-conventions'],
    mcp: [{ server: 'github', perm: 'write' }],
    gates: ['unit'],
    asks: 'When the fix needs a change another team owns.',
    instructions: 'Fix the root cause the investigator found. The regression test fails before the fix and passes after.',
  },
  // ---- Design pass ----------------------------------------------------------------
  {
    id: 'ui-designer',
    file: 'ui-designer',
    name: 'Designer',
    does: 'Designs the states before code',
    steps: ['plan', 'grow'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['design-system'],
    mcp: [{ server: 'figma', perm: 'read' }],
    gates: ['shots'],
    asks: 'When the brief and the design system disagree.',
    instructions: 'Lay out every state of the change with the design system, then hand Frontend a screenshot target per state.',
  },
  {
    id: 'design-reviewer',
    file: 'design-reviewer',
    name: 'Reviewer (design rubric)',
    does: 'Reviews screenshots against the rubric',
    steps: ['harvest'],
    harness: 'claude-code',
    model: OPUS,
    skills: ['design-rubric'],
    mcp: [{ server: 'github', perm: 'read' }],
    gates: ['review', 'shots'],
    asks: 'Never. A failed rubric line fails the gate.',
    instructions: 'Review every screenshot against the design rubric: spacing, type, contrast and states. Block only on rubric failures.',
  },
]

// One style per agent template. Fences stay in wood and muted tones: red is kept for failure, blue for outbound.
const STYLE: Record<string, FieldStyle> = {
  'head-farmer': { fence: '#a8774a', body: '#f3f2c0', shade: '#ddd5de', crop: 'pumpkin' },
  messaging: { fence: '#7d9a62', body: '#d3e8b6', shade: '#98b679', crop: 'tulip' },
  backend: { fence: '#6f9e8f', body: '#9fd8c5', shade: '#5fa894', crop: 'wheat' },
  frontend: { fence: '#b97f9f', body: '#f2c6de', shade: '#c98bb0', crop: 'carrot' },
  tests: { fence: '#7f8fb5', body: '#b9cdf5', shade: '#7d93c9', crop: 'cabbage' },
  docs: { fence: '#b8955a', body: '#f6d58e', shade: '#c9a253', crop: 'tulip' },
  reviewer: { fence: '#8e78ad', body: '#d9c2f0', shade: '#9d84bd', crop: 'pumpkin' },
  ceo: { fence: '#a0603f', body: '#f4c7a8', shade: '#c98f6b', crop: 'pumpkin' },
  'eng-manager': { fence: '#6f8597', body: '#c6d8ea', shade: '#8aa3bd', crop: 'wheat' },
  designer: { fence: '#b0768f', body: '#f7cfe0', shade: '#cf94ae', crop: 'tulip' },
  'staff-engineer': { fence: '#7d6aa0', body: '#d4c6ec', shade: '#9a87bf', crop: 'pumpkin' },
  'security-officer': { fence: '#6d7f5a', body: '#cbd9b4', shade: '#93a57a', crop: 'cabbage' },
  qa: { fence: '#8592ad', body: '#c3d3f2', shade: '#8598c4', crop: 'cabbage' },
  'release-manager': { fence: '#a88540', body: '#f2dda0', shade: '#c4a85e', crop: 'wheat' },
  'tech-writer': { fence: '#9c8a63', body: '#efe0b8', shade: '#c2ad7c', crop: 'tulip' },
  retro: { fence: '#8a7a6a', body: '#e6dccd', shade: '#b5a693', crop: 'carrot' },
  investigator: { fence: '#6f8a9a', body: '#c8dde6', shade: '#8fa9b6', crop: 'carrot' },
  fixer: { fence: '#5f9483', body: '#a8dccb', shade: '#68ab97', crop: 'wheat' },
  'ui-designer': { fence: '#a86f86', body: '#f5d6e4', shade: '#d39db5', crop: 'tulip' },
  'design-reviewer': { fence: '#8a74a8', body: '#dccbf2', shade: '#a08bc2', crop: 'pumpkin' },
}
const PLAIN: FieldStyle = { fence: '#a8774a', body: '#f3f2c0', shade: '#ddd5de', crop: 'wheat' }

export const AGENT_TEMPLATES: AgentTemplate[] = BASE.map((a) => ({ ...a, style: STYLE[a.id] ?? PLAIN }))

const FEATURE_STAFF: Record<string, string> = { backend: 'backend', frontend: 'frontend', messaging: 'messaging', tests: 'tests', docs: 'backend', reviewer: 'reviewer' }

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: 'feature',
    file: 'feature-crew',
    name: 'Feature crew',
    line: 'A feature across the stack.',
    members: [
      { agent: 'head-farmer', steps: ['brief', 'clarify', 'plan', 'grow', 'harvest', 'ship'] },
      { agent: 'frontend', steps: ['grow'] },
      { agent: 'backend', steps: ['grow'] },
      { agent: 'messaging', steps: ['grow'] },
      { agent: 'tests', steps: ['grow', 'harvest'] },
      { agent: 'reviewer', steps: ['harvest'] },
    ],
    gates: ['shots', 'unit', 'integration', 'e2e', 'review'],
    budget: 120_000,
    staffs: FEATURE_STAFF,
  },
  {
    id: 'gstack',
    file: 'gstack',
    name: 'Full-cycle crew',
    line: 'Reviews from a CEO, eng manager, designer, security and QA at every step. Based on gstack.',
    members: [
      { agent: 'head-farmer', steps: ['brief', 'clarify', 'plan', 'grow', 'harvest', 'ship'] },
      { agent: 'ceo', steps: ['clarify', 'plan'] },
      { agent: 'eng-manager', steps: ['plan'] },
      { agent: 'designer', steps: ['plan'] },
      { agent: 'frontend', steps: ['grow'] },
      { agent: 'backend', steps: ['grow'] },
      { agent: 'messaging', steps: ['grow'] },
      { agent: 'qa', steps: ['grow', 'harvest'] },
      { agent: 'staff-engineer', steps: ['harvest'] },
      { agent: 'security-officer', steps: ['harvest'] },
      { agent: 'release-manager', steps: ['ship'] },
      { agent: 'retro', steps: ['ship'] },
    ],
    gates: ['shots', 'unit', 'integration', 'e2e', 'review', 'security'],
    budget: 180_000,
    sandbox: ['/careful', '/guard'],
    staffs: { frontend: 'frontend', backend: 'backend', messaging: 'messaging', tests: 'qa', docs: 'tech-writer', reviewer: 'staff-engineer' },
    upstream: true,
  },
  {
    id: 'bug-fix',
    file: 'bug-fix',
    name: 'Bug fix',
    line: 'One failing behaviour, root cause first.',
    members: [
      { agent: 'head-farmer', steps: ['brief', 'clarify', 'plan', 'grow', 'harvest', 'ship'] },
      { agent: 'investigator', steps: ['plan', 'grow'] },
      { agent: 'fixer', steps: ['grow'] },
      { agent: 'tests', steps: ['grow'] },
      { agent: 'reviewer', steps: ['harvest'] },
    ],
    gates: ['unit', 'integration', 'review'],
    budget: 60_000,
    staffs: { backend: 'fixer', frontend: 'fixer', messaging: 'fixer', tests: 'tests', docs: 'investigator', reviewer: 'reviewer' },
  },
  {
    id: 'design-pass',
    file: 'design-pass',
    name: 'Design pass',
    line: 'UI changes with screenshot gates.',
    members: [
      { agent: 'head-farmer', steps: ['brief', 'clarify', 'plan', 'grow', 'harvest', 'ship'] },
      { agent: 'ui-designer', steps: ['plan', 'grow'] },
      { agent: 'frontend', steps: ['grow'] },
      { agent: 'design-reviewer', steps: ['harvest'] },
    ],
    gates: ['shots', 'unit', 'review'],
    budget: 80_000,
    staffs: { backend: 'frontend', frontend: 'frontend', messaging: 'frontend', tests: 'ui-designer', docs: 'ui-designer', reviewer: 'design-reviewer' },
  },
]

// The demo runs on the Feature crew: a field for each of its five agents, the head farmer at the farmstead.
export const DEFAULT_TEAM = 'feature'
export const HEAD_FARMER = 'head-farmer'

// The crews the neighbouring valleys run, in scenario order: the neighbour first, then the other projects.
// By position, so it holds whatever the valleys are called.
export const NEIGHBOUR_CREWS = ['Feature crew', 'Bug fix', 'Design pass']

export function agentTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((a) => a.id === id)
}

export function teamTemplate(id: string, custom: TeamTemplate[] = []): TeamTemplate | undefined {
  return [...TEAM_TEMPLATES, ...custom].find((t) => t.id === id)
}

// A team template is a valley layout: its fields, in order, one per agent. Only the head farmer works from the farmstead.
export interface Field {
  index: number
  agent: AgentTemplate
  steps: Step[]
  style: FieldStyle
}

export function fieldsFor(teamId: string, custom: TeamTemplate[] = []): Field[] {
  const t = teamTemplate(teamId, custom) ?? teamTemplate(DEFAULT_TEAM)!
  return t.members
    .map((m) => ({ m, a: agentTemplate(m.agent) }))
    .filter((x): x is { m: TeamTemplate['members'][number]; a: AgentTemplate } => !!x.a && x.a.id !== HEAD_FARMER)
    .map((x, index) => ({ index, agent: x.a, steps: x.m.steps, style: x.a.style }))
}

export function agentPath(a: AgentTemplate) {
  return `.homestead/agents/${a.file}.md`
}

export function teamPath(t: TeamTemplate) {
  return `.homestead/teams/${t.file}.toml`
}

const q = (s: string) => JSON.stringify(s)
const list = (xs: string[]) => `[${xs.map(q).join(', ')}]`
const kb = (n: number) => `${Math.round(n / 1000)}k`

// The agent template as its file: settings between +++ lines, instructions below.
export function agentFile(a: AgentTemplate): string {
  const lines = ['+++']
  if (a.upstream) lines.push(`# ${UPSTREAM.notice}`)
  lines.push(
    `name = ${q(a.name)}`,
    `does = ${q(a.does)}`,
    `steps = ${list(a.steps)}`,
    `harness = ${q(a.harness)}`,
    `model = ${q(a.model)}`,
    `skills = ${list(a.skills)}`,
  )
  if (a.upstream) lines.push(`skills_version = ${q(UPSTREAM.version)}`)
  lines.push(`gates = ${list(a.gates)}`, `asks = ${q(a.asks)}`)
  if (a.id !== HEAD_FARMER) lines.push('', '[field]', `fence = ${q(a.style.fence)}`, `farmhand = [${q(a.style.body)}, ${q(a.style.shade)}]`, `crop = ${q(a.style.crop)}`)
  if (a.mcp.length) {
    lines.push('', '[mcp]')
    for (const m of a.mcp) lines.push(`${m.server} = ${q(m.perm)}`)
  }
  lines.push('+++', '', a.instructions, '')
  return lines.join('\n')
}

export function teamFile(t: TeamTemplate): string {
  const lines: string[] = []
  if (t.upstream) lines.push(`# ${UPSTREAM.notice}`, '')
  lines.push(`name = ${q(t.name)}`, `about = ${q(t.line)}`, `budget_tokens = ${t.budget}`, `gates = ${list(t.gates)}`)
  if (t.upstream) lines.push('', '[skills]', `source = ${q(UPSTREAM.repo)}`, `version = ${q(UPSTREAM.version)}`)
  if (t.sandbox?.length) lines.push('', '[sandbox]', `guardrails = ${list(t.sandbox)}`)
  for (const m of t.members) {
    const a = agentTemplate(m.agent)
    lines.push('', '[[agent]]', `template = ${q(a ? agentPath(a) : m.agent)}`, `steps = ${list(m.steps)}`)
  }
  lines.push('')
  return lines.join('\n')
}

// One line on what a team brings, for rows and the valley.
export function teamSummary(t: TeamTemplate) {
  return `${t.members.length} agents, ${t.gates.length} gates, ${kb(t.budget)} tokens`
}

// A new team template from the crew this run used.
export function crewAsTemplate(base: TeamTemplate, name: string, assignees: string[], budget: number, gates: GateKey[], n: number): TeamTemplate {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const used = new Set(['head-farmer', ...assignees.map((r) => base.staffs[r]), base.staffs.reviewer].filter(Boolean))
  // Reviewing roles come along: they review every field.
  for (const m of base.members) if (agentTemplate(m.agent)?.farmstead) used.add(m.agent)
  return {
    ...base,
    id: `custom-${n}`,
    file: slug || `crew-${n}`,
    name,
    line: `Saved from this run. Based on ${base.name}.`,
    members: base.members.filter((m) => used.has(m.agent)),
    gates,
    budget,
    custom: true,
    upstream: base.upstream,
  }
}
