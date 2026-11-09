import './fonts'
import './styles.css'
import { useEffect, useRef } from 'react'
import { MapView } from './map/MapView'
import { Panel } from './panel/Panel'
import { BEATS, engine } from './sim/engine'
import { FARM } from './sim/scenario'
import { Kbd, useEngine } from './ui'

function Hud() {
  const e = useEngine()
  const growing = e.phase === 'grow' || e.phase === 'harvest'
  if (e.intro) return null
  return (
    <div className="hud">
      <div className="crumbs" role="group" aria-label="Map view">
        <button aria-pressed={e.view === 'valley'} onClick={() => e.setView('valley')} data-testid="view-valley">
          Valley
        </button>
        <span className="sep">/</span>
        <button aria-pressed={e.view === 'farm'} onClick={() => e.setView('farm')} data-testid="view-farm">
          {FARM.name}
        </button>
      </div>
      <div className="meters">
        {growing && (
          <button className="pause-btn" aria-pressed={e.paused} onClick={() => e.togglePause()} data-testid="pause">
            {e.paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
        )}
        <button className="pause-btn" onClick={() => ((e.showHelp = !e.showHelp), e.notify())} aria-label="Help and shortcuts">
          ?
        </button>
      </div>
    </div>
  )
}

function Toasts() {
  const e = useEngine()
  const shown = e.toasts.filter((t) => e.clock - t.t < 4.5)
  return (
    <div className="toasts" aria-live="polite">
      {shown.map((t) => (
        <div className="toast" key={t.id}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

const GLOSSARY: [string, string][] = [
  ['Farm', 'A project, named after it'],
  ['Head farmer', 'Plans the work and asks you questions'],
  ['Farmhand', 'An agent with one role'],
  ['Plot and crop', 'A task, and how far along it is'],
  ['Energy', 'Tokens the crew spends'],
  ['Pest', 'Something wrong in the work'],
  ['Crow', 'A clash with another team’s plan'],
  ['Harvest', 'Your review before anything goes out'],
]

function Help() {
  const e = useEngine()
  if (!e.showHelp) return null
  const rows: [string, string][] = [
    ['⏎', 'Main action'],
    ['A / D', 'Approve or deny'],
    ['1 / 2', 'Pick an option'],
    ['R', 'Reply'],
    ['P', 'Pause everything'],
    ['V', 'Valley view'],
    ['Esc', 'Back'],
    ['Tab', 'Open or close the panel'],
    ['Drag', 'Move around the map'],
  ]
  return (
    <div className="help" role="dialog" aria-label="Help">
      <h4>Words</h4>
      <dl>
        {GLOSSARY.map(([k, v]) => (
          <span key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </span>
        ))}
      </dl>
      <label className="switch">
        <input type="checkbox" checked={e.liveAI} onChange={(ev) => e.setLiveAIOn(ev.target.checked)} data-testid="live-ai" />
        <span>
          <b>Live AI</b>
          <br />
          {e.live === false ? 'Needs an API key on the server. Off: responses are simulated.' : 'Off: responses are simulated and cost nothing.'}
        </span>
      </label>
      <h4>Keys</h4>
      <dl>
        {rows.map(([k, v]) => (
          <span key={k} style={{ display: 'contents' }}>
            <dt>
              <Kbd>{k}</Kbd>
            </dt>
            <dd>{v}</dd>
          </span>
        ))}
      </dl>
    </div>
  )
}

// The opening: one line per camera beat. Enter moves on, Esc skips.
function Caption() {
  const e = useEngine()
  if (!e.intro || !e.ready) return null
  return (
    <div className="caption" role="status" key={e.beat}>
      <p>{BEATS[e.beat].caption}</p>
      <div className="caption-foot">
        <span className="dots" aria-hidden>
          {BEATS.map((_, i) => (
            <i key={i} className={i === e.beat ? 'on' : ''} />
          ))}
        </span>
        <button className="linkish" onClick={() => e.nextBeat()} data-testid="next-beat">
          Next <Kbd>⏎</Kbd>
        </button>
        <button className="linkish" onClick={() => e.skipIntro()} data-testid="skip-intro">
          Skip <Kbd>Esc</Kbd>
        </button>
      </div>
    </div>
  )
}

function onKey(ev: KeyboardEvent) {
  const e = engine
  if (e.intro) {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      e.nextBeat()
    } else if (ev.key === 'Escape') e.skipIntro()
    return
  }
  const el = ev.target as HTMLElement
  const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  const mod = ev.metaKey || ev.ctrlKey
  if (ev.key === 'Enter' && mod) {
    if (e.phase === 'brief') {
      ev.preventDefault()
      e.submitBrief()
    }
    return
  }
  if (typing) {
    if (ev.key === 'Escape') el.blur()
    return
  }
  if (mod || ev.altKey) return
  const k = ev.key.toLowerCase()
  const ask = e.activeAsk
  const growing = e.phase === 'grow' || e.phase === 'harvest'

  if (k === 'escape') {
    if (e.showHelp) e.showHelp = false
    else if (ask?.status === 'confirming') e.cancelConfirm(ask.id)
    else if (e.sendState === 'confirming') e.cancelSend()
    else if (e.back()) return
    else if (e.view === 'valley') e.setView('farm')
    e.notify()
    return
  }
  if (k === 'tab' && !ev.shiftKey && (!el || el === document.body || el.closest('.map-col'))) {
    ev.preventDefault()
    e.setPanel(!e.panelOpen)
    return
  }
  if (k === '?') {
    e.showHelp = !e.showHelp
    e.notify()
    return
  }
  if (k === 'enter') {
    if (el.tagName === 'BUTTON' || el.tagName === 'SUMMARY' || el.tagName === 'A' || el.getAttribute('role') === 'button') return // the focused control handles it
    ev.preventDefault()
    if (e.phase === 'brief') e.submitBrief()
    else if (e.phase === 'clarify') e.finishClarify()
    else if (e.phase === 'plan') e.approvePlan()
    else if (e.phase === 'harvest' && e.harvestStage === 'map') e.skipHarvestMap()
    else if (e.trace) e.saveSeed()
    else if (ask?.status === 'confirming') e.answer(ask.id, 'approve')
    else if (ask) {
      const rec = ask.options.find((o) => o.recommended) ?? ask.options[0]
      e.answer(ask.id, rec.value)
    } else if (e.replan?.status === 'open') e.applyReplan()
    else if (e.harvestReady && e.phase === 'grow') e.openHarvest()
    return
  }
  if (k === 'v') return e.setView(e.view === 'valley' ? 'farm' : 'valley')
  if (!growing) return
  if (ask && ask.status === 'open') {
    const opt = ask.options.find((o) => o.key.toLowerCase() === k)
    if (opt) {
      e.answer(ask.id, opt.value)
      return
    }
    if (k === 'r') {
      ev.preventDefault()
      e.setPanel(true)
      setTimeout(() => document.getElementById('reply-input')?.focus(), 0)
      return
    }
  }
  if (k === 'p') e.togglePause()
  else if (k === 'h' && e.harvestReady && e.phase === 'grow') e.openHarvest()
  else if (k === 'w' && e.replan?.status === 'applied' && !e.flags.has('seedSaved')) e.openTrace('date')
}

export function App() {
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const e = useEngine()
  // When the opening ends, the cursor waits in the brief.
  const wasIntro = useRef(true)
  useEffect(() => {
    if (wasIntro.current && !e.intro) setTimeout(() => (document.getElementById('goal') as HTMLTextAreaElement | null)?.focus({ preventScroll: true }), 450)
    wasIntro.current = e.intro
  }, [e.intro])
  return (
    <div className={`app ${e.intro ? 'wide' : !e.panelOpen ? 'railed' : ''}`}>
      <main className="map-col">
        <MapView />
        <Hud />
        <Toasts />
        <Caption />
        {e.paused && (
          <div className="paused-veil">
            <span>Paused</span>
          </div>
        )}
      </main>
      <Panel />
      <Help />
    </div>
  )
}
