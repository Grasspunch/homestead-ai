import './fonts'
import './styles.css'
import { useEffect, useRef } from 'react'
import { MapView } from './map/MapView'
import { Panel } from './panel/Panel'
import { AgentTree } from './panel/AgentTree'
import { FarmPeek } from './panel/FarmPeek'
import { BEATS, engine } from './sim/engine'
import { FARM, MISSING } from './sim/scenario'
import { crumbsOf, goPage, pageOf, parsePath, pathOf } from './sim/pages'
import { Kbd, useEngine } from './ui'

function Hud() {
  const e = useEngine()
  const growing = e.phase === 'grow'
  if (e.intro) return null
  const crumbs = crumbsOf(e, pageOf(e))
  return (
    <div className="hud">
      <nav className="crumbs" aria-label="Where you are">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          const id = c.page.kind === 'region' ? 'view-valley' : c.page.kind === 'valley' && c.page.id === FARM.name ? 'view-farm' : `crumb-${i}`
          return (
            <span key={i} className="crumb">
              {i > 0 && <span className="sep">/</span>}
              <button aria-pressed={last} aria-current={last ? 'page' : undefined} onClick={() => goPage(e, c.page)} data-testid={id} title={c.page.kind === 'region' ? 'Every project in your organisation (V)' : undefined}>
                {c.label}
              </button>
            </span>
          )
        })}
      </nav>
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
  const shown = e.toasts.filter((t) => e.clock - t.t < 4.5).slice(-1)
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
  ['Region', 'Your organisation, one valley per project'],
  ['Valley', 'A project, named after it'],
  ['Field', 'One agent: its farmhand and its plots'],
  ['Head farmer', 'Plans the work and asks you questions'],
  ['Farmhand', 'The agent at work on its field'],
  ['Plot and crop', 'A task, and how far along it is'],
  ['Gate', 'A check a crop must pass to ripen'],
  ['Energy', 'Tokens the crew spends'],
  ['Pest', 'A failing test the crew fixes alone'],
  ['Crow', 'A clash with another team’s project'],
  ['Plant', 'Your goal, the crew, and the plan you approve'],
  ['Grow', 'The crew works and the gates run'],
  ['Harvest', 'Your review, the merge and the deploy'],
]

function Help() {
  const e = useEngine()
  if (!e.showHelp) return null
  const rows: [string, string][] = [
    ['⏎', 'Main action'],
    ['A', 'Approve, at the harvest'],
    ['1 / 2', 'Pick an option'],
    ['R', 'Reply'],
    ['P', 'Pause everything'],
    ['V', 'Region view, and back'],
    ['Esc', 'Back'],
    ['Tab', 'Agent tree'],
    ['B', 'Open or close the panel'],
    ['Drag', 'Move around the map'],
  ]
  return (
    <div className="help" role="dialog" aria-label="Help">
      <dl>
        {GLOSSARY.map(([k, v]) => (
          <span key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </span>
        ))}
      </dl>
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
  // The agent tree handles its own keys while it is open.
  if (e.treeOpen) return
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
  // Keys only answer the ask that is on screen: none on the Valleys page or another project's valley,
  // and on a field page only that agent's own ask.
  const onValleys = e.view === 'valley' || !!e.peekName
  const ask = onValleys ? undefined : e.fieldPage ? e.openAsks.find((a) => a.from === e.fieldPage) : e.activeAsk
  const growing = e.phase === 'grow' || e.phase === 'harvest' || e.phase === 'ship'

  if (k === 'escape') {
    if (e.showHelp) e.showHelp = false
    else if (ask?.status === 'confirming') e.cancelConfirm(ask.id)
    else if (e.sendState === 'confirming') e.cancelSend()
    else if (e.peekName) e.setView('valley')
    else if (e.back()) return
    else if (e.fieldPage) e.closeField()
    else if (e.view === 'valley') e.setView('farm')
    e.notify()
    return
  }
  if (k === 'tab' && !ev.shiftKey && (!el || el === document.body || el.closest('.map-col'))) {
    ev.preventDefault()
    e.setTree(true)
    return
  }
  if (k === 'b') {
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
    else if (e.phase === 'harvest' && e.canApprove && !e.approved) e.approveHarvest()
    else if (e.phase === 'harvest' && e.approved && e.sendState !== 'sent') e.merge()
    else if (e.trace) e.saveSeed()
    else if (ask?.status === 'confirming') e.answer(ask.id, 'approve')
    else if (ask) {
      const rec = ask.options.find((o) => o.recommended) ?? ask.options[0]
      e.answer(ask.id, rec.value)
    } else if (e.replan?.status === 'open' && !onValleys && (!e.fieldPage || e.task(MISSING.taskId).assignee === e.fieldPage)) e.applyReplan()
    else if (e.phase === 'ship' && e.shipStage === 'held') e.requestDeploy()
    else if (e.harvestReady && e.phase === 'grow') e.openHarvest()
    return
  }
  if (k === 'v') return e.setView(e.view === 'valley' ? 'farm' : 'valley')
  if (k === 'a' && e.phase === 'harvest') return e.approveHarvest()
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
  else if (k === 'w' && e.replan?.status === 'applied' && !e.flags.has('seedSaved')) e.openTrace('endpoint')
}

export function App() {
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const e = useEngine()
  // Each page has its own address. A deep link skips the opening; Back and Forward move between pages.
  useEffect(() => {
    const deep = parsePath(location.pathname, engine)
    if (location.pathname !== '/' && deep) {
      engine.skipIntro()
      goPage(engine, deep)
    } else if (location.pathname !== '/') {
      // An address that names no valley goes to Valleys, the same way an unknown agent goes to its valley.
      history.replaceState(null, '', '/' + location.search)
      engine.skipIntro()
      goPage(engine, { kind: 'region' })
    }
    const onPop = () => {
      const p = parsePath(location.pathname, engine)
      if (p) goPage(engine, p)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (e.intro) return
    const want = pathOf(pageOf(e))
    if (location.pathname === want) return
    // An address that names no page (or a different one) is replaced, so Back never lands on it again.
    const here = parsePath(location.pathname, engine)
    if (!here || pathOf(here) !== location.pathname) history.replaceState(null, '', want + location.search)
    else history.pushState(null, '', want + location.search)
  })
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
        <FarmPeek />
        <Caption />
        {e.paused && (
          <div className="paused-veil">
            <span>Paused</span>
          </div>
        )}
      </main>
      <Panel />
      <Help />
      <AgentTree />
    </div>
  )
}
