// Your projects: every project drawn as a little farm, and the Planner asking what to build next.
import { useEffect, useRef, useState } from 'react'
import { planInto } from '../run/planning'
import { draw, hasFrame } from '../map/atlas'
import { TINT } from '../run/crew'
import { pendingAsk, reduce } from '../run/reduce'
import { liveStage } from '../run/rollback'
import { store, useStore, type Project } from '../run/store'
import type { FarmerId, RunState } from '../run/types'
import { ASK_WHY, Ico, Portrait, atlasLoaded } from './bits'

const PX = 16
// The largest pixel scale that shows every farm and the new-farm plot above the Planner's dialogue.
function fitScale(W: number, H: number, farms: number) {
  if (W < 700) return 2
  const slots = farms + 1
  const cols = Math.min(3, slots)
  const rows = Math.ceil(slots / 3)
  return [3, 2.5, 2, 1.5].find((s) => (2 + cols * 9) * PX * s <= W - 16 && (1.5 + rows * 7) * PX * s <= H - 230) ?? 1.5
}
// Starters that need no context: each matches one of the scripted runs (support, checkout, dashboard).
const EXAMPLES = ['A chatbot that answers questions from a shop’s help pages', 'Card checkout for an online shop', 'A dashboard of new sign-ups each week']

interface Mini {
  p: Project
  x: number
  y: number
  stage: number
  emote: 'alert' | 'notes' | 'hearts' | 'read'
  farmer: FarmerId
  words: string
}

function minis(projects: Project[]): Mini[] {
  return projects.map((p, i) => {
    // A run you haven't opened yet starts from the beginning when you do, so it shows as ready to watch.
    const unwatched = p.approved && p.clock === undefined
    const t = !p.approved ? Number.MAX_SAFE_INTEGER : p.clock ?? 0
    const answers = p.answers ?? {}
    const s = reduce(p.events, t, answers)
    const waiting = p.approved && pendingAsk(p.events, t, answers)
    // The same count as the top bar: the work tasks, not the release.
    const work = s.tasks.filter((k) => !k.gate)
    const done = work.filter((k) => k.status === 'ripe' || k.status === 'accepted').length
    const prog = work.length ? done / work.length : 0
    const busy = Object.values(s.farmers).find((f) => f && f.state === 'working')
    // Who needs you and why, in words: the colour alone doesn't say.
    const ask = waiting ? s.asks.find((a) => !a.answer) : undefined
    const asker = ask ? s.farmers[ask.farmer]?.label ?? 'An agent' : ''
    return {
      p,
      x: 2 + (i % 3) * 9,
      y: 2 + Math.floor(i / 3) * 7,
      stage: !p.approved ? -1 : s.done ? 3 : Math.min(2, Math.floor(prog * 3)),
      emote: !p.approved || unwatched ? 'read' : waiting ? 'alert' : s.done ? 'hearts' : 'notes',
      farmer: ask?.farmer ?? busy?.id ?? 'builder',
      words: !p.approved
        ? 'Plan ready, not started'
        : unwatched
          ? p.kind === 'sample' ? 'Sample run, open to watch' : 'Ready to run'
          : ask
            ? `${asker} needs you: ${ASK_WHY[ask.reason]}`
            : waiting
              ? 'Needs you'
              : s.done
                ? doneWords(p, s, t)
                : `${done} of ${work.length} tasks done`,
    }
  })
}

// A finished farm: is its release live, rolled back, or never shipped?
function doneWords(p: Project, s: RunState, t: number) {
  if (liveStage(p.events, t)) return s.tasks.some((k) => k.stopped) ? 'Partly shipped and live' : 'Done and live'
  return s.deploy.some((d) => d.stage === 'rollback') ? 'Rolled back, nothing live' : 'Done, not shipped'
}

export function Home() {
  const st = useStore()
  const [goal, setGoal] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [S, setS] = useState(3)
  const list = minis(st.projects)
  const newSpot = { x: 2 + (list.length % 3) * 9, y: 2 + Math.floor(list.length / 3) * 7 }
  const needs = list.filter((m) => m.emote === 'alert').length

  useEffect(() => {
    let raf = 0
    let alive = true
    atlasLoaded().then(() => {
      const bubble = new Image()
      bubble.src = '/ui/bubble.png'
      const emoji = new Image()
      emoji.src = '/ui/emoji.png'
      const tick = (now: number) => {
        if (!alive) return
        const c = canvas.current
        if (c) {
          const dpr = window.devicePixelRatio || 1
          const W = c.clientWidth
          const H = c.clientHeight
          const s = fitScale(W, H, store.projects.length)
          if (s !== S) setS(s)
          c.width = W * dpr
          c.height = H * dpr
          const g = c.getContext('2d')!
          g.imageSmoothingEnabled = false
          g.setTransform(s * dpr, 0, 0, s * dpr, 0, 0)
          for (let y = 0; y < H / (PX * s) + 1; y++)
            for (let x = 0; x < W / (PX * s) + 1; x++) {
              draw(g, 'grass', x * PX, y * PX)
              const n = Math.abs(Math.sin(x * 12.9 + y * 78.2) * 43758) % 1
              if (n < 0.12) draw(g, `grass_deco_${Math.floor(n * 100) % 12}`, x * PX, y * PX)
            }
          // The trees stand clear of the farms' columns.
          const edge = 2 + Math.min(3, store.projects.length + 1) * 9
          for (const [n, x, y] of [['tree_big', 27, 0], ['tree_apple', 28, 9], ['bush_0', 0, 12], ['tree_small', 26, 12]] as [string, number, number][]) draw(g, n, (x > 20 ? Math.max(x, edge + x - 26) : x) * PX, y * PX)
          const all = minis(store.projects)
          // When a project needs you, only its farmer moves: the rest hold still so the eye goes there.
          const quiet = all.some((m) => m.emote === 'alert')
          for (const m of all) {
            draw(g, `house_${m.p.kind === 'sample' ? 2 : 4}`, m.x * PX, m.y * PX)
            const bx = m.x + 4.4
            const by = m.y + 1.2
            for (let y = 0; y < 4; y++)
              for (let x = 0; x < 5; x++) {
                const r = y === 0 ? 0 : y === 3 ? 2 : 1
                const cc = x === 0 ? 0 : x === 4 ? 2 : 1
                g.globalAlpha = m.stage < 0 ? 0.2 : 1
                draw(g, `bed_wet_${cc}${r}`, (bx - 1 + x) * PX, (by - 1 + y) * PX)
                g.globalAlpha = 1
              }
            if (m.stage >= 0) for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) draw(g, `crop_${m.p.kind === 'sample' ? 'pumpkin' : 'carrot'}_${m.stage}`, (bx + x) * PX, (by + y) * PX - 3)
            const fx = (m.x + 5.8) * PX
            const fy = (m.y + 4.6) * PX
            const still = quiet && m.emote !== 'alert'
            const fr = still ? 0 : Math.floor(now / 125) % 8
            const anim = m.emote === 'notes' && !still ? 'till' : 'idle'
            if (hasFrame(`char_${anim}_down_${fr}`)) draw(g, `char_${anim}_down_${fr}`, fx - 24, fy - 30, { tint: TINT[m.farmer] })
            if (bubble.complete && emoji.complete) {
              const em = { alert: [5, 8], notes: [8, 8], hearts: [0, 9], read: [7, 5] }[m.emote]
              const bob = still ? 0 : Math.round(Math.sin(now / 260))
              g.drawImage(bubble, 0, 0, 31, 32, fx - 8, fy - 52 + bob, 16, 16.5)
              g.drawImage(emoji, em[0] * 32, em[1] * 32, 32, 32, fx - 6.5, fy - 51 + bob, 13, 13)
            }
          }
          // The empty plot for a new farm.
          const ns = { x: 2 + (store.projects.length % 3) * 9, y: 2 + Math.floor(store.projects.length / 3) * 7 }
          draw(g, 'sign_blank', (ns.x + 1) * PX, (ns.y + 1) * PX)
          g.globalAlpha = 0.32
          for (let y = 0; y < 4; y++)
            for (let x = 0; x < 5; x++) draw(g, `bed_dry_${x === 0 ? 0 : x === 4 ? 2 : 1}${y === 0 ? 0 : y === 3 ? 2 : 1}`, (ns.x + 3.4 + x) * PX, (ns.y + 0.2 + y) * PX)
          g.globalAlpha = 1
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [])

  const start = (text: string) => {
    const g = text.trim()
    if (!g) return
    const p = store.newProject(g)
    planInto(p)
  }
  const T = PX * S

  return (
    <>
      <canvas ref={canvas} className="map-layer" style={{ width: '100%', height: '100%' }} aria-hidden />
      <h1 className="homehead">Your projects</h1>
      {list.map((m) => (
        <button key={m.p.id} className="farm-hit" style={{ left: m.x * T, top: m.y * T, width: 9 * T, height: 5.6 * T }} onClick={() => store.open(m.p.id)} aria-label={`${m.p.name}, ${m.words}`}>
          <span className="farm-tag" style={{ left: 4.6 * T, top: 4.85 * T }}>
            {m.p.name}
            <span className={`farm-words${m.emote === 'alert' ? ' alert' : ''}`}>{m.words}</span>
          </span>
        </button>
      ))}
      <button className="farm-hit" style={{ left: newSpot.x * T, top: newSpot.y * T, width: 9 * T, height: 5 * T }} onClick={() => input.current?.focus()} aria-label="New project">
        <span className="farm-tag ghost" style={{ left: 5 * T, top: 4.85 * T }}>
          + New project
        </span>
      </button>
      <section className="dlg">
        <div className="portrait">
          <Portrait farmer="planner" />
        </div>
        <div className="body paper bubble" data-tail="left">
          <div className="who">
            <b>Planner</b>
            {needs > 0 && (
              <span className="aside">
                <Ico name="alert" size={18} />
                {needs} project{needs > 1 ? 's' : ''} need{needs > 1 ? '' : 's'} you
              </span>
            )}
          </div>
          <p>Tell me what to build. I’ll split it into tasks and pick a team of AI agents to do them. They work on their own and come to you when a decision is yours.</p>
          <p className="legend">On the map, each project is a farm, each task is a plot, and each agent is a farmer.</p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              start(goal)
            }}
          >
            <span className="field">
              <input ref={input} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Describe an app or feature, for example a chatbot for a shop’s help pages" aria-label="What should the agents build?" />
            </span>
            <button className="btn" type="submit" disabled={!goal.trim()}>
              <Ico name="sprout" />
              Plan it
            </button>
          </form>
          {/* Starters until you type; a tap fills the box so you can edit it before planning. */}
          <div className={`examples-fold${goal ? ' shut' : ''}`} inert={!!goal || undefined} aria-hidden={!!goal || undefined}>
            <div className="row examples">
              {EXAMPLES.map((x) => (
                <button
                  key={x}
                  type="button"
                  className="btn chip xs"
                  onClick={() => {
                    setGoal(x)
                    const el = input.current
                    if (el) requestAnimationFrame(() => (el.focus(), el.setSelectionRange(x.length, x.length)))
                  }}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
