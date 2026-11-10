// The farm: the project drawn as Sprout Lands pixel art (the concept v3 look).
// Plots are tasks and their crops show progress; farmers are the crew and their pose and emote
// show what they are doing. Everything here is read from RunState, so the map never shows
// work that isn't happening.

import { useEffect, useMemo, useRef, useState } from 'react'
import { draw, hasFrame } from '../map/atlas'
import { atlasLoaded } from '../hud/bits'
import { TINT } from '../run/crew'
import type { FarmerId, RunState, TaskState } from '../run/types'
import { FARMER_ORDER } from '../run/types'

const PX = 16 // atlas pixels per tile
type Crop = 'wheat' | 'carrot' | 'pumpkin' | 'tulip' | 'cabbage'
const CROPS: Crop[] = ['wheat', 'carrot', 'tulip', 'pumpkin', 'cabbage']
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
    crop: CROPS[tasks.findIndex((x) => x.id === t.id) % CROPS.length],
    gate: t.gate,
  }))
  return { w: 12 + cols * 7 + 1, h: Math.max(14, 3 + rows * 6), plots }
}

// Spots in the yard, in tiles (feet position).
const DOOR = { x: 4, y: 6.6 }
const MAILBOX = { x: 6.1, y: 3.8 }
const CHEST = { x: 7.1, y: 4.85 }
const COINS = { x: 7.4, y: 6.6 }
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

  const known = useRef<string[]>([])
  const layout = useMemo(() => {
    // A new plan (nothing in common with the last) starts the order over.
    if (!p.state.tasks.some((t) => known.current.includes(t.id)) || p.planning) known.current = []
    const l = farmLayout(p.state.tasks, known.current)
    known.current = l.plots.map((x) => x.id)
    return l
  }, [p.state.tasks.map((t) => t.id + t.gate).join(), p.planning])

  useEffect(() => {
    atlasLoaded().then(() => setReady(true))
    const imgs = ['bubble', 'emoji', 'dot_1', 'selectorst_a1', 'mailbox', 'mailbox_letter', 'coin', 'crates']
    for (const k of imgs) loadImg(k)
  }, [])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit the farm into the space the HUD leaves free.
  useEffect(() => {
    const narrow = size.w < 900
    const free = { x: 0, y: narrow ? 60 : 80, w: size.w - (p.side && !narrow ? 470 : 0), h: size.h - (narrow ? 60 + 230 : 80 + 280) }
    const fit = Math.min(free.w / (layout.w * PX), free.h / (layout.h * PX))
    const s = fit >= 2 ? Math.min(4, Math.floor(fit * 2) / 2) : Math.max(1, fit)
    const ww = layout.w * PX * s
    const hh = layout.h * PX * s
    setCam({ s, ox: Math.round(free.x + (free.w - ww) / 2), oy: Math.round(free.y + (free.h - hh) / 2) })
  }, [size.w, size.h, p.side, layout.w, layout.h])

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
      const c = canvas.current
      if (c) paint(c, props.current, layout, cam, walkers.current, born.current, hover.current, now, dt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ready, layout, cam])

  const toTile = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - cam.ox) / (PX * cam.s), y: (e.clientY - r.top - cam.oy) / (PX * cam.s) }
  }

  const hit = (t: { x: number; y: number }): string | null => {
    for (const [id, w] of walkers.current) if (Math.abs(t.x - w.x) < 0.6 && t.y > w.y - 1.6 && t.y < w.y + 0.2) return `f:${id}`
    for (const pl of layout.plots) if (t.x > pl.x - 2.2 && t.x < pl.x + pl.w + 1 && t.y > pl.y - 1.2 && t.y < pl.y + pl.h + 1.9) return `t:${pl.id}`
    if (near(t, { x: MAILBOX.x + 0.5, y: MAILBOX.y - 0.6 }, 0.9)) return 'mail'
    if (near(t, { x: CHEST.x + 0.5, y: CHEST.y + 0.3 }, 0.8)) return 'chest'
    if (near(t, COINS, 1)) return 'coins'
    return null
  }

  const onMove = (e: React.PointerEvent) => {
    const h = hit(toTile(e))
    hover.current = h
    if (wrap.current) wrap.current.style.cursor = h ? 'url(/cursor-paw-point.png) 6 2, pointer' : ''
  }
  const onClick = (e: React.PointerEvent) => {
    const h = hit(toTile(e))
    if (!h) return
    if (h.startsWith('f:')) p.onFarmer(h.slice(2) as FarmerId)
    else if (h.startsWith('t:')) p.onTask(h.slice(2))
    else if (h === 'mail') p.onMail()
    else if (h === 'chest') p.onChest()
    else if (h === 'coins') p.onCoins()
  }

  const T = PX * cam.s
  return (
    <div ref={wrap} className="map-layer" onPointerMove={onMove} onPointerUp={onClick} onPointerLeave={() => (hover.current = null)}>
      <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-label="The farm" role="img" />
      {layout.plots.map((pl) => {
        const t = p.state.tasks.find((x) => x.id === pl.id)
        if (!t) return null
        const sel = p.selected?.kind === 'task' && p.selected.id === pl.id
        if (cam.s < 1.4 && !sel) return null
        return (
          <button
            key={pl.id}
            className={`plot-label${p.planning ? ' ghost' : ''}${sel ? ' sel' : ''}`}
            style={{ left: cam.ox + (pl.x + pl.w / 2) * T, top: cam.oy + (pl.y + pl.h + 1) * T + 2, fontSize: cam.s >= 3 ? 13 : 11 }}
            onClick={(e) => {
              e.stopPropagation()
              p.onTask(pl.id)
            }}
            onPointerUp={(e) => e.stopPropagation()}
          >
            {t.name}
            {!p.planning && t.status !== 'waiting' && (
              <span className="plot-bar" aria-hidden>
                <i style={{ width: `${Math.round(t.progress * 100)}%`, background: t.status === 'wilted' || (t.gate && p.state.deploy[p.state.deploy.length - 1]?.stage === 'rollback' && t.status !== 'ripe') ? 'var(--berry)' : 'var(--leaf)' }} />
              </span>
            )}
          </button>
        )
      })}
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
  g.save()
  g.globalAlpha = 0.14 * alpha
  bed(g, pl, false)
  g.restore()
  g.save()
  g.globalAlpha = alpha
  g.strokeStyle = 'rgba(120,80,50,.6)'
  g.lineWidth = 1
  g.setLineDash([3, 3])
  g.strokeRect((pl.x - 1) * PX + 2.5, (pl.y - 1) * PX + 2.5, (pl.w + 2) * PX - 5, (pl.h + 2) * PX - 5)
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
  g.drawImage(IMG.emoji, c * 32, r * 32, 32, 32, bx + 1.5, by + 1, 13, 13)
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
  if (next) return { x: next.x + next.w + 1.4, y: next.y + 0.9, anim: 'idle', dir: (Math.floor(performance.now() / 3000 + idx) % 2 ? 'left' : 'right') as Dir, emote: 'dots' as Emote }
  if (id === 'planner') return { ...DOOR, anim: 'idle', dir: 'down' as Dir }
  const c = CHORES[idx % CHORES.length]
  return { x: c.x, y: c.y, anim: c.anim, dir: c.dir }
}

function paint(c: HTMLCanvasElement, p: FarmViewProps, layout: Layout, cam: Cam, walkers: Map<FarmerId, Walker>, born: Map<string, number>, hover: string | null, now: number, dt: number) {
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
  spr(g, 'chicken_0', 9.2, 12.4)
  spr(g, 'chicken_1', 10.4, 12.7, { flip: true })

  // Mailbox: a letter when something needs you.
  const mail = p.openAsk ? 'mailbox_letter' : 'mailbox'
  if (ok(mail)) g.drawImage(IMG[mail], MAILBOX.x * PX, (MAILBOX.y - (p.openAsk ? 2.05 : 1.8)) * PX)
  // The shipping chest, open once something is ready to review.
  const anyRipe = s.tasks.some((t) => t.status === 'ripe' || t.status === 'accepted')
  spr(g, anyRipe ? 'chest_open' : 'chest', CHEST.x, CHEST.y)
  // The coin pile grows with the spend: a coin per 25 cents, up to 14.
  if (ok('coin')) {
    const n = Math.min(14, Math.round(s.usage.usd * 4))
    for (let i = 0; i < n; i++) {
      const col = i % 4
      const row = Math.floor(i / 4)
      g.drawImage(IMG.coin, 0, 0, 22, 22, (COINS.x - 1 + col * 0.42 + row * 0.2) * PX, (COINS.y - 0.4 - row * 0.32) * PX, 9, 9)
    }
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
        (i) => (lastDeploy.stage === '100%' || t.status === 'ripe' ? 3 : i === 0 ? 3 : 1),
        (i) => back && i === 0,
      )
      if (!back && ok('crates')) g.drawImage(IMG.crates, 20, 3, 24, 26, (pl.x + pl.w + 1.1) * PX, (pl.y - 0.9) * PX, 16, 17)
    } else {
      bed(g, pl, t.status !== 'wilted')
      crops(g, pl, (i) => (st < 0 ? -1 : t.status === 'growing' && st < 2 && (i * 7) % 3 === 0 ? Math.max(0, st - 1) : st), () => t.status === 'wilted')
    }
    // One emote per plot when no farmer speaks for it.
    const rolledBack = pl.gate && lastDeploy?.stage === 'rollback' && t.status !== 'ripe'
    const plotEmote: Emote | null = t.status === 'wilted' || rolledBack ? 'x' : t.status === 'ripe' || t.status === 'accepted' ? 'check' : t.status === 'checking' ? 'read' : null
    if (plotEmote) emote(g, pl.x + pl.w / 2, pl.y + 1.3, plotEmote, now)
  }
  // A big change: dashed lines from its plot to every plot whose code it reaches.
  if (p.openAsk?.touches?.length) {
    const from = layout.plots.find((x) => x.id === p.openAsk!.task)
    if (from) {
      g.save()
      g.strokeStyle = 'rgba(91,58,38,.75)'
      g.lineWidth = 1.5
      g.setLineDash([4, 3])
      g.lineDashOffset = -now / 60
      for (const id of p.openAsk.touches) {
        const to = layout.plots.find((x) => x.id === id)
        if (!to) continue
        g.beginPath()
        g.moveTo((from.x + from.w / 2) * PX, (from.y + from.h / 2) * PX)
        g.lineTo((to.x + to.w / 2) * PX, (to.y + to.h / 2) * PX)
        g.stroke()
        selector(g, to, 0)
      }
      g.restore()
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
