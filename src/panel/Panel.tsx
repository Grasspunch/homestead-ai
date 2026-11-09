// The quest log: the owner's side of the screen. One card at a time asks for attention.
import type { Phase } from '../sim/types'
import { Kbd, useEngine } from '../ui'
import { Grow } from './Grow'
import { Brief, Clarify, Plan, SetupFooter } from './Setup'

const STEPS: { id: Phase; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'clarify', label: 'Clarify' },
  { id: 'plan', label: 'Plan' },
  { id: 'grow', label: 'Grow' },
  { id: 'harvest', label: 'Harvest' },
]

export function Panel() {
  const e = useEngine()
  const idx = STEPS.findIndex((s) => s.id === e.phase)
  const growing = e.phase === 'grow' || e.phase === 'harvest'
  return (
    <aside className="panel" aria-label="Quest log">
      <header className="panel-head">
        <div className="eyebrow">
          <span>Q1 Launch · You (PM)</span>
          <span>{e.live === null ? 'checking…' : e.live ? 'Live · Claude' : 'Replay'}</span>
        </div>
        <h1>{e.phase === 'brief' || e.phase === 'clarify' ? 'Brief the head farmer' : e.questTitle}</h1>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={i < idx ? 'done' : i === idx ? 'now' : ''}>
              {s.label}
            </li>
          ))}
        </ol>
      </header>
      <div className="panel-body">
        {e.phase === 'brief' && <Brief />}
        {e.phase === 'clarify' && <Clarify />}
        {e.phase === 'plan' && <Plan />}
        {growing && <Grow />}
      </div>
      <footer className="panel-foot">
        {growing ? (
          <>
            <span className="foot-sum">
              {e.neededYou} needed you · {e.liveCalls ? `${e.liveCalls} live calls` : `${e.replayCalls} replayed calls`} · {e.simSteps} simulated steps
            </span>
            <button className="btn ghost" onClick={() => e.setView(e.view === 'valley' ? 'farm' : 'valley')}>
              {e.view === 'valley' ? 'Farm' : 'Valley'} <Kbd>V</Kbd>
            </button>
            <button className="btn ghost" onClick={() => (e.showHelp = !e.showHelp, e.notify())} aria-label="Keyboard shortcuts">
              <Kbd>?</Kbd>
            </button>
          </>
        ) : (
          <SetupFooter />
        )}
      </footer>
    </aside>
  )
}
