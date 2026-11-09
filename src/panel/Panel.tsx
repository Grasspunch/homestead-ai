// The owner's side of the screen. One job per step; finished steps can be reopened read-only.
import { useEffect, useState } from 'react'
import type { Phase } from '../sim/types'
import { useEngine } from '../ui'
import { Grow } from './Grow'
import { Brief, Clarify, Plan, Review, SetupFooter } from './Setup'

type Reviewable = 'brief' | 'clarify' | 'plan'

const STEPS: { id: Phase; label: string; review: string }[] = [
  { id: 'brief', label: 'Brief', review: 'Your brief' },
  { id: 'clarify', label: 'Clarify', review: 'Your answers' },
  { id: 'plan', label: 'Plan', review: 'The plan' },
  { id: 'grow', label: 'Grow', review: '' },
  { id: 'harvest', label: 'Harvest', review: '' },
]

export function Panel() {
  const e = useEngine()
  const [review, setReview] = useState<Reviewable | null>(null)
  useEffect(() => setReview(null), [e.phase])
  const idx = STEPS.findIndex((s) => s.id === e.phase)
  const growing = e.phase === 'grow' || e.phase === 'harvest'
  const current = STEPS[growing ? 3 : idx]
  const title = review
    ? STEPS.find((s) => s.id === review)!.review
    : e.phase === 'brief'
      ? 'Brief the head farmer'
      : e.phase === 'clarify'
        ? 'A few questions'
        : e.questTitle
  return (
    <aside className="panel" aria-label="Quest">
      <header className="panel-head">
        <h1>{title}</h1>
        <ol className="steps">
          {STEPS.map((s, i) => {
            const done = i < idx
            const canReview = done && (s.id === 'brief' || s.id === 'clarify' || s.id === 'plan')
            const viewing = review ? review === s.id : i === idx || (growing && s.id === 'grow' && e.phase === 'harvest')
            return (
              <li key={s.id} className={`${done ? 'done' : ''} ${viewing ? 'viewing' : ''}`}>
                {canReview ? (
                  <button onClick={() => setReview(review === s.id ? null : (s.id as Reviewable))} aria-current={viewing ? 'step' : undefined}>
                    {s.label}
                  </button>
                ) : s.id === current.id && review ? (
                  <button onClick={() => setReview(null)}>{s.label}</button>
                ) : (
                  <span aria-current={viewing ? 'step' : undefined}>{s.label}</span>
                )}
              </li>
            )
          })}
        </ol>
      </header>
      <div className="panel-body">
        {review ? (
          <Review step={review} />
        ) : (
          <>
            {e.phase === 'brief' && <Brief />}
            {e.phase === 'clarify' && <Clarify />}
            {e.phase === 'plan' && <Plan />}
            {growing && <Grow />}
          </>
        )}
      </div>
      <footer className={`panel-foot ${growing && !review ? 'empty' : ''}`}>
        {review ? (
          <button className="btn primary grow" onClick={() => setReview(null)}>
            {growing ? "Back to the farm" : `Back to ${current.label.toLowerCase()}`}
          </button>
        ) : growing ? null : (
          <SetupFooter />
        )}
      </footer>
    </aside>
  )
}
