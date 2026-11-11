// The kit page: every control the app uses, drawn by the app's own CSS and components.
// The /design library embeds this page, so the library always shows what the app ships.
import { useEffect, useState, type ReactNode } from 'react'
import '../fonts'
import './kit.css'
import './hud.css'
import './panel.css'
import { Ico, LimitField, Mark, Portrait, Quiet, Sign, SimTag, Swatch, Ticks } from './bits'
import { AskMe } from './Side'
import type { AutonomyLevel } from '../run/types'

const PAGE = `
body { overflow: auto !important; background: var(--grass); }
.kp { padding: 24px; display: flex; flex-direction: column; gap: 24px; max-width: 1040px; }
.kp-sec { padding: 6px 10px 12px; display: flex; flex-direction: column; gap: 14px; }
.kp-sec h2 { margin: 0; font: 400 var(--px-title)/1 px7; color: var(--bark); }
.kp-note { margin: 0; font-size: var(--t-meta); color: var(--bark-3); max-width: 640px; line-height: 1.45; }
.kp-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.kp-col { display: flex; flex-direction: column; gap: 8px; }
.kp-cap { font-size: var(--t-meta); color: var(--bark-3); }
.kp-stage { background: var(--grass); padding: 32px; display: flex; gap: 40px; align-items: center; flex-wrap: wrap; }
.kp-bub { width: 260px; padding: 6px 10px; font-size: var(--t-body); }
.kp-ctl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.kp-ask { display: flex; gap: 14px; align-items: flex-start; }
.kp-askbody { flex: 1; padding: 4px 10px 6px; display: flex; flex-direction: column; gap: 10px; }
.kp-askbody p { margin: 0; font-size: var(--t-lead); }
.kp-ctl input[type=range] { width: 200px; accent-color: var(--leaf); }
.kp-top.top { position: static; pointer-events: auto; flex-wrap: wrap; }
.kp-type { align-items: baseline; gap: 24px; color: var(--bark); }
.kp-sw { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-meta); color: var(--bark-2); }
.kp-sw i { width: 22px; height: 22px; box-shadow: inset 0 0 0 1px var(--rule); }
.kp-done.dlg { position: static; transform: none; width: 100%; max-width: 860px; }
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
  const [budget, setBudget] = useState(60)
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

      <Sec title="Tokens" note="One set for type, colour and corners, defined once in hud.css. Reading text has three sizes; the pixel font has its own steps for tags, buttons, names and titles.">
        <div className="kp-row kp-type">
          <span style={{ fontSize: 'var(--t-meta)' }}>Meta 13</span>
          <span style={{ fontSize: 'var(--t-body)' }}>Body 15</span>
          <span style={{ fontSize: 'var(--t-lead)' }}>Lead 17</span>
          <span className="px" style={{ fontSize: 'var(--t-big)' }}>34</span>
          <span className="px" style={{ fontSize: 'var(--t-hero)' }}>40</span>
        </div>
        <div className="kp-row kp-type">
          {(['tag', 'xs', 'sm', 'btn', 'name', 'title'] as const).map((k) => (
            <span key={k} className={k === 'tag' ? 'px-s' : 'px'} style={{ fontSize: `var(--px-${k})` }}>
              {k}
            </span>
          ))}
        </div>
        <div className="kp-row">
          {['bark', 'bark-2', 'bark-3', 'bark-4', 'leaf', 'berry', 'sky', 'honey', 'honey-deep', 'cream', 'paper', 'field-ink'].map((c) => (
            <span key={c} className="kp-sw">
              <i style={{ background: `var(--${c})` }} />
              {c}
            </span>
          ))}
        </div>
        <div className="kp-row">
          {['rule', 'tint', 'track'].map((c) => (
            <span key={c} className="kp-sw">
              <i style={{ background: `var(--${c})` }} />
              {c}
            </span>
          ))}
          {['r-s', 'r', 'r-m'].map((r) => (
            <span key={r} className="kp-sw">
              <i style={{ background: 'var(--bark-4)', borderRadius: `var(--${r})` }} />
              {r}
            </span>
          ))}
        </div>
      </Sec>

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

      <Sec title="Top bar, as you ask" note="Ask the Planner to move, resize, rename or recolour a top bar button. Colours are the pack's button in the HUD's own colours. Sizes step twice each way, with icons at whole pixel scales.">
        <div className="top kp-top">
          {(['white', 'cream', 'tan', 'brown', 'leaf', 'berry', 'sky', 'gold'] as const).map((c) => (
            <button key={c} className={`btn ${c} top-ico`} aria-label={c}>
              <Ico name="gear" size={32} />
            </button>
          ))}
        </div>
        <div className="top kp-top">
          {[-2, -1, 0, 1, 2].map((n) => (
            <button key={n} className={`btn white top-ico${n ? ` s${n}` : ''}`} aria-label={`Size ${n}`}>
              <Ico name="gear" size={[16, 16, 32, 32, 48][n + 2]} />
            </button>
          ))}
          <button className="btn white top-ico inbox-btn named" aria-label="Questions">
            <i className="mail-ico" />
            <span className="top-name">Questions</span>
          </button>
        </div>
      </Sec>

      <Sec title="Fields" note="Every value you can change is the same soft well: one shade darker than the paper, a soft outline, a lip on top. Hover darkens the outline, focus turns it leaf green. The label sits above in bold; the placeholder is never the label.">
        <div className="kp-row" style={{ alignItems: 'flex-start' }}>
          <div className="kp-col" style={{ width: 200 }}>
            <span className="field-label">Model</span>
            <select className="field-box" defaultValue="sol">
              <optgroup label="Claude">
                <option value="opus">Claude Opus 5.5</option>
                <option value="opus5">Claude Opus 5</option>
                <option value="sonnet">Claude Sonnet 5</option>
                <option value="haiku">Claude Haiku 4.5</option>
                <option value="fable">Claude Fable 5.1</option>
              </optgroup>
              <optgroup label="OpenAI (Codex)">
                <option value="sol">GPT-6.1 Sol</option>
                <option value="terra">GPT-6.1 Terra</option>
                <option value="luna">GPT-6 Luna</option>
                <option value="astra">GPT-6 Astra</option>
              </optgroup>
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

      <Sec title="Choosing" note="On or off is the wooden switch. How often the crew stops for you is one select-styled field, “Ask me: When it matters”, that opens a menu: each level on one line, with what it asks about under it, read from the autonomy presets. Arrow keys move, Enter picks, Esc closes.">
        <div className="kp-row">
          <button className="plan-setting" onClick={() => setOn(!on)} aria-pressed={on}>
            <span>I accept finished work</span>
            <span className={`switch${on ? ' on' : ''}`} />
          </button>
          <AskMe level={level as AutonomyLevel} onPick={setLevel} />
        </div>
      </Sec>

      <Sec title="Status" note="Tags name a state. The urgency tag leads an ask: red for a failure, honey for cost or risk, bark for the rest, each with its icon. Pass and fail are the pack's check and cross. Spend is the tick meter.">
        <div className="kp-row">
          <span className="tag grey">Plan</span>
          <span className="tag green">Done</span>
          <span className="tag sky">Live</span>
          <span className="tag red">Rolled back</span>
          <span className="tag paused">
            <i aria-hidden />
            Paused
          </span>
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

      <Sec title="Change card" note="Asking the Planner to change the farm brings one card per request. One row per change, all checked; untick any you want kept. A row that removes a safety step says what you lose in berry ink. Each row says how long it lasts, this farm or every farm, as the Planner suggests; every-farm rows join Your flow in Settings, and new farms start with it. Applied, the request becomes a gold chip under the title. For its first few seconds the chip carries Undo, then × to turn it off. No toast, so nothing covers the plots.">
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
                  <span className="scope" role="radiogroup" aria-label="How long">
                    <button role="radio" aria-checked className="on">
                      This farm
                    </button>
                    <button role="radio" aria-checked={false}>
                      Every farm
                    </button>
                  </span>
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
            <button className="chip-undo">Undo</button>
          </span>
          <span className="tag gold reshape-chip">
            Incident mode
            <button aria-label="Turn off Incident mode">×</button>
          </span>
        </div>
      </Sec>

      <Sec title="Team view" note="Home's Team side: spend against each area's budget and the few projects worth a look, never what anyone is doing. An outlier row is its urgency tag, the project and whose it is, one line, and Open. The budget is a soft well; a new project in the area starts with it as its spend limit.">
        <div className="kp-row">
          <span className="view-switch" role="group" aria-label="Show" style={{ marginLeft: 0 }}>
            <button className="btn xs" aria-pressed>
              Mine
            </button>
            <button className="btn xs tan" aria-pressed={false}>
              Team
            </button>
          </span>
        </div>
        <ul className="outliers" style={{ maxWidth: 720 }}>
          <li className="outlier">
            <span className="urgency honey">
              <Ico name="coin" tone="light" />
              Cost spike
            </span>
            <div className="what">
              <b>Help-center bot</b> <span className="who-ran">(Maya)</span>
              <p>Index the help docs is over plan: $8.50 of its $9.80 spent, about half done.</p>
            </div>
            <button className="btn tan xs">Open</button>
          </li>
        </ul>
        <div className="budgets" role="table" style={{ maxWidth: 720 }}>
          <div className="area-row" role="row">
            <b role="rowheader">Help center</b>
            <span className="team-meta" role="cell">
              Budget per project
            </span>
            <span role="cell">
              <LimitField value={budget} unit="$" label="Help center: budget per project" onChange={setBudget} />
            </span>
          </div>
          <div className="farm-row" role="row">
            <button className="farm-name" role="cell">
              Help-center bot
            </button>
            <span className="team-meta" role="cell">
              Maya, 5 agents
            </span>
            <span role="cell" className="spend">
              <Ticks used={13} total={budget} n={12} />
              <span>
                <b>$13</b> of ${budget}
              </span>
            </span>
          </div>
        </div>
      </Sec>

      <Sec title="Projection" note="The deep honey tag marks a number that is projected, not measured. No screen says Simulated: the run's speed already says it.">
        <div className="kp-row">
          <SimTag>Projection</SimTag>
        </div>
      </Sec>

      <Sec title="Quiet states" note="Empty, nothing to flag, a call that failed: one bold line and at most one meta line on the flat tint, an icon first. Berry only for a failure. A paused run drains the farm's colour a little and the title carries the Paused tag.">
        <div className="kp-col" style={{ maxWidth: 520 }}>
          <Quiet icon="check" title="Nothing yet.">
            Questions, fixes and your decisions land here as the run goes.
          </Quiet>
          <Quiet icon="check" title="Nothing stands out.">
            No cost spikes, repeated work or disagreements across the team.
          </Quiet>
        </div>
      </Sec>

      <Sec title="Done" note="One calm block: the lead, the gain in leaf, the learned line, the projection under its tag, then one row of actions. The downloads sit at the end of that row as a quiet group.">
        <div className="dlg done kp-done">
          <div className="body paper">
            <div className="who">
              <b>Planner</b>
              <span className="tag green">Done</span>
            </div>
            <div className="done-text">
              <p>All 7 tasks are in and live for everyone. $54 in 1 h 39 min.</p>
              <p className="impact gain-line">$1.67 of checks caught 3 problems before merge.</p>
              <p className="impact scale-line">
                <SimTag>Projection</SimTag> 10 people × 2 crews a day, at this run’s rates: $1,083 a day.
              </p>
            </div>
            <div className="row">
              <button className="btn">
                <Ico name="star" />
                See the pull request
              </button>
              <button className="btn tan">Spend</button>
              <span className="export-group" role="group" aria-label="Download">
                <span className="export-label">Download</span>
                <button className="btn tan xs long">PR</button>
                <button className="btn tan xs long">Run report</button>
              </span>
            </div>
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
