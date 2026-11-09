// The quest log: the owner's side of the screen. One card at a time asks for attention.
import type { Phase } from '../sim/types'
import { useEngine } from '../ui'
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
            <button className="btn ghost grow" onClick={() => e.setView(e.view === 'valley' ? 'farm' : 'valley')} title="V">
              {e.view === 'valley' ? 'Back to the farm' : 'See the whole valley'}
            </button>
            <button className="btn ghost" onClick={() => (e.showHelp = !e.showHelp, e.notify())} title="?">
              Shortcuts
            </button>
          </>
        ) : (
          <SetupFooter />
        )}
      </footer>
    </aside>
  )
}
