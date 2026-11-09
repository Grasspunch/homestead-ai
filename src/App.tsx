import './fonts'
import './styles.css'
import { useEffect } from 'react'
import { MapView } from './map/MapView'
import { Harvest } from './panel/Harvest'
import { Panel } from './panel/Panel'
import { engine } from './sim/engine'
import { fmtK, Kbd, useEngine } from './ui'

function Hud() {
  const e = useEngine()
  const growing = e.phase === 'grow' || e.phase === 'harvest'
  const pct = Math.min(100, (e.energyUsed / e.budget) * 100)
  return (
    <div className="hud">
      <div className="crumbs" role="group" aria-label="Map view">
        <button aria-pressed={e.view === 'valley'} onClick={() => e.setView('valley')} disabled={!growing}>
          Valley
        </button>
        <span className="sep">/</span>
        <button aria-pressed={e.view === 'farm'} onClick={() => e.setView('farm')}>
          Q1 Launch
        </button>
      </div>
      <div className="meters">
        {growing && (
          <>
            <div className="meter energy" data-testid="meter-energy" title="Energy is tokens. Model calls report their real usage; simulated steps use estimates.">
              <span>Energy</span>
              <div className="bar">
                <i className={pct > 85 ? 'warn' : ''} style={{ width: `${pct}%` }} />
              </div>
              <b>
                {fmtK(e.energyUsed)} <small>/ {fmtK(e.budget)}</small>
              </b>
            </div>
            <div
              className="meter needed"
              data-testid="meter-needed"
              title={`${e.liveCalls || e.replayCalls} ${e.liveCalls ? 'live' : 'replayed'} model calls, ${e.simSteps} simulated steps`}
            >
              <span>Needed you</span>
              <b>{e.neededYou}</b>
            </div>
          </>
        )}
        <div className={`chip-live ${e.live ? '' : 'replay'}`} title={e.live ? 'Writer, Reviewer and the date check call Claude live' : 'No API key here: model steps replay recorded runs'}>
          <i />
          {e.live === null ? 'Checking' : e.live ? 'Live' : 'Replay'}
        </div>
        {growing && (
          <button className="pause-btn" aria-pressed={e.paused} onClick={() => e.togglePause()} data-testid="pause">
            {e.paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
        )}
        {growing && (
          <button className="pause-btn" onClick={() => (e.showHelp = !e.showHelp, e.notify())} aria-label="Keyboard shortcuts">
            ?
          </button>
        )}
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

function Help() {
  const e = useEngine()
  if (!e.showHelp) return null
  const rows: [string, string][] = [
    ['⏎', 'Main action'],
    ['A / D', 'Approve / deny'],
    ['1 / 2', 'Pick an option'],
    ['R', 'Reply'],
    ['P', 'Pause everything'],
    ['V', 'Valley view'],
    ['W', 'Trace a decision'],
    ['H', 'Harvest report'],
    ['Esc', 'Close'],
    ['?', 'This help'],
  ]
  return (
    <div className="help" role="dialog" aria-label="Keyboard shortcuts">
      {rows.map(([k, v]) => (
        <span key={k} style={{ display: 'contents' }}>
          <Kbd>{k}</Kbd>
          <span>{v}</span>
        </span>
      ))}
    </div>
  )
}

function Intro() {
  const e = useEngine()
  if (!e.intro) return null
  return (
    <div className="intro" role="dialog" aria-label="Homestead AI">
      <div className="intro-card">
        <h1>Your agents don’t know what other teams decided.</h1>
        <p>
          You promised Acme Relay v2 on March 12. Engineering moved it to March 26 in standup notes your agents were never given. Brief your crew and watch what
          they catch.
        </p>
        <button className="btn primary" onClick={() => e.startDemo()} data-testid="start" autoFocus>
          Walk onto the farm
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
      e.startDemo()
    }
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
    else if (e.harvestOpen) e.closeHarvest()
    else if (ask?.status === 'confirming') e.cancelConfirm(ask.id)
    else if (e.trace) e.closeTrace()
    else if (e.selected) e.select(null)
    else if (e.view === 'valley') e.setView('farm')
    e.notify()
    return
  }
  if (k === '?') {
    e.showHelp = !e.showHelp
    e.notify()
    return
  }
  if (k === 'enter') {
    if (el.tagName === 'BUTTON' || el.tagName === 'SUMMARY' || el.getAttribute('role') === 'button') return // the focused control handles it
    ev.preventDefault()
    if (e.phase === 'brief') e.submitBrief()
    else if (e.phase === 'clarify') e.finishClarify()
    else if (e.phase === 'plan') e.approvePlan()
    else if (e.harvestOpen) e.closeHarvest()
    else if (e.trace) e.saveSeed()
    else if (ask?.status === 'confirming') e.answer(ask.id, 'approve')
    else if (ask) {
      const rec = ask.options.find((o) => o.recommended) ?? ask.options[0]
      e.answer(ask.id, rec.value)
    } else if (e.replan?.status === 'open') e.applyReplan()
    else if (e.harvestReady) e.openHarvest()
    return
  }
  if (!growing) return
  if (e.harvestOpen && k !== 'h') return
  if (ask && ask.status === 'open') {
    const opt = ask.options.find((o) => o.key.toLowerCase() === k)
    if (opt) {
      e.answer(ask.id, opt.value)
      return
    }
    if (k === 'r') {
      ev.preventDefault()
      const input = document.getElementById('reply-input')
      input?.closest('details')?.setAttribute('open', '')
      input?.focus()
      return
    }
  }
  if (k === 'p') e.togglePause()
  else if (k === 'v') e.setView(e.view === 'valley' ? 'farm' : 'valley')
  else if (k === 'h') (e.harvestOpen ? e.closeHarvest() : e.openHarvest())
  else if (k === 'w' && e.replan?.status === 'applied' && !e.flags.has('seedSaved')) e.openTrace('date')
  else if (k === 's' && e.trace) e.saveSeed()
}

export function App() {
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const e = useEngine()
  return (
    <div className="app">
      <main className="map-col">
        <MapView />
        <Hud />
        <Toasts />
        <Intro />
        {e.paused && (
          <div className="paused-veil">
            <span>Paused</span>
          </div>
        )}
      </main>
      <Panel />
      <Harvest />
      <Help />
    </div>
  )
}
