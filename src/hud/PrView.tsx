// The pull request, the way GitHub shows it when you open one: the title, its state, what it merges, the lines
// and files it changes, and its checks. Commits, Checks and Files changed open the rest, with the diffs.
import './pr.css'
import { useMemo, useState } from 'react'
import { store, type Project } from '../run/store'
import { branchOf, prOf, type Commit, type Pr, type PrFile, type Row } from '../run/files'
import { SEND_BACK } from '../run/simulate'
import { isOwnWay } from '../run/discuss'
import { BY_YOU } from '../run/rollback'
import type { Ask, FarmerId, RunState, TaskState } from '../run/types'
import { FARMER_ORDER } from '../run/types'
import { Ico, Mark, Portrait, Swatch, mins, usd } from './bits'
import { Rollout } from './Proof'
import { caughtLine } from './Side'
import { ExportButtons } from './Export'
import { soloLine } from '../run/export'

type Tab = 'conversation' | 'commits' | 'checks' | 'files'

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const sha = (id: string) => hash(id).toString(16).padStart(8, '0').slice(0, 7)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const isShipAsk = (a: Ask) => a.reason === 'irreversible' && /merge/i.test(a.suggested)

// The title is the goal's first clause, as a person would name the pull request.
export function titleOf(goal: string) {
  let first = goal.replace(/[.!?]+$/, '').split(/,\s+(?:and\s+)?|;\s+/)[0]
  // "Build an AI support assistant that answers…" is titled "Build an AI support assistant".
  const lead = first.split(/\s+(?:that|which|so|to help)\s+/)[0]
  if (lead.split(/\s+/).length >= 3) first = lead
  if (first.length <= 72) return first
  const cut = first.slice(0, 72)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

function stateOf(s: RunState, pr: Pr) {
  const work = s.tasks.filter((t) => !t.gate && !(t.stopped && t.status !== 'accepted'))
  const inPr = work.filter((t) => t.status === 'accepted')
  const last = s.deploy[s.deploy.length - 1]
  if (last) return { key: 'merged' as const, label: 'Merged', rolledBack: last.stage === 'rollback' }
  if (!pr.files.length) return { key: 'draft' as const, label: 'Draft', rolledBack: false }
  if (inPr.length < work.length) return { key: 'draft' as const, label: 'Draft', rolledBack: false }
  return { key: 'open' as const, label: 'Open', rolledBack: false }
}

const label = (s: RunState, f: FarmerId | undefined) => (f ? s.farmers[f]?.label ?? f : '')

export function PrView({ s, p }: { s: RunState; p: Project }) {
  const pr = useMemo(() => prOf(s, p.goal), [s, p.goal])
  const [tab, setTab] = useState<Tab>('conversation')
  const [path, setPath] = useState<string | null>(null)
  const state = stateOf(s, pr)
  const commits = pr.commits.length
  const checks = s.tasks.flatMap((t) => t.checks.map((c) => ({ ...c, task: t })))
  const failing = s.tasks.filter((t) => t.status === 'wilted').length
  const passedChecks = checks.filter((c) => c.pass).length
  const branch = branchOf(p.name)
  const merger = s.activity.find((a) => /merged the pull request|pushed straight to main/i.test(a.text))?.farmer
  const openFile = (to: string) => {
    setPath(to)
    setTab('files')
  }

  return (
    <aside className="side wood prv" aria-label="Pull request">
      <button className="close btn white xs" onClick={() => store.setDrawer(null)} aria-label="Close">
        <Ico name="cross" size={16} />
      </button>
      <header className="prv-head">
        <h2>
          {titleOf(p.goal)} <span className="prv-num">#{(hash(p.id) % 90) + 10}</span>
        </h2>
        <div className="prv-state">
          <span className={`prv-pill ${state.key}`}>{state.label}</span>
          <span className="prv-what">
            {state.key === 'merged' ? (
              <>
                <b>The {label(s, merger) || 'Deployer'}</b> merged {plural(commits, 'commit')} into <code>main</code> from <code>{branch}</code>
              </>
            ) : commits ? (
              <>
                <b>The agents</b> want to merge {plural(commits, 'commit')} into <code>main</code> from <code>{branch}</code>
              </>
            ) : (
              <>
                <b>The agents</b> are writing on <code>{branch}</code>. No commits yet.
              </>
            )}
          </span>
          {state.rolledBack && <span className="tag red">Rolled back</span>}
          <ExportButtons p={p} s={s} />
        </div>
      </header>

      <div className="prv-stats">
        <span>
          <b className={pr.add ? 'add' : undefined}>+{pr.add}</b>
          lines added
        </span>
        <span>
          <b className={pr.del ? 'del' : undefined}>−{pr.del}</b>
          lines removed
        </span>
        <span>
          <b>{pr.files.length}</b>
          {pr.files.length === 1 ? 'file' : 'files'} changed
        </span>
        <span>
          <b>{commits}</b>
          {commits === 1 ? 'commit' : 'commits'}
        </span>
        <span>
          <b className={failing ? 'del' : undefined}>{passedChecks}</b>
          {failing ? `checks passed, ${failing} failing` : `${passedChecks === 1 ? 'check' : 'checks'} passed`}
        </span>
      </div>

      <nav className="prv-tabs" role="tablist">
        {(
          [
            ['conversation', 'Conversation', null],
            ['commits', 'Commits', commits],
            ['checks', 'Checks', checks.length],
            ['files', 'Files changed', pr.files.length],
          ] as const
        ).map(([k, name, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {name}
            {n !== null && <span className="prv-count">{n}</span>}
          </button>
        ))}
      </nav>

      <div className="prv-body">
        {tab === 'conversation' && <Conversation s={s} p={p} pr={pr} state={state.key} failing={failing} openFile={openFile} />}
        {tab === 'commits' && <Commits s={s} pr={pr} openFile={openFile} />}
        {tab === 'checks' && <Checks s={s} />}
        {tab === 'files' && <Files s={s} pr={pr} path={path} setPath={setPath} ask={s.asks.find((a) => !a.answer && isShipAsk(a))} />}
      </div>
    </aside>
  )
}

function Avatar({ farmer, size = 32 }: { farmer: FarmerId; size?: number }) {
  return (
    <span className="prv-avatar" style={{ width: size, height: size }}>
      <Portrait farmer={farmer} size={size} />
    </span>
  )
}

function Conversation({ s, p, pr, state, failing, openFile }: { s: RunState; p: Project; pr: Pr; state: 'draft' | 'open' | 'merged'; failing: number; openFile: (path: string) => void }) {
  const work = s.tasks.filter((t) => !t.gate)
  const proofs = s.tasks.flatMap((t) => t.checks.filter((c) => c.pass).map((c) => c.proof))
  const tests = proofs.reduce((n, x) => n + (x?.tests?.filter((t) => t.pass).length ?? 0), 0)
  const shots = proofs.reduce((n, x) => n + (x?.shots?.length ?? 0), 0)
  const passed = s.tasks.reduce((n, t) => n + t.checks.filter((c) => c.pass).length, 0)
  // A teammate's pull request is theirs to review: no merge or request-changes controls on it.
  const ask = s.asks.find((a) => !a.answer && isShipAsk(a))
  const planner: FarmerId = s.farmers.planner ? 'planner' : (FARMER_ORDER.find((f) => s.farmers[f]) ?? 'builder')
  const reviewers = [...new Set(s.tasks.flatMap((t) => t.checks.map((c) => c.by)))]
  const assignees = FARMER_ORDER.filter((f) => s.tasks.some((t) => t.farmer === f && !t.gate))
  const now = workingNow(s, pr)
  const last = s.deploy[s.deploy.length - 1]
  const live = !!last && last.stage !== 'rollback' && !s.tasks.some((t) => t.gate && t.stopped)
  const decided = s.asks.filter((a) => a.answer)

  return (
    <div className="prv-conv">
      <div className="prv-main">
        {now.length > 0 && (
          <section className="prv-now" aria-label="Working now">
            <h4>Working now</h4>
            {now.map((w) => (
              <div key={w.farmer} className="prv-now-row">
                <Avatar farmer={w.farmer} size={28} />
                <span className="grow">
                  <b>The {label(s, w.farmer)}</b> {w.verb} {w.task}
                  {w.path && (
                    <button className="prv-path" onClick={() => openFile(w.path!)}>
                      {w.path}
                    </button>
                  )}
                </span>
                <i className="live-dot" aria-label="live" />
              </div>
            ))}
          </section>
        )}

        <article className="prv-comment">
          <div className="prv-comment-head">
            <Avatar farmer={planner} size={28} />
            <span>
              <b>The {label(s, planner)}</b> opened this pull request
            </span>
          </div>
          <div className="prv-comment-body">
            <p>{p.goal.replace(/([^.!?])$/, '$1.')}</p>
            <h4>What's in it</h4>
            <ul className="prv-tasks">
              {work.map((t) => (
                <li key={t.id}>
                  <TaskMark t={t} />
                  <span className="grow">
                    {t.name}
                    <span className="sub">{taskLine(s, t)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <h4>How it was checked</h4>
            <p className="prv-checked">
              {passed ? (
                <>
                  {plural(passed, 'check')} passed{tests ? `, ${plural(tests, 'test')}` : ''}
                  {shots ? `, ${plural(shots, 'screenshot')}` : ''}. Nobody checks their own work. {caughtLine(s)}.
                </>
              ) : (
                'Each task is reviewed by a different agent before it is committed.'
              )}
            </p>
          </div>
        </article>

        <ReviewLoop s={s} p={p} pr={pr} openFile={openFile} />
        <MergeBox s={s} p={p} state={state} failing={failing} ask={ask} live={live} />
      </div>

      <aside className="prv-sidebar">
        <div>
          <h4>Reviewers</h4>
          {reviewers.length ? (
            reviewers.map((f) => (
              <div key={f} className="prv-person">
                <Swatch farmer={f} />
                <span className="grow">{label(s, f)}</span>
                <Mark pass />
              </div>
            ))
          ) : (
            <p className="fine">No checks yet</p>
          )}
        </div>
        <div>
          <h4>Assignees</h4>
          {assignees.map((f) => (
            <div key={f} className="prv-person">
              <Swatch farmer={f} />
              <span className="grow">{label(s, f)}</span>
              {s.farmers[f]?.state === 'working' && <i className="live-dot" aria-label="working" />}
            </div>
          ))}
        </div>
        <div>
          <h4>Spent</h4>
          <p className="prv-side-num">{usd(s.usage.usd)}</p>
          {s.done && s.soloActual && <p className="fine">{soloLine(s, true)}</p>}
        </div>
        {decided.length > 0 && (
          <div>
            <h4>Your decisions</h4>
            {decided.map((a) => (
              <p key={a.id} className="prv-decision">
                {a.answer!.choice}
              </p>
            ))}
          </div>
        )}
      </aside>
    </div>
  )
}

function TaskMark({ t }: { t: TaskState }) {
  if (t.status === 'accepted') return <Mark pass />
  if (t.stopped || t.status === 'wilted') return <Mark pass={false} />
  if (t.status === 'growing') return <i className="live-dot" aria-label="being written" />
  return <span className="prv-todo" aria-label={t.status === 'waiting' ? 'not started' : 'being checked'} />
}

function taskLine(s: RunState, t: TaskState) {
  const by = `The ${label(s, t.farmer)}`
  if (t.stopped && t.status !== 'accepted') return `${by}. Stopped, left out of this pull request`
  if (t.status === 'accepted') {
    const c = [...t.checks].reverse().find((x) => x.pass)
    return c ? `${by}, checked by the ${label(s, c.by)}` : by
  }
  if (t.status === 'growing') return `${by} is writing it`
  if (t.status === 'checking' || t.status === 'ripe') return `${by}. Being checked`
  if (t.status === 'wilted') return `${by}. Failed a check, being fixed`
  return `${by}. Not started`
}

// Each farmer with work in hand, and the file it is in.
function workingNow(s: RunState, pr: Pr) {
  const out: { farmer: FarmerId; verb: string; task: string; path?: string }[] = []
  for (const f of FARMER_ORDER) {
    const fr = s.farmers[f]
    if (!fr || (fr.state !== 'working' && fr.state !== 'stuck')) continue
    const t = s.tasks.find((x) => x.id === fr.task)
    if (!t || t.gate) continue
    const writing = pr.live.find((l) => l.farmer === f)
    if (writing) out.push({ farmer: f, verb: fr.state === 'stuck' ? 'is fixing' : 'is writing', task: t.name, path: writing.path })
    else if (t.farmer !== f || t.status === 'checking') out.push({ farmer: f, verb: 'is checking', task: t.name })
  }
  return out
}

function Stat({ add, del }: { add: number; del: number }) {
  if (!add && !del) return null
  return (
    <span className="prv-stat">
      <b className="add">+{add}</b> <b className="del">−{del}</b>
    </span>
  )
}

function Commits({ s, pr, openFile }: { s: RunState; pr: Pr; openFile: (path: string) => void }) {
  const out = s.tasks.filter((t) => !t.gate && t.stopped && t.status !== 'accepted')
  if (!pr.commits.length && !out.length) return <p className="prv-empty">No commits yet. A task is committed when another agent's review passes.</p>
  return (
    <div className="list prv-list">
      {pr.commits.map((c: Commit) => (
        <button key={c.id} onClick={() => c.files[0] && openFile(c.files[0])}>
          <Avatar farmer={c.farmer} size={28} />
          <span className="grow">
            <b>{c.message}</b>
            <span className="sub">
              {c.kind === 'change' ? (isOwnWay(c.check ?? '') ? c.check : `You asked: ${c.check}`) : `The ${label(s, c.farmer)}${c.checkedBy ? `, checked by the ${label(s, c.checkedBy)}: ${c.check}` : c.check ? `: ${c.check}` : ''}`}
            </span>
          </span>
          <span className="prv-files-n">{plural(c.files.length, 'file')}</span>
          <Stat add={c.add} del={c.del} />
          <code>{sha(c.id)}</code>
        </button>
      ))}
      {out.map((t) => (
        <div key={t.id}>
          <Mark pass={false} />
          <span className="grow">
            {t.name}
            <span className="sub">Stopped, left out of this pull request</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function Checks({ s }: { s: RunState }) {
  const rows = s.tasks.flatMap((t) => t.checks.map((c, i) => ({ c, t, i }))).sort((a, b) => b.c.t - a.c.t)
  if (!rows.length) return <p className="prv-empty">No checks yet.</p>
  return (
    <div className="list prv-list">
      {rows.map(({ c, t, i }) => (
        <button key={`${t.id}-${i}`} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
          <Mark pass={c.pass} />
          <span className="grow">
            {t.name}
            <span className="sub">
              The {label(s, c.by)}: {c.notes}
            </span>
          </span>
          <span className="mono">{mins(Math.round(c.t / 60000))}</span>
        </button>
      ))}
    </div>
  )
}

function Files({ s, pr, path, setPath, ask }: { s: RunState; pr: Pr; path: string | null; setPath: (p: string) => void; ask?: Ask }) {
  if (!pr.files.length) return <p className="prv-empty">No changes yet. Files show up here as the agents write them.</p>
  const file = pr.files.find((f) => f.path === path) ?? pr.files.find((f) => f.live) ?? pr.files[0]
  return (
    <div className="prv-files">
      <ul className="prv-tree" aria-label="Files changed">
        {pr.files.map((f) => {
          const cut = f.path.lastIndexOf('/')
          return (
            <li key={f.path}>
              <button className={f === file ? 'on' : ''} onClick={() => setPath(f.path)} title={f.path}>
                <span className="grow">
                  <span className="dir">{f.path.slice(0, cut + 1)}</span>
                  <b>{f.path.slice(cut + 1)}</b>
                </span>
                {f.live ? <i className="live-dot" aria-label="being written" /> : <Stat add={f.add} del={f.del} />}
              </button>
            </li>
          )
        })}
      </ul>
      <FileDiff key={file.path} s={s} f={file} ask={ask} />
    </div>
  )
}

function FileDiff({ s, f, ask }: { s: RunState; f: PrFile; ask?: Ask }) {
  const [at, setAt] = useState<string | null>(null) // `${part}:${row}` of the line you're commenting on
  const [note, setNote] = useState('')
  const base = f.path.slice(f.path.lastIndexOf('/') + 1)
  return (
    <section className="prv-diff" aria-label={f.path}>
      <header>
        <code>{f.path}</code>
        {f.isNew && <span className="tag green">New</span>}
        <Stat add={f.add} del={f.del} />
      </header>
      {f.parts.map((part, i) => {
        const t = s.tasks.find((x) => x.id === part.task)
        // A line can be sent back while your review is open, on work that is committed.
        const canAsk = !!ask && part.committed && t?.status === 'accepted'
        const fails = (t?.checks ?? []).filter((c) => !c.pass)
        const asked = t?.changes ?? []
        return (
          <div key={i} className="prv-part">
            <p className="prv-part-head">
              <Swatch farmer={part.farmer} />
              <span className="grow">
                {part.summary}
                <span className="sub">
                  The {label(s, part.farmer)}, in {part.taskName}
                  {!part.committed && !part.live ? '. Not committed yet' : ''}
                </span>
              </span>
            </p>
            <table className="prv-code">
              <tbody>
                {part.rows.map((r: Row, j) => {
                  if (r.k === '@')
                    return (
                      <tr key={j} className="hunk">
                        <td colSpan={3}>{r.s}</td>
                      </tr>
                    )
                  const line = r.k === '-' ? r.a : r.b
                  const here = at === `${i}:${j}`
                  const pick = canAsk ? () => { setAt(here ? null : `${i}:${j}`); setNote('') } : undefined
                  return [
                    <tr key={j} className={r.k === '+' ? 'add' : r.k === '-' ? 'del' : ''}>
                      <td className={`ln${pick ? ' pick' : ''}`} onClick={pick} title={pick ? 'Ask for a change on this line' : undefined}>
                        {r.k === '+' ? '' : r.a}
                      </td>
                      <td className={`ln${pick ? ' pick' : ''}`} onClick={pick} title={pick ? 'Ask for a change on this line' : undefined}>
                        {r.k === '-' ? '' : r.b}
                      </td>
                      <td className="code">
                        <span className="sign">{r.k === ' ' ? ' ' : r.k === '-' ? '−' : '+'}</span>
                        {r.s}
                      </td>
                    </tr>,
                    here && ask && (
                      <tr key={`${j}-c`} className="prv-thread">
                        <td colSpan={3}>
                          <form
                            className="row"
                            onSubmit={(e) => {
                              e.preventDefault()
                              if (!note.trim()) return
                              store.sendBack(ask.id, part.task, `${note.trim()} (${base}, line ${line})`)
                              setAt(null)
                            }}
                          >
                            <span className="field">
                              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={`What should change on line ${line}?`} aria-label="What should change" />
                            </span>
                            <button className="btn sm" type="submit" disabled={!note.trim()}>
                              Request change
                            </button>
                          </form>
                        </td>
                      </tr>
                    ),
                  ]
                })}
                {part.live && (
                  <tr className="typing">
                    <td className="ln" />
                    <td className="ln" />
                    <td className="code">
                      <i className="caret" /> The {label(s, part.farmer)} is writing
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {i === f.parts.findIndex((x) => x.task === part.task) && (fails.length > 0 || asked.length > 0) && (
              <div className="prv-notes">
                {fails.map((c, k) => (
                  <p key={`f${k}`} className="prv-note">
                    <Swatch farmer={c.by} />
                    <span className="grow">
                      <b>The {label(s, c.by)} requested changes:</b> {c.notes}
                    </span>
                    {t?.checks.some((x) => x.pass && x.t > c.t) && <span className="prv-badge t-ok">Fixed</span>}
                  </p>
                ))}
                {asked.map((n, k) => (
                  <p key={`a${k}`} className="prv-note">
                    <span className="prv-you">You</span>
                    <span className="grow">
                      <b>You asked:</b> {n}
                    </span>
                    {(t?.checks.filter((x) => x.pass).length ?? 0) > k + 1 && <span className="prv-badge t-ok">Done</span>}
                  </p>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

// The review loop, in the order it happened: commits, each agent's review of another's work, your review,
// the changes that came back, and the merge.
type Item = { t: number; key: string; tone: 'commit' | 'ok' | 'changes' | 'merged' | 'bad'; who: FarmerId | 'you'; text: string; quote?: string; commit?: Commit }

function loopOf(s: RunState, p: Project, pr: Pr): Item[] {
  const items: Item[] = []
  const name = (id: string) => s.tasks.find((t) => t.id === id)?.name ?? id
  for (const c of pr.commits) {
    const text = c.kind === 'change' ? `pushed the change you asked for on ${name(c.task)}` : c.kind === 'fix' ? 'pushed a fix for what caused the rollback' : c.kind === 'refactor' ? `pushed a change across tasks: ${lowerFirst(c.message)}` : `committed ${c.message}`
    items.push({ t: c.t - 0.001, key: c.id, tone: 'commit', who: c.farmer, text, commit: c })
    if (c.checkedBy && c.kind !== 'fix') items.push({ t: c.t, key: `${c.id}-ok`, tone: 'ok', who: c.checkedBy, text: `approved ${name(c.task)}`, quote: c.kind === 'change' ? undefined : c.check })
  }
  for (const t of s.tasks)
    for (const [i, c] of t.checks.entries()) if (!c.pass) items.push({ t: c.t, key: `${t.id}-fail-${i}`, tone: 'changes', who: c.by, text: `requested changes on ${t.name}`, quote: c.notes })
  for (const a of s.asks) {
    if (!a.answer) continue
    if (a.answer.choice === SEND_BACK) {
      const sb = p.sendBacks?.[a.id]
      items.push({ t: a.answer.t, key: `you-${a.id}`, tone: 'changes', who: 'you', text: `requested changes${sb ? ` on ${name(sb.task)}` : ''}`, quote: sb?.note })
    } else if (isShipAsk(a) && /^merge/i.test(a.answer.choice)) items.push({ t: a.answer.t, key: `you-${a.id}`, tone: 'merged', who: 'you', text: 'approved and merged' })
  }
  const self = s.activity.find((x) => /merged the pull request by itself|pushed straight to main/i.test(x.text))
  if (self && !items.some((x) => x.tone === 'merged')) items.push({ t: self.t, key: 'self-merge', tone: 'merged', who: self.farmer ?? 'deployer', text: 'merged it by itself, since every check passed' })
  for (const d of s.deploy) if (d.stage === 'rollback') items.push({ t: d.t, key: `rb-${d.t}`, tone: 'bad', who: d.reason === BY_YOU ? 'you' : 'deployer', text: d.reason === BY_YOU ? 'rolled it back' : 'rolled it back by itself', quote: d.reason === BY_YOU ? undefined : d.reason })
  return items.sort((x, y) => x.t - y.t)
}

const lowerFirst = (x: string) => x.charAt(0).toLowerCase() + x.slice(1)
const TONE: Record<Item['tone'], string | null> = { commit: null, ok: 'Approved', changes: 'Changes requested', merged: 'Merged', bad: 'Rolled back' }

function ReviewLoop({ s, p, pr, openFile }: { s: RunState; p: Project; pr: Pr; openFile: (path: string) => void }) {
  const items = loopOf(s, p, pr)
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const shown = all ? items : items.slice(-8)
  return (
    <section className="prv-loop" aria-label="Reviews and commits">
      <h4>Reviews and commits</h4>
      {!all && items.length > shown.length && (
        <button className="prv-more" onClick={() => setAll(true)}>
          Show {items.length - shown.length} earlier
        </button>
      )}
      {shown.map((x) => (
        <div key={x.key} className={`prv-item t-${x.tone}`}>
          <span className="prv-dot" aria-hidden />
          {x.who === 'you' ? <span className="prv-you">You</span> : <Avatar farmer={x.who} size={24} />}
          <span className="grow">
            <b>{x.who === 'you' ? 'You' : `The ${label(s, x.who)}`}</b> {x.text}
            {x.quote && <q>{x.quote}</q>}
          </span>
          {TONE[x.tone] && <span className={`prv-badge t-${x.tone}`}>{TONE[x.tone]}</span>}
          {x.commit && (
            <button className="prv-sha" onClick={() => x.commit!.files[0] && openFile(x.commit!.files[0])} title="See its files">
              <Stat add={x.commit.add} del={x.commit.del} />
              <code>{sha(x.commit.id)}</code>
            </button>
          )}
        </div>
      ))}
    </section>
  )
}

// GitHub's merge box: what still stands between this and main, and the button once nothing does.
function MergeBox({ s, p, state, failing, ask, live }: { s: RunState; p: Project; state: 'draft' | 'open' | 'merged'; failing: number; ask?: Ask; live: boolean }) {
  const [writing, setWriting] = useState(false)
  const [task, setTask] = useState('')
  const [note, setNote] = useState('')
  const work = s.tasks.filter((t) => !t.gate && !(t.stopped && t.status !== 'accepted'))
  const done = work.filter((t) => t.status === 'accepted')
  const fixing = s.tasks.filter((t) => t.status === 'wilted')
  const sentBack = s.asks.filter((a) => a.answer?.choice === SEND_BACK)
  const lastSent = sentBack[sentBack.length - 1]
  const reopened = lastSent && s.asks.some((a) => isShipAsk(a) && a.t > lastSent.answer!.t)
  const backTask = lastSent && p.sendBacks?.[lastSent.id]
  const mergedBy = s.asks.find((a) => isShipAsk(a) && a.answer && /^merge/i.test(a.answer.choice))

  if (state === 'merged')
    return (
      <section className="prv-merge merged">
        <div className="prv-merge-row">
          <span className="prv-merge-ico merged" aria-hidden>
            <Ico name="check" tone="light" />
          </span>
          <span className="grow">
            <b>Merged into main</b>
            <span className="sub">{s.done ? `${usd(s.done.usd)} in ${mins(s.done.minutes)}` : `${usd(s.usage.usd)} so far`}</span>
          </span>
          {live && (
            <button className="btn tan sm" onClick={() => store.rollBackNow()}>
              <Ico name="back" size={20} />
              Roll back
            </button>
          )}
        </div>
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
      </section>
    )

  // Each gate on the way to main: the farmers' reviews, then yours.
  const agent: Gate = fixing.length
    ? { tone: 'bad', title: `Changes requested on ${fixing.map((t) => t.name).join(', ')}`, sub: 'Its agent is fixing it, then it is reviewed again' }
    : done.length === work.length && done.length
      ? { tone: 'ok', title: 'Approved by the agents', sub: `Every task was reviewed by an agent that didn't write it` }
      : { tone: 'wait', title: `${done.length} of ${work.length} tasks approved`, sub: 'Each task is reviewed by an agent that didn’t write it' }
  const you: Gate =
    p.autonomy.ship === 'auto'
      ? { tone: 'ok', title: 'Your review is not needed', sub: 'You let it merge by itself once every check passes' }
      : mergedBy
        ? { tone: 'ok', title: 'You approved it', sub: '' }
        : ask
          ? { tone: 'you', title: 'Waiting for your review', sub: 'Nothing merges until you approve it' }
          : lastSent && !reopened
            ? { tone: 'bad', title: 'You requested changes', sub: backTask ? `The ${label(s, s.tasks.find((t) => t.id === backTask.task)?.farmer)} is changing ${s.tasks.find((t) => t.id === backTask.task)?.name ?? 'it'}, then it comes back to you` : 'It comes back to you once changed' }
            : { tone: 'wait', title: 'Your review comes next', sub: 'Once the agents approve every task' }

  const committed = done
  return (
    <section className={`prv-merge ${state}`}>
      <GateRow g={agent} />
      <GateRow g={you} />
      {failing === 0 && ask && (
        <>
          {writing ? (
            <form
              className="row prv-send-back"
              onSubmit={(e) => {
                e.preventDefault()
                const id = task || committed[0]?.id
                if (!note.trim() || !id) return
                store.sendBack(ask.id, id, note.trim())
                setWriting(false)
              }}
            >
              <select className="field-box" value={task || committed[0]?.id} onChange={(e) => setTask(e.target.value)} aria-label="Which task">
                {committed.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="field">
                <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" aria-label="What should change" />
              </span>
              <button className="btn" type="submit" disabled={!note.trim()}>
                {SEND_BACK}
              </button>
              <button className="btn tan" type="button" onClick={() => setWriting(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <div className="row">
              <button className="btn" onClick={() => store.answer(ask.id, ask.suggested)}>
                <Ico name="check" />
                {ask.suggested}
              </button>
              {ask.alternatives.includes(SEND_BACK) && (
                <button className="btn tan" onClick={() => setWriting(true)}>
                  Request changes
                </button>
              )}
            </div>
          )}
          <p className="fine">You can also ask for a change on one line, from Files changed.</p>
        </>
      )}
    </section>
  )
}

type Gate = { tone: 'ok' | 'bad' | 'wait' | 'you'; title: string; sub: string }
function GateRow({ g }: { g: Gate }) {
  return (
    <div className="prv-merge-row">
      <span className={`prv-merge-ico ${g.tone}`} aria-hidden>
        <Ico name={g.tone === 'ok' ? 'check' : g.tone === 'bad' ? 'cross' : g.tone === 'you' ? 'alert' : 'pause'} tone="light" />
      </span>
      <span className="grow">
        <b>{g.title}</b>
        {g.sub && <span className="sub">{g.sub}</span>}
      </span>
    </div>
  )
}
