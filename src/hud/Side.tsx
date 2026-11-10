// The wood panel on the right: one page at a time (a task, a farmer, the inbox, spend, the harvest, control).
import { useState } from 'react'
import { CREW } from '../agent/agents'
import { store, type Project } from '../run/store'
import type { Autonomy, AutonomyLevel, FarmerId, Moment, RunState, TaskState } from '../run/types'
import { AUTONOMY_PRESETS, FARMER_ORDER } from '../run/types'
import { Ico, Mark, Portrait, Swatch, mins, usd } from './bits'
import { ProofView, Rollout } from './Proof'

const STATUS: Record<TaskState['status'], string> = {
  waiting: 'Not started',
  growing: 'Growing',
  checking: 'Being checked',
  wilted: 'Failed a check',
  ripe: 'Done and checked',
  accepted: 'Accepted and in the chest',
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
          {t.gate && s.deploy.length && s.deploy[s.deploy.length - 1].stage === 'rollback' && t.status !== 'ripe' ? <b>Rolled back by itself. </b> : null}
          {STATUS[t.status]}
          {t.status === 'growing' ? `, about ${Math.round(t.progress * 100)}% there.` : '.'} {f && t.status !== 'ripe' && t.status !== 'accepted' ? `${f.label} is on it.` : ''}{t.status === 'accepted' && t.acceptedBy && t.acceptedBy !== 'you' ? ` The ${s.farmers[t.acceptedBy]?.label ?? 'checker'} accepted it when its check passed.` : ''}
          {t.summary && t.status === 'ripe' ? ` ${t.summary}.` : ''}
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
              {usd(t.usd)} so far
            </span>
          </>
        )}
        {t.gate && <span className="tag sky">Waits for you</span>}
      </div>

      {!planning && t.status === 'ripe' && !t.gate && <Review t={t} s={s} />}

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

// Finished work waits for you: accept it into the chest, or send it back with a note.
function Review({ t, s }: { t: TaskState; s: RunState }) {
  const [note, setNote] = useState('')
  const [writing, setWriting] = useState(false)
  const check = t.checks[t.checks.length - 1]
  return (
    <div className="review paper">
      <p>
        {t.sentBack ? <>Changed as you asked: “{t.sentBack}”. </> : null}
        {check ? <>Checked by the {s.farmers[check.by]?.label ?? check.by}: {check.notes}.</> : 'Done.'}
      </p>
      {writing ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!note.trim()) return
            store.sendBack(t.id, note.trim())
            setWriting(false)
            setNote('')
          }}
        >
          <span className="field grow"><input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" aria-label="What should change" /></span>
          <button className="btn xs" type="submit">Send back</button>
        </form>
      ) : (
        <div className="row">
          <button className="btn sm" onClick={() => store.accept(t.id)}>
            <Ico name="check" size={20} />
            Accept
          </button>
          <button className="btn tan sm" onClick={() => setWriting(true)}>
            Send back with a note
          </button>
        </div>
      )}
    </div>
  )
}

export function FarmerPanel({ s, id, p }: { s: RunState; id: FarmerId; p: Project }) {
  const f = s.farmers[id]
  if (!f) return null
  const mine = s.tasks.filter((t) => t.farmer === id)
  const pct = Math.min(1, f.usd / Math.max(0.01, f.limits.usd))
  const agent = f.agent === 'claude-code' ? 'Claude Code' : f.agent
  const words = { idle: 'Waiting for its next task', working: f.lastTool ?? 'Working', stuck: 'Fixing a failed check', needs: 'Waiting for you', done: 'Finished' }[f.state]
  return (
    <Panel label={`Farmer: ${f.label}`}>
      <div className="farmer-head">
        <div className="portrait sm">
          <Portrait farmer={id} size={72} />
        </div>
        <div>
          <h3>Farmer</h3>
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

export function InboxPanel({ s }: { s: RunState }) {
  const open = s.asks.filter((a) => !a.answer)
  const review = s.tasks.filter((t) => t.status === 'ripe' && !t.gate)
  const decided = s.asks.filter((a) => a.answer).reverse()
  const fixed = [...s.autoFixes].reverse()
  return (
    <Panel label="Inbox">
      <div>
        <h3>Inbox</h3>
        <h2>{open.length + review.length ? `${open.length + review.length} need${open.length + review.length === 1 ? 's' : ''} you` : 'Nothing needs you'}</h2>
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
      {review.length > 0 && (
        <div>
          <h3>Ready for you to review</h3>
          <div className="list">
            {review.map((t) => (
              <button key={t.id} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
                <Swatch farmer={t.farmer} />
                <span className="grow">
                  {t.name}
                  <span className="sub">{t.sentBack ? `Changed: ${t.sentBack}` : t.doneWhen}</span>
                </span>
              </button>
            ))}
          </div>
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
                <span className="sub">{ago(s, x.t)}</span>
              </span>
            </button>
          ))}
          {!fixed.length && <div className="sub">Nothing yet.</div>}
        </div>
      </div>
      <div>
        <h3>You decided</h3>
        <div className="list">
          {decided.map((a) => (
            <button key={a.id} onClick={() => a.task && store.setDrawer({ kind: 'task', id: a.task })}>
              <Swatch farmer={a.farmer} />
              <span className="grow">
                {a.answer!.choice}
                <span className="sub">{a.question}</span>
              </span>
            </button>
          ))}
          {!decided.length && <div className="sub">Nothing yet.</div>}
        </div>
      </div>
      <button className="btn tan sm" onClick={() => store.setDrawer({ kind: 'control' })}>
        <Ico name="gear" size={20} />
        How often the crew stops for you
      </button>
    </Panel>
  )
}

interface Fix {
  key: string
  farmer: FarmerId
  title: string
  why: string
  saves: number
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
        <span className="sub">Saves {usd(fix.saves)} a run</span>
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
  if (designer && designer.model.includes('Opus')) out.push({ key: 'shots', farmer: 'designer', title: 'Run the Designer on Claude Sonnet 5.5', why: 'Its screenshot checks don’t need the bigger model.', saves: designer.usd * 0.5, model: 'Claude Sonnet 5.5' })
  for (const r of s.replans) {
    const t = s.tasks.find((x) => r.added.includes(x.id))
    if (t) out.push({ key: `split-${t.id}`, farmer: 'planner', title: `Plan "${t.name.split(': ')[1] ?? t.name}" as two tasks from the start`, why: 'It was split mid-run after going over its limit.', saves: 0.25 })
  }
  return out
}

// What the crew bought you, against one agent doing it all: time, money, and what got caught on the way.
export function caught(s: RunState): { where: string; what: string }[] {
  const out: { where: string; what: string }[] = []
  for (const t of s.tasks) for (const c of t.checks) if (!c.pass) out.push({ where: t.name, what: c.notes })
  // A rollback only counts as caught when it came after the 10% stage; after a full ship every user already saw it.
  s.deploy.forEach((d, i) => {
    if (d.stage === 'rollback' && s.deploy[i - 1]?.stage !== '100%') out.push({ where: 'Rollout', what: d.reason ?? 'Errors passed 2% at 10%, so it rolled back on its own' })
  })
  return out
}

export function CrewVsAlone({ s }: { s: RunState }) {
  const crew = s.estimate
  const one = s.singleAgentEstimate
  const n = FARMER_ORDER.filter((id) => s.farmers[id]).length
  if (!crew || !one || n < 2) return null
  const sooner = one.minutes - crew.minutes
  const less = one.usd - crew.usd
  const found = caught(s)
  return (
    <div className="vs">
      <h3>Crew vs one agent</h3>
      <p className="vs-gap">
        <span className="big">{mins(sooner)}</span> sooner{less > 0.5 ? <>, <b>{usd(less)}</b> less</> : less < -0.5 ? <>, <b>{usd(-less)}</b> more</> : null}
      </p>
      <div className="vs-grid" role="table">
        <span role="columnheader" />
        <span role="columnheader">This crew</span>
        <span role="columnheader">One agent</span>
        <span>Time</span>
        <b>{mins(crew.minutes)}</b>
        <span>{mins(one.minutes)}</span>
        <span>Cost</span>
        <b>{usd(crew.usd)}</b>
        <span>{usd(one.usd)}</span>
        <span>Caught</span>
        <b>{found.length}</b>
        <span>Unchecked</span>
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
        <h3>By farmer</h3>
        <div className="crew-spend">
          {ids.map((id) => {
            const f = s.farmers[id]!
            const spike = f.usd > f.limits.usd * 0.85
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
                {spike && <span className="returned"><b className="warn">Near its limit</b></span>}
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

// The chest is the pull request: a commit per accepted task, the checks that ran on it, then the merge and rollout.
export function HarvestPanel({ s, p }: { s: RunState; p: Project }) {
  const built = s.tasks.filter((t) => !t.gate)
  const inPr = built.filter((t) => t.status === 'accepted')
  const waiting = built.filter((t) => t.status === 'ripe')
  const decided = s.asks.filter((a) => a.answer)
  const est = s.estimate
  const merged = s.deploy.length > 0
  const live = s.deploy[s.deploy.length - 1]?.stage
  const state = !merged ? 'Open' : live === '100%' ? 'Live for everyone' : live === 'rollback' ? 'Rolled back' : 'Merged, live for 10%'
  return (
    <Panel label="Pull request">
      <div>
        <h3>Pull request</h3>
        <h2>{p.name}</h2>
        <div className="meta pr-meta">
          <span className={`tag ${merged ? (live === 'rollback' ? 'red' : 'green') : 'grey'}`}>{state}</span>
          <span className="mono">homestead/{p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}</span>
        </div>
      </div>
      {s.done && est && (
        <div className="sum">
          {usd(s.done.usd)} and {mins(s.done.minutes)}, against about {usd(est.usd)} and {mins(est.minutes)} planned.
          {s.singleAgentEstimate && s.singleAgentEstimate.minutes > est.minutes
            ? ` About ${mins(s.singleAgentEstimate.minutes - est.minutes)} sooner than one agent alone, and ${caught(s).length || 'no'} problem${caught(s).length === 1 ? '' : 's'} caught before users saw ${caught(s).length === 1 ? 'it' : 'them'}.`
            : ''}
        </div>
      )}
      <div>
        <h3>Commits, one per accepted task</h3>
        <div className="list">
          {inPr.map((t) => {
            const check = [...t.checks].reverse().find((c) => c.pass)
            return (
              <button key={t.id} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
                <Mark pass />
                <span className="grow">
                  {t.name}
                  <span className="sub">
                    By the {s.farmers[t.farmer]?.label ?? t.farmer}
                    {check ? `, checked by the ${s.farmers[check.by]?.label ?? check.by}` : ''}
                  </span>
                </span>
                <span className="mono">{usd(t.usd)}</span>
              </button>
            )
          })}
          {!inPr.length && <div className="sub">Nothing accepted yet.</div>}
        </div>
      </div>
      {waiting.length > 0 && (
        <div>
          <h3>Waiting for you to accept</h3>
          <div className="list">
            {waiting.map((t) => (
              <button key={t.id} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
                <Swatch farmer={t.farmer} />
                <span className="grow">
                  {t.name}
                  <span className="sub">{t.doneWhen}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {s.deploy.length > 0 && (
        <div>
          <h3>After the merge</h3>
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
  { key: 'disagree', label: 'Two farmers disagree', auto: 'The Planner picks, using the done-when' },
  { key: 'failed', label: 'A check fails', auto: 'The farmer fixes it and checks again' },
  { key: 'big', label: 'A big change across many files', auto: 'Lands it as one commit, with every test run before and after' },
  { key: 'review', label: 'A task is finished', auto: 'Accepted once its check passes' },
  { key: 'ship', label: 'Shipping to real users', auto: 'Ships to 10% first' },
  { key: 'reship', label: 'Shipping again after a rollback', auto: 'Ships to 10% again once fixed' },
  { key: 'rollback', label: 'A rollout goes bad', auto: 'Rolls back by itself, always' },
]

export const LEVELS: { key: AutonomyLevel; label: string }[] = [
  { key: 'often', label: 'Often' },
  { key: 'matters', label: 'When it matters' },
  { key: 'undoable', label: 'Only what’s hard to undo' },
]

export function LevelPicker({ p, compact = false }: { p: Project; compact?: boolean }) {
  return (
    <div className={`levels${compact ? ' compact' : ''}`} role="radiogroup" aria-label="How often the crew stops for you">
      {LEVELS.map((l) => (
        <button key={l.key} role="radio" aria-checked={p.level === l.key} className={p.level === l.key ? 'on' : ''} onClick={() => store.setAutonomy(p.id, l.key, { ...AUTONOMY_PRESETS[l.key] })}>
          {l.label}
        </button>
      ))}
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
    <Panel label="How often the crew stops for you">
      <div>
        <h3>Control</h3>
        <h2>How often should the crew stop for you?</h2>
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
                <span className="sub">{v === 'ask' ? 'Asks you first, with a suggested answer' : m.auto}</span>
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
      {p.approved && <p className="fine">Changing this replays the run from the start with the new setting.</p>}
    </Panel>
  )
}
