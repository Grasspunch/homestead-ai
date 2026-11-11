// The wood panel on the right: one page at a time (a task, a farmer, the inbox, spend, the harvest, control).
import { useEffect, useRef, useState } from 'react'
import { CREW } from '../agent/agents'
import { clip, store, type Project } from '../run/store'
import type { Autonomy, AutonomyLevel, FarmerId, Moment, RunState, TaskState } from '../run/types'
import { AUTONOMY_PRESETS, FARMER_ORDER } from '../run/types'
import { Ico, Mark, Portrait, Swatch, cents, mins, usd } from './bits'
import { ProofView, Rollout } from './Proof'
import { BY_YOU } from '../run/rollback'
import { isOwnWay } from '../run/discuss'
import { agentName } from '../run/kit'

const STATUS: Record<TaskState['status'], string> = {
  waiting: 'Not started',
  growing: 'In progress',
  checking: 'Being checked',
  wilted: 'Failed a check',
  ripe: 'Done and checked',
  accepted: 'Committed to the pull request',
}

const ago = (s: RunState, t: number) => {
  const m = Math.max(0, Math.round((s.t - t) / 60000))
  return m < 1 ? 'just now' : `${m} min ago`
}

function Panel({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <aside className="side wood" aria-label={label}>
      <button className="close btn white xs" onClick={() => store.setDrawer(null)} aria-label="Close">
        <Ico name="cross" size={16} />
      </button>
      <div className="scroll">{children}</div>
    </aside>
  )
}

export function TaskPanel({ p, s, id }: { p: Project; s: RunState; id: string }) {
  const t = s.tasks.find((x) => x.id === id)
  if (!t) return null
  const planning = !p.approved
  const f = s.farmers[t.farmer]
  const lines = s.activity.filter((a) => a.task === id).slice(-6).reverse()
  const chat = /support|assistant|chat/i.test(p.name + p.goal)
  const ask = s.asks.find((a) => a.task === id && !a.answer)
  return (
    <Panel label={`Task: ${t.name}`}>
      <div>
        <h3>Task</h3>
        <h2>{t.name}</h2>
      </div>
      {!planning && (
        <div className="sum">
          {ask ? <b>Waiting for you. </b> : null}
          {t.gate && s.deploy.length && s.deploy[s.deploy.length - 1].stage === 'rollback' && t.status !== 'ripe' && t.status !== 'accepted' ? <b>{s.deploy[s.deploy.length - 1].reason === BY_YOU ? 'Rolled back by you. ' : 'Rolled back by itself. '}</b> : null}
          {STATUS[t.status]}
          {t.status === 'growing' ? `, about ${Math.round(t.progress * 100)}% there.` : '.'} {f && t.status !== 'ripe' && t.status !== 'accepted' ? t.status === 'waiting' ? `${f.label} will work on this.` : `${f.label} is on it.` : ''}{t.status === 'accepted' && t.acceptedBy && t.acceptedBy !== 'you' ? ` The ${s.farmers[t.acceptedBy]?.label ?? 'checker'} checked it.` : ''}
          {t.summary && (t.status === 'ripe' || t.status === 'accepted') ? ` ${t.summary}.` : ''}
        </div>
      )}
      <div className="meta">
        {f && (
          <button className="chip" onClick={() => store.setDrawer({ kind: 'farmer', id: f.id })}>
            <Swatch farmer={f.id} />
            {f.label}
          </button>
        )}
        {!planning && (
          <>
            <span className="chip">
              <i className="coin-s" />
              {cents(t.usd)} so far
            </span>
          </>
        )}
        {t.gate && <span className="tag sky">Waits for you</span>}
      </div>

      <div>
        {planning ? (
          <label>
            <span className="field-label">Done when</span>
            <textarea
              className="field-area"
              rows={2}
              value={t.doneWhen}
              onChange={(e) => store.editPlan(p.id, (tasks) => {
                const x = tasks.find((k) => k.id === id)
                if (x) x.doneWhen = e.target.value
              })}
            />
          </label>
        ) : (
          <>
            <h3>Done when</h3>
            <div className="when">{t.doneWhen}</div>
          </>
        )}
      </div>

      {planning && (
        <>
          <div>
            <h3>Who does it</h3>
            <div className="row">
              {FARMER_ORDER.filter((fid) => s.farmers[fid]).map((fid) => (
                <button
                  key={fid}
                  className={`btn xs ${t.farmer === fid ? '' : 'tan'}`}
                  aria-pressed={t.farmer === fid}
                  onClick={() => store.editPlan(p.id, (tasks) => {
                    const x = tasks.find((k) => k.id === id)
                    if (x) x.farmer = fid
                  })}
                >
                  <Swatch farmer={fid} />
                  {s.farmers[fid]!.label}
                </button>
              ))}
            </div>
          </div>
          <button
            className="toggle"
            onClick={() => store.editPlan(p.id, (tasks) => {
              const x = tasks.find((k) => k.id === id)
              if (x) x.gate = !x.gate
            })}
          >
            <span className={`switch${t.gate ? ' on' : ''}`} />
            <span>Wait for my go-ahead before this one runs</span>
          </button>
        </>
      )}

      {t.gate && s.deploy.length > 0 && (
        <div>
          <h3>Rollout</h3>
          <Rollout state={s} />
        </div>
      )}

      {t.checks.length > 0 && (
        <div>
          <h3>Checks</h3>
          <div className="checks">
            {[...t.checks].reverse().map((c, i) => (
              <details key={c.t} open={i === 0} className={c.pass ? 'check ok-row' : 'check bad-row'}>
                <summary>
                  <Mark pass={c.pass} />
                  <span className="grow">{c.notes}</span>
                  <span className="sub">{s.farmers[c.by]?.label ?? c.by}, {ago(s, c.t)}</span>
                </summary>
                {c.proof && <ProofView proof={c.proof} chat={chat} note={c.notes} />}
              </details>
            ))}
          </div>
        </div>
      )}

      {lines.length > 0 && (
        <div>
          <h3>Latest</h3>
          <div className="list">
            {lines.map((a) => (
              <div key={a.t + a.text}>
                {a.farmer ? <Swatch farmer={a.farmer} /> : <Ico name="sprout" size={14} />}
                <span className="grow">{a.text}</span>
                <span className="sub">{ago(s, a.t)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

export function FarmerPanel({ s, id, p }: { s: RunState; id: FarmerId; p: Project }) {
  const f = s.farmers[id]
  if (!f) return null
  const mine = s.tasks.filter((t) => t.farmer === id)
  const pct = Math.min(1, f.usd / Math.max(0.01, f.limits.usd))
  const agent = agentName(f.agent)
  const words = { idle: 'Waiting for its next task', working: f.lastTool ?? 'Working', stuck: 'Fixing a failed check', needs: 'Waiting for you', done: 'Finished' }[f.state]
  return (
    <Panel label={`AI agent: ${f.label}`}>
      <div className="farmer-head">
        <div className="portrait sm">
          <Portrait farmer={id} size={72} />
        </div>
        <div>
          <h3>AI agent</h3>
          <h2>{f.label}</h2>
          <div className="meta">
            <span>{f.model} on {agent}</span>
          </div>
        </div>
      </div>
      {p.approved && <div className="sum">{words}.</div>}
      <div>
        <h3>Can read</h3>
        <div className="slots">
          {f.context.map((c) => (
            <span key={c} className="slot mono">{c}</span>
          ))}
        </div>
      </div>
      <div>
        <h3>Rules</h3>
        {f.constraints.map((c) => (
          <div className="rule" key={c}>
            <Ico name="no" size={16} tone="light" />
            {c}
          </div>
        ))}
      </div>
      <div>
        <h3>Limit</h3>
        <div className="stat">
          <span className="big">{usd(f.usd)}</span>
          <span>of {usd(f.limits.usd)}, and {mins(f.limits.minutes)} at most</span>
        </div>
        <div className="bar" style={{ marginTop: 6 }}>
          <i style={{ width: `${pct * 100}%`, background: pct > 0.85 ? 'var(--honey)' : 'var(--leaf)' }} />
        </div>
      </div>
      <div>
        <h3>Its tasks</h3>
        <div className="list">
          {mine.map((t) => (
            <button key={t.id} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
              <span className="grow">{t.name}</span>
              <span className="sub">{p.approved ? STATUS[t.status] : t.gate ? 'Waits for you' : ''}</span>
            </button>
          ))}
          {!mine.length && <div className="sub">Checks the others’ work.</div>}
        </div>
      </div>
      <p className="fine">{CREW[id].role.charAt(0).toUpperCase() + CREW[id].role.slice(1)}.</p>
    </Panel>
  )
}

// A release the crew made by itself that a later rollback took down.
function supersededBy(s: RunState, x: { t: number; what: string }) {
  if (!/shipped|merged/i.test(x.what)) return ''
  const rb = s.deploy.find((d) => d.stage === 'rollback' && d.t > x.t)
  return rb ? (rb.reason === BY_YOU ? '. Later rolled back by you' : '. Later rolled back') : ''
}

export function InboxPanel({ s }: { s: RunState }) {
  const open = s.asks.filter((a) => !a.answer)
  const decided = s.asks.filter((a) => a.answer).reverse()
  // Whether each answer can still be changed, and why not when it can't.
  const changeable = new Map(store.decided().map((d) => [d.id, d]))
  const change = (id: string) => {
    const why = store.reopen(id)
    if (why) store.say(why)
  }
  const fixed = [...s.autoFixes].reverse()
  return (
    <Panel label="Inbox">
      <div>
        <h3>Inbox</h3>
        <h2>{open.length ? `${open.length} need${open.length === 1 ? 's' : ''} you` : 'Nothing needs you'}</h2>
      </div>
      {open.length > 0 && (
        <div className="list">
          {open.map((a) => (
            <button key={a.id} onClick={() => a.task && store.setDrawer({ kind: 'task', id: a.task })}>
              <Swatch farmer={a.farmer} />
              <span className="grow">
                {a.question}
                <span className="sub">Suggested: {a.suggested}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div>
        <h3>Fixed without you</h3>
        <div className="list">
          {fixed.map((x) => (
            <button key={x.t} onClick={() => x.task && store.setDrawer({ kind: 'task', id: x.task })}>
              <Ico name="check" size={16} tone="green" />
              <span className="grow">
                {x.what}
                <span className="sub">{ago(s, x.t)}{supersededBy(s, x)}</span>
              </span>
            </button>
          ))}
          {!fixed.length && <div className="sub">Nothing yet.</div>}
        </div>
      </div>
      <div>
        <h3>You decided</h3>
        <div className="list">
          {decided.map((a) => {
            const d = changeable.get(a.id)
            return (
              <div key={a.id}>
                <Swatch farmer={a.farmer} />
                <button className="grow" style={{ textAlign: 'left' }} onClick={() => a.task && store.setDrawer({ kind: 'task', id: a.task })}>
                  {a.answer!.choice}
                  <span className="sub">{store.project()?.notes?.[a.id] ? `In your words: “${clip(store.project()!.notes![a.id])}”. ` : ''}{a.question}</span>
                  {d && !d.canChange && d.why ? <span className="sub">{d.why}</span> : null}
                </button>
                {d?.canChange && (
                  <button className="btn tan sm" onClick={() => change(a.id)} aria-label={`Change your answer: ${a.answer!.choice}`}>
                    Change
                  </button>
                )}
              </div>
            )
          })}
          {!decided.length && <div className="sub">Nothing yet.</div>}
        </div>
      </div>
      <button className="btn tan sm" onClick={() => store.setDrawer({ kind: 'control' })}>
        <Ico name="gear" size={20} />
        How often the agents check with you
      </button>
    </Panel>
  )
}

interface Fix {
  key: string
  farmer: FarmerId
  title: string
  why: string
  saves?: number // measured from this run, when it can be
  model?: string // a fix you can apply here: move this farmer to a cheaper model
}

// What a farmer has given back for its spend, in a few words.
export function returnOf(s: RunState, id: FarmerId): string {
  const done = s.tasks.filter((t) => t.farmer === id && (t.status === 'ripe' || t.status === 'accepted')).length
  const caught = s.tasks.reduce((n, t) => n + t.checks.filter((c) => c.by === id && !c.pass).length, 0)
  const parts: string[] = []
  if (done) parts.push(`${done} task${done === 1 ? '' : 's'} done`)
  if (caught) parts.push(`caught ${caught} failure${caught === 1 ? '' : 's'}`)
  if (id === 'planner' && s.replans.length) parts.push(`${s.replans.length} re-plan${s.replans.length === 1 ? '' : 's'} that kept the cost down`)
  if (id === 'deployer' && s.deploy.some((d) => d.stage === 'rollback')) parts.push('rolled back a bad release by itself')
  const out = parts.join(', ')
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : 'Nothing back yet'
}

export function fixFor(s: RunState, id: FarmerId): Fix | undefined {
  return fixes(s).find((f) => f.farmer === id)
}

export function ApplyFix({ fix }: { fix: Fix }) {
  const p = store.project()
  return (
    <div className="fix">
      <span className="grow">
        {fix.title}
        <span className="sub">{fix.saves !== undefined ? `Saves ${usd(fix.saves)} a run` : 'Skips the pause and the re-plan mid-run'}</span>
      </span>
      {store.applied.has(fix.key) ? (
        <span className="ok px-s">Applied</span>
      ) : fix.model && p ? (
        <button
          className="btn xs"
          onClick={() => {
            store.applied.add(fix.key)
            store.editKit(p.id, fix.farmer, (e) => (e.model = fix.model))
            store.say(`The ${fix.farmer.charAt(0).toUpperCase() + fix.farmer.slice(1)} runs on ${fix.model} from now on.`)
          }}
        >
          Apply
        </button>
      ) : null}
    </div>
  )
}

function fixes(s: RunState): Fix[] {
  const out: Fix[] = []
  const total = Math.max(0.01, s.usage.usd)
  const retry = s.usage.byKind.retry.usd
  const read = s.usage.byKind.read.usd
  if (retry / total > 0.04) out.push({ key: 'retry', farmer: 'builder', title: 'Cap fix rounds at 2 per task', why: `Fixes after failed checks cost ${usd(retry)} this run.`, saves: retry * 0.4 })
  if (read / total > 0.2) out.push({ key: 'read', farmer: 'builder', title: 'Narrow the Builder to the folders it touched', why: `Reading files was ${Math.round((read / total) * 100)}% of the spend.`, saves: read * 0.35 })
  const designer = s.farmers.designer
  if (designer && designer.model.includes('Opus')) out.push({ key: 'shots', farmer: 'designer', title: 'Run the Designer on Claude Sonnet 5', why: 'Its screenshot checks don’t need the bigger model.', saves: designer.usd * 0.5, model: 'Claude Sonnet 5' })
  for (const r of s.replans) {
    const t = s.tasks.find((x) => r.added.includes(x.id))
    if (t) out.push({ key: `split-${t.id}`, farmer: 'planner', title: `Plan "${s.tasks.find((x) => `${x.id}-rest` === t.id)?.name ?? t.name}" as two tasks from the start`, why: 'It was split mid-run after going over its limit.' })
  }
  return out
}

// What got caught: problems a different farmer's check found before the merge, and a bad release the 10% stage
// stopped (10% of users did see that one). A rollback you made yourself isn't counted.
export function caught(s: RunState): { where: string; what: string; kind: 'check' | 'canary' }[] {
  const out: { where: string; what: string; kind: 'check' | 'canary' }[] = []
  for (const t of s.tasks) for (const c of t.checks) if (!c.pass) out.push({ where: t.name, what: c.notes, kind: 'check' })
  s.deploy.forEach((d, i) => {
    if (d.stage === 'rollback' && d.reason !== BY_YOU && s.deploy[i - 1]?.stage === '10%') out.push({ where: 'Rollout', what: d.reason ?? 'Errors passed 2% at 10%, so it rolled back on its own', kind: 'canary' })
  })
  return out
}

// "2 caught before merge, 1 stopped at 10%", said the same way everywhere.
export function caughtLine(s: RunState) {
  const c = caught(s)
  const checks = c.filter((x) => x.kind === 'check').length
  const canary = c.filter((x) => x.kind === 'canary').length
  const parts = [`${checks || 'No'} problem${checks === 1 ? '' : 's'} caught before merge`]
  if (canary) parts.push(`${canary} bad release stopped at 10%`)
  return parts.join(', ')
}

// The case for a crew: a separate checker caught problems before the merge, for a few dollars of checks.
export function outcome(s: RunState): { line: string; value: string } | null {
  if (!s.done || !s.soloActual) return null
  const checks = caught(s).filter((x) => x.kind === 'check').length
  if (!checks) return null
  const gap = s.done.usd - s.soloActual.usd
  const cost = Math.abs(gap) < 0.5 ? 'cost the same' : gap > 0 ? `cost ${usd(gap)} less` : `cost ${usd(-gap)} more`
  const sooner = s.soloActual.minutes - s.done.minutes
  // The time rests on an assumption, so it says so: one agent's steps run about a third slower.
  const time = sooner > 0 ? ` and take about ${mins(sooner)} longer, assuming it runs a third slower` : ''
  const spent = s.checkUsd !== undefined ? `${usd(s.checkUsd)} of checks` : 'A separate checker'
  return {
    line: `${spent} caught ${checks} problem${checks === 1 ? '' : 's'} before merge. One agent has nobody to catch them.`,
    value: `${spent} caught ${checks} problem${checks === 1 ? '' : 's'} before merge. One agent alone would ${cost}${time}.`,
  }
}

// Planned against planned before the run ends; this run against the same work done alone once it has.
export function CrewVsAlone({ s }: { s: RunState }) {
  const done = !!s.done && !!s.soloActual
  const crew = done ? { usd: s.done!.usd, minutes: s.done!.minutes } : s.estimate
  const one = done ? s.soloActual : s.singleAgentEstimate
  const n = FARMER_ORDER.filter((id) => s.farmers[id]).length
  if (!crew || !one || n < 2) return null
  const sooner = one.minutes - crew.minutes
  const less = one.usd - crew.usd
  const found = caught(s)
  const out = outcome(s)
  return (
    <div className="vs">
      <h3>{done ? 'This team vs one agent, this run' : 'This team vs one agent, planned'}</h3>
      <p className="vs-gap">
        {sooner > 0 ? (
          <>
            <span className="big">{mins(sooner)}</span> sooner
          </>
        ) : (
          <>
            <span className="big">{mins(-sooner)}</span> slower
          </>
        )}
        {less > 0.5 ? <>, <b>{usd(less)}</b> less</> : less < -0.5 ? <>, <b>{usd(-less)}</b> more</> : null}
      </p>
      {out && <p className="vs-out">{out.line}</p>}
      <p className="vs-note">One agent holds every file in context, so each step is about a third slower and 10% dearer.</p>
      <div className="vs-grid" role="table">
        <span role="columnheader" />
        <span role="columnheader">This team</span>
        <span role="columnheader">One Sonnet 5 agent</span>
        <span>Time</span>
        <b>{mins(crew.minutes)}</b>
        <span>{mins(one.minutes)}</span>
        <span>Cost</span>
        <b>{usd(crew.usd)}</b>
        <span>{usd(one.usd)}</span>
        <span>Caught</span>
        <b>{found.filter((f) => f.kind === 'check').length} before merge</b>
        <span>No checker</span>
      </div>
      {found.length > 0 && (
        <ul className="vs-caught">
          {found.slice(0, 3).map((f, i) => (
            <li key={i}>
              <Mark pass={false} />
              <span>
                <b>{f.where}</b> {f.what}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function UsagePanel({ s }: { s: RunState }) {
  const est = s.estimate
  const ids = FARMER_ORDER.filter((id) => s.farmers[id])
  const max = Math.max(0.01, ...ids.map((id) => s.farmers[id]!.usd))
  const kinds = s.usage.byKind
  const total = Math.max(0.01, s.usage.usd)
  const list = fixes(s)
  return (
    <Panel label="Spend">
      <CrewVsAlone s={s} />
      <div>
        <h3>Spent</h3>
        <div className="stat">
          <span className="big">{usd(s.usage.usd)}</span>
          {est && <span>of {usd(est.usd)}</span>}
        </div>
        {est && (
          <div className="bar" style={{ marginTop: 8 }}>
            <i style={{ width: `${Math.min(100, (s.usage.usd / est.usd) * 100)}%`, background: s.usage.usd > est.usd ? 'var(--honey)' : 'var(--leaf)' }} />
          </div>
        )}
      </div>
      <div>
        <h3>By agent</h3>
        <div className="crew-spend">
          {ids.map((id) => {
            const f = s.farmers[id]!
            const over = f.usd - f.limits.usd
            const spike = over > 0.005
            const fix = list.find((x) => x.farmer === id)
            return (
              <div key={id} className={`crew-spend-row${spike ? ' spike' : ''}`}>
                <button className="crew-spend-head" onClick={() => store.setDrawer({ kind: 'farmer', id })}>
                  <Swatch farmer={id} />
                  <b>{f.label}</b>
                  <span className="sub-inline">{f.model}</span>
                  <span className="grow" />
                  <span className="money">{usd(f.usd)}</span>
                  <span className="of">of {usd(f.limits.usd)}</span>
                </button>
                <span className="bar thin">
                  <i style={{ width: `${(f.usd / max) * 100}%`, background: spike ? 'var(--honey)' : '#c9a27a' }} />
                </span>
                {spike && <span className="returned"><b className="over">Over its limit by {usd(over)}</b></span>}
                {fix && <ApplyFix fix={fix} />}
              </div>
            )
          })}
        </div>
      </div>
      <div>
        <h3>On what</h3>
        <div className="bar tall">
          <i style={{ width: `${(kinds.read.usd / total) * 100}%`, background: '#98c2dc' }} title="Reading" />
          <i style={{ width: `${(kinds.write.usd / total) * 100}%`, background: '#a9cf86' }} title="Writing" />
          <i style={{ width: `${(kinds.retry.usd / total) * 100}%`, background: 'var(--honey)' }} title="Fixing" />
        </div>
        <div className="meta" style={{ marginTop: 6 }}>
          <span className="chip"><span className="sw" style={{ background: '#98c2dc' }} />Reading {usd(kinds.read.usd)}</span>
          <span className="chip"><span className="sw" style={{ background: '#a9cf86' }} />Writing {usd(kinds.write.usd)}</span>
          <span className="chip"><span className="sw" style={{ background: 'var(--honey)' }} />Fixing {usd(kinds.retry.usd)}</span>
        </div>
      </div>
    </Panel>
  )
}

// The chest is the pull request: a commit per checked task, then the merge and the release.
export function HarvestPanel({ s, p }: { s: RunState; p: Project }) {
  const inPr = s.tasks.filter((t) => t.status === 'accepted' && !t.gate)
  const work = s.tasks.filter((t) => !t.gate)
  const out = work.filter((t) => t.stopped && t.status !== 'accepted')
  const commits = inPr.reduce((n, t) => n + 1 + (t.changes?.length ?? 0), 0)
  const decided = s.asks.filter((a) => a.answer)
  const merged = s.deploy.length > 0
  const last = s.deploy[s.deploy.length - 1]
  const live = !!last && last.stage !== 'rollback' && !s.tasks.some((t) => t.gate && t.stopped)
  const state = !merged ? 'Open' : last.stage === '100%' ? 'Live for everyone' : last.stage === 'rollback' ? 'Rolled back' : 'Live for 10%'
  if (!inPr.length)
    return (
      <Panel label="Pull request">
        <div>
          <h3>Pull request</h3>
          <h2>No commits yet</h2>
        </div>
      </Panel>
    )
  return (
    <Panel label="Pull request">
      <div>
        <h3>Pull request</h3>
        <h2>{p.name}</h2>
        <div className="meta pr-meta">
          <span className={`tag ${merged ? (last.stage === 'rollback' ? 'red' : 'green') : 'grey'}`}>{state}</span>
          <span className="mono">homestead/{p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}</span>
        </div>
        {live && (
          <button className="btn tan sm pr-rollback" onClick={() => store.rollBackNow()}>
            <Ico name="back" size={20} />
            Roll back
          </button>
        )}
      </div>
      {s.done && (
        <div className="sum">
          {usd(s.done.usd)} in {mins(s.done.minutes)}
          {s.soloActual ? `. One Sonnet 5 agent alone: about ${usd(s.soloActual.usd)} in ${mins(s.soloActual.minutes)}.` : '.'} {caughtLine(s)}.
        </div>
      )}
      <div>
        <h3>
          <span className="num">{commits}</span> commit{commits === 1 ? '' : 's'}
          {out.length > 0 && (
            <>
              , <span className="num">{inPr.length}</span> of <span className="num">{work.length}</span> tasks
            </>
          )}
        </h3>
        <div className="list">
          {inPr.flatMap((t) => {
            const check = [...t.checks].reverse().find((c) => c.pass)
            const row = (
              <button key={t.id} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
                <Mark pass />
                <span className="grow">
                  {t.name}
                  <span className="sub">
                    By the {s.farmers[t.farmer]?.label ?? t.farmer}
                    {check ? `, checked by the ${s.farmers[check.by]?.label ?? check.by}` : ''}
                  </span>
                </span>
                <span className="mono">{cents(t.usd)}</span>
              </button>
            )
            return [
              row,
              ...(t.changes ?? []).map((c, i) => (
                <button key={`${t.id}-${i}`} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
                  <Mark pass />
                  <span className="grow">
                    {t.name}: changed
                    <span className="sub">{isOwnWay(c) ? c : `You asked: ${c}`}</span>
                  </span>
                </button>
              )),
            ]
          })}
          {out.map((t) => (
            <button key={t.id} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
              <Mark pass={false} />
              <span className="grow">
                {t.name}
                <span className="sub">Stopped, left out of this pull request</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {merged && (
        <div>
          <h3>Release</h3>
          <div className="list">
            {s.deploy.map((d) => (
              <div key={d.t}>
                {d.stage === 'rollback' ? <Mark pass={false} /> : <Ico name="play" size={16} tone="green" />}
                <span className="grow">
                  {d.stage === 'rollback' ? (d.reason === BY_YOU ? 'Rolled back by you' : 'Rolled back by itself') : d.stage === '100%' ? 'Live for everyone' : 'Live for 10% of users'}
                  {d.stage === 'rollback' && d.reason !== BY_YOU && d.reason ? <span className="sub">{d.reason}</span> : null}
                </span>
                <span className="mono">{mins(Math.round(d.t / 60000))}</span>
              </div>
            ))}
          </div>
          <Rollout state={s} compact />
        </div>
      )}
      {decided.length > 0 && (
        <div>
          <h3>Your decisions on it</h3>
          <div className="list">
            {decided.map((a) => (
              <div key={a.id}>
                <Swatch farmer={a.farmer} />
                <span className="grow">
                  {a.answer!.choice}
                  <span className="sub">{a.question}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {p.kind === 'sample' && s.done && (
        <button className="btn sm" onClick={() => store.open(p.id)}>
          <Ico name="back" size={20} />
          Watch it again
        </button>
      )}
    </Panel>
  )
}

export const MOMENTS: { key: Moment | 'rollback'; label: string; auto: string }[] = [
  { key: 'cost', label: 'A task goes over its limit', auto: 'The Planner splits or trims it' },
  { key: 'disagree', label: 'Two agents disagree', auto: 'The Planner picks whichever fits the task’s goal' },
  { key: 'failed', label: 'A check fails', auto: 'The agent fixes it and checks again' },
  { key: 'big', label: 'A big change across many files', auto: 'Lands it as one commit, with every test run before and after' },
  { key: 'ship', label: 'Merging the pull request', auto: 'Merges when every check passes, then ships to 10% first' },
  { key: 'reship', label: 'Shipping again after a rollback', auto: 'Ships to 10% again once fixed' },
  { key: 'rollback', label: 'A rollout goes bad', auto: 'Rolls back by itself, always' },
]

export const LEVELS: { key: AutonomyLevel; label: string }[] = [
  { key: 'often', label: 'Often' },
  { key: 'matters', label: 'When it matters' },
  { key: 'undoable', label: 'Only what’s hard to undo' },
]

// What a level stops for, read off its autonomy preset: one line under each option in the menu.
const ASKS_ABOUT: Record<Moment, string> = {
  cost: 'cost',
  disagree: 'disagreements',
  failed: 'failed checks',
  big: 'big changes',
  ship: 'merging',
  reship: 'shipping again after a rollback',
}
export function asksAbout(a: Autonomy): string {
  const on = (Object.keys(ASKS_ABOUT) as Moment[]).filter((m) => a[m] === 'ask').map((m) => ASKS_ABOUT[m])
  if (!on.length) return 'Nothing: it handles every moment itself'
  const list = on.length > 1 ? `${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}` : on[0]
  const line = list.charAt(0).toUpperCase() + list.slice(1)
  return on.length <= 2 ? `${line} only` : line
}

// "Ask me: When it matters ▾": one compact field that opens a menu of the levels, each with what it asks about.
// Arrow keys move, Enter picks, Esc closes.
export function LevelPicker({ p, compact = false }: { p: Project; compact?: boolean }) {
  return <AskMe level={p.level} up={compact} onPick={(k) => store.setAutonomy(p.id, k, { ...AUTONOMY_PRESETS[k] })} />
}

export function AskMe({ level, onPick, up = false }: { level: AutonomyLevel | 'custom'; onPick: (k: AutonomyLevel) => void; up?: boolean }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = LEVELS.find((l) => l.key === level)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const pick = (k: AutonomyLevel) => {
    onPick(k)
    setOpen(false)
    trigger.current?.focus()
  }
  const show = () => {
    setAt(Math.max(0, LEVELS.findIndex((l) => l.key === level)))
    setOpen(true)
  }
  const keys = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAt((at + 1) % LEVELS.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAt((at + LEVELS.length - 1) % LEVELS.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(LEVELS[at].key)
    } else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <div className={`ask-me${up ? ' up' : ''}`} ref={box} onKeyDown={keys}>
      <button
        ref={trigger}
        className="field-box select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Check with me: ${current?.label ?? 'Custom'}`}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span className="ask-label">Check with me:</span> <b>{current?.label ?? 'Custom'}</b>
      </button>
      {open && (
        <ul className="ask-menu paper" role="listbox" aria-label="How often the agents check with you" aria-activedescendant={`ask-${LEVELS[at].key}`} tabIndex={-1}>
          {LEVELS.map((l, i) => (
            <li
              key={l.key}
              id={`ask-${l.key}`}
              role="option"
              aria-selected={level === l.key}
              className={`${i === at ? 'at' : ''}${level === l.key ? ' on' : ''}`}
              onMouseEnter={() => setAt(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(l.key)}
            >
              <b>{l.label}</b>
              <span>{asksAbout(AUTONOMY_PRESETS[l.key])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function setMoment(p: Project, k: Moment, v: 'ask' | 'auto') {
  const next: Autonomy = { ...p.autonomy, [k]: v }
  const level = (Object.keys(AUTONOMY_PRESETS) as AutonomyLevel[]).find((l) => MOMENTS.every((m) => m.key === 'rollback' || AUTONOMY_PRESETS[l][m.key] === next[m.key]))
  store.setAutonomy(p.id, level ?? 'custom', next)
}

export function ControlPanel({ p }: { p: Project }) {
  const set = (k: Moment, v: 'ask' | 'auto') => setMoment(p, k, v)
  return (
    <Panel label="How often the agents check with you">
      <div>
        <h3>Control</h3>
        <h2>How often should the agents check with you?</h2>
      </div>
      <LevelPicker p={p} />
      <div className="moments">
        {MOMENTS.map((m) => {
          const locked = m.key === 'rollback'
          const v = locked ? 'auto' : p.autonomy[m.key as Moment]
          return (
            <div className="moment" key={m.key}>
              <span className="grow">
                {m.label}
                <span className="sub">
                  {v === 'ask' ? 'Asks you first, with a suggested answer' : m.auto}
                  {m.key === 'ship' && v === 'ask' ? `. Clean runs in a row: ${Math.min(3, p.cleanRuns ?? 0)} of 3${p.everSentBack ? '. Not offered: you sent work back on this project' : store.kit[p.id]?.deployer?.rules.deploy === false ? '. Not offered while May deploy is off' : ''}` : ''}
                </span>
              </span>
              <div className="seg" role="radiogroup" aria-label={m.label}>
                <button role="radio" aria-checked={v === 'ask'} className={v === 'ask' ? 'on' : ''} disabled={locked} onClick={() => set(m.key as Moment, 'ask')}>
                  Ask me
                </button>
                <button role="radio" aria-checked={v === 'auto'} className={v === 'auto' ? 'on' : ''} disabled={locked} onClick={() => set(m.key as Moment, 'auto')}>
                  Just do it
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {p.approved && <p className="fine">Changing this restarts the run.</p>}
    </Panel>
  )
}
