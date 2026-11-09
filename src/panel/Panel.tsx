// The owner's side of the screen: a short overview of the five steps, with a trail for drill-down.
import { FARM } from '../sim/scenario'
import type { Phase } from '../sim/types'
import { fmtK, useEngine } from '../ui'
import { navName, viewFor } from './Detail'
import { Overview } from './Overview'

function Meter() {
  const e = useEngine()
  const pct = Math.min(100, (e.energyUsed / e.budget) * 100)
  return (
    <span className="meter" data-testid="meter-energy" title="Energy is tokens, and dollars at the rate in Settings. Model calls report their real usage; simulated steps use estimates.">
      <span className="bar">
        <i className={pct > 85 ? 'warn' : ''} style={{ width: `${pct}%` }} />
      </span>
      <span className="mono">
        {fmtK(e.energyUsed)} of {fmtK(e.budget)}, ${e.usd.toFixed(2)}
      </span>
    </span>
  )
}

function OverviewStatus() {
  const e = useEngine()
  const done = e.ripeCount
  if (e.phase === 'brief') return <>Tell the head farmer what you need</>
  if (e.phase === 'clarify') {
    if (e.headThinking) return <>The head farmer is reading your brief</>
    return <>{e.questions.every((q) => e.clarifyAnswers[q.id]) ? 'Answered. Ready to plan.' : 'The head farmer has a few questions'}</>
  }
  if (e.phase === 'plan') return <>{e.planReady ? 'Approve to start' : 'The head farmer is planning'}</>
  if (e.phase === 'grow')
    return (
      <>
        <span data-testid="meter-needed">
          {done} of {e.tasks.length} tasks done. Needed you {e.neededYou} {e.neededYou === 1 ? 'time' : 'times'}.
        </span>
        <Meter />
      </>
    )
  if (e.gateFailed) return <>Blocked. 1 gate failed.</>
  if (e.harvestStage === 'review' && e.gatesRunning) return <>Gates running.</>
  if (e.approved && e.sendState !== 'sent') return <>Approved, not merged.</>
  if (e.sendState === 'sent') return <>Merged. Needed you {e.neededYou} {e.neededYou === 1 ? 'time' : 'times'}.</>
  return (
    <>
      Ripe. Needed you {e.neededYou} {e.neededYou === 1 ? 'time' : 'times'}.
    </>
  )
}

const STEPS: Phase[] = ['brief', 'clarify', 'plan', 'grow', 'harvest']
const STEP_LABEL: Record<Phase, string> = { brief: 'Brief', clarify: 'Clarify', plan: 'Plan', grow: 'Grow', harvest: 'Harvest' }

// While the crew works the panel folds into a rail: the five steps and what needs you.
function Rail() {
  const e = useEngine()
  const now = STEPS.indexOf(e.phase)
  const waiting = e.openAsks.length + (e.replan?.status === 'open' ? 1 : 0)
  return (
    <button className="rail" onClick={() => e.setPanel(true)} aria-label={`Show the side panel${waiting ? `, ${waiting} waiting for you` : ''}`} title="Show the side panel (Tab)" data-testid="rail">
      <PanelIcon />
      <span className="rail-steps" aria-hidden>
        {STEPS.map((k, i) => (
          <i key={k} className={i < now ? 'done' : i === now ? 'now' : ''} title={STEP_LABEL[k]} />
        ))}
      </span>
      {waiting > 0 && (
        <span className="rail-count" aria-hidden>
          {waiting}
        </span>
      )}
    </button>
  )
}

export function Panel() {
  const e = useEngine()
  const top = e.nav[e.nav.length - 1]
  const view = top ? viewFor(top, e) : null
  if (e.intro) return <aside className="panel off" aria-hidden />
  if (!e.panelOpen) return <aside className="panel rail-only">{<Rail />}</aside>
  return (
    <aside className="panel" aria-label={FARM.name}>
      <header className="panel-head">
        {top && (
          <nav className="trail" aria-label="Where you are">
            <button onClick={() => e.goTo(0)} data-testid="trail-overview">
              Overview
            </button>
            {e.nav.slice(0, -1).map((n, i) => (
              <span key={i}>
                <span className="sep">/</span>
                <button onClick={() => e.goTo(i + 1)}>{navName(n, e)}</button>
              </span>
            ))}
          </nav>
        )}
        <div className="title-row">
          <h1>{view ? view.title : FARM.name}</h1>
          {top?.kind !== 'settings' && (
            <button className="icon-btn" onClick={() => e.go({ kind: 'settings' })} aria-label="Settings" title="Settings" data-testid="settings">
              <GearIcon />
            </button>
          )}
          <button className="icon-btn" onClick={() => e.setPanel(false)} aria-label="Close the side panel" title="Close (Tab)" data-testid="panel-close">
            <PanelIcon />
          </button>
        </div>
        <div className="status">{view ? view.status : <OverviewStatus />}</div>
      </header>
      <div className="panel-body" key={e.nav.length + (top ? JSON.stringify(top) : '')}>
        <div className={`slide ${top ? 'in' : 'out'}`}>{view ? view.body : <Overview />}</div>
      </div>
    </aside>
  )
}

export function PanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 3v10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="2.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
