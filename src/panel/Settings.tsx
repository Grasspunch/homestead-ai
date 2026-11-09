// Settings, opened from the gear in the panel header. Every page is a view of homestead.toml.
import './settings.css'
import './ship.css'
import { GATE_ORDER, GATES } from '../sim/review'
import { HARNESSES, MODELS, type Settings } from '../sim/settings'
import { Kbd, useEngine } from '../ui'
import { Row } from './Overview'
import { TemplatesView, templatesName, templatesStatus } from './Templates'

type E = ReturnType<typeof useEngine>

const NAMES: Record<string, string> = {
  agents: 'Agents',
  gates: 'Done-when gates',
  mcp: 'MCP servers',
  sandbox: 'Sandbox',
  limits: 'Limits',
  ask: 'When agents ask you',
  deploy: 'Deploy',
  keys: 'Keyboard',
  config: 'homestead.toml',
  templates: 'Templates',
}

export function settingsName(id?: string): string {
  if (id?.startsWith('templates')) return templatesName(id)
  return id ? (NAMES[id] ?? 'Settings') : 'Settings'
}

export function settingsStatus(id: string | undefined, _e: E): string | undefined {
  if (id?.startsWith('templates')) return templatesStatus(id, _e)
  switch (id) {
    case undefined:
      return 'Saved to homestead.toml in web-app. Every run reads it.'
    case 'agents':
      return 'Each agent is a lane. A new harness is a new lane, not a new app.'
    case 'gates':
      return 'Plan sets which gates each task needs. These are the commands behind them.'
    case 'mcp':
      return 'Agents only get a server when a task attaches it.'
    case 'sandbox':
      return 'Production secrets never reach an agent.'
    case 'ask':
      return 'Everything else, agents decide and log under Decided without you.'
    case 'config':
      return 'Changes here open a pull request on the file.'
    default:
      return undefined
  }
}

const tools = (e: E) => e.library.filter((x) => x.kind === 'tool')
const k = (tokens: string) => `${(Number(tokens) || 0) / 1000}k`

export function SettingsView({ id }: { id?: string }) {
  if (id?.startsWith('templates')) return <TemplatesView id={id} />
  switch (id) {
    case 'agents':
      return <Agents />
    case 'gates':
      return <Gates />
    case 'mcp':
      return <Mcp />
    case 'sandbox':
      return <Sandbox />
    case 'limits':
      return <Limits />
    case 'ask':
      return <Ask />
    case 'deploy':
      return <Deploy />
    case 'keys':
      return <Keys />
    case 'config':
      return <Config />
    default:
      return <Root />
  }
}

function Opt({ type = 'checkbox', name, checked, onChange, label, ev, testId }: { type?: 'checkbox' | 'radio'; name?: string; checked: boolean; onChange: (on: boolean) => void; label: string; ev?: string; testId?: string }) {
  return (
    <li>
      <label>
        <input type={type} name={name} checked={checked} onChange={(x) => onChange(x.target.checked)} data-testid={testId} />
        <span>
          <strong>{label}</strong>
          {ev && <span className="ev">{ev}</span>}
        </span>
      </label>
    </li>
  )
}

function Root() {
  const e = useEngine()
  const S = e.settings
  const live = e.liveAI
  const agents = Object.values(S.agents)
  const harn = [...new Set(agents.map((a) => HARNESSES.find((h) => h[0] === a.harness)?.[1] ?? a.harness))].join(', ')
  const liveEv =
    e.live === false
      ? 'Needs ANTHROPIC_API_KEY on the server.'
      : live
        ? `Calls the models under Agents. Each run can use up to ${k(S.run.budget_tokens)} tokens, about $${S.run.budget_usd}.`
        : 'Calls the models under Agents and uses tokens.'
  const rows: { id: string; label: string; sub: string; end?: string }[] = [
    { id: 'agents', label: 'Agents', sub: `Model and harness per agent. ${harn}`, end: String(agents.length) },
    { id: 'gates', label: 'Done-when gates', sub: 'The command behind each gate', end: `${GATE_ORDER.filter((g) => S.gates[g].required).length} required` },
    { id: 'mcp', label: 'MCP servers', sub: 'What agents may do with each', end: String(tools(e).length) },
    { id: 'sandbox', label: 'Sandbox', sub: 'Where agents run, network, secrets' },
    { id: 'limits', label: 'Limits', sub: `${k(S.run.budget_tokens)} tokens, $${S.run.budget_usd}, ${S.run.timeout_min} min per run` },
    { id: 'ask', label: 'When agents ask you', sub: 'Rules for interrupting, and where' },
    { id: 'deploy', label: 'Deploy', sub: '', end: S.deploy.auto_rollback ? 'Rolls back on its own' : 'Asks before rolling back' },
    { id: 'templates', label: 'Templates', sub: `Agent and team templates. This valley uses ${e.team.name}`, end: String(e.customTeams.length + 4) },
    { id: 'keys', label: 'Keyboard', sub: 'J and K to move, Enter to open' },
    { id: 'config', label: 'homestead.toml', sub: 'All of this as a file, and the CLI' },
  ]
  return (
    <div className="settings">
      <section className="section">
        <h4>Responses</h4>
        <ul className="opt-list">
          <Opt type="radio" name="mode" checked={!live} onChange={() => e.setLiveAIOn(false)} label="Simulated" ev="Uses recorded agent responses. Uses no tokens. Good for trying things out." testId="settings-mode-simulated" />
          <Opt type="radio" name="mode" checked={live} onChange={() => e.setLiveAIOn(true)} label="Live AI" ev={liveEv} testId="settings-mode-live" />
        </ul>
      </section>
      <ul className="rows flat">
        {rows.map((r) => (
          <li key={r.id}>
            <Row label={r.label} sub={r.sub} end={r.end} onClick={() => e.go({ kind: 'settings', id: r.id })} testId={`settings-row-${r.id}`} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Agents() {
  const e = useEngine()
  return (
    <div className="settings">
      {Object.entries(e.settings.agents).map(([key, a]) => (
        <div className="agent" key={key}>
          <div className="agent-h">
            <strong>{a.role}</strong>
            <span>{a.does}</span>
          </div>
          <div className="selects">
            <label>
              Harness
              <select value={a.harness} onChange={(x) => e.setSetting(`agents.${key}`, 'harness', x.target.value)}>
                {HARNESSES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <select className="mono" value={a.model} onChange={(x) => e.setSetting(`agents.${key}`, 'model', x.target.value)}>
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {a.harness === 'custom' && (
            <label className="field">
              Command
              <input className="mono" value={a.command ?? './scripts/agent --prompt {prompt} --cwd {worktree}'} onChange={(x) => e.setSetting(`agents.${key}`, 'command', x.target.value)} />
            </label>
          )}
          {key === 'reviewer' && <p className="note">Use a different model from the builders so it doesn’t grade its own work.</p>}
        </div>
      ))}
      <p className="note">Custom takes any CLI that runs headless with a prompt and a working directory.</p>
    </div>
  )
}

function Gates() {
  const e = useEngine()
  const S = e.settings
  return (
    <div className="settings">
      {GATE_ORDER.map((g) => (
        <div className="gate-cfg" key={g}>
          <div className="gate-head">
            <strong>{GATES[g].name}</strong>
            <label className="toggle">
              <input type="checkbox" checked={S.gates[g].required} onChange={(x) => e.setSetting(`gates.${g}`, 'required', x.target.checked)} />
              Required
            </label>
          </div>
          <input className="mono gate-run" value={S.gates[g].run} onChange={(x) => e.setSetting(`gates.${g}`, 'run', x.target.value)} aria-label={`${GATES[g].name} command`} />
        </div>
      ))}
      <ul className="opt-list">
        <Opt checked={S.ci_checks} onChange={(on) => e.setSetting('', 'ci_checks', on)} label="Also run them as CI checks on the pull request" ev="They show as homestead/unit, homestead/e2e and so on." />
      </ul>
    </div>
  )
}

function Mcp() {
  const e = useEngine()
  return (
    <div className="settings">
      <ul className="rows">
        {tools(e).map((t) => {
          const access = t.access ?? []
          return (
            <li key={t.name}>
              <Row mark={<span className="kind tool">T</span>} label={t.name} sub={t.what} end={`${access.filter((a) => a.on).length} of ${access.length} allowed`} onClick={() => e.go({ kind: 'lib', id: t.name })} />
            </li>
          )
        })}
      </ul>
      <ConnectMcp />
    </div>
  )
}

export function ConnectMcp() {
  const e = useEngine()
  return (
    <button className="linkish" onClick={() => e.toast('In the app: paste a server URL or command. Homestead lists its tools and asks what agents may do before anyone can use it.')}>
      Connect another MCP server
    </button>
  )
}

const WHERE: [Settings['sandbox']['where'], string, string][] = [
  ['worktree', 'A git worktree on your machine', 'Fast, uses your toolchain'],
  ['container', 'A container in the cloud', 'Runs while your laptop is closed'],
  ['ci', 'Your CI runners', 'Same images as your builds'],
]

function Sandbox() {
  const e = useEngine()
  const S = e.settings.sandbox
  return (
    <div className="settings">
      <section className="section">
        <h4>Where agents run</h4>
        <ul className="opt-list">
          {WHERE.map(([v, l, ev]) => (
            <Opt key={v} type="radio" name="where" checked={S.where === v} onChange={() => e.setSetting('sandbox', 'where', v)} label={l} ev={ev} />
          ))}
        </ul>
      </section>
      <section className="section">
        <h4>Branches</h4>
        <label className="field">
          <input className="mono" value={S.branch} onChange={(x) => e.setSetting('sandbox', 'branch', x.target.value)} aria-label="Branch name pattern" />
        </label>
      </section>
      <section className="section">
        <h4>Network allowlist</h4>
        <div className="chips">
          {S.network.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      </section>
      <section className="section">
        <h4>Secrets agents can use</h4>
        <div className="chips">
          {S.secrets.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      </section>
    </div>
  )
}

function Limits() {
  const e = useEngine()
  const R = e.settings.run
  const field = (key: 'budget_tokens' | 'budget_usd' | 'timeout_min', label: string) => (
    <label className="field">
      {label}
      <input className="mono" inputMode="numeric" value={R[key]} onChange={(x) => e.setSetting('run', key, x.target.value)} />
    </label>
  )
  return (
    <div className="settings">
      <section className="section limits">
        {field('budget_tokens', 'Tokens per run')}
        {field('budget_usd', 'Dollars per run')}
        {field('timeout_min', 'Minutes per run')}
        <label className="field">
          When a limit is hit
          <select value={R.on_limit} onChange={(x) => e.setSetting('run', 'on_limit', x.target.value)}>
            <option value="pause">Pause and ask me</option>
            <option value="stop">Stop the run</option>
          </select>
        </label>
      </section>
    </div>
  )
}

function Deploy() {
  const e = useEngine()
  const D = e.settings.deploy
  const monitors = tools(e).filter((t) => t.name === 'Sentry' || t.name === 'GitHub Actions')
  const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1)
  return (
    <div className="settings">
      <ul className="rows">
        <li>
          <Row label={`Pipeline: ${D.pipeline}`} end={<span className="mono">{D.workflow.replace('.github/workflows/', '')}</span>} />
        </li>
        {D.environments.map((x) => (
          <li key={x.name}>
            <Row label={`${cap(x.name)}: ${x.url}`} end={x.name === 'production' ? 'After you approve' : 'On every merge'} />
          </li>
        ))}
      </ul>
      <section className="section">
        <div className="rollout-fields">
          <label>
            Canary
            <span className="unit-input">
              <input className="mono" value={D.canary_pct} onChange={(x) => e.setSetting('deploy', 'canary_pct', x.target.value)} aria-label="Canary percent" />% of users
            </span>
          </label>
          <label>
            for
            <span className="unit-input">
              <input className="mono" value={D.canary_min} onChange={(x) => e.setSetting('deploy', 'canary_min', x.target.value)} aria-label="Canary minutes" />
              min, then everyone
            </span>
          </label>
        </div>
      </section>
      <ul className="rows">
        {D.checks.map((c) => (
          <li key={c.name}>
            <Row label={c.name} end={c.threshold} />
          </li>
        ))}
      </ul>
      <section className="section">
        <ul className="opt-list">
          <Opt checked={D.auto_rollback} onChange={(on) => e.setSetting('deploy', 'auto_rollback', on)} label="Roll back on its own when a check fails" testId="settings-auto-rollback" />
        </ul>
      </section>
      <ul className="rows">
        {monitors.map((t) => (
          <li key={t.name}>
            <Row mark={<span className="kind tool">T</span>} label={t.name} end="Read only" onClick={() => e.go({ kind: 'lib', id: t.name })} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Ask() {
  const e = useEngine()
  const A = e.settings.ask
  const N = e.settings.notify
  const rule = (key: string, label: string, ev?: string) => <Opt key={key} checked={!!A[key]} onChange={(on) => e.setSetting('ask', key, on)} label={label} ev={ev} />
  return (
    <div className="settings">
      <section className="section">
        <h4>Ask me when</h4>
        <ul className="opt-list">
          {rule('gate_fails_twice', 'A gate fails twice in a row')}
          {rule('needs_new_permission', 'An agent needs an MCP permission it doesn’t have')}
          {rule('other_team', 'A choice depends on another team’s project', 'This is how the /v1/session question reached you.')}
          {rule('spend_80', 'Spend passes 80% of the limit')}
          {rule('never_for_style', 'Never for naming or style', 'Agents follow your skills and move on.')}
        </ul>
      </section>
      <section className="section">
        <h4>Tell me in</h4>
        <ul className="opt-list">
          <Opt checked={N.slack} onChange={(on) => e.setSetting('notify', 'slack', on)} label="Slack, as a DM" />
          <Opt checked={N.email} onChange={(on) => e.setSetting('notify', 'email', on)} label="Email" />
          <Opt checked={N.chime} onChange={(on) => e.setSetting('notify', 'chime', on)} label="Chime when an agent asks" ev="A soft sound in this tab. Nothing else makes a sound." testId="settings-chime" />
        </ul>
      </section>
    </div>
  )
}

const KEYS: [string, string[]][] = [
  ['Move between rows', ['J', 'K']],
  ['Open', ['Enter']],
  ['Back', ['Esc']],
  ['Answer the open question', ['1', '2']],
  ['Approve, at harvest', ['A']],
  ['Agent tree: every valley, field and plot', ['Tab']],
  ['Region view, and back', ['V']],
  ['Open or close the panel', ['B']],
  ['Jump to anything', ['⌘', 'K']],
]

function Keys() {
  return (
    <div className="settings">
      <ul className="keys">
        {KEYS.map(([l, ks]) => (
          <li key={l}>
            <span>{l}</span>
            <span>
              {ks.map((x) => (
                <Kbd key={x}>{x}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Config() {
  const e = useEngine()
  const text = e.settingsToml()
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(text)
    } catch {
      /* clipboard blocked: the toast still confirms the action */
    }
    e.toast('Copied homestead.toml')
  }
  return (
    <div className="settings">
      <section className="section">
        <pre className="excerpt toml">{text}</pre>
        <div className="foot">
          <button className="btn sm" onClick={copy}>
            Copy
          </button>
        </div>
      </section>
      <section className="section">
        <h4>Run it from your terminal</h4>
        <div className="cmd">
          <code>homestead run "Add Google sign-in" --config homestead.toml</code>
        </div>
        <p className="note">The valley and the CLI read the same file and show the same run.</p>
      </section>
    </div>
  )
}
