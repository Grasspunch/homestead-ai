// Settings: one homestead.toml in the repo. The settings page is a view of that file.
import { GATE_ORDER, type GateId } from './review'

export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'harness default']
export const HARNESSES: [string, string][] = [
  ['claude-code', 'Claude Code'],
  ['codex', 'Codex CLI'],
  ['gemini', 'Gemini CLI'],
  ['custom', 'Custom command'],
]

export interface AgentCfg {
  role: string
  does: string
  harness: string
  model: string
  command?: string
}

export interface Settings {
  run: { mode: 'simulated' | 'live'; budget_tokens: string; budget_usd: string; timeout_min: string; on_limit: 'pause' | 'stop'; usd_per_k: number }
  agents: Record<string, AgentCfg>
  gates: Record<GateId, { run: string; required: boolean }>
  sandbox: { where: 'worktree' | 'container' | 'ci'; branch: string; network: string[]; secrets: string[] }
  ask: Record<string, boolean>
  notify: { slack: boolean; email: boolean; chime: boolean }
  ci_checks: boolean
  deploy: {
    pipeline: string
    workflow: string
    environments: { name: string; url: string; gate: string }[]
    canary_pct: string
    canary_min: string
    checks: { name: string; threshold: string; source: string }[]
    auto_rollback: boolean
  }
}

export function defaultSettings(): Settings {
  return {
    run: { mode: 'simulated', budget_tokens: '120000', budget_usd: '8', timeout_min: '45', on_limit: 'pause', usd_per_k: 0.052 },
    agents: {
      head: { role: 'Head farmer', does: 'Plans, assigns, asks you', harness: 'claude-code', model: 'claude-opus-5-5' },
      backend: { role: 'Backend', does: 'Server code', harness: 'claude-code', model: 'claude-sonnet-5-5' },
      frontend: { role: 'Frontend', does: 'UI code', harness: 'claude-code', model: 'claude-sonnet-5-5' },
      tests: { role: 'Tests', does: 'Writes and runs tests', harness: 'codex', model: 'harness default' },
      docs: { role: 'Docs', does: 'Guides and changelogs', harness: 'claude-code', model: 'claude-haiku-5-5' },
      reviewer: { role: 'Reviewer', does: 'Agentic review, writes no code', harness: 'claude-code', model: 'claude-opus-5-5' },
    },
    gates: {
      shots: { run: 'npx playwright test --project=screens', required: true },
      unit: { run: 'npm test', required: true },
      integration: { run: 'npm run test:int', required: true },
      e2e: { run: 'npx playwright test e2e/', required: true },
      review: { run: 'reviewer --rubric skills', required: true },
    },
    sandbox: {
      where: 'container',
      branch: 'homestead/{task}',
      network: ['staging.web-app.dev', 'registry.npmjs.org', 'accounts.google.com'],
      secrets: ['GOOGLE_CLIENT_ID (staging)', 'GOOGLE_CLIENT_SECRET (staging)'],
    },
    ask: { gate_fails_twice: true, needs_new_permission: true, other_team: true, spend_80: true, never_for_style: true },
    notify: { slack: true, email: false, chime: true },
    ci_checks: true,
    deploy: {
      pipeline: 'GitHub Actions',
      workflow: '.github/workflows/main.yml',
      environments: [
        { name: 'staging', url: 'staging.web-app.dev', gate: 'Deploys on every merge to main' },
        { name: 'production', url: 'app.example.com', gate: 'Deploys only after you approve' },
      ],
      canary_pct: '5',
      canary_min: '10',
      checks: [
        { name: 'Google sign-in success', threshold: 'At least 99%', source: 'Sentry' },
        { name: '5xx rate', threshold: 'Under 0.5%', source: 'Sentry' },
        { name: 'p95 latency', threshold: 'Under 800 ms', source: 'Sentry' },
      ],
      auto_rollback: true,
    },
  }
}

export interface TomlContext {
  agents: Record<string, { tools: string[]; skills: string[] }>
  tools: { name: string; access: { label: string; on: boolean }[] }[]
}

export function toml(s: Settings, ctx: TomlContext): string {
  const q = (v: string) => `"${v}"`
  const L = [
    '# homestead.toml',
    '[run]',
    `mode = ${q(s.run.mode)}`,
    `budget_tokens = ${(Number(s.run.budget_tokens) || 0).toLocaleString('en-US').replace(/,/g, '_')}`,
    `budget_usd = ${s.run.budget_usd}`,
    `timeout_min = ${s.run.timeout_min}`,
    `on_limit = ${q(s.run.on_limit)}`,
    '',
  ]
  for (const [k, a] of Object.entries(s.agents)) {
    L.push(`[agents.${k}]`, `harness = ${q(a.harness)}`)
    if (a.harness === 'custom' && a.command) L.push(`command = ${q(a.command)}`)
    if (a.model !== 'harness default') L.push(`model = ${q(a.model)}`)
    const c = ctx.agents[k]
    if (c) {
      if (c.tools.length) L.push(`mcp = [${c.tools.map((t) => q(t.toLowerCase())).join(', ')}]`)
      if (c.skills.length) L.push(`skills = [${c.skills.map(q).join(', ')}]`)
    }
    L.push('')
  }
  L.push('[gates]')
  for (const g of GATE_ORDER) L.push(`${g} = { run = ${q(s.gates[g].run)}, required = ${s.gates[g].required} }`)
  L.push(`ci_checks = ${s.ci_checks}`)
  L.push('', '[sandbox]', `where = ${q(s.sandbox.where)}`, `branch = ${q(s.sandbox.branch)}`, `network = [${s.sandbox.network.map(q).join(', ')}]`, '')
  for (const t of ctx.tools) L.push(`[mcp.${t.name.toLowerCase()}]`, `allow = [${t.access.filter((a) => a.on).map((a) => q(a.label.toLowerCase())).join(', ')}]`, '')
  L.push('[ask]', ...Object.entries(s.ask).map(([k, v]) => `${k} = ${v}`), '')
  const d = s.deploy
  L.push('[deploy]', `pipeline = ${q(d.pipeline)}`, `workflow = ${q(d.workflow)}`, `environments = [${d.environments.map((x) => q(x.name)).join(', ')}]`, `canary = { percent = ${d.canary_pct}, minutes = ${d.canary_min} }`, `auto_rollback = ${d.auto_rollback}`, '')
  for (const c of d.checks) L.push(`[[deploy.check]]`, `name = ${q(c.name)}`, `threshold = ${q(c.threshold)}`, `source = ${q(c.source.toLowerCase())}`, '')
  L.push('[notify]', ...Object.entries(s.notify).map(([k, v]) => `${k} = ${v}`))
  return L.join('\n')
}

// Dollars for a token count, at the configured rate.
export function usd(tokens: number, s: Settings) {
  return (tokens / 1000) * s.run.usd_per_k
}
