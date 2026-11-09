import { useEffect, useRef, type ReactNode } from 'react'
import { draw, loadAtlas } from '../map/atlas'
import { Emoji } from './Icon'
import { Sprite } from './Sprite'

/* ---------- Ask reasons. Shape carries the meaning; colour is ink except Failure (red) and Merge/deploy (blue). ---------- */
export type Reason = 'anomaly' | 'failure' | 'risk' | 'cost' | 'outbound'

export const REASONS: Record<Reason, { label: string; emoji: string; sprite?: string; tone: 'ink' | 'fail' | 'out'; means: string }> = {
  anomaly: { label: 'Looks wrong', emoji: 'question', tone: 'ink', means: 'Something in the work does not match what was expected.' },
  failure: { label: 'Failed', emoji: 'cross', tone: 'fail', means: 'A check or a call failed and the agent cannot go on alone.' },
  risk: { label: 'Risky', emoji: 'alert', tone: 'ink', means: 'The next step could break something people rely on.' },
  cost: { label: 'Costs more', emoji: 'coin', tone: 'ink', means: 'The next step would spend more energy than the plan allowed.' },
  outbound: { label: 'Reaches people', emoji: '', sprite: 'glyph_envelope', tone: 'out', means: 'Merging or deploying reaches users outside the team.' },
}

export function ReasonMark({ reason, size = 32 }: { reason: Reason; size?: 32 | 64 }) {
  const r = REASONS[reason]
  return r.sprite ? <Sprite name={r.sprite} scale={size / 16} /> : <Emoji name={r.emoji} size={size} />
}

export function ReasonLabel({ reason }: { reason: Reason }) {
  const r = REASONS[reason]
  return (
    <span className={`hs-reason ${r.tone}`}>
      <ReasonMark reason={reason} />
      {r.label}
    </span>
  )
}

/* ---------- The ask card: the one raised object on screen ---------- */
export function AskCard({ reason, who, question, children, why, onDismiss }: { reason: Reason; who: ReactNode; question: ReactNode; children: ReactNode; why?: ReactNode; onDismiss?: () => void }) {
  return (
    <section className={`hs-ask ${REASONS[reason].tone}`} aria-label="Needs you">
      <header>
        <ReasonLabel reason={reason} />
        <span className="hs-ask-who">{who}</span>
        {onDismiss && (
          <button type="button" className="hs-ask-x" aria-label="Later" onClick={onDismiss}>
            Later
          </button>
        )}
      </header>
      <h3>{question}</h3>
      <div className="hs-ask-opts">{children}</div>
      {why && (
        <details className="hs-why">
          <summary>Why it's asking</summary>
          <div>{why}</div>
        </details>
      )}
    </section>
  )
}

/* ---------- Step bar: Plant, Grow, Harvest. Done steps open their read-only review. ---------- */
export type Step = { id: string; label: string; state: 'done' | 'now' | 'next' }

export function StepBar({ steps, onOpen }: { steps: Step[]; onOpen?: (id: string) => void }) {
  return (
    <ol className="hs-steps">
      {steps.map((s, i) => (
        <li key={s.id} className={s.state}>
          {s.state === 'done' && onOpen ? (
            <button type="button" onClick={() => onOpen(s.id)}>
              <i aria-hidden>{i + 1}</i>
              {s.label}
            </button>
          ) : (
            <span aria-current={s.state === 'now' ? 'step' : undefined}>
              <i aria-hidden>{i + 1}</i>
              {s.label}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

/* ---------- Ruled rows. Lists are ruled, never boxed. ---------- */
export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="hs-rows" aria-label={label}>
      {children}
    </ul>
  )
}

export function Row({ lead, title, detail, trail, onClick, selected }: { lead?: ReactNode; title: ReactNode; detail?: ReactNode; trail?: ReactNode; onClick?: () => void; selected?: boolean }) {
  const body = (
    <>
      {lead && <span className="hs-row-lead">{lead}</span>}
      <span className="hs-row-main">
        <b>{title}</b>
        {detail && <small>{detail}</small>}
      </span>
      {trail && <span className="hs-row-trail">{trail}</span>}
    </>
  )
  return (
    <li className="hs-row" aria-selected={selected || undefined}>
      {onClick ? (
        <button type="button" onClick={onClick}>
          {body}
        </button>
      ) : (
        <div>{body}</div>
      )}
    </li>
  )
}

/* ---------- A farmhand's face, tinted like its sprite on the map ---------- */
export function Portrait({ body, shade, size = 40 }: { body: string; shade: string; size?: 20 | 40 | 60 }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true
    loadAtlas().then(() => {
      const c = ref.current
      if (!alive || !c) return
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, c.width, c.height)
      draw(ctx, 'char_idle_down_0', -14, -15, { tint: { body, shade } })
    })
    return () => {
      alive = false
    }
  }, [body, shade])
  return <canvas ref={ref} width={20} height={20} className="hs-portrait" style={{ width: size, height: size }} aria-hidden />
}

export type HandState = 'needs' | 'working' | 'done'
const HAND_STATE: Record<HandState, string> = { needs: 'Needs you', working: 'Working', done: 'Done' }

export function CrewRow({ role, body, shade, state, detail, onClick }: { role: string; body: string; shade: string; state: HandState; detail?: ReactNode; onClick?: () => void }) {
  return (
    <Row
      onClick={onClick}
      lead={<Portrait body={body} shade={shade} size={40} />}
      title={role}
      detail={detail}
      trail={<span className={`hs-state ${state}`}>{state === 'needs' && <Emoji name="alert" />}{HAND_STATE[state]}</span>}
    />
  )
}

/* ---------- Tooltip: one line, on hover and focus ---------- */
export function Tip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <span className="hs-tip" tabIndex={0}>
      {children}
      <span role="tooltip">{tip}</span>
    </span>
  )
}
