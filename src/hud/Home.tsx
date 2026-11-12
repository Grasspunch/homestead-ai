// Your projects: every project drawn as a little farm, and the Planner asking what to build next.
import { useEffect, useRef, useState } from 'react'
import { planInto } from '../run/planning'
import { EXAMPLE_GOALS } from '../run/recorded'
import { draw, hasFrame } from '../map/atlas'
import { TINT } from '../run/crew'
import { pendingAsk, reduce } from '../run/reduce'
import { liveStage } from '../run/rollback'
import { store, useStore, type Project } from '../run/store'
import type { FarmerId, RunState } from '../run/types'
import { ASK_WHY, Ico, Portrait, atlasLoaded } from './bits'
import { CELL, PX, fitLayout, type Layout } from './homeLayout'
import { spentOf } from '../run/team'
import { budgetStopOf } from '../run/done'


interface Mini {
  p: Project
  x: number
  y: number
  stage: number
  emote: 'alert' | 'notes' | 'hearts' | 'read'
  farmer: FarmerId
  words: string
  spent: number
  budget: number
}

function minis(projects: Project[], cols: number): Mini[] {
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
      x: (i % cols) * CELL.w,
      y: Math.floor(i / cols) * CELL.h,
      stage: !p.approved ? -1 : s.done ? 3 : Math.min(2, Math.floor(prog * 3)),
      emote: !p.approved || unwatched ? 'read' : waiting ? 'alert' : s.done ? 'hearts' : 'notes',
      farmer: ask?.farmer ?? busy?.id ?? 'builder',
      spent: p.approved && !unwatched ? s.usage.usd : 0,
      budget: store.budgetOf(p),
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
  if (budgetStopOf(s)) return liveStage(p.events, t) ? 'Stopped at its budget, partly live' : 'Stopped at its budget'
  if (liveStage(p.events, t)) return s.tasks.some((k) => k.stopped) ? 'Partly shipped and live' : 'Done and live'
  return s.deploy.some((d) => d.stage === 'rollback') ? 'Rolled back, nothing live' : 'Done, not shipped'
}

export function Home() {
  const st = useStore()
  const [goal, setGoal] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const side = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [L, setL] = useState<Layout>({ s: 3, cols: 3, x: 0, y: 0 })
  const list = minis(st.projects, L.cols)
  // The one project worth a look for money: over its budget, or within a tenth of it.
  const tight = [...list].filter((m) => m.spent >= m.budget * 0.9).sort((a, b) => b.spent / b.budget - a.spent / a.budget)[0]
  const tightLine = tight
    ? tight.spent > tight.budget + 0.005
      ? `${tight.p.name} is ${spentOf(tight.spent, tight.budget).over} over its ${spentOf(tight.spent, tight.budget).limit} budget this run.`
      : `${tight.p.name} has spent ${spentOf(tight.spent, tight.budget).spent} of its ${spentOf(tight.spent, tight.budget).limit} budget this run.`
    : null

  useEffect(() => {
    let raf = 0
    let alive = true
    let was = ''
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
          // The farms take the room right of the Planner, centred in it.
          const left = (side.current?.getBoundingClientRect().right ?? 0) + 24
          const farms = store.projects
          const pad = Math.max(24, (W - 1680) / 2) // as --home-pad
          const lay = fitLayout({ x: left, y: 24, w: W - left - pad, h: H - 48 }, farms.length)
          const k = JSON.stringify(lay)
          if (k !== was) {
            was = k
            setL(lay)
          }
          const s = lay.s
          const ox = lay.x / s
          const oy = lay.y / s
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
          {
            const slots = farms.length + 1
            const right = Math.min(lay.cols, slots) * CELL.w
            const rows = Math.ceil(slots / lay.cols)
            // Trees stand just outside the farms, to the right.
            for (const [n, x, y] of [['tree_big', right + 0.4, -1.2], ['tree_apple', right + 1.2, rows * CELL.h - 4.5], ['tree_small', right - 0.2, rows * CELL.h - 1.5]] as [string, number, number][])
              draw(g, n, ox + x * PX, oy + y * PX)
            const all = minis(farms, lay.cols)
            // When a project needs you, only its farmer moves: the rest hold still so the eye goes there.
            const quiet = all.some((m) => m.emote === 'alert')
            for (const m of all) {
              const mx = ox + m.x * PX
              const my = oy + m.y * PX
              draw(g, `house_${m.p.kind === 'sample' ? 2 : 4}`, mx, my)
              const bx = mx + 4.4 * PX
              const by = my + 1.2 * PX
              for (let y = 0; y < 4; y++)
                for (let x = 0; x < 5; x++) {
                  const r = y === 0 ? 0 : y === 3 ? 2 : 1
                  const cc = x === 0 ? 0 : x === 4 ? 2 : 1
                  g.globalAlpha = m.stage < 0 ? 0.2 : 1
                  draw(g, `bed_wet_${cc}${r}`, bx + (x - 1) * PX, by + (y - 1) * PX)
                  g.globalAlpha = 1
                }
              if (m.stage >= 0) for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) draw(g, `crop_${m.p.kind === 'sample' ? 'pumpkin' : 'carrot'}_${m.stage}`, bx + x * PX, by + y * PX - 3)
              const fx = mx + 5.8 * PX
              const fy = my + 4.6 * PX
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
            const ns = { x: ox + (farms.length % lay.cols) * CELL.w * PX, y: oy + Math.floor(farms.length / lay.cols) * CELL.h * PX }
            draw(g, 'sign_blank', ns.x + PX, ns.y + PX)
            g.globalAlpha = 0.32
            for (let y = 0; y < 4; y++)
              for (let x = 0; x < 5; x++) draw(g, `bed_dry_${x === 0 ? 0 : x === 4 ? 2 : 1}${y === 0 ? 0 : y === 3 ? 2 : 1}`, ns.x + (3.4 + x) * PX, ns.y + (0.2 + y) * PX)
            g.globalAlpha = 1
          }
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
  const T = PX * L.s
  const at = (m: { x: number; y: number }) => ({ left: L.x + m.x * T, top: L.y + m.y * T })
  const newSpot = { x: (list.length % L.cols) * CELL.w, y: Math.floor(list.length / L.cols) * CELL.h }

  return (
    <>
      <canvas ref={canvas} className="map-layer" style={{ width: '100%', height: '100%' }} aria-hidden />
      <div className="home-side" ref={side}>
        <header className="home-intro paper">
          <div className="home-title">
            <h1 className="homehead">Your projects</h1>
          </div>
          <p className="home-who">For builders: hand a product to AI agents and stay in charge of cost and risk.</p>
        </header>
        <section className="dlg home">
          <div className="portrait">
            <Portrait farmer="planner" size={72} />
          </div>
          <div className="body paper bubble" data-tail="left">
            <div className="who">
              <b>Planner</b>
            </div>
            {tightLine && (
              <p className="impact budget-line">
                <button className="tag-btn" onClick={() => tight && (store.open(tight.p.id), store.setDrawer({ kind: 'usage' }))}>
                  {tightLine}
                </button>
              </p>
            )}
            <p>Tell me what to build. I’ll plan the tasks and pick the agents.</p>
            <p className="legend">Each farm is a project, each plot a task, each farmer an agent.</p>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                start(goal)
              }}
            >
              <span className="field">
                <input ref={input} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Describe an app or feature" aria-label="What should the agents build?" />
              </span>
              <button className="btn" type="submit" disabled={!goal.trim()}>
                <Ico name="sprout" />
                Plan it
              </button>
            </form>
            {/* Starters until you type; a tap fills the box so you can edit it before planning. */}
            <div className={`examples-fold${goal ? ' shut' : ''}`} inert={!!goal || undefined} aria-hidden={!!goal || undefined}>
              <div className="row examples">
                {EXAMPLE_GOALS.map((x) => (
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
      </div>
      <>
          {list.map((m) => (
            <button key={m.p.id} className="farm-hit" style={{ ...at(m), width: 9 * T, height: 5.6 * T }} onClick={() => store.open(m.p.id)} aria-label={`${m.p.name}, ${m.words}`}>
              <span className="farm-tag" style={{ left: 4.6 * T, top: 4.85 * T }}>
                {m.p.name}
                <span className={`farm-words${m.emote === 'alert' ? ' alert' : ''}`}>{m.words}</span>
                {m.spent > 0 && (
                  <span className={`farm-words${m.spent > m.budget + 0.005 ? ' alert' : ''}`}>
                    {spentOf(m.spent, m.budget).spent} of {spentOf(m.spent, m.budget).limit} this run
                  </span>
                )}
              </span>
            </button>
          ))}
          <button className="farm-hit" style={{ ...at(newSpot), width: 9 * T, height: 5 * T }} onClick={() => input.current?.focus()} aria-label="New project">
            <span className="farm-tag ghost" style={{ left: 5.9 * T, top: 4.85 * T }}>
              {list.length ? '+ New project' : '+ Your first project'}
              {!list.length && <span className="farm-words">Tell the Planner what to build</span>}
            </span>
          </button>
      </>
    </>
  )
}

