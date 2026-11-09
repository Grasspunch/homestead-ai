// Levels 2 and 3: a step, a task, a file or skill, an activity entry, an output to review.
import { useState, type ReactNode } from 'react'
import type { Nav } from '../sim/engine'
import { LESSON_DATES, INVITE_LIST, ROLE_ORDER } from '../sim/scenario'
import { SUGGESTIONS } from '../sim/library'
import { DOCS } from '../sim/docs'
import type { OutputId } from '../sim/review'
import type { LogEntry, RoleId, Task } from '../sim/types'
import { fmtK, fmtT, Portrait, useEngine } from '../ui'
import { AskOptions, PROV, ReplyBox } from './Cards'
import { Crop, Mark, OutboxHead, Row, SendControls } from './Overview'

export interface ViewSpec {
  title: string
  status?: ReactNode
  body: ReactNode
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h4>
        {title}
        {aside && <span className="soft">{aside}</span>}
      </h4>
      {children}
    </section>
  )
}

// ---- trail names --------------------------------------------------------------

export function navName(n: Nav, e: ReturnType<typeof useEngine>): string {
  switch (n.kind) {
    case 'step':
      return { brief: 'Your brief', clarify: 'Your answers', plan: 'The plan', grow: 'Grow', harvest: 'Harvest' }[n.id]
    case 'task':
      return e.task(n.id).name
    case 'log':
      return 'Activity'
    case 'why':
      return 'Why it’s asking'
    case 'trace':
      return `Why the Writer used ${e.out.draft?.data.launch_date ?? 'March 12'}`
    case 'out':
      return n.id === 'decisions' ? 'Your decisions' : n.id === 'lessons' ? 'Lessons saved' : (e.outputs.find((o) => o.id === n.id)?.title ?? '')
    case 'lib':
      return n.id
    case 'pick':
      return `Add to ${e.task(n.id).name}`
    case 'library':
      return 'Files and skills'
  }
}

export function viewFor(n: Nav, e: ReturnType<typeof useEngine>): ViewSpec {
  const title = navName(n, e)
  switch (n.kind) {
    case 'step':
      return { title, body: <StepView id={n.id} /> }
    case 'task': {
      const t = e.task(n.id)
      const fh = e.farmhands[t.assignee]
      const growing = e.phase === 'grow' || e.phase === 'harvest'
      return { title, status: growing ? `${fh.role}. ${e.taskStatus(t).text}.` : `Proposed for the ${fh.role.toLowerCase()}`, body: <TaskView t={t} /> }
    }
    case 'log':
      return { title, body: <LogView tab={n.tab} /> }
    case 'why': {
      const ask = e.asks.find((a) => a.id === n.id)
      return { title, body: ask ? <WhyView id={n.id} /> : <p className="quiet">Answered.</p> }
    }
    case 'trace':
      return { title, body: <TraceView /> }
    case 'out':
      if (n.id === 'decisions') return { title, body: <DecisionsView /> }
      if (n.id === 'lessons') return { title, body: <LessonsView /> }
      return { title, status: <OutboxHead />, body: <OutputView id={n.id} /> }
    case 'lib': {
      const L = e.lib(n.id)
      return { title, status: `${L.kind === 'skill' ? 'Skill' : 'File'}. ${L.owner}${L.updated ? `, updated ${L.updated}` : ''}.`, body: <LibView name={n.id} /> }
    }
    case 'pick':
      return { title, status: 'Files are facts to read. Skills are how to do the job.', body: <PickView taskId={n.id} /> }
    case 'library':
      return { title, status: 'Everything your crew can read. Files are facts; skills are how to do the job.', body: <LibraryView /> }
  }
}

// ---- steps ------------------------------------------------------------------------

function StepView({ id }: { id: string }) {
  const e = useEngine()
  if (id === 'brief')
    return (
      <>
        <Section title="Goal">
          <p>{e.goal}</p>
        </Section>
        <Section title="Files and skills">
          <ul className="files">
            {e.attachments.map((a) => (
              <li key={a.id} className={a.selected ? '' : 'off'} title={a.selected ? a.note : 'Not attached'}>
                {a.name}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Energy budget">
          <p className="num">{fmtK(e.budget)}</p>
        </Section>
      </>
    )
  if (id === 'clarify')
    return (
      <>
        {e.questions.map((q) => (
          <Section key={q.id} title={q.q}>
            <p>{e.clarifyAnswers[q.id] ?? q.options[0]}</p>
          </Section>
        ))}
      </>
    )
  if (id === 'plan') {
    const approval = e.log.find((l) => l.kind === 'answer' && l.text.startsWith('Approved the quest plan'))
    const replan = e.log.find((l) => l.kind === 'replan')
    return (
      <>
        <p className="quiet">
          Approved at {fmtT(approval?.t ?? 0)}. {approval?.reason ? `${approval.reason}.` : 'No changes.'}
        </p>
        {replan && <p className="quiet">Changed at {fmtT(replan.t)} by the re-plan: the draft now reads eng-standup-notes/.</p>}
        <ul className="rows">
          {e.tasks.map((t) => (
            <li key={t.id}>
              <Row mark={<Crop t={t} />} label={t.name} sub={`${e.farmhands[t.assignee].role}, ${t.signposts.length} files and skills`} end={fmtK(t.budget)} onClick={() => e.go({ kind: 'task', id: t.id })} taskId={t.id} />
            </li>
          ))}
        </ul>
      </>
    )
  }
  return (
    <ul className="rows">
      {e.tasks.map((t) => (
        <li key={t.id}>
          <Row mark={<Crop t={t} />} label={t.name} sub={e.farmhands[t.assignee].role} end="Done" tone="done" onClick={() => e.go({ kind: 'task', id: t.id })} taskId={t.id} />
        </li>
      ))}
      <li>
        <Row label="All activity" end={String(e.log.length)} onClick={() => e.go({ kind: 'log', tab: 'all' })} />
      </li>
    </ul>
  )
}

// ---- a task -------------------------------------------------------------------------

function TaskView({ t }: { t: Task }) {
  const e = useEngine()
  const fh = e.farmhands[t.assignee]
  const planning = e.phase === 'plan'
  const growing = !planning
  const [draft, setDraft] = useState('')
  const firstOpen = t.subtasks.findIndex((s) => !s.done)
  const entries = e.log.filter((l) => l.taskId === t.id).slice().reverse()
  const checks = e.checks.filter((c) => c.taskId === t.id)
  return (
    <>
      <Section title="Farmhand">
        <div className="hand">
          <Portrait color={fh.color} shade={fh.colorDark} />
          {planning ? (
            <select value={t.assignee} onChange={(ev) => e.reassign(t.id, ev.target.value as RoleId)} aria-label={`Assign ${t.name}`}>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {e.farmhands[r].role}
                </option>
              ))}
            </select>
          ) : (
            <span>
              <b>{fh.role}</b> <span className="soft">{e.fhStatus(fh)}</span>
            </span>
          )}
          {growing && e.phase === 'grow' && (
            <button className="btn sm" onClick={() => e.togglePauseFarmhand(fh.id)}>
              {fh.paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>
        {planning && t.proposalNote && t.assignee === t.proposedAssignee && <p className="quiet">{t.proposalNote}</p>}
      </Section>

      <Section title="Steps">
        <ul className="ticks">
          {t.subtasks.map((s, i) => {
            const k = s.done ? 'done' : growing && i === firstOpen && s.started ? 'now' : 'later'
            return (
              <li key={s.id}>
                <Mark k={k} />
                <span>{s.name}</span>
                <span className="soft">{k === 'now' && fh.status === 'working' ? 'Working' : ''}</span>
              </li>
            )
          })}
          {t.pests.map((p) => (
            <li key={p.id} className="warn">
              <Mark k="later" />
              <span>Missing a source: {p.label}</span>
              <span />
            </li>
          ))}
        </ul>
      </Section>

      <Context t={t} />

      <Section title="Done when">
        <ul className="ticks">
          {checks.map((c) => (
            <li key={c.id}>
              <Mark k={e.ticked.has(c.id) ? 'done' : 'later'} />
              <span>{c.text}</span>
              {planning ? (
                <button className="x" onClick={() => e.removeCheck(c.id)} aria-label={`Remove “${c.text}”`}>
                  ×
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
          {!checks.length && <li className="soft">{planning && !e.out.plan ? 'The head farmer proposes these with the plan.' : 'No checks.'}</li>}
        </ul>
        {planning && (
          <form
            className="add-check"
            onSubmit={(ev) => {
              ev.preventDefault()
              e.addCheck(t.id, draft)
              setDraft('')
            }}
          >
            <input value={draft} onChange={(ev) => setDraft(ev.target.value)} placeholder="Add a check" aria-label="Add a check" />
          </form>
        )}
      </Section>

      {growing && (
        <Section title="Activity">
          {entries.length ? (
            <ul className="log">
              {entries.map((l) => (
                <LogLine key={l.id} l={l} />
              ))}
            </ul>
          ) : (
            <p className="soft">Nothing yet.</p>
          )}
        </Section>
      )}
    </>
  )
}

function Context({ t }: { t: Task }) {
  const e = useEngine()
  const planning = e.phase === 'plan'
  const files = t.signposts.filter((s) => e.lib(s).kind === 'file')
  const skills = t.signposts.filter((s) => e.lib(s).kind === 'skill')
  const sugg = planning ? SUGGESTIONS.find((s) => s.taskIds.includes(t.id) && !t.signposts.includes(s.name)) : undefined
  const libRow = (name: string) => {
    const L = e.lib(name)
    return (
      <li key={name}>
        <Row mark={<span className={`kind ${L.kind}`}>{L.kind === 'skill' ? 'S' : 'F'}</span>} label={<span className="mono">{name}</span>} sub={L.what} end={fmtK(L.tokens)} onClick={() => e.go({ kind: 'lib', id: name })} />
      </li>
    )
  }
  return (
    <Section title="Context" aside={`${fmtK(e.contextTokens(t))} tokens`}>
      {sugg && (
        <div className="suggest">
          <p>
            <b>Suggested: {sugg.name}</b>
            <br />
            {sugg.why}
          </p>
          <button className="btn sm" onClick={() => e.attach(t.id, sugg.name)}>
            Add
          </button>
        </div>
      )}
      <p className="sublabel">Files it reads</p>
      {files.length ? <ul className="rows">{files.map(libRow)}</ul> : <p className="soft">None</p>}
      <p className="sublabel">Skills it uses</p>
      {skills.length ? <ul className="rows">{skills.map(libRow)}</ul> : <p className="soft">None</p>}
      {planning && (
        <button className="linkish" onClick={() => e.go({ kind: 'pick', id: t.id })}>
          Add a file or skill
        </button>
      )}
    </Section>
  )
}

function LibView({ name }: { name: string }) {
  const e = useEngine()
  const L = e.lib(name)
  const users = e.tasks.filter((t) => t.signposts.includes(name))
  const prev = e.nav[e.nav.length - 2]
  const fromTask = prev?.kind === 'task' && e.task(prev.id).signposts.includes(name) ? e.task(prev.id) : null
  return (
    <>
      <Section title="What it is">
        <p>{L.what}</p>
      </Section>
      <Section title={L.kind === 'skill' ? 'What it teaches' : 'Preview'}>
        <pre className="excerpt">{L.preview || (DOCS[name] ?? '').slice(0, 280)}</pre>
      </Section>
      <Section title="Used by">
        <p>{users.length ? [...new Set(users.map((t) => `${e.farmhands[t.assignee].role} on ${t.name}`))].join(', ') : 'No task yet'}</p>
      </Section>
      <Section title="Cost">
        <p>{fmtK(L.tokens)} tokens each time an agent reads it</p>
      </Section>
      {fromTask && e.phase === 'plan' && (
        <button className="btn" onClick={() => e.detach(fromTask.id, name)}>
          Remove from {fromTask.name}
        </button>
      )}
    </>
  )
}

function PickView({ taskId }: { taskId: string }) {
  const e = useEngine()
  const [q, setQ] = useState('')
  const t = e.task(taskId)
  const avail = e.library.filter((x) => !t.signposts.includes(x.name) && (!q || `${x.name} ${x.what}`.toLowerCase().includes(q.toLowerCase())))
  const group = (kind: 'file' | 'skill') => {
    const items = avail.filter((x) => x.kind === kind)
    if (!items.length) return <p className="soft">{q ? 'No match' : 'All added'}</p>
    return (
      <ul className="rows">
        {items.map((x) => (
          <li key={x.name} className="pick-row">
            <Row mark={<span className={`kind ${x.kind}`}>{x.kind === 'skill' ? 'S' : 'F'}</span>} label={<span className="mono">{x.name}</span>} sub={x.what} end={fmtK(x.tokens)} onClick={() => e.go({ kind: 'lib', id: x.name })} />
            <button className="btn sm" onClick={() => e.attach(taskId, x.name)} disabled={e.phase !== 'plan'}>
              Add
            </button>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <>
      <input className="search" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search files and skills" aria-label="Search files and skills" autoFocus />
      <p className="sublabel">Files</p>
      {group('file')}
      <p className="sublabel">Skills</p>
      {group('skill')}
    </>
  )
}

// Everything in the chest: what each item is, what it costs and who reads it.
function LibraryView() {
  const e = useEngine()
  const [q, setQ] = useState('')
  const items = e.library.filter((x) => !q || `${x.name} ${x.what}`.toLowerCase().includes(q.toLowerCase()))
  const group = (kind: 'file' | 'skill') => {
    const list = items.filter((x) => x.kind === kind)
    if (!list.length) return <p className="soft">No match</p>
    return (
      <ul className="rows">
        {list.map((x) => {
          const users = e.tasks.filter((t) => t.signposts.includes(x.name)).length
          return (
            <li key={x.name}>
              <Row
                mark={<span className={`kind ${x.kind}`}>{x.kind === 'skill' ? 'S' : 'F'}</span>}
                label={<span className="mono">{x.name}</span>}
                sub={x.what}
                end={users ? `${users} ${users > 1 ? 'tasks' : 'task'}` : fmtK(x.tokens)}
                onClick={() => e.go({ kind: 'lib', id: x.name })}
              />
            </li>
          )
        })}
      </ul>
    )
  }
  return (
    <>
      <input className="search" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search files and skills" aria-label="Search files and skills" />
      <p className="sublabel">Files</p>
      {group('file')}
      <p className="sublabel">Skills</p>
      {group('skill')}
    </>
  )
}

// ---- activity -----------------------------------------------------------------------

export function LogLine({ l }: { l: LogEntry }) {
  const e = useEngine()
  const [open, setOpen] = useState(false)
  const traceable = l.traceId === 'date' && e.flags.has('dateResolved') && !e.flags.has('seedSaved')
  return (
    <li className={`k-${l.kind} ${open ? 'open' : ''}`}>
      <button className="entry" onClick={() => l.reason && setOpen(!open)} aria-expanded={l.reason ? open : undefined} disabled={!l.reason}>
        <span className="t">{fmtT(l.t)}</span>
        <span className="what">
          <b>{l.who}</b> {l.text}
        </span>
      </button>
      {open && l.reason && <p className="why">{l.reason}</p>}
      {traceable && (
        <button className="linkish why-btn" onClick={() => e.openTrace('date')}>
          Why?
        </button>
      )}
    </li>
  )
}

const TABS: [Extract<Nav, { kind: 'log' }>['tab'], string][] = [
  ['all', 'All'],
  ['asks', 'Asked you'],
  ['auto', 'Decided without you'],
]

function LogView({ tab }: { tab: Extract<Nav, { kind: 'log' }>['tab'] }) {
  const e = useEngine()
  const items = e.log
    .filter((l) => tab === 'all' || (tab === 'auto' ? l.kind === 'auto' : l.kind === 'ask' || l.kind === 'answer'))
    .slice()
    .reverse()
  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => e.setNav([...e.nav.slice(0, -1), { kind: 'log', tab: k }])}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="log">
        {items.length ? items.map((l) => <LogLine key={l.id} l={l} />) : <li className="soft">Nothing yet.</li>}
      </ul>
    </>
  )
}

// ---- level 3: why an ask is asking -------------------------------------------------

function WhyView({ id }: { id: string }) {
  const e = useEngine()
  const ask = e.asks.find((a) => a.id === id)!
  return (
    <>
      <p className="headline">{ask.question}</p>
      <ul className="facts">
        <li>
          <b>{ask.confidence} confidence.</b> {ask.basis}
        </li>
        <li>{ask.details.reasoning}</li>
        {ask.impact.map((i) => (
          <li key={i}>{i}</li>
        ))}
        <li className="mono">{ask.details.sources.join(', ')}</li>
        {PROV[ask.provenance] && <li className="soft">{PROV[ask.provenance]}</li>}
      </ul>
      {ask.details.preview && <pre className="excerpt">{ask.details.preview}</pre>}
      {ask.status !== 'resolved' && (
        <>
          <AskOptions ask={ask} />
          <ReplyBox ask={ask} />
        </>
      )}
    </>
  )
}

function TraceView() {
  const e = useEngine()
  const writer = e.farmhands.writer
  const seen = e.task('draft').signposts.filter((s) => s !== 'eng-standup-notes/')
  const quote = (DOCS['customer-call-notes.md'] ?? '').split('\n').find((l) => /March/.test(l))?.replace(/^- /, '')
  return (
    <>
      <p className="headline">eng-standup-notes/ was never attached, so no farmhand on this farm could see the move to March 26.</p>
      <details className="fine">
        <summary>The full trace</summary>
        <ol className="trace-steps">
          <li>
            The Writer could read <span className="mono">{[...seen, ...writer.almanac].join(', ')}</span>.
          </li>
          <li>The only launch date in them was “{quote}” from the Jan 28 call notes.</li>
          <li>It used that date in the draft.</li>
        </ol>
      </details>
      <div className="seed-card">
        <div className="mono soft">{LESSON_DATES.file}</div>
        <b>{LESSON_DATES.title}</b>
        <p>{LESSON_DATES.body}</p>
      </div>
      <button className="btn primary full" onClick={() => e.saveSeed()} data-testid="save-seed">
        Save as a skill
      </button>
    </>
  )
}

// ---- the harvest review ---------------------------------------------------------------

function Changed({ from, to }: { from: string; to: string }) {
  return (
    <>
      <del>{from}</del> <ins>{to}</ins>
    </>
  )
}

// First draft against final, with the changes marked inline.
function AnnouncementDiff() {
  const e = useEngine()
  const d = e.out.draft?.data
  if (!d) return <p className="soft">No draft.</p>
  const first = d.launch_date ?? 'March 12'
  const quote = e.asks.find((a) => a.id === 'quote')?.answer
  const SPEED = /(up to )?3x faster/i
  const fixed = e.facts.sourceFixed
  const para = (p: string): ReactNode => {
    if (quote === 'paraphrase' && /^[“"]/.test(p.trim()))
      return (
        <Changed from={p} to="Pilot teams told us the “which version is this?” question has gone from their standups." />
      )
    const parts: ReactNode[] = []
    let rest = p
    let k = 0
    const take = (re: RegExp, to: string | null) => {
      const m = rest.match(re)
      if (!m || m.index === undefined || to === null) return
      parts.push(rest.slice(0, m.index), <Changed key={k++} from={m[0]} to={to} />)
      rest = rest.slice(m.index + m[0].length)
    }
    take(new RegExp(first), first !== e.launchDate ? e.launchDate : null)
    take(SPEED, fixed && SPEED.test(rest) ? '3.2x faster in our Q4 benchmarks' : null)
    parts.push(rest)
    return parts
  }
  return (
    <div className="doc">
      <b>{d.headline}</b>
      <div className="soft">Launching {e.launchDate}</div>
      {d.paragraphs.map((p, i) => (
        <p key={i}>{para(p)}</p>
      ))}
      <p className="soft">Sources: {d.launch_date_source ?? 'customer-call-notes.md'}{first !== e.launchDate ? ', eng-standup-notes/2026-02-03.md' : ''}{fixed ? ', benchmarks-q4.xlsx row 14' : ''}</p>
    </div>
  )
}

function OutputView({ id }: { id: OutputId }) {
  const e = useEngine()
  const checks = e.checksFor(id)
  const total = INVITE_LIST.reduce((n, r) => n + r.contacts, 0)
  const firstWebinar = e.log.find((l) => /^Picked /.test(l.text))?.text.match(/Picked (\w+ \d+)/)?.[1]
  return (
    <>
      {id === 'announcement' && <AnnouncementDiff />}
      {id === 'invite' && (
        <div className="doc">
          <b>You’re invited: Relay v2 launch webinar, {e.webinarDate}</b>
          <p>
            Relay v2 arrives {e.launchDate}. Join us{' '}
            {firstWebinar && firstWebinar !== e.webinarDate ? <Changed from={firstWebinar} to={e.webinarDate} /> : e.webinarDate} at 10:00 PT, shown in each person’s own time zone, for a 30-minute walkthrough.
          </p>
        </div>
      )}
      {id === 'recipients' && (
        <ul className="rows">
          {INVITE_LIST.map((r) => (
            <li key={r.company}>
              <Row label={r.company} end={`${r.contacts} people`} />
            </li>
          ))}
          <li>
            <Row label="Total" end={`${total} people`} />
          </li>
        </ul>
      )}
      <button className="btn sm dl" onClick={() => download(id, e)}>
        Download {e.outputs.find((o) => o.id === id)?.file}
      </button>

      <Section title="Checks" aside={`${checks.filter((c) => e.ticked.has(c.id)).length} of ${checks.length}`}>
        <ul className="checks">
          {checks.map((c) => {
            const r = e.checkResult(c)
            const can = r.state === 'pass' || r.state === 'manual'
            return (
              <li key={c.id} className={r.state}>
                <label>
                  <input type="checkbox" checked={e.ticked.has(c.id)} disabled={!can || e.approved} onChange={() => e.toggleTick(c.id)} data-testid={`tick-${c.id}`} />
                  <span>
                    <b>{c.text}</b>
                    <span className="evidence">{r.evidence}</span>
                  </span>
                </label>
                {r.state === 'fail' && !e.approved && (
                  <button className="btn sm" onClick={() => e.sendBack(c.id)}>
                    Send back to the {e.farmhands[e.task(c.taskId).assignee].role.toLowerCase()}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </Section>
      <SendControls />
    </>
  )
}

function DecisionsView() {
  const e = useEngine()
  return (
    <ul className="rows">
      {e.decisions.map((d, i) => (
        <li key={i}>
          <Row label={d.text} sub={d.word} />
        </li>
      ))}
    </ul>
  )
}

function LessonsView() {
  const e = useEngine()
  const saved = e.seeds.filter((s) => s.isNew)
  return (
    <>
      <p className="quiet">Lessons join the skills library. The head farmer offers them on the next run.</p>
      <ul className="rows">
        {saved.map((s) => (
          <li key={s.file}>
            <Row mark={<span className="kind skill">S</span>} label={s.title} sub={s.file} />
          </li>
        ))}
        {e.pendingSeeds.map((s) => (
          <li key={s.file} className="pick-row">
            <Row mark={<span className="kind skill">S</span>} label={s.title} sub={s.file} />
            <span className="pair">
              <button className="btn sm" onClick={() => e.keepPendingSeed(s.file, true)}>
                Keep
              </button>
              <button className="btn sm ghost" onClick={() => e.keepPendingSeed(s.file, false)}>
                Discard
              </button>
            </span>
          </li>
        ))}
        {!saved.length && !e.pendingSeeds.length && <li className="soft">None this run.</li>}
      </ul>
    </>
  )
}

// ---- downloads ------------------------------------------------------------------------

function save(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function ics(title: string, date: string, description: string) {
  const m = date.match(/^(\w+) (\d+)$/)
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 3
  const day = m ? Number(m[2]) : 24
  const pad = (n: number) => String(n).padStart(2, '0')
  const utcHour = month > 3 || (month === 3 && day >= 8) ? 17 : 18
  const stamp = (h: number, min: number) => `2026${pad(month)}${pad(day)}T${pad(h)}${pad(min)}00Z`
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Homestead AI//Demo//EN', 'BEGIN:VEVENT', `UID:homestead-${month}-${day}@homestead.ai`, `DTSTAMP:${stamp(utcHour, 0)}`, `DTSTART:${stamp(utcHour, 0)}`, `DTEND:${stamp(utcHour, 30)}`, `SUMMARY:${title}`, `DESCRIPTION:${description.replace(/\n/g, '\\n')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
}

function download(id: OutputId, e: ReturnType<typeof useEngine>) {
  const d = e.out.draft?.data
  if (id === 'announcement') {
    const first = d?.launch_date ?? 'March 12'
    const body = (d?.paragraphs ?? []).map((p) => p.split(first).join(e.launchDate).replace(/(up to )?3x faster/i, e.facts.sourceFixed ? '3.2x faster in our Q4 benchmarks' : '$&')).join('\n\n')
    save('announcement.md', 'text/markdown', `# ${d?.headline ?? e.questTitle}\n\n${body}\n`)
  }
  if (id === 'invite') save('webinar.ics', 'text/calendar', ics('Relay v2 launch webinar', e.webinarDate, `Relay v2 arrives ${e.launchDate}. A 30-minute walkthrough.`))
  if (id === 'recipients') save('recipients.csv', 'text/csv', 'company,contacts\n' + INVITE_LIST.map((r) => `${r.company},${r.contacts}`).join('\n') + '\n')
}
