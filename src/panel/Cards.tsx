// The one raised object on the panel: whatever needs you right now.
import { useState } from 'react'
import { REASON_WORD, type OutId } from '../sim/engine'
import { CLASH, MISSING } from '../sim/scenario'
import type { Ask } from '../sim/types'
import { Kbd, useEngine } from '../ui'
import './ship.css'

export const PROV: Record<string, string> = { live: 'Found by a live Claude call' }

// Outbound steps lead with who they reach, in the one outbound colour.
export function Envelope() {
  return (
    <svg className="envelope" width="16" height="12" viewBox="0 0 16 12" aria-hidden>
      <rect x="0.75" y="0.75" width="14.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 1.8 8 6.6l6.5-4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function AskOptions({ ask }: { ask: Ask }) {
  const e = useEngine()
  const out = ask.label === 'Irreversible'
  if (ask.status === 'confirming')
    return (
      <div className="confirm">
        {!ask.confirmList && (
          <p>
            <b>{ask.confirm}</b>
          </p>
        )}
        {ask.confirmList && (
          <ul className="confirm-list" data-testid="confirm-list">
            {ask.confirmList.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        <div className="opts">
          <button className="btn out" onClick={() => e.answer(ask.id, 'approve')} data-testid="confirm">
            {ask.confirmLabel ?? ask.options.find((o) => o.value === 'approve')?.label} <Kbd>⏎</Kbd>
          </button>
          <button className="btn ghost" onClick={() => e.cancelConfirm(ask.id)}>
            Back
          </button>
        </div>
      </div>
    )
  return (
    <div className="opts">
      {ask.options.map((o) => (
        <button
          key={o.value}
          className={`btn ${o.recommended ? (out && o.kind === 'approve' ? 'out' : 'primary') : ''}`}
          onClick={() => e.answer(ask.id, o.value)}
          data-testid={`opt-${o.value}`}
        >
          {o.label} <Kbd>{o.key.toUpperCase()}</Kbd>
        </button>
      ))}
    </div>
  )
}

export function AskCard({ ask }: { ask: Ask }) {
  const e = useEngine()
  const out = ask.label === 'Irreversible'
  const rec = ask.options.find((o) => o.recommended)
  return (
    <div className={`card ask ${out ? 'outbound' : ''}`} data-testid={`ask-${ask.id}`}>
      {out ? (
        <div className="who out-line">
          <Envelope />
          <span>{ask.impact[0]}</span>
        </div>
      ) : (
        <div className="who">
          <strong>{REASON_WORD[ask.label] ?? ask.label}</strong>
          <span>{ask.fromName} asks</span>
        </div>
      )}
      <h3>{ask.question}</h3>
      {ask.sides && ask.status === 'open' && (
        <div className="sides">
          {ask.sides.map((s, i) => {
            const opt = ask.options[i === 0 ? 1 : 0]
            return (
              <button key={s.title} className={`side ${rec && opt?.value === rec.value ? 'rec' : ''}`} onClick={() => opt && e.answer(ask.id, opt.value)}>
                <b>{s.title}</b>
                <span>{s.who}</span>
              </button>
            )
          })}
        </div>
      )}
      {ask.status === 'open' && (out ? ask.impact[1] : ask.impact[0]) && <p className="consequence">{out ? ask.impact[1] : ask.impact[0]}</p>}
      {ask.link && ask.status === 'open' && (
        <button className="linkish" onClick={() => e.go({ kind: 'out', id: ask.link!.out as OutId })} data-testid={`ask-link-${ask.id}`}>
          {ask.link.label}
        </button>
      )}
      <AskOptions ask={ask} />
      <button className="linkish" onClick={() => e.go({ kind: 'why', id: ask.id })}>
        Why it’s asking
      </button>
    </div>
  )
}

export function ReplanCard() {
  const e = useEngine()
  const r = e.replan!
  return (
    <div className="card" data-testid="replan">
      <div className="who">
        <strong>Re-plan</strong>
        <span>Nothing changes until you apply it</span>
      </div>
      <h3>{r.title}</h3>
      <div className="diff">
        {r.lines.map((l) => (
          <div key={l.text} className={l.op === '+' ? 'plus' : l.op === '-' ? 'minus' : 'mod'}>
            <span>{l.op}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
      <div className="opts">
        <button className="btn primary" onClick={() => e.applyReplan()} data-testid="apply-replan">
          Apply re-plan <Kbd>⏎</Kbd>
        </button>
      </div>
    </div>
  )
}

// Asks, the re-plan and the next step. Only one sits on top at a time.
export function NeedsYou() {
  const e = useEngine()
  const ask = e.activeAsk
  const queued = e.openAsks.length - 1
  if (ask)
    return (
      <>
        {e.showHint('ask') && <p className="tip">Your crew stops here when a step needs you.</p>}
        <AskCard ask={ask} key={ask.id} />
        {queued > 0 && <p className="queue-note">{queued} more waiting</p>}
      </>
    )
  if (e.replan?.status === 'open') return <ReplanCard />
  if (e.phase !== 'grow') return null
  if (e.replan?.status === 'applied' && !e.flags.has('seedSaved'))
    return (
      <div className="card">
        <h3>
          Why did {e.farmhands[e.task(MISSING.taskId).assignee].role} use {CLASH.ours}?
        </h3>
        <div className="opts">
          <button className="btn primary" onClick={() => e.openTrace('endpoint')} data-testid="open-trace">
            Trace it
          </button>
        </div>
      </div>
    )
  if (e.harvestReady)
    return (
      <div className="card">
        <h3>Every crop is ripe.</h3>
        <p className="consequence">Every gate so far passed. The agentic review runs at the harvest, then you look before anything merges.</p>
        <div className="opts">
          <button className="btn primary" onClick={() => e.openHarvest()} data-testid="open-harvest">
            Harvest <Kbd>⏎</Kbd>
          </button>
        </div>
      </div>
    )
  return null
}

export function ReplyBox({ ask }: { ask: Ask }) {
  const e = useEngine()
  const [reply, setReply] = useState('')
  return (
    <form
      className="reply"
      onSubmit={(ev) => {
        ev.preventDefault()
        e.reply(ask.id, reply)
        setReply('')
      }}
    >
      <input id="reply-input" value={reply} onChange={(ev) => setReply(ev.target.value)} placeholder={`Reply to ${ask.fromName}`} />
    </form>
  )
}
