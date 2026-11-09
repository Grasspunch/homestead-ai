// While the farm grows: the one card that needs you, the crew, and the quest log.
import { useState } from 'react'
import { LESSON_DATES, ROLE_ORDER } from '../sim/scenario'
import { DOCS } from '../sim/docs'
import type { Ask, LogEntry } from '../sim/types'
import { fmtT, Kbd, Reason, Term, useEngine } from '../ui'

const PROV = { live: 'Found by a live Claude call', replay: 'From a recorded run', sim: 'Scripted step' }

export function AskCard({ ask }: { ask: Ask }) {
  const e = useEngine()
  const [reply, setReply] = useState('')
  const task = e.task(ask.taskId)
  const rec = ask.options.find((o) => o.recommended)
  return (
    <div className="ask" data-testid={`ask-${ask.id}`}>
      <div className="ask-head">
        <Reason label={ask.label} />
        <span title={task.name}>{ask.fromName}</span>
        {ask.status !== 'confirming' && <span className="conf">{ask.confidence} confidence</span>}
      </div>
      {ask.status === 'confirming' ? (
        <>
          <div className="ask-body">
            <h2>{ask.question}</h2>
            <ul className="impact">
              {ask.impact.map((i) => (
                <li key={i} className={/undone|Can’t/.test(i) ? 'irrev' : ''}>
                  {i}
                </li>
              ))}
            </ul>
          </div>
          <div className="confirm-bar">
            <b>{ask.confirm}</b>
            <button className="btn ghost" onClick={() => e.cancelConfirm(ask.id)}>
              Back
            </button>
            <button className="btn danger" onClick={() => e.answer(ask.id, 'approve')} data-testid="confirm">
              Send
            </button>
          </div>
        </>
      ) : (
        <div className="ask-body">
          <h2>{ask.question}</h2>
          {ask.sides && (
            <div className="sides">
              {ask.sides.map((s, i) => {
                const opt = ask.options[i === 0 ? 1 : 0]
                return (
                  <button key={s.title} className={`side ${rec && opt?.value === rec.value ? 'rec' : ''}`} onClick={() => opt && e.answer(ask.id, opt.value)}>
                    <span className="date">{s.title}</span>
                    <span className="who">{s.who}</span>
                    <blockquote>“{s.quote}”</blockquote>
                    <span className="src">{s.source}</span>
                  </button>
                )
              })}
            </div>
          )}
          <ul className="impact">
            {ask.impact.map((i) => (
              <li key={i} className={/undone|Can’t/.test(i) && !/Can be undone/.test(i) ? 'irrev' : ''}>
                {i}
              </li>
            ))}
          </ul>
          <div className="actions">
            {ask.options.map((o) => (
              <button key={o.value} className={`btn ${o.kind === 'approve' ? 'primary' : ''} ${o.recommended ? 'rec' : ''}`} onClick={() => e.answer(ask.id, o.value)} data-testid={`opt-${o.value}`}>
                {o.label} <Kbd>{o.key.toUpperCase()}</Kbd>
              </button>
            ))}
          </div>
          <details className="why">
            <summary>Why it’s asking</summary>
            {ask.basis && <p>{ask.basis}</p>}
            <p>{ask.details.reasoning}</p>
            <p className="mono">{ask.details.sources.join(', ')}</p>
            {ask.details.preview && <pre>{ask.details.preview}</pre>}
            <p className="src-note">{PROV[ask.provenance]}</p>
            <form
              className="reply"
              onSubmit={(ev) => {
                ev.preventDefault()
                e.reply(ask.id, reply)
                setReply('')
              }}
            >
              <input id="reply-input" value={reply} onChange={(ev) => setReply(ev.target.value)} placeholder={`Reply to the ${ask.fromName}`} />
            </form>
          </details>
        </div>
      )}
    </div>
  )
}

export function ReplanCard() {
  const e = useEngine()
  const r = e.replan!
  return (
    <div className="ask" data-testid="replan">
      <div className="ask-head">
        <Reason label="Re-plan" icon="hammer" />
      </div>
      <div className="ask-body">
        <h2>{r.title}</h2>
        <div className="diff">
          {r.lines.map((l) => (
            <div key={l.text} className={l.op === '+' ? 'plus' : l.op === '-' ? 'minus' : 'mod'}>
              <span>{l.op}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => e.applyReplan()} data-testid="apply-replan">
            Apply re-plan
          </button>
        </div>
      </div>
    </div>
  )
}

export function TraceCard() {
  const e = useEngine()
  const draft = e.out.draft
  const entry = e.log.find((l) => l.traceId === 'date')
  const writer = e.farmhands.writer
  const seen = e.task('draft').signposts.filter((s) => s !== 'eng-standup-notes/')
  const quote = (DOCS['customer-call-notes.md'] ?? '').split('\n').find((l) => /March/.test(l))?.replace(/^- /, '')
  return (
    <div className="ask" data-testid="trace">
      <div className="ask-head">
        <Reason label="Trace" icon="question" />
        <span>
          Why the Writer used {draft?.data.launch_date ?? 'March 12'}
          {entry ? ` at ${fmtT(entry.t)}` : ''}
        </span>
      </div>
      <div className="ask-body">
        <ol className="trace-steps">
          <li>
            It could read <span className="mono">{[...seen, ...writer.almanac].join(', ')}</span>.
          </li>
          <li>
            The only launch date in them was <i>“{quote}”</i> from the Jan 28 call notes.
          </li>
          <li className="missing">
            <span className="mono">eng-standup-notes/</span> was never attached, so no farmhand on this farm could see the move to March 26.
          </li>
        </ol>
        <div className="seed-card">
          <div className="file">{LESSON_DATES.file}</div>
          <h4>{LESSON_DATES.title}</h4>
          <p>{LESSON_DATES.body}</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => e.saveSeed()} data-testid="save-seed">
            Save as a seed
          </button>
          <button className="btn ghost" onClick={() => e.closeTrace()}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function Crew() {
  const e = useEngine()
  return (
    <div className="crew-grid">
      {ROLE_ORDER.map((r) => {
        const f = e.farmhands[r]
        const job = f.job
        let status = f.paused ? 'Paused by you' : 'Waiting on another task'
        if (!f.paused) {
          if (f.status === 'asking') status = 'Waiting for your answer'
          else if (job?.kind === 'fix') status = `Fixing a pest`
          else if (job?.kind === 'sub') status = e.task(job.taskId).subtasks.find((s) => s.id === job.subId)?.name ?? ''
          else if (f.status === 'idle' || f.status === 'done') status = 'Done'
          else if (f.status === 'walking') status = 'Walking to a plot'
        }
        return (
          <div key={r} className={`hand ${e.selected === r ? 'sel' : ''} ${f.paused ? 'paused' : ''}`} style={{ ['--c' as string]: f.color }} onClick={() => e.select(r)}
            onKeyDown={(ev) => {
              if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return
              ev.preventDefault()
              e.select(r)
            }}
            role="button"
            aria-pressed={e.selected === r}
            tabIndex={0}
          >
            <div className="role">
              {f.role} <span>{f.name}</span>
            </div>
            <div className="status">{status}</div>
            <button
              className="pz"
              onClick={(ev) => {
                ev.stopPropagation()
                e.togglePauseFarmhand(r)
              }}
              aria-label={`${f.paused ? 'Resume' : 'Pause'} the ${f.role}`}
            >
              {f.paused ? '▶' : '❚❚'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function FarmhandCard() {
  const e = useEngine()
  const f = e.farmhands[e.selected!]
  return (
    <div className="fh-card" data-testid="farmhand-card">
      <h3>
        <span>
          {f.role} <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 15, color: 'var(--ink-faint)' }}>{f.name}</span>
        </span>
        <button className="btn ghost" onClick={() => e.select(null)}>
          Close
        </button>
      </h3>
      <dl className="slots">
        <dt>Tools</dt>
        <dd>{f.tools.join(', ')}</dd>
        <dt>Almanac</dt>
        <dd className="mono">{f.almanac.join(', ') || '—'}</dd>
        <dt>Seeds</dt>
        <dd className="mono">{f.seeds.join(', ') || '—'}</dd>
        <dt>Signposts</dt>
        <dd className="mono">{f.context.join(', ')}</dd>
      </dl>
      <div className="transcript">
        {f.transcript.length ? f.transcript.map((l, i) => <div key={i}>{l}</div>) : 'No work yet.'}
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => e.togglePauseFarmhand(f.id)}>
          {f.paused ? 'Resume' : 'Pause'} {f.role}
        </button>
      </div>
    </div>
  )
}

type Filter = 'all' | 'asks' | 'auto'

export function QuestLog() {
  const e = useEngine()
  const [filter, setFilter] = useState<Filter>('all')
  const items = e.log
    .filter((l) => (filter === 'all' ? true : filter === 'auto' ? l.kind === 'auto' : l.kind === 'ask' || l.kind === 'answer'))
    .slice()
    .reverse()
  return (
    <>
      <div className="section-title">
        <span>Quest log</span>
        <span className="tabs">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
          <button aria-pressed={filter === 'asks'} onClick={() => setFilter('asks')}>
            Asks
          </button>
          <button aria-pressed={filter === 'auto'} onClick={() => setFilter('auto')} data-testid="filter-auto">
            Decided alone ({e.autoDecided.length})
          </button>
        </span>
      </div>
      <ul className="log">
        {items.length === 0 && <li className="empty">Nothing yet.</li>}
        {items.map((l) => (
          <LogLine key={l.id} l={l} />
        ))}
      </ul>
    </>
  )
}

function LogLine({ l }: { l: LogEntry }) {
  const e = useEngine()
  const traceable = l.traceId === 'date' && e.flags.has('dateResolved') && !e.flags.has('seedSaved')
  return (
    <li className={`k-${l.kind} ${traceable ? 'traceable' : ''}`} onClick={traceable ? () => e.openTrace('date') : undefined}>
      <span className="t">{fmtT(l.t)}</span>
      <span>
        <span className="who">{l.who}</span> {l.text}
        {l.kind === 'auto' && <span className="tag auto">auto</span>}
        {traceable && <button className="why-btn">Why?</button>}
        {l.reason && l.kind === 'auto' && <span className="why">{l.reason}</span>}
      </span>
    </li>
  )
}

export function Grow() {
  const e = useEngine()
  const ask = e.activeAsk
  const queued = e.openAsks.length - 1
  const showNudge = e.replan?.status === 'applied' && !e.flags.has('seedSaved') && !e.trace && !ask
  return (
    <>
      {e.trace ? (
        <TraceCard />
      ) : ask ? (
        <>
          <AskCard ask={ask} key={ask.id} />
          {queued > 0 && <div className="queue-note">{queued} more waiting</div>}
        </>
      ) : e.replan?.status === 'open' ? (
        <ReplanCard />
      ) : showNudge ? (
        <div className="nudge">
          <p>
            <b>Why did the Writer use {e.out.draft?.data.launch_date ?? 'March 12'}?</b>
          </p>
          <button className="btn" onClick={() => e.openTrace('date')} data-testid="open-trace">
            Trace it
          </button>
        </div>
      ) : e.harvestReady ? (
        <div className="nudge">
          <p>
            <b>Every crop is ripe.</b>
          </p>
          <button className="btn primary" onClick={() => e.openHarvest()} data-testid="open-harvest">
            Open the report
          </button>
        </div>
      ) : null}

      {e.selected ? <FarmhandCard /> : null}

      <div className="section-title">
        <Term w="Crew" m="Your agents on this farm" />
      </div>
      <Crew />
      <QuestLog />
    </>
  )
}
