// The agent dashboard: every agent on the farm, what it is on, its last step and its spend, in one panel.
// It is what the demo run builds ("Replace the cost button with an agent dashboard"): once that run's release
// reaches you, the top bar's coins become the Agents button, and it opens this.
import './agents.css'
import { Ico, Portrait, usd } from './bits'
import { store, type Project } from '../run/store'
import { scenario } from '../run/simPlan'
import type { FarmerId, FarmerRun, RunState } from '../run/types'
import { FARMER_ORDER } from '../run/types'

// Whether this farm's run has put the dashboard in front of you: its release is live for the 10% or for everyone.
// A rollback takes it away again until the fix ships, as a real rollback would.
export function agentsLive(p: Project | null | undefined, s: RunState): boolean {
  if (!p?.approved || scenario(p.goal).script.ships !== 'agents') return false
  const stage = s.deploy[s.deploy.length - 1]?.stage
  return stage === '10%' || stage === '100%'
}

const STATE: Record<FarmerRun['state'], { label: string; tone: string }> = {
  working: { label: 'Working', tone: 'green' },
  stuck: { label: 'Fixing a check', tone: 'gold' },
  needs: { label: 'Needs you', tone: 'red' },
  idle: { label: 'Waiting', tone: 'grey' },
  done: { label: 'Finished', tone: 'grey' },
}

const crewOf = (s: RunState) => FARMER_ORDER.filter((id) => s.farmers[id]).map((id) => s.farmers[id]!)

// The top-bar button: the faces of the crew and how many are busy right now.
export function AgentsButton({ s, className, label, onClick }: { s: RunState; className: string; label?: string; onClick: () => void }) {
  const crew = crewOf(s)
  const busy = crew.filter((f) => f.state === 'working' || f.state === 'stuck').length
  const needs = crew.filter((f) => f.state === 'needs').length
  return (
    <button className={`${className} top-agents`} onClick={onClick} aria-label={`${label ?? 'Agents'}: ${busy} working${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}`}>
      <span className="agent-faces" aria-hidden>
        {crew.slice(0, 3).map((f) => (
          <span key={f.id} className={`agent-face ${f.state}`}>
            <Portrait farmer={f.id} size={24} />
            <span className="face-name paper">{f.label}</span>
          </span>
        ))}
      </span>
      <span className="top-name">{label ?? 'Agents'}</span>
      {busy + needs > 0 && <b className={`agent-count${needs ? ' needs' : ''}`}>{needs || busy}</b>}
    </button>
  )
}

export function AgentsPanel({ s }: { s: RunState }) {
  const crew = crewOf(s)
  const busy = crew.filter((f) => f.state === 'working' || f.state === 'stuck').length
  const needs = crew.filter((f) => f.state === 'needs').length
  const allDone = crew.every((f) => f.state === 'done')
  const head = allDone ? `All ${crew.length} finished` : [`${busy} working`, needs ? `${needs} need${needs === 1 ? 's' : ''} you` : '', `${crew.length - busy - needs} waiting`].filter(Boolean).join(', ')
  return (
    <aside className="side wood agents-panel" aria-label="Agent dashboard">
      <button className="close btn white xs" onClick={() => store.setDrawer(null)} aria-label="Close">
        <Ico name="cross" size={16} />
      </button>
      <div className="scroll">
        <div>
          <h3>Agents</h3>
          <h2>{head}</h2>
        </div>
        <div className="agent-rows">
          {crew.map((f) => (
            <AgentRow key={f.id} s={s} f={f} />
          ))}
        </div>
        <div className="agent-foot">
          <span>
            {usd(s.usage.usd)} spent{s.estimate ? ` of ${usd(s.estimate.usd)} planned` : ''}
          </span>
          <button className="link" onClick={() => store.setDrawer({ kind: 'usage' })}>
            Spend details
          </button>
        </div>
      </div>
    </aside>
  )
}

function AgentRow({ s, f }: { s: RunState; f: FarmerRun }) {
  const mine = s.tasks.filter((t) => t.farmer === f.id)
  const done = mine.filter((t) => t.status === 'ripe' || t.status === 'accepted').length
  const busy = f.state === 'working' || f.state === 'stuck' || f.state === 'needs'
  const on = busy ? s.tasks.find((t) => t.id === f.task) : undefined
  const ask = s.asks.find((a) => !a.answer && a.farmer === f.id)
  const next = f.state === 'idle' ? mine.find((t) => t.status === 'waiting') : undefined
  // The checks it ran on the others' work: for the Planner and the Tester, most of what they do.
  const checked = new Set(s.tasks.filter((t) => t.checks.some((c) => c.by === f.id)).map((t) => t.id)).size
  const st = STATE[f.state]
  const over = f.usd > f.limits.usd
  const line =
    f.state === 'needs' && ask
      ? ask.question
      : busy
        ? on ? f.lastTool ?? 'Starting' : mine.length ? f.lastTool ?? 'Starting' : 'Checking the others’ work and keeping the plan'
        : next
          ? `Next: ${next.name}`
          : f.state === 'done' || !mine.length
            ? f.lastTool ? `Last: ${f.lastTool}` : f.why ?? ''
            : f.lastTool ? `Last: ${f.lastTool}` : 'Nothing to do yet'
  const meta = [mine.length ? `${done} of ${mine.length} task${mine.length === 1 ? '' : 's'} done` : '', checked ? `checked ${checked} task${checked === 1 ? '' : 's'}` : '', `limit ${usd(f.limits.usd)}`].filter(Boolean).join(' · ')
  return (
    <button className={`agent-row ${f.state}`} onClick={() => store.setDrawer({ kind: 'farmer', id: f.id as FarmerId })}>
      <span className="agent-portrait">
        <Portrait farmer={f.id} size={48} />
        {(f.state === 'working' || f.state === 'stuck') && <i className="live-dot" aria-hidden />}
      </span>
      <span className="agent-body">
        <span className="agent-head">
          <b>{f.label}</b>
          <span className={`tag ${st.tone}`}>{st.label}</span>
          <span className="grow" />
          <span className={`money${over ? ' over' : ''}`}>{usd(f.usd)}</span>
        </span>
        <span className="agent-model">{f.model}</span>
        {on ? (
          <span className="agent-task">
            <span className="agent-task-name">On {on.name}</span>
            <span className="bar thin">
              <i style={{ width: `${Math.round(on.progress * 100)}%`, background: on.status === 'wilted' ? 'var(--honey)' : 'var(--leaf)' }} />
            </span>
          </span>
        ) : null}
        <span className="agent-line">{line}</span>
        <span className="agent-meta">{meta}</span>
      </span>
    </button>
  )
}
