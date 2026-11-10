// The farm: the project drawn as Sprout Lands pixel art (the concept v3 look).
// Plots are tasks and their crops show progress; farmers are the crew and their pose and emote
// show what they are doing. Everything here is read from RunState, so the map never shows
// work that isn't happening.

import { useEffect, useMemo, useRef, useState } from 'react'
import { draw, hasFrame } from '../map/atlas'
import { atlasLoaded } from '../hud/bits'
import { TINT } from '../run/crew'
import { ProofPop } from '../hud/Proof'
import type { FarmerId, RunState, TaskState } from '../run/types'
import { FARMER_ORDER } from '../run/types'

const PX = 16 // atlas pixels per tile
type Crop = 'wheat' | 'carrot' | 'pumpkin' | 'tulip' | 'cabbage'
export const CROPS: Crop[] = ['wheat', 'carrot', 'tulip', 'pumpkin', 'cabbage']
type Dir = 'down' | 'up' | 'left' | 'right'
type Emote = 'alert' | 'notes' | 'dots' | 'check' | 'x' | 'coin' | 'read' | 'zzz'

export interface Plot {
  id: string
  x: number // top-left of the crops, in tiles
  y: number
  w: number
  h: number
  crop: Crop
  gate: boolean
}

export interface Layout {
  w: number
  h: number
  plots: Plot[]
}

// Plots never move once staked: tasks keep the place they had in the first plan (gated ones last),
// and a task added mid-run takes the next free place.
export function farmLayout(tasks: { id: string; gate: boolean }[], known: string[] = []): Layout {
  const first = [...tasks.filter((t) => !t.gate), ...tasks.filter((t) => t.gate)].map((t) => t.id)
  const ids = [...known.filter((id) => first.includes(id)), ...first.filter((id) => !known.includes(id))]
  const order = ids.map((id) => tasks.find((t) => t.id === id)!)
  const n = order.length
  const cols = n <= 4 ? 2 : 3
  const rows = Math.max(1, Math.ceil(n / cols))
  const plots = order.map((t, i) => ({
    id: t.id,
    x: 12 + (i % cols) * 7,
    y: 3 + Math.floor(i / cols) * 6,
    w: 3,
    h: 2,
    crop: cropOf(tasks, t.id),
    gate: t.gate,
  }))
  return { w: 12 + cols * 7 + 1, h: Math.max(14, 3 + rows * 6 + 1), plots }
}

// Each task's crop, the same on its plot, its sign and anywhere the task is named.
export const cropOf = (tasks: { id: string }[], id: string) => CROPS[Math.max(0, tasks.findIndex((x) => x.id === id)) % CROPS.length]

// Spots in the yard, in tiles (feet position).
const DOOR = { x: 4, y: 6.6 }
const MAILBOX = { x: 6.1, y: 3.8 }
const CHEST = { x: 7.1, y: 4.85 }
// Chickens stand about the yard. Click one and it gives you a heart.
const CHICKENS = [
  { x: 9.6, y: 12.5, flip: false },
  { x: 10.7, y: 12.8, flip: true },
]
const CHORES: { x: number; y: number; anim: string; dir: Dir }[] = [
  { x: 4.6, y: 10.1, anim: 'chop', dir: 'right' },
  { x: 8.6, y: 10.6, anim: 'water', dir: 'down' },
  { x: 3.4, y: 9.4, anim: 'idle', dir: 'right' },
  { x: 9.8, y: 8.2, anim: 'idle', dir: 'left' },
  { x: 6.2, y: 12.2, anim: 'idle', dir: 'up' },
]

export interface FarmViewProps {
  state: RunState
  planning: boolean
  side: boolean // the panel is open on the right
  selected?: { kind: 'task' | 'farmer'; id: string } | null
  openAsk?: { farmer: FarmerId; task?: string; reason: string; touches?: string[] } | null
  onTask(id: string): void
  onFarmer(id: FarmerId): void
  onMail(): void
  onCoins(): void
  onChest(): void
}

interface Cam {
  s: number
  ox: number
  oy: number
}

interface Walker {
  x: number
  y: number
  dir: Dir
}

export function FarmView(p: FarmViewProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [ready, setReady] = useState(false)
  const [cam, setCam] = useState<Cam>({ s: 3, ox: 0, oy: 0 })
  const props = useRef(p)
  props.current = p
  const walkers = useRef(new Map<FarmerId, Walker>())
  const born = useRef(new Map<string, number>())
  const hover = useRef<string | null>(null)
  const hearts = useRef(new Map<number, number>())

  const known = useRef<string[]>([])
  // When each proof pop first showed, in wall-clock time, so it settles after a few seconds even while the run waits on you.
  const popSeen = useRef(new Map<string, number>())
  const [, setPopTick] = useState(0)
  const layout = useMemo(() => {
    // A new plan (nothing in common with the last) starts the order over.
    if (!p.state.tasks.some((t) => known.current.includes(t.id)) || p.planning) known.current = []
    const l = farmLayout(p.state.tasks, known.current)
    known.current = l.plots.map((x) => x.id)
    return l
  }, [p.state.tasks.map((t) => t.id + t.gate).join(), p.planning])

  useEffect(() => {
    atlasLoaded().then(() => setReady(true))
    const imgs = ['bubble', 'emoji', 'dot_1', 'selectorst_a1', 'mailbox', 'mailbox_letter', 'crates']
    for (const k of imgs) loadImg(k)
  }, [])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The camera: a fixed pixel scale (3x on desktop), centred on what matters in the space the HUD
  // leaves free. It leans toward the plot that needs you or the one you opened; drag to look around.
  const camRef = useRef<Cam & { cx: number; cy: number; tx: number; ty: number; manual: boolean }>({ s: 3, ox: 0, oy: 0, cx: 0, cy: 0, tx: 0, ty: 0, manual: false })
  const labels = useRef<HTMLDivElement>(null)
  const narrow = size.w < 900
  const scale = narrow ? 2 : size.h < 760 ? 2.5 : 3
  if (cam.s !== scale) setCam({ s: scale, ox: 0, oy: 0 })
  const focusId = p.openAsk?.task ?? (p.selected?.kind === 'task' ? p.selected.id : undefined)
  useEffect(() => {
    const c = camRef.current
    const pl = layout.plots.find((x) => x.id === focusId)
    // The farm's own centre, from the house to the last plot column.
    const home = { x: Math.min(layout.w / 2, 15.5), y: 7.2 }
    // An ask centres its plot exactly in the free space above the dialogue; an opened plot only leans toward it.
    const asking = !!p.openAsk?.task && pl?.id === p.openAsk.task
    const tgt = !pl ? home : asking ? { x: pl.x + pl.w / 2, y: pl.y + pl.h / 2 } : { x: Math.max(home.x, pl.x + pl.w / 2 - 2), y: Math.max(7, pl.y + pl.h / 2) }
    c.tx = tgt.x
    c.ty = tgt.y
    c.manual = false
    if (!c.cx) {
      c.cx = tgt.x
      c.cy = tgt.y
    }
  }, [focusId, layout, !!p.openAsk])
  const freeRect = () => {
    const w = size.w - (p.side && !narrow ? 470 : 0)
    const top = narrow ? 60 : 80
    // The free space ends where the dialogue starts, measured, so a tall plan or review never covers what it's about.
    const dlg = document.querySelector('.dlg') as HTMLElement | null
    const box = wrap.current?.getBoundingClientRect()
    const bottom = dlg && box ? Math.max(0, box.bottom - dlg.getBoundingClientRect().top) + 8 : narrow ? 250 : 230
    return { cx: w / 2, cy: top + Math.max(0, size.h - top - bottom) / 2 }
  }

  // Every new plot (a task split in two mid-run) stakes itself out over a moment.
  useEffect(() => {
    const now = performance.now()
    for (const pl of layout.plots) if (!born.current.has(pl.id)) born.current.set(pl.id, born.current.size === 0 && layout.plots.length > 1 ? 0 : now)
  }, [layout])

  useEffect(() => {
    if (!ready) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const k = camRef.current
      if (!k.manual) {
        const f = 1 - Math.pow(0.002, dt)
        k.cx += (k.tx - k.cx) * f
        k.cy += (k.ty - k.cy) * f
      }
      const fr = freeRect()
      k.s = cam.s
      k.ox = Math.round(fr.cx - k.cx * PX * k.s)
      k.oy = Math.round(fr.cy - k.cy * PX * k.s)
      if (labels.current) labels.current.style.transform = `translate(${k.ox}px, ${k.oy}px)`
      const c = canvas.current
      if (c) paint(c, props.current, layout, k, walkers.current, born.current, hover.current, now, dt, hearts.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ready, layout, cam, size, p.side])

  const toTile = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    const k = camRef.current
    return { x: (e.clientX - r.left - k.ox) / (PX * k.s), y: (e.clientY - r.top - k.oy) / (PX * k.s) }
  }

  const hit = (t: { x: number; y: number }): string | null => {
    for (const [id, w] of walkers.current) if (Math.abs(t.x - w.x) < 0.6 && t.y > w.y - 1.6 && t.y < w.y + 0.2) return `f:${id}`
    for (const pl of layout.plots) if (t.x > pl.x - 2.2 && t.x < pl.x + pl.w + 1 && t.y > pl.y - 1.2 && t.y < pl.y + pl.h + 1.9) return `t:${pl.id}`
    if (near(t, { x: MAILBOX.x + 0.5, y: MAILBOX.y - 0.6 }, 0.9)) return 'mail'
    if (near(t, { x: CHEST.x + 0.5, y: CHEST.y + 0.3 }, 0.8)) return 'chest'
    for (let i = 0; i < CHICKENS.length; i++) if (near(t, { x: CHICKENS[i].x, y: CHICKENS[i].y - 0.4 }, 0.6)) return `c:${i}`
    return null
  }

  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    const k = camRef.current
    drag.current = { x: e.clientX, y: e.clientY, cx: k.cx, cy: k.cy, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (d && e.buttons) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (d.moved || Math.hypot(dx, dy) > 5) {
        d.moved = true
        const k = camRef.current
        k.manual = true
        k.cx = Math.max(0, Math.min(layout.w, d.cx - dx / (PX * k.s)))
        k.cy = Math.max(0, Math.min(layout.h, d.cy - dy / (PX * k.s)))
        if (wrap.current) wrap.current.style.cursor = 'url(/cursor-paw-hold.png) 8 8, grabbing'
        return
      }
    }
    const h = hit(toTile(e))
    hover.current = h
    if (wrap.current) wrap.current.style.cursor = h ? 'url(/cursor-paw-point.png) 6 2, pointer' : ''
  }
  const onClick = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.moved) return
    const h = hit(toTile(e))
    if (!h) return
    if (h.startsWith('f:')) p.onFarmer(h.slice(2) as FarmerId)
    else if (h.startsWith('t:')) p.onTask(h.slice(2))
    else if (h === 'mail') p.onMail()
    else if (h === 'chest') p.onChest()
    else if (h.startsWith('c:')) hearts.current.set(Number(h.slice(2)), performance.now())
  }

  const T = PX * cam.s
  return (
    <div ref={wrap} className="map-layer" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onClick} onPointerLeave={() => (hover.current = null)} style={{ touchAction: 'none' }}>
      <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-label="The farm" role="img" />
      <div ref={labels} className="plot-labels">
      {!p.planning &&
        layout.plots.map((pl) => {
          // A check that just landed pops up over its plot with what it rests on, then settles into the label.
          // Only the latest one, so two never stack.
          const t = p.state.tasks.find((x) => x.id === pl.id)
          const c = t?.checks[t.checks.length - 1]
          const latest = Math.max(...p.state.tasks.map((x) => x.checks[x.checks.length - 1]?.t ?? -1))
          if (!t || !c || c.t !== latest || p.state.t < c.t) return null
          const key = `${pl.id}-${c.t}`
          const now = performance.now()
          if (!popSeen.current.has(key)) {
            popSeen.current.set(key, now)
            setTimeout(() => setPopTick((n) => n + 1), 7100)
          }
          if (now - popSeen.current.get(key)! > 7000) return null
          return (
            <ProofPop
              key={`${pl.id}-${c.t}`}
              check={c}
              state={p.state}
              style={{ left: (pl.x + pl.w / 2) * T, top: (pl.y - 0.7) * T }}
              onOpen={() => p.onTask(pl.id)}
            />
          )
        })}
      {layout.plots.map((pl) => {
        const t = p.state.tasks.find((x) => x.id === pl.id)
        if (!t) return null
        const sel = p.selected?.kind === 'task' && p.selected.id === pl.id
        return (
          <button
            key={pl.id}
            className={`plot-label${p.planning ? ' ghost' : ''}${sel ? ' sel' : ''}${t.status === 'accepted' ? ' done' : ''}`}
            style={{ left: (pl.x + pl.w / 2) * T, top: (pl.y + pl.h + 1) * T + 2, fontSize: cam.s >= 3 ? 13 : 11 }}
            onClick={(e) => {
              e.stopPropagation()
              p.onTask(pl.id)
            }}
            onPointerUp={(e) => e.stopPropagation()}
          >
            {t.name}
            {p.planning && <span className="plot-when">Done when {t.doneWhen.charAt(0).toLowerCase() + t.doneWhen.slice(1)}</span>}
            {!p.planning && t.status !== 'waiting' && (
              <span className="plot-bar" aria-hidden>
                <i style={{ width: `${Math.round(t.progress * 100)}%`, background: t.status === 'wilted' || (t.gate && p.state.deploy[p.state.deploy.length - 1]?.stage === 'rollback' && t.status !== 'ripe' && t.status !== 'accepted') ? 'var(--berry)' : 'var(--leaf)' }} />
              </span>
            )}
          </button>
        )
      })}
      </div>
    </div>
  )
}

// ---- drawing ---------------------------------------------------------------------

const IMG: Record<string, HTMLImageElement> = {}
function loadImg(k: string) {
  if (IMG[k]) return
  const i = new Image()
  i.src = `/ui/${k}.png`
  IMG[k] = i
}
const ok = (k: string) => IMG[k]?.complete && IMG[k].naturalWidth > 0

const near = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => Math.hypot(a.x - b.x, a.y - b.y) < r

function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function spr(g: CanvasRenderingContext2D, name: string, tx: number, ty: number, o: { tint?: { body: string; shade: string }; alpha?: number; flip?: boolean } = {}) {
  if (!hasFrame(name)) return
  g.globalAlpha = o.alpha ?? 1
  draw(g, name, Math.round(tx * PX), Math.round(ty * PX), { tint: o.tint, flip: o.flip })
  g.globalAlpha = 1
}

function bed(g: CanvasRenderingContext2D, pl: Plot, wet: boolean) {
  const x0 = pl.x - 1
  const y0 = pl.y - 1
  const w = pl.w + 2
  const h = pl.h + 2
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = y === 0 ? 0 : y === h - 1 ? 2 : 1
      const c = x === 0 ? 0 : x === w - 1 ? 2 : 1
      spr(g, `bed_${wet ? 'wet' : 'dry'}_${c}${r}`, x0 + x, y0 + y)
    }
}

function staked(g: CanvasRenderingContext2D, pl: Plot, alpha = 1) {
  // A ghost of the bed: marked out, not dug yet.
  g.save()
  g.globalAlpha = 0.32 * alpha
  bed(g, pl, false)
  g.restore()
}

// stage per tile: -1 nothing, 0..3 growth; wilt marks tiles drawn dried out.
function crops(g: CanvasRenderingContext2D, pl: Plot, stageAt: (i: number) => number, wiltAt: (i: number) => boolean) {
  let i = 0
  for (let y = 0; y < pl.h; y++)
    for (let x = 0; x < pl.w; x++, i++) {
      const st = stageAt(i)
      if (st < 0) continue
      if (wiltAt(i)) {
        g.save()
        g.filter = 'grayscale(0.7) sepia(0.6) brightness(0.85)'
        spr(g, `crop_${pl.crop}_${Math.max(1, st)}`, pl.x + x, pl.y + y + 0.15)
        g.restore()
      } else spr(g, `crop_${pl.crop}_${st}`, pl.x + x, pl.y + y - 3 / 16)
    }
}

function emote(g: CanvasRenderingContext2D, fx: number, fy: number, what: Emote, now: number) {
  if (!ok('bubble') || !ok('emoji')) return
  const bob = Math.round(Math.sin(now / 260) * 1)
  const bx = fx * PX - 8
  const by = fy * PX - 30 - 22 + bob
  g.drawImage(IMG.bubble, 0, 0, 31, 32, bx, by, 16, 16.5)
  if (what === 'dots') {
    if (!ok('dot_1')) return
    for (let i = 0; i < 3; i++) {
      const up = Math.floor(now / 300) % 3 === i ? -1 : 0
      g.drawImage(IMG.dot_1, 5, 4, 6, 7, bx + 3 + i * 3.5, by + 6 + up, 2.5, 3)
    }
    return
  }
  const m: Record<Exclude<Emote, 'dots'>, [number, number]> = { alert: [5, 8], notes: [8, 8], zzz: [9, 8], check: [0, 8], x: [3, 8], coin: [6, 10], read: [7, 5] }
  const [c, r] = m[what]
  // The cross fills its whole cell, so it's drawn a little smaller to clear the bubble's lower edge.
  const sz = what === 'x' ? 11 : 13
  g.drawImage(IMG.emoji, c * 32, r * 32, 32, 32, bx + 1.5 + (13 - sz) / 2, by + 1 + (13 - sz) / 2 - (what === 'x' ? 0.5 : 0), sz, sz)
}

// A heart rises from a chicken you clicked and fades.
function heart(g: CanvasRenderingContext2D, x: number, y: number, age: number) {
  if (!ok('emoji')) return
  const k = age / 1400
  g.save()
  g.globalAlpha = 1 - k * k
  g.drawImage(IMG.emoji, 2 * 32, 9 * 32, 32, 32, x * PX - 6, y * PX - 26 - k * 14, 12, 12)
  g.restore()
}

function selector(g: CanvasRenderingContext2D, pl: Plot, now: number) {
  if (!ok('selectorst_a1')) return
  const pad = 3 + (Math.floor(now / 400) % 2)
  const x0 = (pl.x - 1) * PX - pad
  const y0 = (pl.y - 1) * PX - pad
  const x1 = (pl.x + pl.w + 1) * PX + pad
  const y1 = (pl.y + pl.h + 1) * PX + pad
  for (const [x, y, sx, sy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ]) {
    g.save()
    g.translate(x, y)
    g.scale(sx, sy)
    g.drawImage(IMG.selectorst_a1, 4, 4, 8, 9, 0, 0, 8, 9)
    g.restore()
  }
}

function charAt(g: CanvasRenderingContext2D, fx: number, fy: number, anim: string, dir: Dir, now: number, seed: number, o: { tint?: { body: string; shade: string }; alpha?: number }) {
  const f = Math.floor(now / 125 + seed * 3) % 8
  spr(g, `char_${anim}_${dir}_${f}`, fx - 1.5, fy - 30 / 16 - 0.1, o)
}

// Where each farmer is and what it is doing, from the run state.
function poseOf(id: FarmerId, s: RunState, layout: Layout, planning: boolean, openAsk: FarmViewProps['openAsk'], idx: number) {
  const f = s.farmers[id]!
  const plotOf = (task?: string) => layout.plots.find((x) => x.id === task)
  const side = (pl: Plot) => ({ x: pl.x + pl.w + 1.4, y: pl.y + 2.3 })
  if (planning) {
    const first = plotOf(s.tasks.find((t) => t.farmer === id)?.id)
    const at = first ? side(first) : id === 'planner' ? DOOR : CHORES[idx % CHORES.length]
    return { ...at, anim: 'idle', dir: 'left' as Dir, emote: id === 'planner' ? ('read' as Emote) : undefined, alpha: id === 'planner' ? 1 : 0.75 }
  }
  if (openAsk && openAsk.farmer === id) {
    const pl = plotOf(openAsk.task)
    const at = pl ? side(pl) : DOOR
    return { ...at, anim: 'idle', dir: 'left' as Dir, emote: (openAsk.reason === 'cost' ? 'coin' : 'alert') as Emote }
  }
  if (f.state === 'done' || (f.state === 'idle' && !s.tasks.some((t) => t.farmer === id && (t.status === 'waiting' || t.status === 'growing')))) {
    if (id === 'planner') return { ...DOOR, anim: 'idle', dir: 'down' as Dir }
    const c = CHORES[idx % CHORES.length]
    return { x: c.x, y: c.y, anim: c.anim, dir: c.dir }
  }
  const task = s.tasks.find((t) => t.id === f.task)
  const pl = plotOf(f.task)
  if (pl && task && (task.status === 'growing') && f.state === 'working') {
    const sway = (Math.sin(performance.now() / 2600 + idx) + 1) / 2
    return { x: pl.x + 0.5 + sway * (pl.w - 1), y: pl.y + 1.7, anim: id === 'designer' ? 'water' : 'till', dir: 'down' as Dir, emote: 'notes' as Emote }
  }
  if (pl && task && (task.status === 'wilted' || task.status === 'checking')) return { ...side(pl), anim: 'idle', dir: 'left' as Dir }
  // Waiting for its next task: stand by that plot and glance around.
  const next = plotOf(s.tasks.find((t) => t.farmer === id && t.status === 'waiting')?.id)
  // Waiting on someone else's work: a chore in the yard until its plot frees up.
  if (next) {
    const c = CHORES[idx % CHORES.length]
    return { x: c.x, y: c.y, anim: c.anim, dir: c.dir }
  }
  if (id === 'planner') return { ...DOOR, anim: 'idle', dir: 'down' as Dir }
  const c = CHORES[idx % CHORES.length]
  return { x: c.x, y: c.y, anim: c.anim, dir: c.dir }
}

function paint(c: HTMLCanvasElement, p: FarmViewProps, layout: Layout, cam: Cam, walkers: Map<FarmerId, Walker>, born: Map<string, number>, hover: string | null, now: number, dt: number, hearts: Map<number, number>) {
  const dpr = window.devicePixelRatio || 1
  const W = c.clientWidth
  const H = c.clientHeight
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
  }
  const g = c.getContext('2d')!
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.imageSmoothingEnabled = false
  g.fillStyle = '#8fc77a'
  g.fillRect(0, 0, c.width, c.height)
  const k = cam.s * dpr
  g.setTransform(k, 0, 0, k, cam.ox * dpr, cam.oy * dpr)

  // Grass to the screen edges, with a little scatter.
  const tx0 = Math.floor(-cam.ox / (PX * cam.s)) - 1
  const ty0 = Math.floor(-cam.oy / (PX * cam.s)) - 1
  const tx1 = Math.ceil((W - cam.ox) / (PX * cam.s)) + 1
  const ty1 = Math.ceil((H - cam.oy) / (PX * cam.s)) + 1
  for (let y = ty0; y < ty1; y++)
    for (let x = tx0; x < tx1; x++) {
      spr(g, 'grass', x, y)
      const n = rand(x * 73 + y * 151)
      if (n < 0.12) spr(g, `grass_deco_${Math.floor(n * 100) % 12}`, x, y)
    }

  const s = p.state
  const W_ = layout.w
  // Scenery around the yard and the edge.
  for (const [n, x, y] of [
    ['tree_big', 0, 0],
    ['tree', 8.5, -0.6],
    ['bush_0', 10, 0.2],
    ['tree_orange', 0, 10.5],
    ['tree_apple', W_ - 1, 0],
    ['tree_small', W_ - 0.5, 6],
    ['tree_pear', W_ - 1, layout.h - 2.5],
  ] as [string, number, number][])
    spr(g, n, x, y)
  for (const [n, x, y] of [
    ['flower_2', 7.4, 11],
    ['flower_5', 8.4, 11.3],
    ['sunflower', 9.6, 10.2],
    ['flower_8', 10.3, 11.6],
  ] as [string, number, number][])
    spr(g, n, x, y)
  spr(g, 'house_2', 2, 2)
  spr(g, 'well', 2, 8)
  spr(g, 'workstation', 5, 9.4)
  // Chickens stand still and peck now and then; a clicked one floats a heart.
  CHICKENS.forEach((c, i) => {
    const pecking = Math.floor(now / 500 + i * 3) % 7 === 0
    spr(g, `chicken_${pecking ? 1 : 0}`, c.x, c.y, { flip: c.flip })
    const at = hearts.get(i)
    if (at !== undefined && now - at < 1400) heart(g, c.x, c.y, now - at)
  })

  // Mailbox: a letter when a farmer has a question for you.
  const letter = !!p.openAsk
  const mail = letter ? 'mailbox_letter' : 'mailbox'
  if (ok(mail)) g.drawImage(IMG[mail], MAILBOX.x * PX, (MAILBOX.y - (letter ? 2.05 : 1.8)) * PX)
  // The shipping chest is the pull request: shut until the first commit goes in.
  const committed = s.tasks.some((t) => t.status === 'accepted' && !t.gate)
  spr(g, committed ? 'chest_open' : 'chest', CHEST.x, CHEST.y)
  // Crates stack up by the chest as tasks come in.
  if (ok('crates')) {
    const n = Math.min(3, s.tasks.filter((t) => t.status === 'accepted').length)
    const spots = [[CHEST.x + 0.95, CHEST.y - 0.55], [CHEST.x + 1.9, CHEST.y - 0.55], [CHEST.x + 1.45, CHEST.y - 1.45]]
    for (let i = 0; i < n; i++) g.drawImage(IMG.crates, 20, 3, 24, 26, spots[i][0] * PX, spots[i][1] * PX, 24, 26)
  }
  // Plots.
  const lastDeploy = s.deploy[s.deploy.length - 1]
  for (const pl of layout.plots) {
    const t = s.tasks.find((x) => x.id === pl.id)
    if (!t) continue
    const age = born.get(pl.id) ?? 0
    const fade = age === 0 ? 1 : Math.min(1, (now - age) / 900)
    spr(g, `sign_${pl.crop}`, pl.x - 2, pl.y - 1, { alpha: fade })
    if (p.planning || t.status === 'waiting') {
      staked(g, pl, fade)
      continue
    }
    const st = stage(t)
    if (pl.gate && lastDeploy) {
      // The rollout on the field: a tenth ripe at 10%, wilted on rollback, all ripe at 100%.
      const back = lastDeploy.stage === 'rollback'
      bed(g, pl, !back)
      crops(
        g,
        pl,
        (i) => (lastDeploy.stage === '100%' || t.status === 'ripe' || t.status === 'accepted' ? 3 : i === 0 ? 3 : 1),
        (i) => back && i === 0,
      )
      if (!back && ok('crates')) g.drawImage(IMG.crates, 20, 3, 24, 26, (pl.x + pl.w + 1.1) * PX, (pl.y - 0.9) * PX, 16, 17)
    } else if (t.status === 'accepted' && lastDeploy) {
      // Merged: harvested into the chest, the soil left bare. Until then a committed task stands ripe.
      bed(g, pl, true)
    } else {
      bed(g, pl, t.status !== 'wilted')
      crops(g, pl, (i) => (st < 0 ? -1 : t.status === 'growing' && st < 2 && (i * 7) % 3 === 0 ? Math.max(0, st - 1) : st), () => t.status === 'wilted')
    }
    // One emote per plot when no farmer speaks for it.
    const rolledBack = pl.gate && lastDeploy?.stage === 'rollback' && t.status !== 'ripe' && t.status !== 'accepted'
    const plotEmote: Emote | null = t.status === 'wilted' || rolledBack ? 'x' : t.status === 'ripe' || (t.status === 'accepted' && !lastDeploy) ? 'check' : t.status === 'checking' ? 'read' : null
    if (plotEmote) emote(g, pl.x + pl.w / 2, pl.y + 1.3, plotEmote, now)
  }
  // A big change: every plot whose code it reaches glows with it, in time with its own plot.
  if (p.openAsk?.touches?.length) {
    const glow = 0.18 + 0.12 * Math.sin(now / 300)
    for (const id of [p.openAsk.task, ...p.openAsk.touches]) {
      const to = layout.plots.find((x) => x.id === id)
      if (!to) continue
      g.save()
      g.globalAlpha = glow
      g.fillStyle = '#ffd36b'
      g.fillRect((to.x - 1) * PX + 3, (to.y - 1) * PX + 3, (to.w + 2) * PX - 6, (to.h + 2) * PX - 6)
      g.restore()
      selector(g, to, now)
    }
  }
  const sel = p.selected?.kind === 'task' ? layout.plots.find((x) => x.id === p.selected!.id) : undefined
  const hov = hover?.startsWith('t:') ? layout.plots.find((x) => x.id === hover.slice(2)) : undefined
  if (sel) selector(g, sel, now)
  else if (hov) selector(g, hov, 0)

  // Farmers, walking to where their state puts them, drawn back to front.
  const ids = FARMER_ORDER.filter((id) => s.farmers[id])
  const drawList: { y: number; fn: () => void }[] = []
  ids.forEach((id, idx) => {
    const pose = poseOf(id, s, layout, p.planning, p.openAsk, idx)
    let w = walkers.get(id)
    if (!w) {
      w = { x: pose.x, y: pose.y, dir: pose.dir }
      walkers.set(id, w)
    }
    const dx = pose.x - w.x
    const dy = pose.y - w.y
    const d = Math.hypot(dx, dy)
    const step = 4.5 * dt
    let anim = pose.anim
    let dir = pose.dir
    if (d > 0.05) {
      if (d <= step) {
        w.x = pose.x
        w.y = pose.y
      } else {
        // Walk the longer leg first, so farmers move along rows and columns, not diagonals.
        if (Math.abs(dx) > 0.05 && (Math.abs(dx) >= Math.abs(dy) || Math.abs(dy) < 0.05)) w.x += Math.sign(dx) * Math.min(step, Math.abs(dx))
        else w.y += Math.sign(dy) * Math.min(step, Math.abs(dy))
        anim = 'walk'
        dir = Math.abs(pose.x - w.x) > 0.05 && Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
      }
    }
    const fx = w.x
    const fy = w.y
    const selected = p.selected?.kind === 'farmer' && p.selected.id === id
    drawList.push({
      y: fy,
      fn: () => {
        if (selected || hover === `f:${id}`) {
          g.fillStyle = selected ? 'rgba(255,246,228,.75)' : 'rgba(255,246,228,.45)'
          g.beginPath()
          g.ellipse(fx * PX, fy * PX - 1, 8, 3.5, 0, 0, Math.PI * 2)
          g.fill()
        }
        charAt(g, fx, fy, anim, dir, now, idx, { tint: TINT[id], alpha: 'alpha' in pose ? pose.alpha : 1 })
        if ('emote' in pose && pose.emote && anim !== 'walk') emote(g, fx, fy, pose.emote, now)
      },
    })
  })
  drawList.sort((a, b) => a.y - b.y).forEach((d) => d.fn())
}

function stage(t: TaskState) {
  if (t.status === 'ripe' || t.status === 'accepted') return 3
  if (t.status === 'waiting' || t.progress <= 0) return 0
  return Math.min(2, Math.floor(Math.min(0.999, t.progress) * 3))
}
