import { useState, type ReactNode } from 'react'
import { Emoji } from '../../ds'
import { PageHead } from '../Doc'
import './styles.css'

/* Three control directions, the same parts in each, so they compare like for like.
   Each one is drawn from named references in "Homestead AI: high-craft UI references".
   Temporary: once one is picked it moves into src/ds and this page goes. */

type DirId = 'a' | 'b' | 'c'
type Dir = { id: DirId; name: string; from: string; line: string }
const DIRS: Dir[] = [
  {
    id: 'a',
    name: 'A. Farm-drawn',
    from: 'Stardew Valley, Playdate, A Short Hike, Balatro',
    line: 'The controls are drawn like the farm. Stardew draws its menus from the same sheets and scale as the world, so every edge here sits on the farm’s 3px pixel, with the UI pack’s own shading: a dark outline with cut corners, a light top edge and a thick lip that squashes when pressed. Deploy is press-and-hold, like Playdate’s crank to buy. Energy is chunky pixel ticks, like Balatro.',
  },
  {
    id: 'b',
    name: 'B. Instrument',
    from: 'Teenage Engineering OP-1, Raycast, Linear, Vercel Geist',
    line: 'A precise tool beside a playful farm, the way the OP-1 keeps its character art on the display and its hardware plain. Each key carries a colour light for the one thing it does. Keycaps are always shown, as in Raycast, and the ask card ends in one action bar with the shortcut. Flat, no shadows, borders and hover from one neutral ramp like Geist. Sections are numbered in mono instead of labelled.',
  },
  {
    id: 'c',
    name: 'C. Choice screen',
    from: 'Hades, Into the Breach, Disco Elysium, Citizen Sleeper, Celeste',
    line: 'Plain, square controls everywhere, and all the ornament spent on the decision, the way Hades frames only its choice screens. The ask card gets a stepped frame and shows what each answer changes, old value to new, like Hades and Into the Breach. One-shot answers are marked by shape, not colour, like Disco Elysium’s checks. Selection is an edge tab, as in Celeste’s menus. Energy is a segmented clock from Citizen Sleeper.',
  },
]

/* ---------- ticks ---------- */
function PixelTick() {
  const rows = ['....#', '...#.', '#.#..', '.#...']
  return (
    <svg className="sx-tick" viewBox="0 0 5 4" width={15} height={12} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null)))}
    </svg>
  )
}
function LineTick() {
  return (
    <svg className="sx-tick" viewBox="0 0 16 16" width={10} height={10} aria-hidden>
      <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="square" />
    </svg>
  )
}
function Tick({ dir }: { dir: DirId }) {
  return dir === 'a' ? <PixelTick /> : <LineTick />
}

/* ---------- parts ---------- */
function Check({ dir, checked, onChange, label }: { dir: DirId; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="sx-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sx-box" aria-hidden>
        {checked && <Tick dir={dir} />}
      </span>
      <span>{label}</span>
    </label>
  )
}

function Switch({ dir, on, onChange, label }: { dir: DirId; on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="sx-switch-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="sx-switch" onClick={() => onChange(!on)}>
        {dir === 'b' ? (
          <>
            <span>Off</span>
            <span>On</span>
          </>
        ) : (
          <i />
        )}
      </button>
    </div>
  )
}

function Meter({ dir, left }: { dir: DirId; left: number }) {
  if (dir === 'c') {
    // Citizen Sleeper's segmented clock: 6 wedges, filled ones are what's left
    const n = 6
    const on = Math.round(left * n)
    const wedge = (i: number) => {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.09
      const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.09
      const p = (a: number, r: number) => `${16 + Math.cos(a) * r},${16 + Math.sin(a) * r}`
      return `M${p(a0, 7)} L${p(a0, 15)} A15 15 0 0 1 ${p(a1, 15)} L${p(a1, 7)} A7 7 0 0 0 ${p(a0, 7)} Z`
    }
    return (
      <div className="sx-meter">
        <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden>
          {Array.from({ length: n }, (_, i) => (
            <path key={i} d={wedge(i)} className={i < on ? 'on' : ''} />
          ))}
        </svg>
        <span>
          <b>Energy</b> {on} of {n} left
        </span>
      </div>
    )
  }
  const ticks = 12
  const on = Math.round(left * ticks)
  return (
    <div className="sx-meter">
      <span className="sx-meter-label">Energy</span>
      <span className="sx-ticks" aria-hidden>
        {Array.from({ length: ticks }, (_, i) => (
          <i key={i} className={i < on ? 'on' : ''} />
        ))}
      </span>
      <b>{Math.round(left * 100)}%</b>
    </div>
  )
}

function H({ dir, n, children }: { dir: DirId; n: number; children: ReactNode }) {
  return <h3>{dir === 'b' ? <><span className="sx-num">0{n}</span> {children}</> : children}</h3>
}

const CHOICES = [
  { title: 'Postgres', detail: 'Hosted, survives restarts.', cost: ['$0', '$5 a month'], once: false },
  { title: 'SQLite', detail: 'A file next to the app. One server only.', cost: ['$0', '$0'], once: false },
  { title: 'Move the old data too', detail: 'Copies 1,240 rows across. Can’t be undone.', cost: ['0 rows', '1,240 rows'], once: true },
]

function Specimen({ dir }: { dir: Dir }) {
  const [pick, setPick] = useState(0)
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  const [chime, setChime] = useState(true)
  const [roll, setRoll] = useState(false)
  const d = dir.id

  return (
    <section className={`sx sx-${d}`} id={`sx-${d}`}>
      <div className="sx-head">
        <h2>{dir.name}</h2>
        <p className="sx-from">From {dir.from}</p>
        <p>{dir.line}</p>
      </div>
      <div className="sx-grid">
        <div className="sx-cell">
          <H dir={d} n={1}>Buttons</H>
          <div className="sx-row">
            <button type="button" className="sx-btn sprout">
              Approve plan <kbd>↵</kbd>
            </button>
            <button type="button" className="sx-btn out hold">
              <span>{d === 'b' ? 'Deploy' : 'Hold to deploy'}</span>
            </button>
          </div>
          <div className="sx-row">
            <button type="button" className="sx-btn plain">
              Send back
            </button>
            <button type="button" className="sx-btn quiet">
              Later
            </button>
          </div>
          <h4>Hover, pressed, disabled</h4>
          <div className="sx-row">
            <button type="button" className="sx-btn sprout is-hover">
              Hover
            </button>
            <button type="button" className="sx-btn sprout is-press">
              Pressed
            </button>
            <button type="button" className="sx-btn sprout" disabled>
              Disabled
            </button>
          </div>
          <div className="sx-row">
            <button type="button" className="sx-btn plain is-hover">
              Hover
            </button>
            <button type="button" className="sx-btn plain is-press">
              Pressed
            </button>
            <button type="button" className="sx-btn out hold is-holding">
              <span>{d === 'b' ? 'Deploying' : 'Holding'}</span>
            </button>
          </div>
          <Meter dir={d} left={0.62} />
        </div>

        <div className="sx-cell">
          <H dir={d} n={2}>Ask card</H>
          <div className="sx-ask">
            <div className="sx-who">
              <Emoji name="question" />
              <span>
                <b>Planner</b> needs a choice
              </span>
            </div>
            <p className="sx-q">Where should the app keep its data?</p>
            <div className="sx-choices">
              {CHOICES.map((c, i) => (
                <button key={c.title} type="button" className={`sx-choice ${c.once ? 'once' : ''}`} aria-pressed={pick === i} onClick={() => setPick(i)}>
                  <kbd>{i + 1}</kbd>
                  <span>
                    <b>
                      {c.title}
                      {c.once && d === 'c' && <i className="sx-once" title="One-shot: can’t be undone" />}
                    </b>
                    <small>{c.detail}</small>
                    {d === 'c' && (
                      <small className="sx-cons">
                        {c.once ? 'Rows moved' : 'Cost'} <s>{c.cost[0]}</s> → <b>{c.cost[1]}</b>
                      </small>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="sx-foot">
              {d === 'b' && <span className="sx-ctx">Planner · ask 2 of 5</span>}
              <button type="button" className="sx-btn quiet sm">
                Skip
              </button>
              <button type="button" className="sx-btn sprout sm">
                Answer <kbd>↵</kbd>
              </button>
            </div>
          </div>
        </div>

        <div className="sx-cell">
          <H dir={d} n={3}>Settings</H>
          <div className="sx-stack">
            <Check dir={d} checked={a} onChange={setA} label="Run tests before deploy" />
            <Check dir={d} checked={b} onChange={setB} label="Ask before spending" />
            <Switch dir={d} on={chime} onChange={setChime} label="Chime when done" />
            <Switch dir={d} on={roll} onChange={setRoll} label="Roll back on failure" />
            <div className="sx-field">
              <label htmlFor={`sx-${d}-name`}>Project name</label>
              <input id={`sx-${d}-name`} className="sx-input" defaultValue="Mira’s bakery" />
            </div>
            <div className="sx-field">
              <label htmlFor={`sx-${d}-budget`}>Monthly budget</label>
              <input id={`sx-${d}-budget`} className="sx-input is-focus" defaultValue="$20" />
              <small>Focused</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function StylesPage(_: { arg?: string }) {
  return (
    <>
      <PageHead title="Control styles">
        Three directions for the controls, each built from references in the high-craft UI research. The same parts appear in each,
        and everything is clickable. The picked one replaces the current controls everywhere.
      </PageHead>
      {DIRS.map((d) => (
        <Specimen key={d.id} dir={d} />
      ))}
    </>
  )
}
