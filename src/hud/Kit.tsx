// The kit page: every control the app uses, drawn by the app's own CSS and components.
// The /design library embeds this page, so the library always shows what the app ships.
import { useEffect, useState, type ReactNode } from 'react'
import '../fonts'
import './kit.css'
import './hud.css'
import './panel.css'
import { Ico, LimitField, Mark, Portrait, Sign, Swatch, Ticks } from './bits'

const PAGE = `
body { overflow: auto !important; background: #8fc77a; }
.kp { padding: 24px; display: flex; flex-direction: column; gap: 24px; max-width: 1040px; }
.kp-sec { padding: 6px 10px 12px; display: flex; flex-direction: column; gap: 14px; }
.kp-sec h2 { margin: 0; font: 400 24px/1 px7; color: var(--bark); }
.kp-note { margin: 0; font-size: var(--t-meta); color: var(--bark-3); max-width: 640px; line-height: 1.45; }
.kp-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.kp-col { display: flex; flex-direction: column; gap: 8px; }
.kp-cap { font-size: var(--t-meta); color: var(--bark-3); }
.kp-stage { background: #8fc77a; padding: 32px; display: flex; gap: 40px; align-items: center; flex-wrap: wrap; }
.kp-bub { width: 260px; padding: 6px 10px; font-size: var(--t-body); }
.kp-ctl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.kp-ask { display: flex; gap: 14px; align-items: flex-start; }
.kp-askbody { flex: 1; padding: 4px 10px 6px; display: flex; flex-direction: column; gap: 10px; }
.kp-askbody p { margin: 0; font-size: var(--t-lead); }
.kp-ctl input[type=range] { width: 200px; accent-color: var(--leaf); }
`

function Sec({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="kp-sec paper">
      <h2>{title}</h2>
      {note && <p className="kp-note">{note}</p>}
      {children}
    </section>
  )
}

type Tail = 'none' | 'left' | 'right' | 'up' | 'down'

export function Kit() {
  const [tail, setTail] = useState<Tail>('left')
  const [at, setAt] = useState(42)
  const [limit, setLimit] = useState(23)
  const [on, setOn] = useState(true)
  const [level, setLevel] = useState('matters')
  useEffect(() => {
    // Tell an embedding page how tall this is, so it can size its frame.
    const post = () => window.parent?.postMessage({ kitHeight: document.documentElement.scrollHeight }, '*')
    post()
    const ro = new ResizeObserver(post)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [])
  return (
    <main className="kp">
      <style>{PAGE}</style>

      <Sec title="Paper and bubbles" note="Paper is the one surface, with straight edges. A bubble is paper with a tail, and only when someone speaks: the tail points at the speaker. Panels, the inbox and cards have no speaker, so they have no tail.">
        <div className="kp-ctl">
          {(['none', 'left', 'right', 'up', 'down'] as Tail[]).map((t) => (
            <button key={t} className={`btn xs ${tail === t ? '' : 'tan'}`} onClick={() => setTail(t)}>
              {t === 'none' ? 'No tail' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <label className="kp-cap kp-ctl">
            Tail at {at}px
            <input type="range" min={12} max={tail === 'up' || tail === 'down' ? 220 : 60} value={at} onChange={(e) => setAt(Number(e.target.value))} />
          </label>
        </div>
        <div className="kp-stage">
          <div className="kp-bub paper bubble" data-tail={tail === 'none' ? undefined : tail} style={{ ['--tail-at' as string]: `${at}px` }}>
            The widget answers and shows its sources without covering the reply box.
          </div>
          <div className="kp-col">
            <code className="kp-cap">{tail === 'none' ? '<div class="paper">' : `<div class="paper bubble" data-tail="${tail}" style="--tail-at: ${at}px">`}</code>
          </div>
        </div>
      </Sec>

      <Sec title="Buttons" note="Pack buttons. Cream for the one main action, tan for the rest, white in the top bar. Text is the pixel font.">
        <div className="kp-row">
          <button className="btn">
            <Ico name="play" />
            Approve
          </button>
          <button className="btn tan">Not now</button>
          <button className="btn white top-ico" aria-label="Settings">
            <Ico name="gear" size={32} />
          </button>
          <button className="btn sm">
            <Ico name="check" size={20} />
            Accept
          </button>
          <button className="btn xs tan">Send back</button>
          <button className="btn" disabled>
            Disabled
          </button>
        </div>
      </Sec>

      <Sec title="Fields" note="Every value you can change is the same soft well: one shade darker than the paper, a soft outline, a lip on top. Hover darkens the outline, focus turns it leaf green. The label sits above in bold; the placeholder is never the label.">
        <div className="kp-row" style={{ alignItems: 'flex-start' }}>
          <div className="kp-col" style={{ width: 200 }}>
            <span className="field-label">Model</span>
            <select className="field-box" defaultValue="sonnet">
              <option value="opus">Claude Opus 5.5</option>
              <option value="sonnet">Claude Sonnet 5.5</option>
              <option value="haiku">Claude Haiku 5.5</option>
            </select>
          </div>
          <div className="kp-col" style={{ width: 100 }}>
            <span className="field-label">Limit</span>
            <LimitField unit="$" label="Spend limit" value={limit} onChange={setLimit} />
          </div>
          <div className="kp-col" style={{ flex: 1, minWidth: 280 }}>
            <label className="field-label" htmlFor="kp-when">
              Done when
            </label>
            <textarea id="kp-when" className="field-area" defaultValue="90% of eval questions get an answer with a cited doc" />
          </div>
        </div>
        <form className="row" onSubmit={(e) => e.preventDefault()}>
          <span className="field">
            <input placeholder="Tell the crew something, for example: make the widget friendlier" aria-label="Message the crew" />
          </span>
          <button className="btn" type="submit">
            <Ico name="chat" />
            Send
          </button>
        </form>
      </Sec>

      <Sec title="Choosing" note="On or off is the wooden switch. A choice among a few levels is a row of pack buttons, cream for the chosen one.">
        <div className="kp-row">
          <button className="plan-setting" onClick={() => setOn(!on)} aria-pressed={on}>
            <span>I accept finished work</span>
            <span className={`switch${on ? ' on' : ''}`} />
          </button>
          <div className="levels" role="radiogroup">
            {[
              ['often', 'Often'],
              ['matters', 'When it matters'],
              ['undoable', 'Only what’s hard to undo'],
            ].map(([k, l]) => (
              <button key={k} role="radio" aria-checked={level === k} className={level === k ? 'on' : ''} onClick={() => setLevel(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </Sec>

      <Sec title="Status" note="Tags name a state. The urgency tag leads an ask: red for a failure, honey for cost or risk, bark for the rest, each with its icon. Pass and fail are the pack's check and cross. Spend is the tick meter.">
        <div className="kp-row">
          <span className="tag grey">Plan</span>
          <span className="tag green">Done</span>
          <span className="tag sky">Live</span>
          <span className="tag red">Rolled back</span>
          <span className="urgency red">
            <Ico name="alert" tone="light" />
            Failed check
          </span>
          <span className="urgency honey">
            <Ico name="coin" tone="light" />
            Over budget
          </span>
          <span className="urgency calm">
            <Ico name="chat" tone="light" />
            Disagreement
          </span>
          <Mark pass />
          <Mark pass={false} />
        </div>
        <div style={{ maxWidth: 320 }}>
          <Ticks used={14} total={20} />
        </div>
      </Sec>

      <Sec title="Ask" note="The one raised object: a speech bubble from the farmer who needs you, its tail at their portrait. The plot's sign and task name lead, then the urgency tag, the question, and the answers. The suggested answer is the cream button. Each side of a disagreement folds open to its reasoning.">
        <div className="kp-ask">
          <div className="portrait">
            <Portrait farmer="designer" />
          </div>
          <div className="body paper bubble kp-askbody" data-tail="left">
            <div className="who">
              <span className="plot-chip">
                <Sign crop="pumpkin" />
                Chat widget
              </span>
              <span className="urgency calm">
                <Ico name="chat" tone="light" />
                Disagreement
              </span>
            </div>
            <p>Should the sources sit under the answer or behind a button?</p>
            <div className="sides">
              <details className="side-card">
                <summary>
                  <Swatch farmer="designer" />
                  <span className="grow">
                    <b>Designer</b> Under the answer
                  </span>
                  <span className="sub why-open">Why</span>
                </summary>
                <p className="why">People trust an answer more when they can see where it came from.</p>
              </details>
              <details className="side-card">
                <summary>
                  <Swatch farmer="builder" />
                  <span className="grow">
                    <b>Builder</b> Behind a button
                  </span>
                  <span className="sub why-open">Why</span>
                </summary>
                <p className="why">Three sources push the reply box below the fold on small windows.</p>
              </details>
            </div>
            <div className="row">
              <button className="btn">
                <Ico name="check" />
                Under the answer
              </button>
              <button className="btn tan">Behind a button</button>
            </div>
          </div>
        </div>
      </Sec>

      <Sec title="Change card" note="Asking the Planner to change the farm brings one card per request. One row per change, all checked; untick any you want kept. A row that removes a safety step says what you lose in berry ink. Applied, the request becomes a gold chip under the title with × to turn it off, and the toast carries Undo.">
        <div className="kp-ask">
          <div className="portrait">
            <Portrait farmer="planner" />
          </div>
          <div className="body paper bubble kp-askbody" data-tail="left">
            <div className="who">
              <b>Planner</b>
              <span className="urgency honey">
                <Ico name="star" tone="light" />
                Incident mode
              </span>
            </div>
            <p>Make these 3 changes to the farm?</p>
            <ul className="change-rows" aria-label="Changes">
              {[
                ['The Deployer is off, so the Builder pushes to main', 'Nobody but the author watches the release', true],
                ['Ship to everyone, no 10% stage', 'No 10% stage, so no automatic rollback', true],
                ['Skip “Check it end to end”', 'Nothing checks the tasks together before release', false],
              ].map(([what, loss, on]) => (
                <li key={what as string} className={on ? 'on' : ''}>
                  <label>
                    <input type="checkbox" defaultChecked={on as boolean} />
                    <span className="what">{what}</span>
                    <span className="loss">{loss}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="btn">
                <Ico name="check" />
                Apply 2 changes
              </button>
              <button className="btn tan">Cancel</button>
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14, gap: 10, alignItems: 'center' }}>
          <span className="tag gold reshape-chip">
            Incident mode
            <button aria-label="Turn off Incident mode">×</button>
          </span>
          <div className="toast paper with-undo" style={{ position: 'static', transform: 'none', animation: 'none' }}>
            Incident mode is on.
            <button className="toast-undo">Undo</button>
          </div>
        </div>
      </Sec>

      <Sec title="Rows" note="Lists are ruled, never boxed. Name in body ink, the line under it in description ink.">
        <div className="list" style={{ maxWidth: 520 }}>
          <div>
            <Mark pass />
            <span className="grow">
              Index the help docs
              <span className="sub">Every help doc is searchable, and a test finds the refunds page</span>
            </span>
          </div>
          <div>
            <Mark pass={false} />
            <span className="grow">
              Chat widget
              <span className="sub">The sources cover the reply box</span>
            </span>
          </div>
        </div>
      </Sec>
    </main>
  )
}
