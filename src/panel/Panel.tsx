// The owner's side of the screen: the step bar, what needs you now, and a back arrow for drill-down.
import { FARM } from '../sim/scenario'
import './steps.css'
import { STEP_LABEL, STEPS, stepOf } from '../sim/steps'
import { fmtK, useEngine } from '../ui'
import { navName, viewFor } from './Detail'
import { Overview } from './Overview'
import { FarmBody, farmTitle, ValleysBody, valleysStatus } from './Pages'

function Meter() {
  const e = useEngine()
  const pct = Math.min(100, (e.energyUsed / e.budget) * 100)
  return (
    <span className="meter" data-testid="meter-energy" title="Energy is tokens, and dollars at the rate in Settings. Model calls report their real usage; simulated steps use estimates.">
      <span className="bar">
        <i className={pct > 85 ? 'warn' : ''} style={{ width: `${pct}%` }} />
      </span>
      <span className="mono">
        {fmtK(e.energyUsed)} tokens, ${e.usd.toFixed(2)}
      </span>
    </span>
  )
}

function OverviewStatus() {
  const e = useEngine()
  const done = e.ripeCount
  if (e.phase === 'brief') return <>Tell the head farmer what you need</>
  if (e.phase === 'clarify') {
    if (e.headThinking) return <>The head farmer is reading your goal</>
    return <>{e.questions.every((q) => e.clarifyAnswers[q.id]) ? 'Answered. Ready to plan.' : 'The head farmer has a few questions'}</>
  }
  if (e.phase === 'plan') return <>{e.planReady ? 'Approve to start' : 'The head farmer is planning'}</>
  if (e.phase === 'grow')
    return (
      <>
        <span data-testid="meter-needed">
          {done === e.tasks.length ? 'Every task done' : `${e.tasks.length - done} ${e.tasks.length - done === 1 ? 'task' : 'tasks'} to go`}. Needed you {e.neededYou} {e.neededYou === 1 ? 'time' : 'times'}.
        </span>
        <Meter />
      </>
    )
  if (e.phase === 'ship') {
    const times = `Needed you ${e.neededYou} ${e.neededYou === 1 ? 'time' : 'times'}.`
    if (e.shipStage === 'announced') return <>Willow Lane Vets is taking bookings online. {times}</>
    if (e.shipStage === 'live') return <>Live for everyone at Willow Lane Vets. {times}</>
    if (e.shipStage === 'ci') return <>Merged. CI is running on main.</>
    if (e.shipStage === 'cifailed') return <>CI failed on main.</>
    if (e.shipStage === 'rollback' || e.shipStage === 'rolledback') return <>Rolled back to “Call us to book”. {times}</>
    if (e.shipStage === 'fixing') return <>Fixing availability search. {times}</>
    if (e.shipStage === 'canary' || e.shipStage === 'canary2') return <>Canary live for 5% of visitors.</>
    if (e.shipStage === 'rollout') return <>Rolling out, {e.rollout}% of visitors.</>
    return <>Merged, not deployed. {times}</>
  }
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

// One line at the top: Plant, Grow, Harvest. A done step opens its read-only review;
// the step you're on brings you back to what needs you.
function StepBar() {
  const e = useEngine()
  const now = STEPS.indexOf(stepOf(e.phase))
  const reviewing = e.nav[0]?.kind === 'step' ? e.nav[0].id : null
  return (
    <nav className="step-bar" aria-label="Steps">
      <ol>
        {STEPS.map((k, i) => {
          const state = i < now ? 'done' : i === now ? 'now' : 'later'
          const open = reviewing === k || (i === now && !e.nav.length)
          return (
            <li key={k} className={`${state} ${open ? 'open' : ''}`}>
              {state === 'later' ? (
                <span>{STEP_LABEL[k]}</span>
              ) : (
                <button
                  onClick={() => (state === 'now' ? (e.nav.length || k !== 'grow' ? e.setNav([]) : e.setNav([{ kind: 'step', id: 'grow' }])) : e.setNav([{ kind: 'step', id: k }]))}
                  aria-current={state === 'now' ? 'step' : undefined}
                  title={state === 'done' ? `Review ${STEP_LABEL[k]}` : undefined}
                  data-testid={state === 'now' ? 'trail-overview' : `step-${k}`}
                >
                  {state === 'done' && <Check />}
                  {STEP_LABEL[k]}
                </button>
              )}
              {i < STEPS.length - 1 && <Chevron />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="step-check">
      <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="step-chev">
      <path d="M3.5 2 6.5 5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// While the crew works the panel folds into a rail: the three steps and what needs you.
function Rail() {
  const e = useEngine()
  const now = STEPS.indexOf(stepOf(e.phase))
  const waiting = e.openAsks.length + (e.replan?.status === 'open' ? 1 : 0)
  return (
    <button className="rail" onClick={() => e.setPanel(true)} aria-label={`Show the side panel${waiting ? `, ${waiting} waiting for you` : ''}`} title="Show the side panel (B)" data-testid="rail">
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
  if (!e.panelOpen) return <aside className="panel rail-only">{<Rail />}</aside>
  // The Valleys page and a farm page have their own panel at the root; drill-down works the same on every page.
  const valleys = e.view === 'valley' && !e.peekName
  const farm = e.view === 'farm' && !e.peekName ? e.fieldPage : null
  const title = view ? view.title : valleys ? 'Valleys' : farm ? farmTitle(e, farm) : FARM.name
  const status = view ? view.status : valleys ? valleysStatus(e) : farm ? (e.phase === 'brief' || e.phase === 'clarify' ? 'Not started' : e.fhStatus(e.farmhands[farm])) : <OverviewStatus />
  const body = view ? view.body : valleys ? <ValleysBody /> : farm ? <FarmBody id={farm} /> : <Overview />
  return (
    <aside className="panel" aria-label={FARM.name}>
      <header className="panel-head">
        {!valleys && !farm && <StepBar />}
        <div className="title-row">
          {/* No label over the title: a back arrow names the parent in its tooltip. */}
          {e.nav.length > 1 && (
            <button className="icon-btn back" onClick={() => e.goTo(e.nav.length - 1)} aria-label={`Back to ${navName(e.nav[e.nav.length - 2], e)}`} title={`Back to ${navName(e.nav[e.nav.length - 2], e)} (Esc)`} data-testid="back">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <h1>{title}</h1>
          {top?.kind !== 'settings' && (
            <button className="icon-btn" onClick={() => e.go({ kind: 'settings' })} aria-label="Settings" title="Settings" data-testid="settings">
              <GearIcon />
            </button>
          )}
          <button className="icon-btn" onClick={() => e.setPanel(false)} aria-label="Close the side panel" title="Close (B)" data-testid="panel-close">
            <PanelIcon />
          </button>
        </div>
        <div className="status">{status}</div>
      </header>
      <div className="panel-body" key={e.nav.length + (top ? JSON.stringify(top) : '')}>
        <div className={`slide ${top ? 'in' : 'out'}`}>{body}</div>
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
