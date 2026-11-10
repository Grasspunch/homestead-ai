// Agent and team templates: the Templates page in Settings, its previews, and the Brief's crew picker.
import './templates.css'
import { useState } from 'react'
import { AGENT_TEMPLATES, GATE_NAME, HEAD_FARMER, STEP_NAME, TEAM_TEMPLATES, UPSTREAM, agentFile, agentPath, agentTemplate, fieldsFor, teamFile, teamPath, teamSummary, teamTemplate, type AgentTemplate, type FieldStyle, type TeamTemplate } from '../sim/templates'
import { HARNESSES } from '../sim/settings'
import { engine } from '../sim/engine'
import { Sprite, useEngine } from '../ui'
import { Row } from './Overview'

type E = ReturnType<typeof useEngine>

const harness = (id: string) => HARNESSES.find((h) => h[0] === id)?.[1] ?? id
const steps = (xs: string[]) => xs.map((s) => STEP_NAME[s as keyof typeof STEP_NAME] ?? s).filter((s, i, a) => a.indexOf(s) === i).join(', ')

// Settings ids: 'templates', 'templates:team:<id>', 'templates:agent:<id>'.
export function templatesName(id: string): string {
  const e = engine
  const [, kind, key] = id.split(':')
  if (kind === 'team') return teamTemplate(key, e.customTeams)?.name ?? 'Team template'
  if (kind === 'agent') return agentTemplate(key)?.name ?? 'Agent template'
  return 'Templates'
}

export function templatesStatus(id: string, e: E): string {
  const [, kind, key] = id.split(':')
  if (kind === 'team') {
    const t = teamTemplate(key, e.customTeams)
    return t ? teamPath(t) : ''
  }
  if (kind === 'agent') {
    const a = agentTemplate(key)
    return a ? agentPath(a) : ''
  }
  return ''
}

export function TemplatesView({ id }: { id: string }) {
  const [, kind, key] = id.split(':')
  if (kind === 'team') return <TeamPreview id={key} />
  if (kind === 'agent') return <AgentPreview id={key} />
  return <TemplatesPage />
}

function TemplatesPage() {
  const e = useEngine()
  const teams = [...TEAM_TEMPLATES, ...e.customTeams]
  const saved = e.customTeams[e.customTeams.length - 1]
  return (
    <div className="settings templates">
      <section className="section">
        <ul className="rows flat">
          {teams.map((t) => (
            <li key={t.id}>
              <Row label={t.name} end={e.crew === t.id ? 'In use' : `${t.members.length} agents`} onClick={() => e.go({ kind: 'settings', id: `templates:team:${t.id}` })} testId={`team-${t.id}`} />
            </li>
          ))}
        </ul>
        <div className="foot">
          <button className="btn sm" onClick={() => e.saveCrewAsTemplate()} data-testid="save-crew">
            Save this crew as a template
          </button>
          {saved && <span className="soft">Saved as {teamPath(saved)}</span>}
        </div>
      </section>
      <section className="section">
        <ul className="rows flat">
          {AGENT_TEMPLATES.map((a) => (
            <li key={a.id}>
              <Row label={a.name} end={steps(a.steps.length > 3 ? ['brief', 'ship'] : a.steps).replace('Brief, Ship', 'Every step')} onClick={() => e.go({ kind: 'settings', id: `templates:agent:${a.id}` })} testId={`agent-${a.id}`} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function FileText({ text }: { text: string }) {
  return <pre className="excerpt toml template-file">{text}</pre>
}

function Notice() {
  return <p className="licence">{UPSTREAM.notice}</p>
}

function TeamPreview({ id }: { id: string }) {
  const e = useEngine()
  const t = teamTemplate(id, e.customTeams)
  if (!t) return <p className="soft">This template is gone.</p>
  const inUse = e.crew === t.id
  const canPick = !e.crewLocked
  return (
    <div className="settings templates">
      <section className="section">
        <ul className="rows flat">
          {t.members.map((m) => {
            const a = agentTemplate(m.agent)
            return (
              <li key={m.agent}>
                <Row label={a?.name ?? m.agent} sub={a?.skills.length ? a.skills.join(', ') : undefined} end={steps(m.steps.length > 3 ? ['brief', 'ship'] : m.steps).replace('Brief, Ship', 'Every step')} onClick={a ? () => e.go({ kind: 'settings', id: `templates:agent:${a.id}` }) : undefined} />
              </li>
            )
          })}
        </ul>
      </section>
      <section className="section">
        <div className="valley-fields" aria-label="Fields, in order">
          {fieldsFor(t.id, e.customTeams).map((f) => (
            <FieldSwatch key={f.agent.id} style={f.style} label={f.agent.name} />
          ))}
        </div>
      </section>
      <section className="section">
        <p>
          <span className="chip-name">Required gates</span> {t.gates.map((g) => GATE_NAME[g]).join(', ')}
        </p>
      </section>
      {t.sandbox?.length ? (
        <section className="section">
          <p>
            {t.sandbox.join(' and ')} switch on the Sandbox and permission rules for every agent.
          </p>
        </section>
      ) : null}
      <section className="section">
        <p className="num">{teamSummary(t)}</p>
      </section>
      <div className="foot">
        <button className={`btn sm ${inUse ? '' : 'primary'}`} disabled={inUse || !canPick} onClick={() => e.setCrew(t.id)} data-testid="use-team">
          {inUse ? `${e.questTitle} uses this crew` : canPick ? `Use for ${e.questTitle}` : 'Takes effect on the next run'}
        </button>
      </div>
      <section className="section">
        <FileText text={teamFile(t)} />
      </section>
      {t.upstream && <Notice />}
    </div>
  )
}

function AgentPreview({ id }: { id: string }) {
  const a = agentTemplate(id)
  if (!a) return <p className="soft">This template is gone.</p>
  return (
    <div className="settings templates">
      {a.id !== HEAD_FARMER && (
        <section className="section">
          <div className="field-style">
            <FieldSwatch style={a.style} label={a.name} />
            <span>Grows {a.style.crop}</span>
          </div>
        </section>
      )}
      <AgentFacts a={a} />
      <section className="section">
        <FileText text={agentFile(a)} />
      </section>
      {a.upstream && <Notice />}
    </div>
  )
}

// A field in miniature: its fence colour, its farmhand's two tones and its ripe crop.
function FieldSwatch({ style, label }: { style: FieldStyle; label: string }) {
  return (
    <span className="swatch" style={{ borderColor: style.fence }} title={label} aria-label={`${label} field`}>
      <span className="hand" style={{ background: style.body, boxShadow: `inset 0 -4px 0 ${style.shade}` }} />
      <Sprite name={`crop_${style.crop}_3`} scale={1.25} />
    </span>
  )
}

function AgentFacts({ a }: { a: AgentTemplate }) {
  const facts: [string, string][] = [
    ['Steps', steps(a.steps)],
    ['Harness and model', `${harness(a.harness)}, ${a.model}`],
    ['Skills', a.skills.join(', ') || 'None'],
    ['MCP tools', a.mcp.map((m) => `${m.server} (${m.perm})`).join(', ') || 'None'],
    ['Gates it brings', a.gates.map((g) => GATE_NAME[g]).join(', ') || 'None'],
    ['Asks you', a.asks],
  ]
  return (
    <dl className="facts template-facts">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// Who takes a plan task in this crew: the template's name, with the builder role when they differ.
export function staffName(t: TeamTemplate, role: string, roleName: string) {
  const id = t.staffs[role]
  const a = id ? agentTemplate(id) : undefined
  return !a || a.name === roleName ? roleName : `${a.name} (${roleName})`
}

// ---- the Brief's Crew row ----------------------------------------------------------

export function CrewRow() {
  const e = useEngine()
  const [open, setOpen] = useState(false)
  const teams: TeamTemplate[] = [...TEAM_TEMPLATES, ...e.customTeams]
  return (
    <>
      <div className="line crew-line">
        <span data-testid="crew-row">
          Crew: <b>{e.team.name}</b>
        </span>
        <button className="linkish" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="crew-change">
          {open ? 'Done' : 'Change'}
        </button>
      </div>
      {open && (
        <div className="crew-picker" role="radiogroup" aria-label="Crew">
          {teams.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={e.crew === t.id} className={`crew-opt ${e.crew === t.id ? 'on' : ''}`} onClick={() => e.setCrew(t.id)} data-testid={`crew-${t.id}`}>
              <span className="dot" aria-hidden />
              <span className="crew-text">
                <b>{t.name}</b>
                <span className="soft">{teamSummary(t)}</span>
              </span>
            </button>
          ))}
          <button type="button" className="linkish" onClick={() => e.go({ kind: 'settings', id: 'templates' })}>
            See all templates
          </button>
        </div>
      )}
    </>
  )
}
