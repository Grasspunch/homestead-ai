import { useState } from 'react'
import { Button, FieldGlyph } from '../../ds'
import { PageHead, Section } from '../Doc'

const DUR = [
  ['--t-press', '80ms', 'A button dropping onto its shadow'],
  ['--t-quick', '120ms', 'Hover, a check appearing, tooltips'],
  ['--t-base', '220ms', 'Panels folding, rows sliding when their state changes'],
  ['--t-slow', '360ms', 'The ask glyph’s one pulse'],
  ['--t-scene', '680ms', 'The camera leaning toward a plot'],
  ['--t-hold', '200ms', 'Wait before a tooltip, so passing over doesn’t flash'],
]

const EASE = [
  ['--ease', 'Standard, for things moving on screen'],
  ['--ease-enter', 'Things arriving: fast start, soft landing'],
  ['--ease-exit', 'Things leaving, quicker than they came'],
  ['--ease-move', 'The camera and the panel, start to stop'],
]

export function MotionPage(_: { arg?: string }) {
  const [k, setK] = useState(0)
  const [on, setOn] = useState(false)
  return (
    <>
      <PageHead title="Motion">
        Felt, not watched. Fast, and never in the way. Only transform and opacity animate. With reduced motion on, durations drop
        to zero and the glyphs hold still.
      </PageHead>

      <Section title="Durations">
        <ul className="mo-list">
          {DUR.map(([v, ms, use]) => (
            <li key={v}>
              <code>{v}</code>
              <b>{ms}</b>
              <span>{use}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Easing" note="Click to run each curve over the same distance.">
        <div className="mo-ease">
          {EASE.map(([v, use]) => (
            <div key={v}>
              <div className="mo-track">
                <i style={{ transition: `transform var(--t-scene) var(${v})`, transform: on ? 'translateX(calc(100% * 9))' : 'none' }} />
              </div>
              <code>{v}</code>
              <span>{use}</span>
            </div>
          ))}
          <Button size="sm" onClick={() => setOn(!on)}>
            {on ? 'Back' : 'Run'}
          </Button>
        </div>
      </Section>

      <Section title="The ask pulse" note="When an agent asks, its glyph pulses once and then holds still. A soft chime plays if Settings allows it. Nothing else on the farm makes a sound.">
        <div className="mo-pulse">
          <FieldGlyph key={k} state={{ kind: 'ask', reason: 'anomaly' }} pulse />
          <Button size="sm" onClick={() => setK(k + 1)}>
            Play again
          </Button>
        </div>
      </Section>

      <Section title="What never animates">
        <ul className="ds-rules">
          <li>Anything repeated all day: keyboard shortcuts, switching rows, the Tab tree.</li>
          <li>Rows reshuffling on every tick. A row moves only when its state changes, with one short slide.</li>
          <li>Numbers counting up. They change in place, in tabular figures.</li>
        </ul>
      </Section>
    </>
  )
}
