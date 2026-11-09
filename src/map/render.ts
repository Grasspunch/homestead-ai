// Draws the valley. The map shows state at a glance; every decision lives in the quest log.
import { draw, frame as frameSize, hasFrame, animCounts, pixelSprite } from './atlas'
import { cropTiles, type Engine } from '../sim/engine'
import { CLASH, CROW_SPOT, FARM, INTRO_SIGNS, MISSING, NEIGHBOUR, NEIGHBOUR_PLOTS, OTHER_FARMS, PROPS, TILE, VALLEY_STATS, WORLD, type Prop } from '../sim/scenario'
import type { Dir, Farmhand, ReasonLabel, Rect, RoleId, Task } from '../sim/types'
import { usd } from '../sim/settings'
import { VALLEY_CREWS } from '../sim/templates'
import { REVIEW_FAIL } from '../sim/review'
import { cartBack, cartBarn, cartGate, cartOut } from '../sim/ship'

export interface Camera {
  x: number // world px at screen left
  y: number
  scale: number
}

export interface Hit {
  kind: 'plot' | 'farmhand' | 'head' | 'signpost' | 'pest' | 'crow' | 'neighbour' | 'nplot' | 'farm' | 'prop' | 'chicken' | 'sign' | 'crate'
  id: string
  rect: Rect // world px
  title: string
  term?: string // plain-language meaning of the farm word
  body?: string
}

// ---- deterministic noise -----------------------------------------------------

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// ---- static background, in three layers so the valley can draw in ------------------

let layers: { ground: HTMLCanvasElement; fences: HTMLCanvasElement; buildings: HTMLCanvasElement } | null = null

function layer(pad = 0) {
  const c = document.createElement('canvas')
  c.width = (WORLD.w + pad * 2) * TILE
  c.height = (WORLD.h + pad * 2) * TILE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  return { c, ctx }
}

function fenceRect(ctx: CanvasRenderingContext2D, r: Rect, gate: { side: 'w' | 'e' | 's' | 'n'; at: number }[] = []) {
  const x0 = r.x
  const y0 = r.y
  const x1 = r.x + r.w - 1
  const y1 = r.y + r.h - 1
  const isGate = (x: number, y: number) =>
    gate.some((g) => (g.side === 'w' && x === x0 && Math.abs(y - g.at) <= 1) || (g.side === 'e' && x === x1 && Math.abs(y - g.at) <= 1) || (g.side === 's' && y === y1 && Math.abs(x - g.at) <= 1) || (g.side === 'n' && y === y0 && Math.abs(x - g.at) <= 1))
  const put = (name: string, x: number, y: number) => {
    if (!isGate(x, y)) draw(ctx, name, x * TILE, y * TILE)
  }
  put('fence_10', x0, y0)
  put('fence_30', x1, y0)
  put('fence_12', x0, y1)
  put('fence_32', x1, y1)
  for (let x = x0 + 1; x < x1; x++) {
    put('fence_23', x, y0)
    put('fence_23', x, y1)
  }
  for (let y = y0 + 1; y < y1; y++) {
    put('fence_01', x0, y)
    put('fence_01', x1, y)
  }
}

const POND = PROPS.find((p) => p.kind === 'pond')!

// The ground reaches PAD tiles past the world on every side, so the valley never ends in a flat fill.
const PAD = 24
let grassFill: CanvasPattern | null = null

// Smooth 1D noise, -1..1, for path edges that wander a little.
function wander(seed: number, t: number) {
  const i = Math.floor(t)
  const f = t - i
  const k = f * f * (3 - 2 * f)
  return (hash(seed, i) * (1 - k) + hash(seed, i + 1) * k) * 2 - 1
}

// Worn dirt paths, painted pixel by pixel: soft wandering edges, rounded junctions,
// a shadow lip on the low side, specks, pebbles and grass poking in at the edges.
function paintPaths(ctx: CanvasRenderingContext2D, W: number, H: number, off: number) {
  const mask = new Uint8Array(W * H)
  let seed = 1
  // A rect in world px; each edge wanders by up to 1.5 px.
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const sl = seed++ * 7
    const sr = seed++ * 7
    const st = seed++ * 7
    const sb = seed++ * 7
    const ax0 = Math.max(0, Math.floor(x0 + off - 2))
    const ax1 = Math.min(W, Math.ceil(x1 + off + 2))
    const ay0 = Math.max(0, Math.floor(y0 + off - 2))
    const ay1 = Math.min(H, Math.ceil(y1 + off + 2))
    for (let y = ay0; y < ay1; y++)
      for (let x = ax0; x < ax1; x++) {
        const wx = x - off
        const wy = y - off
        if (wx < x0 + Math.round(wander(sl, wy / 6) * 1.5)) continue
        if (wx >= x1 + Math.round(wander(sr, wy / 6) * 1.5)) continue
        if (wy < y0 + Math.round(wander(st, wx / 6) * 1.5)) continue
        if (wy >= y1 + Math.round(wander(sb, wx / 6) * 1.5)) continue
        mask[y * W + x] = 1
      }
  }
  // Round a concave corner at (cx, cy); (sx, sy) points into the grass quadrant.
  const fillet = (cx: number, cy: number, sx: number, sy: number, R: number) => {
    const ox = cx + sx * R
    const oy = cy + sy * R
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        const wx = sx < 0 ? cx - 1 - i : cx + i
        const wy = sy < 0 ? cy - 1 - j : cy + j
        if (Math.hypot(wx + 0.5 - ox, wy + 0.5 - oy) > R) {
          const x = wx + off
          const y = wy + off
          if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1
        }
      }
  }
  const T = TILE
  const lx0 = 37 * T
  const lx1 = 39 * T
  const ly0 = 23.5 * T
  const ly1 = 25.5 * T
  // The two valley lanes, out past the world's edges.
  rect(lx0, -off, lx1, H - off)
  rect(-off, ly0, W - off, ly1)
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) fillet(sx < 0 ? lx0 : lx1, sy < 0 ? ly0 : ly1, sx, sy, 7)
  // Short spurs from each farm gate to its lane. at is the gate's centre in tiles.
  const half = 14
  const toLaneX = (gx: number, at: number) => {
    const cy = (at + 0.5) * T
    const west = gx < lx0
    if (west) rect(gx, cy - half, lx0, cy + half)
    else rect(lx1, cy - half, gx, cy + half)
    const cx = west ? lx0 : lx1
    const sx = west ? -1 : 1
    fillet(cx, cy - half, sx, -1, 5)
    fillet(cx, cy + half, sx, 1, 5)
  }
  const toLaneY = (gy: number, at: number) => {
    const cx = (at + 0.5) * T
    const north = gy < ly0
    if (north) rect(cx - half, gy, cx + half, ly0)
    else rect(cx - half, ly1, cx + half, gy)
    const cy = north ? ly0 : ly1
    const sy = north ? -1 : 1
    fillet(cx - half, cy, -1, sy, 5)
    fillet(cx + half, cy, 1, sy, 5)
  }
  for (const gt of farmGates()) {
    const r = gt.rect
    if (gt.side === 'e') toLaneX((r.x + r.w - 2) * T + 2, gt.at)
    if (gt.side === 'w') toLaneX((r.x + 1) * T - 2, gt.at)
    if (gt.side === 's') toLaneY((r.y + r.h - 2) * T + 2, gt.at)
    if (gt.side === 'n') toLaneY((r.y + 1) * T + 14, gt.at)
  }

  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x])
  const put = (x: number, y: number, c: number) => {
    const i = (y * W + x) * 4
    d[i] = c >> 16
    d[i + 1] = (c >> 8) & 255
    d[i + 2] = c & 255
    d[i + 3] = 255
  }
  const BASE = 0xe8cfa6
  const LIP = 0xdcb98a
  const SPECK = 0xe1c397
  const LIGHT = 0xeddab5
  const BLADE = 0xa4c263
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue
      const wx = x - off
      const wy = y - off
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)
      let c = BASE
      // Worn patches: a slow wash a shade darker.
      if (wander(91, wx / 11 + wander(92, wy / 13) * 1.3) + wander(93, wy / 9) > 1.05) c = SPECK
      const h = hash(wx * 3 + 11, wy * 5 + 7)
      if (h < 0.022) c = LIP
      else if (h < 0.034) c = LIGHT
      // A shadow lip on the low side, and a thin one on the right.
      if (!at(x, y + 1) || !at(x, y + 2) || !at(x + 1, y)) c = LIP
      // Grass poking in at the edges.
      if (edge && hash(wx + 301, wy + 17) < 0.07) c = BLADE
      put(x, y, c)
    }
  // Pebbles: a few per stretch, never on an edge.
  for (let cy = 0; cy < H; cy += 9)
    for (let cx = 0; cx < W; cx += 9) {
      const h = hash(cx * 13 + 5, cy * 17 + 3)
      if (h > 0.13) continue
      const x = cx + Math.floor(hash(cx, cy + 1) * 6)
      const y = cy + Math.floor(hash(cx + 1, cy) * 6)
      let ok = true
      for (let j = -2; j < 5 && ok; j++) for (let i = -2; i < 5 && ok; i++) if (!at(x + i, y + j)) ok = false
      if (!ok) continue
      const wide = h < 0.06
      put(x, y, 0xf3e6c8)
      put(x + 1, y, 0xcfb084)
      if (wide) put(x + 2, y, 0xcfb084)
      put(x, y + 1, 0xcfb084)
      put(x + 1, y + 1, 0xb8966a)
      if (wide) put(x + 2, y + 1, 0xb8966a)
    }
  ctx.putImageData(img, 0, 0)
}

// Farm fences and their gates. The gates face the lanes.
function farmGates() {
  const out: { rect: Rect; side: 'w' | 'e' | 's' | 'n'; at: number }[] = []
  for (const fm of farmFences()) for (const g of fm.gates) out.push({ rect: fm.rect, side: g.side, at: g.at })
  return out
}

function farmFences() {
  const [bl, br] = OTHER_FARMS
  return [
    { rect: FARM.rect, gates: [{ side: 'e' as const, at: 12 }, { side: 's' as const, at: 19 }] },
    { rect: NEIGHBOUR.rect, gates: [{ side: 'w' as const, at: 12 }, { side: 's' as const, at: 57 }] },
    { rect: bl.rect, gates: [{ side: 'e' as const, at: bl.rect.y + 6 }, { side: 'n' as const, at: 19 }] },
    { rect: br.rect, gates: [{ side: 'w' as const, at: br.rect.y + 6 }, { side: 'n' as const, at: 57 }] },
  ]
}

function buildBackground() {
  // The ground is padded past the world so the lanes run on and the grass never stops.
  const g = layer(PAD)
  for (let y = -PAD; y < WORLD.h + PAD; y++)
    for (let x = -PAD; x < WORLD.w + PAD; x++) {
      draw(g.ctx, 'grass', (x + PAD) * TILE, (y + PAD) * TILE)
      const n = hash(x, y)
      if (n < 0.16) draw(g.ctx, `grass_deco_${Math.floor(n * 75) % 12}`, (x + PAD) * TILE, (y + PAD) * TILE)
    }
  paintPaths(g.ctx, g.c.width, g.c.height, PAD * TILE)
  g.ctx.translate(PAD * TILE, PAD * TILE)
  drawPond(g.ctx, 0)
  // Flowers in the grass.
  draw(g.ctx, 'flower_1', 8 * TILE, 21.5 * TILE)
  draw(g.ctx, 'flower_4', 30.5 * TILE, 21.5 * TILE)
  draw(g.ctx, 'flower_6', 4 * TILE, 20 * TILE)

  const f = layer()
  for (const fm of farmFences()) fenceRect(f.ctx, fm.rect, fm.gates)

  const b = layer()
  // Trees along the valley edge.
  const trees: [string, number, number][] = [
    ['tree_big', 0, 0], ['tree', 35, 0.5], ['tree_small', 39.5, 22], ['tree', 74, 0.2], ['tree_big', 73, 20],
    ['tree', 0, 21], ['tree_small', 36, 43], ['tree', 74, 43], ['tree_big', 0.2, 43],
  ]
  for (const [n, x, y] of trees) draw(b.ctx, n, x * TILE, y * TILE - 8)
  // The first other farm is a flower garden; the second is an orchard.
  const garden = OTHER_FARMS[0].rect
  for (let y = garden.y + 6; y < garden.y + garden.h - 2; y += 2)
    for (let x = garden.x + 4; x < garden.x + garden.w - 3; x += 2) {
      const n = hash(x, y)
      draw(b.ctx, n < 0.5 ? `crop_tulip_${n < 0.2 ? 2 : 3}` : `flower_${Math.floor(n * 8)}`, x * TILE, y * TILE)
    }
  const orchard = OTHER_FARMS[1].rect
  const fruit = ['tree_apple', 'tree_orange', 'tree_pear', 'tree_peach']
  for (let y = orchard.y + 6; y < orchard.y + orchard.h - 3; y += 4)
    for (let x = orchard.x + 3; x < orchard.x + orchard.w - 4; x += 4) draw(b.ctx, fruit[(x + y) % 4], x * TILE, y * TILE - 8)
  // Houses that never react. Your farmhouse is a prop and is drawn live.
  for (const h of [FARM.barn, NEIGHBOUR.house, ...OTHER_FARMS.map((o) => o.house)]) draw(b.ctx, h.sprite, h.x * TILE, h.y * TILE)
  layers = { ground: g.c, fences: f.c, buildings: b.c }
}

// The pond: water clipped to a rounded shape with a soft shore, so it isn't a hard rectangle.
function pondPath(ctx: CanvasRenderingContext2D, inset = 0) {
  const x = POND.x * TILE + inset
  const y = POND.y * TILE + inset
  const w = POND.w * TILE - inset * 2
  const h = POND.h * TILE - inset * 2
  const r = Math.min(14, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawPond(ctx: CanvasRenderingContext2D, frame: number) {
  ctx.save()
  // Shore: a band of damp earth just outside the water.
  pondPath(ctx, -2)
  ctx.fillStyle = '#b7a46b'
  ctx.fill()
  pondPath(ctx, 0)
  ctx.clip()
  for (let y = POND.y; y < POND.y + POND.h; y++) for (let x = POND.x; x < POND.x + POND.w; x++) draw(ctx, `water_${frame}`, x * TILE, y * TILE)
  ctx.restore()
  ctx.save()
  pondPath(ctx, 0.5)
  ctx.strokeStyle = 'rgba(62, 92, 110, 0.45)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

// ---- helpers -----------------------------------------------------------------

// The tilled bed is one tile wider than the crop area on every side, so each crop
// sits on an inner soil tile and the bed's rim stays clear.
function bed(ctx: CanvasRenderingContext2D, crops: Rect, dry: boolean) {
  const r = { x: crops.x - 1, y: crops.y - 1, w: crops.w + 2, h: crops.h + 2 }
  const pre = dry ? 'bed_dry_' : 'bed_wet_'
  for (let j = 0; j < r.h; j++)
    for (let i = 0; i < r.w; i++) {
      const cx = r.w === 1 ? 1 : i === 0 ? 0 : i === r.w - 1 ? 2 : 1
      const cy = r.h === 1 ? 1 : j === 0 ? 0 : j === r.h - 1 ? 2 : 1
      draw(ctx, `${pre}${cx}${cy}`, (r.x + i) * TILE, (r.y + j) * TILE)
    }
}

// The soil dries as a task uses its energy: damp at 50%, dry at 75%, cracked at 90%.
// It is ambient only; the exact figure is on hover and in the status line.
function soilStage(t: Task) {
  const k = t.budget ? t.used / t.budget : 0
  return k >= 0.9 ? 3 : k >= 0.75 || t.dry ? 2 : k >= 0.5 ? 1 : 0
}

function soil(ctx: CanvasRenderingContext2D, crops: Rect, stage: number) {
  bed(ctx, crops, stage >= 2)
  if (stage === 1) {
    ctx.save()
    ctx.globalAlpha *= 0.5
    bed(ctx, crops, true)
    ctx.restore()
  }
  if (stage < 3) return
  // Cracks: short dark runs on the inner tiles, the same every frame.
  ctx.save()
  ctx.fillStyle = 'rgba(92, 58, 34, 0.55)'
  for (let j = 0; j < crops.h; j++)
    for (let i = 0; i < crops.w; i++) {
      const x = (crops.x + i) * TILE
      const y = (crops.y + j) * TILE
      const n = hash(crops.x + i, crops.y + j)
      const ox = 2 + Math.floor(n * 8)
      const oy = 3 + Math.floor(hash(j, i + 7) * 8)
      for (let k = 0; k < 5; k++) ctx.fillRect(x + ox + k, y + oy + ((k + Math.floor(n * 3)) % 3 === 0 ? 1 : 0) + (k > 2 ? 1 : 0), 1, 1)
      ctx.fillRect(x + ox + 2, y + oy + 2, 1, 2)
    }
  ctx.restore()
}

function stageOf(p: number, done: boolean) {
  if (done) return 3
  if (p > 0.55) return 2
  if (p > 0) return 1
  return 0
}

function charFrame(anim: string, dir: Dir, clock: number, fps = 8) {
  const n = animCounts[`${anim}_${dir}`] ?? 1
  return `char_${anim}_${dir}_${Math.floor(clock * fps) % n}`
}

function drawChar(ctx: CanvasRenderingContext2D, x: number, y: number, anim: string, dir: Dir, clock: number, tint?: { body: string; shade: string }, alpha = 1) {
  // Frames are 48x48 with the feet around y=32.
  ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(40,40,60,0.18)'
  ctx.beginPath()
  ctx.ellipse(x * TILE, y * TILE - 1, 6, 2.5, 0, 0, Math.PI * 2)
  ctx.fill()
  draw(ctx, charFrame(anim, dir, clock), Math.round(x * TILE - 24), Math.round(y * TILE - 33), { tint })
  ctx.globalAlpha = 1
}

const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const REACT = 0.6 // seconds a click reaction lasts

// 0..1 through a click reaction, or -1 when there is none. Under reduced motion it holds one frame.
function reactK(at: number | undefined, clock: number) {
  if (at === undefined) return -1
  const k = (clock - at) / REACT
  if (k < 0 || k > 1) return -1
  return reduced ? 0.5 : k
}

function pixel(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, alpha = 1, scale = 1) {
  const img = pixelSprite(name)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.drawImage(img, Math.round(x - (img.width * scale) / 2), Math.round(y - (img.height * scale) / 2), img.width * scale, img.height * scale)
  ctx.restore()
}

// One emote per plot says how it's doing.
function plotEmote(e: Engine, t: Task): EmoteKind | null {
  const st = e.taskStatus(t)
  if (st.tone === 'done') return 'check'
  if (st.tone === 'needs') return 'alert'
  if (st.tone === 'warn' || st.tone === 'fail') return 'cross'
  if (st.text === 'Waiting') return 'sleep'
  return null
}

// ---- main render ------------------------------------------------------------------

export interface RenderOut {
  hits: Hit[]
}

let viewW = 0

export function render(ctx: CanvasRenderingContext2D, e: Engine, cam: Camera, W: number, H: number, dpr: number): RenderOut {
  viewW = W
  if (!layers) buildBackground()
  const hits: Hit[] = []
  const clock = e.clock
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#9bcf6a'
  ctx.fillRect(0, 0, W, H)

  ctx.save()
  ctx.scale(cam.scale, cam.scale)
  ctx.translate(-cam.x, -cam.y)

  // The valley draws in: ground, then fences, then buildings.
  const boot = e.ready ? clock - e.bootT : 0
  const fade = (from: number) => (reduced ? 1 : Math.max(0, Math.min(1, (boot - from) / 0.45)))
  const L = layers!
  ctx.globalAlpha = fade(0)
  // Grass under everything, in case a view ever reaches past the padded ground.
  if (!grassFill) {
    const t = document.createElement('canvas')
    t.width = TILE
    t.height = TILE
    draw(t.getContext('2d')!, 'grass', 0, 0)
    grassFill = ctx.createPattern(t, 'repeat')
  }
  if (grassFill) {
    ctx.fillStyle = grassFill
    ctx.fillRect(Math.floor(cam.x / TILE) * TILE - TILE, Math.floor(cam.y / TILE) * TILE - TILE, W / cam.scale + TILE * 3, H / cam.scale + TILE * 3)
  }
  ctx.drawImage(L.ground, -PAD * TILE, -PAD * TILE)
  drawPond(ctx, Math.floor(clock * 2.5) % 4)
  ctx.globalAlpha = fade(0.35)
  ctx.drawImage(L.fences, 0, 0)
  const built = fade(0.7)
  ctx.globalAlpha = built
  ctx.drawImage(L.buildings, 0, 0)
  ctx.globalAlpha = 1

  const replay = !!e.trace
  const planning = e.phase === 'plan'
  const planned = e.phase === 'grow' || e.phase === 'harvest' || e.phase === 'ship'
  const focusIds = new Set([e.hoverTask, e.openTaskId, e.activeAsk?.taskId].filter(Boolean) as string[])

  // Neighbour plots.
  for (const np of NEIGHBOUR_PLOTS) {
    const dry = np.drought && e.neighbourDrought
    bed(ctx, np.plot, !!dry)
    for (let j = 0; j < np.plot.h; j++)
      for (let i = 0; i < np.plot.w; i++) {
        const st = dry ? Math.max(0, np.stage - 1) : np.stage
        draw(ctx, `crop_${np.crop}_${st}`, (np.plot.x + i) * TILE, (np.plot.y + j) * TILE)
      }
    hits.push({ kind: 'nplot', id: np.name, rect: px(np.plot), title: np.name, body: `${NEIGHBOUR.name}${dry ? ', retired /v1/session' : ''}` })
  }

  // During an ask (or the re-plan it leads to), everything but the asking plot, its farmhand and the crow dims.
  const ask = e.activeAsk
  const focusTask = e.phase === 'grow' && e.replan?.status === 'open' ? MISSING.taskId : e.phase === 'grow' && ask && ask.from !== 'head' ? ask.taskId : null
  const focusFh: RoleId | null = focusTask ? (ask && ask.from !== 'head' ? ask.from : e.task(focusTask).assignee) : null

  // Plots. During Plan the head farmer tills them one by one. Finished plots fade back.
  const drawPlot = (t: Task, i: number, again = false) => {
    const r = t.plot
    const bedRect = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }
    let shown = planned
    const doneDim = planned && !again && e.taskRipe(t) && !(e.phase === 'harvest' && e.harvestStage === 'map') ? 0.6 : 1
    ctx.save()
    ctx.globalAlpha = doneDim
    if (planning) {
      const k = i < e.planShown ? 1 : i === e.planShown ? (e.head.till[i] ?? 0) : 0
      if (k <= 0) return ctx.restore()
      shown = k >= 1
      ctx.save()
      ctx.beginPath()
      ctx.rect(bedRect.x * TILE, bedRect.y * TILE, bedRect.w * TILE * k, bedRect.h * TILE)
      ctx.clip()
      bed(ctx, r, false)
      ctx.restore()
    } else if (planned) {
      soil(ctx, r, soilStage(t))
      if (!e.picked.has(t.id)) {
        const ripe = e.taskRipe(t)
        for (const c of cropTiles(t)) {
          const s = t.subtasks[c.sub]
          if (!s) continue
          // A crop ripens only when its gates pass: until then it stays one stage short.
          draw(ctx, `crop_${t.crop}_${Math.min(stageOf(s.progress, s.done), ripe ? 3 : 2)}`, c.x * TILE, c.y * TILE)
        }
      }
    } else return ctx.restore()
    if (!shown) return ctx.restore()

    // Hover, the open task and an ask's task get an outline, in step with the panel.
    if (focusIds.has(t.id)) {
      ctx.save()
      ctx.strokeStyle = e.activeAsk?.taskId === t.id ? '#f6d26b' : '#fff6c8'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.9
      ctx.strokeRect(bedRect.x * TILE - 1, bedRect.y * TILE - 1, bedRect.w * TILE + 2, bedRect.h * TILE + 2)
      ctx.restore()
    }

    // The crop sign on the bed's top-left rim, with the progress bar under it.
    const sx = bedRect.x * TILE
    const sy = bedRect.y * TILE - 10
    const wig = reactK(e.pokes[`sign-${t.id}`], clock)
    ctx.save()
    ctx.translate(sx + 8, sy + 16)
    if (wig >= 0) ctx.rotate(Math.sin(wig * Math.PI * 4) * 0.18 * (1 - wig))
    draw(ctx, hasFrame(`sign_${t.crop}`) ? `sign_${t.crop}` : 'sign_blank', -8, -16)
    ctx.restore()
    if (!again) hits.push({ kind: 'sign', id: `sign-${t.id}`, rect: { x: sx, y: sy, w: 16, h: 16 }, title: '' })
    if (planned) {
      const raw = t.subtasks.reduce((n, s) => n + (s.done ? 1 : s.progress), 0) / t.subtasks.length
      const frac = e.taskRipe(t) ? raw : Math.min(raw, 0.92)
      // Centred under the sign: 20px wide, sign is 16px wide starting at sx.
      const bx = sx + 8 - 10
      ctx.fillStyle = 'rgba(62,49,80,0.7)'
      ctx.fillRect(bx, sy + 17, 20, 4)
      ctx.fillStyle = frac >= 1 ? '#4f8f3f' : t.dry ? '#e8a05a' : '#7fc06a'
      ctx.fillRect(bx + 1, sy + 18, Math.max(1, 18 * frac), 2)
      // Only done and failed show on the plot; the farmhand's glyph carries everything else.
      // Picked plots go quiet, except a failed gate: its cross stays through the harvest.
      const em0 = plotEmote(e, t)
      const em = (e.picked.has(t.id) && em0 !== 'cross') || (em0 !== 'check' && em0 !== 'cross') ? null : em0
      if (em) worldEmote(ctx, sx + 8, sy - 1, em, clock)
    }

    // Files, skills and tools the task uses, along the left edge. The column tightens to fit them all.
    const slots = t.signposts.length + (replay && t.id === MISSING.taskId && !t.signposts.includes(MISSING.file) ? 1 : 0)
    const step = Math.min(0.7, (r.h + 0.7) / Math.max(1, slots))
    t.signposts.forEach((s, k) => {
      const px0 = (r.x - 2) * TILE
      const py0 = (r.y + k * step + 0.3) * TILE
      const kind = e.lib(s).kind
      draw(ctx, 'sign_blank', px0, py0)
      if (kind === 'tool') {
        // An MCP tool: a small teal plate on the sign, so tools read apart from files and skills.
        ctx.fillStyle = '#2f6b5e'
        ctx.fillRect(px0 + 5, py0 + 4, 6, 4)
      }
      const verb = kind === 'tool' ? 'Called by' : kind === 'skill' ? 'Used by' : 'Read by'
      const added = s === MISSING.file && e.flags.has('replanApplied')
      if (!again) hits.push({ kind: 'signpost', id: `${t.id}:${s}`, rect: { x: px0, y: py0, w: 16, h: 16 }, title: s, body: added ? 'Added by the re-plan' : `${verb} ${t.name}` })
    })
    if (replay && t.id === MISSING.taskId && !t.signposts.includes(MISSING.file)) {
      // The missing file: what this task's agent never saw.
      const k = t.signposts.length
      const px0 = (r.x - 2) * TILE
      const py0 = (r.y + k * step + 0.3) * TILE
      ctx.save()
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(clock * 5)
      ctx.strokeStyle = '#d9715f'
      ctx.strokeRect(px0 + 1.5, py0 + 1.5, 13, 13)
      ctx.restore()
    }

    // Pests.
    for (const p of t.pests) {
      const img = pixelSprite('beetle')
      const sc = 0.6 + 0.4 * p.size
      const bx = (p.tile.x + 0.5) * TILE + Math.sin(clock * 3) * 2
      const by = (p.tile.y + 0.5) * TILE + Math.cos(clock * 2.3) * 1.5
      ctx.drawImage(img, bx - (img.width * sc) / 2, by - (img.height * sc) / 2, img.width * sc, img.height * sc)
      if (!again) hits.push({ kind: 'pest', id: p.id, rect: { x: bx - 8, y: by - 8, w: 16, h: 16 }, title: 'Beetle', body: p.label })
    }

    // A draft ready on this plot (a commit, a test file, the guide): a crate on the bed's top-right corner.
    const draft = planned ? e.draftFor(t.id) : null
    if (draft) {
      const cx = (bedRect.x + bedRect.w) * TILE - 17
      const cy = bedRect.y * TILE - 9
      ctx.fillStyle = 'rgba(40,40,60,0.2)'
      ctx.fillRect(cx + 1, cy + 13, 15, 2)
      draw(ctx, 'chest', cx, cy)
      if (!again) hits.push({ kind: 'crate', id: t.id, rect: { x: cx - 1, y: cy - 1, w: 18, h: 17 }, title: draft.label, body: 'Open the draft' })
    }
    ctx.restore()
    if (again) return

    const st = e.taskStatus(t)
    const cost = `${fmtK(t.used)} of ${fmtK(t.budget)} tokens, $${usd(t.used, e.settings).toFixed(2)}`
    hits.push({
      kind: 'plot',
      id: t.id,
      rect: px(r),
      title: t.name,
      body: planned ? `${e.farmhands[t.assignee].role}. ${st.text}. ${cost}.` : `Proposed for ${e.farmhands[t.assignee].role}`,
    })
  }
  e.tasks.forEach((t, i) => drawPlot(t, i))

  // ---- things that sit on the ground, sorted with the characters by their feet ----
  type Drawable = { y: number; fn: () => void }
  const list: Drawable[] = []

  for (const p of PROPS) {
    if (p.kind === 'pond') {
      hits.push({ kind: 'prop', id: p.id, rect: px({ x: p.x, y: p.y, w: p.w, h: p.h }), title: '' })
      continue
    }
    const k = reactK(e.pokes[p.id], clock)
    const feet = p.y + p.h
    list.push({ y: feet, fn: () => drawProp(ctx, e, p, k, clock, built) })
    hits.push({ kind: 'prop', id: p.id, rect: px({ x: p.x, y: p.y, w: p.w, h: p.h }), title: '' })
  }

  // The shipping crate, where the harvest goes. Bigger than the file chest and marked with a sign,
  // and it sits above the spots where the crew stops, so nobody stands on it.
  const sh = FARM.shipping
  const shipOpen = e.phase === 'harvest' && e.harvestStage === 'map'
  list.push({ y: sh.y + 0.55, fn: () => drawCrate(ctx, sh.x, sh.y, shipOpen, e.picked.size) })

  // Ship: the cart with the harvest drives out along the valley road, and comes back on a rollback.
  const cartPos = cartSpot(e)
  if (cartPos) list.push({ y: cartPos.y, fn: () => drawCart(ctx, cartPos.x, cartPos.y, e.cart.crow, clock) })

  // The head farmer.
  const hf = e.head
  const waveK = reactK(e.pokes.house, clock)
  list.push({
    y: hf.y,
    fn: () => {
      const dir: Dir = waveK >= 0 ? (Math.floor(waveK * 6) % 2 ? 'left' : 'right') : hf.dir
      drawChar(ctx, hf.x, hf.y, hf.anim, dir, clock, undefined, e.intro && e.beat < 2 ? 0 : 1)
    },
  })
  hits.push({ kind: 'head', id: 'head', rect: { x: hf.x * TILE - 8, y: hf.y * TILE - 18, w: 16, h: 20 }, title: 'Head farmer', body: headStatus(e) })

  for (const fh of Object.values(e.farmhands)) {
    if (fh.inside || (e.intro && e.beat < 2)) continue
    list.push({ y: fh.y, fn: () => drawFarmhand(ctx, e, fh, clock) })
    // The hit box is the body; collision elsewhere uses only the feet.
    hits.push({ kind: 'farmhand', id: fh.id, rect: { x: fh.x * TILE - 8, y: fh.y * TILE - 18, w: 16, h: 20 }, title: fh.role, body: e.fhStatus(fh) })
  }

  // The neighbouring crew, wandering between its plots.
  const lead = { x: 64.5 + Math.sin(clock * 0.3) * 0.4, y: 8.6 }
  list.push({ y: lead.y, fn: () => drawChar(ctx, lead.x, lead.y, 'idle', 'down', clock, { body: '#d7c6f0', shade: '#a596c9' }) })
  hits.push({ kind: 'neighbour', id: 'lead', rect: { x: lead.x * TILE - 8, y: lead.y * TILE - 18, w: 16, h: 20 }, title: `${NEIGHBOUR.name} head farmer`, body: NEIGHBOUR.team })
  NEIGHBOUR_PLOTS.slice(0, 3).forEach((np, i) => {
    const ph = clock * 0.22 + i * 2.1
    const k = (Math.sin(ph) + 1) / 2
    const x = np.plot.x + 0.5 + k * (np.plot.w - 1)
    const y = np.plot.y + np.plot.h + 0.55
    const moving = Math.abs(Math.cos(ph)) > 0.25
    const dir: Dir = moving ? (Math.cos(ph) > 0 ? 'right' : 'left') : 'up'
    list.push({ y, fn: () => drawChar(ctx, x, y, moving ? 'walk' : 'water', dir, clock, { body: '#c9d3dc', shade: '#9aa6b2' }, 0.75) })
  })

  // Other farms in the valley: a couple of farmhands each.
  OTHER_FARMS.forEach((f, fi) => {
    for (let i = 0; i < 2; i++) {
      const ph = clock * 0.18 + i * 3 + fi
      const x = f.rect.x + 8 + i * 9 + Math.sin(ph) * 3
      const y = f.rect.y + 9 + i * 3
      list.push({ y, fn: () => drawChar(ctx, x, y, 'walk', Math.cos(ph) > 0 ? 'right' : 'left', clock, { body: '#e7dcc4', shade: '#c4b79a' }, 0.8) })
    }
  })

  // Chickens. Clicked: a hop and a heart. Three clicks and it runs off.
  e.chickens.forEach((c, i) => {
    const k = reactK(e.pokes[`chicken-${i}`], clock)
    const hop = k >= 0 ? Math.sin(k * Math.PI) * 5 : 0
    const moving = Math.hypot(c.tx - c.x, c.ty - c.y) > 0.05 && c.wait <= 0
    list.push({
      y: c.y,
      fn: () => {
        ctx.globalAlpha = built
        draw(ctx, `chicken_${moving ? Math.floor(clock * (c.flee > 0 ? 10 : 4) + i) % 2 : 0}`, c.x * TILE - 8, c.y * TILE - 14 - hop, { flip: c.tx < c.x })
        ctx.globalAlpha = 1
        if (k >= 0) pixel(ctx, 'heart', c.x * TILE, c.y * TILE - 20 - k * 8, 1 - k * 0.6)
      },
    })
    hits.push({ kind: 'chicken', id: `chicken-${i}`, rect: { x: c.x * TILE - 8, y: c.y * TILE - 16, w: 16, h: 16 }, title: '' })
  })

  list.sort((a, b) => a.y - b.y).forEach((d) => d.fn())

  // Focus on an ask: a dark veil over the farm, then the asking plot and its farmhand again on top.
  if (focusTask) {
    ctx.save()
    ctx.fillStyle = 'rgba(46, 36, 58, 0.42)'
    ctx.fillRect(0, 0, WORLD.w * TILE, WORLD.h * TILE)
    ctx.restore()
    const ti = e.tasks.findIndex((t) => t.id === focusTask)
    if (ti >= 0) drawPlot(e.tasks[ti], ti, true)
    const ffh = focusFh ? e.farmhands[focusFh] : null
    if (ffh && !ffh.inside) drawFarmhand(ctx, e, ffh, clock)
  }

  // Pond: a ripple where you clicked, and now and then a fish.
  const pk = reactK(e.pokes.pond, clock)
  if (pk >= 0) {
    const cx = (POND.x + POND.w / 2) * TILE
    const cy = (POND.y + POND.h / 2) * TILE
    ctx.save()
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - pk)})`
    ctx.lineWidth = 1
    for (const off of [0, 0.35]) {
      const kk = Math.max(0, pk - off)
      ctx.beginPath()
      ctx.ellipse(cx, cy, 3 + kk * 22, 1.5 + kk * 8, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
  const fk = reactK(e.fishAt, clock)
  if (fk >= 0) pixel(ctx, 'fish', (POND.x + POND.w / 2 + (fk - 0.5) * 1.5) * TILE, (POND.y + POND.h / 2) * TILE - Math.sin(fk * Math.PI) * 14, 1)

  // Scrolls: one per attached file, lifted out of the chest while the head farmer reads.
  const scrolls = e.scrollsLifted
  for (let i = 0; i < scrolls; i++) {
    const bob = reduced ? 0 : Math.sin(clock * 3 + i) * 1.5
    pixel(ctx, 'scroll', hf.x * TILE + (i - (scrolls - 1) / 2) * 10, hf.y * TILE - 36 - (i % 2) * 6 + bob)
  }

  // Crops carried to the shipping chest.
  for (const fh of Object.values(e.farmhands)) {
    const crop = e.carrying[fh.id]
    if (crop) draw(ctx, `crop_${crop}_3`, Math.round(fh.x * TILE - 8), Math.round(fh.y * TILE - 52 + (reduced ? 0 : Math.sin(clock * 10) * 1)))
  }

  // Crow.
  if (e.crow.state !== 'none' && e.crow.state !== 'gone') {
    const flying = e.crow.state !== 'landed'
    const img = pixelSprite(flying && Math.floor(clock * 8) % 2 ? 'crow1' : 'crow0')
    const cx = e.crow.x * TILE - 8
    const cy = e.crow.y * TILE - 12 + (flying ? 0 : Math.abs(Math.sin(clock * 2)) * -1)
    // While the conflict is open: threads to the two plots that disagree, and a pulse so it can't be missed.
    const open = e.crow.state === 'landed' && (e.activeAsk?.id === 'crow' || e.replan?.status === 'open')
    if (open) {
      const ox = CROW_SPOT.x * TILE
      const oy = CROW_SPOT.y * TILE - 8
      // One thread to the plot that asks (its right edge, next to the crow), one to the neighbour's plot.
      const ours = e.task(e.activeAsk?.taskId ?? 'tests').plot
      const theirs = NEIGHBOUR_PLOTS.find((p) => p.drought)?.plot ?? NEIGHBOUR_PLOTS[0].plot
      ctx.save()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(122, 82, 170, 0.9)'
      for (const [x2, y2] of [
        [(ours.x + ours.w + 1) * TILE, (ours.y + ours.h / 2) * TILE],
        [(theirs.x + theirs.w / 2) * TILE, theirs.y * TILE - 2],
      ]) {
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }
      for (let k = 0; k < 2; k++) {
        const ph = (clock * 0.8 + k * 0.5) % 1
        ctx.strokeStyle = `rgba(122, 82, 170, ${0.8 * (1 - ph)})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(ox, oy - 4, 8 + ph * 26, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }
    if (!flying) draw(ctx, 'fence_03', CROW_SPOT.x * TILE - 8, CROW_SPOT.y * TILE - 6)
    ctx.save()
    if (e.crow.state === 'leaving') {
      ctx.translate(cx + 16, cy)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0)
    } else if (flying) ctx.drawImage(img, cx, cy)
    else ctx.drawImage(img, cx - 4, cy - 16, 24, 24)
    ctx.restore()
    hits.push({ kind: 'crow', id: 'crow', rect: { x: cx - 2, y: cy - 10, w: 20, h: 20 }, title: 'Crow', body: CLASH.crow })
  }

  // Seed flying to the library.
  if (e.seedFly) {
    const f = e.seedFly
    const k = Math.min(1, f.t)
    const x = (f.from.x + (f.to.x - f.from.x) * k) * TILE
    const y = (f.from.y + (f.to.y - f.from.y) * k) * TILE - Math.sin(k * Math.PI) * 40
    const img = pixelSprite('seed')
    ctx.drawImage(img, x - 5, y - 5, 10, 10)
  }

  ctx.restore()

  // ---- screen-space overlays: labels, emotes, signs ----
  const toScreen = (wx: number, wy: number) => ({ x: (wx * TILE - cam.x) * cam.scale, y: (wy * TILE - cam.y) * cam.scale })

  if (replay) {
    ctx.save()
    ctx.fillStyle = 'rgba(112, 82, 40, 0.20)'
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  if (e.view === 'farm' && !(e.intro && e.beat < 2)) {
    const placed: Box[] = []
    const dimOf = (id: RoleId | 'head') => (focusTask && id !== focusFh ? 0.45 : 1)
    // The head farmer: its line, and the ask glyph when the ask is its own.
    const hfeet = toScreen(hf.x, hf.y)
    const inView = (p: { x: number; y: number }) => p.x > 0 && p.x < W && p.y > 0 && p.y < H + 24
    if (!e.intro && inView(hfeet)) {
      const asking = headWaiting(e)
      const g: Glyph | null = asking ? { kind: 'ask', reason: e.activeAsk?.from === 'head' ? e.activeAsk.label : 'Anomaly' } : e.headThinking > 0 ? { kind: 'work' } : null
      const a = dimOf('head')
      if (g) glyph(ctx, hfeet.x, hfeet.y - 18 * cam.scale, g, glyphPulse('head', g, clock), clock, a)
      nameLine(ctx, hfeet.x, hfeet.y + 3, 'Head farmer', asking ? 'Needs you' : '', a, placed)
    }
    for (const fh of Object.values(e.farmhands)) {
      if (fh.inside || fh.fade <= 0.05) continue
      const feet = toScreen(fh.x, fh.y)
      if (!inView(feet)) continue
      const g = fhGlyph(e, fh)
      const a = dimOf(fh.id) * (g?.kind === 'sleep' ? 0.6 : 1) * fh.fade
      const top = feet.y - 18 * cam.scale
      const reacting = clock - fh.react < REACT * 2
      if (reacting) {
        ctx.save()
        ctx.imageSmoothingEnabled = false
        pixel(ctx, 'heart', feet.x, top - 10 - (reduced ? 0 : ((clock - fh.react) / (REACT * 2)) * 8), 1, Math.max(1, cam.scale * 0.6))
        ctx.restore()
      } else if (g && !e.carrying[fh.id]) glyph(ctx, feet.x, top, g, glyphPulse(fh.id, g, clock), clock, a)
      nameLine(ctx, feet.x, feet.y + 3, fh.role, stateLine(e, fh), a, placed, e.selected === fh.id)
    }
    if (e.crow.state === 'landed') {
      const p = toScreen(CROW_SPOT.x, CROW_SPOT.y - 1.5)
      glyph(ctx, p.x, p.y, { kind: 'ask', reason: 'Anomaly' }, glyphPulse('crow', { kind: 'ask', reason: 'Anomaly' }, clock), clock, 1)
    }
    // The task name for the plot in focus, just above its bed, right of the crop sign.
    if (planning || planned)
      e.tasks.forEach((t, i) => {
        if (!focusIds.has(t.id) || (planning && i >= e.planShown)) return
        const p = toScreen(t.plot.x + 0.35, t.plot.y - 1.05)
        nameLine(ctx, p.x, p.y - 19, t.name, '', focusTask && t.id !== focusTask ? 0.45 : 1, placed, false, 'left')
      })
  }

  // The harvest headline rises over the field while the crops come in.
  if (e.phase === 'harvest' && e.harvestStage === 'map') {
    const k = Math.min(1, (clock - e.harvestT) / 1.2)
    // Over open ground below the plots, clear of the plot signs and the buildings.
    const fr = e.plotsFrame()
    const p = toScreen(fr.x + fr.w / 2, fr.y + 0.9 - k * 0.4)
    ctx.save()
    ctx.globalAlpha = k
    banner(ctx, p.x, p.y, e.harvestHeadline, 16)
    ctx.restore()
  }

  // Farm names. In the valley each farm gets a card with its numbers; the team shows on hover.
  const farms = [
    { name: FARM.name, rect: FARM.rect, team: FARM.team },
    { name: NEIGHBOUR.name, rect: NEIGHBOUR.rect, team: NEIGHBOUR.team },
    ...OTHER_FARMS.map((f) => ({ name: f.name, rect: f.rect, team: f.team })),
  ]
  const nameAlpha = fade(0.9)
  for (const f of farms) {
    const p = toScreen(f.rect.x + f.rect.w / 2, f.rect.y + 0.1)
    ctx.save()
    ctx.globalAlpha = nameAlpha
    if (e.view === 'valley' && !e.intro) valleyCard(ctx, p.x, toScreen(0, f.rect.y + f.rect.h / 2).y, f.name, statsFor(e, f.name))
    else if (e.intro || f.name === FARM.name || f.name === NEIGHBOUR.name) banner(ctx, p.x, p.y, f.name)
    ctx.restore()
    hits.push({ kind: 'farm', id: f.name, rect: px(f.rect), title: f.name, body: f.team })
  }

  // Opening beat 2: what each farm has promised.
  if (e.intro && e.beat === 1) {
    const k = reduced ? 1 : Math.min(1, Math.max(0, (clock - e.beatT - 0.3) / 0.5))
    const ours = toScreen(FARM.rect.x + FARM.rect.w - 2.5, FARM.rect.y + 7)
    const theirs = toScreen(NEIGHBOUR.rect.x + 6, NEIGHBOUR.rect.y + 6.5)
    ctx.save()
    ctx.globalAlpha = k
    banner(ctx, ours.x, ours.y, INTRO_SIGNS.ours, 18)
    ctx.globalAlpha = Math.min(1, Math.max(0, (clock - e.beatT - 2.2) / 0.5))
    if (reduced) ctx.globalAlpha = 1
    banner(ctx, theirs.x, theirs.y, INTRO_SIGNS.theirs, 18)
    ctx.restore()
  }

  return { hits }
}

// ---- small drawing helpers ----------------------------------------------------------

function drawFarmhand(ctx: CanvasRenderingContext2D, e: Engine, fh: Farmhand, clock: number) {
  const tint = { body: fh.color, shade: fh.colorDark }
  // Each farmhand runs on its own clock so no two move in step. Pausing freezes the frame.
  const t = e.paused || fh.paused ? fh.seed : clock + fh.seed
  let anim = 'idle'
  let dir: Dir = fh.dir
  const chore = e.choreOf(fh)
  if (fh.path.length) anim = 'walk'
  else if (fh.paused) dir = 'down'
  else if (clock - fh.react < REACT * 2) dir = 'down'
  else if (fh.status === 'working') {
    const job = fh.job
    const first = job?.kind === 'sub' && e.task(job.taskId).subtasks[0]?.id === job.subId
    anim = job?.kind === 'fix' ? 'chop' : first ? 'till' : 'water'
    dir = 'up'
  } else if (fh.status === 'asking') dir = 'up'
  else if (chore) {
    anim = chore.anim
    dir = chore.dir
    if (chore.partner && fh.look) dir = fh.look
  } else if (fh.look) dir = fh.look
  if (e.selected === fh.id) {
    ctx.save()
    ctx.strokeStyle = '#fff6c8'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.ellipse(fh.x * TILE, fh.y * TILE - 1, 9, 4, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  // Resting farmhands fade back so the ones at work stand out.
  const resting = fhGlyph(e, fh)?.kind === 'sleep'
  drawChar(ctx, fh.x, fh.y, anim, dir, t, tint, fh.fade * (fh.paused ? 0.55 : 1) * (resting ? 0.6 : 1))
}

// The shipping crate: a 1.5x chest on a pallet with a small sign, lid open while crops arrive.
function drawCrate(ctx: CanvasRenderingContext2D, tx: number, ty: number, open: boolean, filled: number) {
  const s = 1.5
  const w = 16 * s
  const x = Math.round(tx * TILE - w / 2)
  const bottom = Math.round((ty + 0.55) * TILE)
  const y = bottom - Math.round(14 * s)
  ctx.save()
  // Pallet.
  ctx.fillStyle = '#7a5236'
  ctx.fillRect(x - 3, bottom - 2, w + 6, 3)
  ctx.fillStyle = 'rgba(40,40,60,0.18)'
  ctx.fillRect(x - 3, bottom + 1, w + 6, 2)
  draw(ctx, open ? 'chest_open' : 'chest', x, y, { scale: s })
  // Crops already shipped peek out of the open lid.
  if (open && filled > 0) {
    ctx.fillStyle = '#94b85c'
    for (let i = 0; i < Math.min(4, filled); i++) ctx.fillRect(x + 5 + i * 4, y + 4, 3, 3)
  }
  // A little sign post to the right, so it reads as the shipping crate.
  const px = x + w + 3
  ctx.fillStyle = '#7a5236'
  ctx.fillRect(px + 4, bottom - 14, 2, 14)
  ctx.fillStyle = '#e6c08a'
  ctx.fillRect(px, bottom - 20, 10, 8)
  ctx.strokeStyle = '#7a4a2b'
  ctx.lineWidth = 1
  ctx.strokeRect(px + 0.5, bottom - 19.5, 9, 7)
  // An arrow on the sign: "in here".
  ctx.fillStyle = '#5a3520'
  ctx.fillRect(px + 2, bottom - 17, 4, 2)
  ctx.fillRect(px + 6, bottom - 18, 1, 4)
  ctx.restore()
}

// A thing on the farm and its click reaction (k is 0..1 through it, or -1).
function drawProp(ctx: CanvasRenderingContext2D, e: Engine, p: Prop, k: number, clock: number, alpha: number) {
  const x = p.x * TILE
  const y = p.y * TILE
  ctx.save()
  ctx.globalAlpha = alpha
  switch (p.kind) {
    case 'tree': {
      const shake = k >= 0 ? Math.sin(k * Math.PI * 6) * 2 * (1 - k) : 0
      draw(ctx, p.sprite, Math.round(x + shake), y - 8)
      if (k >= 0) pixel(ctx, 'fruit', x + 18, y + 6 + k * 18, 1 - Math.max(0, k - 0.8) * 5)
      break
    }
    case 'bush': {
      const shake = k >= 0 ? Math.sin(k * Math.PI * 8) * 1.5 * (1 - k) : 0
      draw(ctx, p.sprite, Math.round(x + shake), y)
      if (k >= 0) pixel(ctx, 'butterfly', x + 8 + k * 20, y - k * 26 + Math.sin(k * 20) * 2, 1 - k * 0.5)
      break
    }
    case 'sunflower': {
      const sway = k >= 0 ? Math.sin(k * Math.PI * 3) * 0.2 * (1 - k) : Math.sin(clock * 0.8) * 0.02
      ctx.translate(x + 8, y + 32)
      ctx.rotate(sway)
      draw(ctx, p.sprite, -8, -32)
      break
    }
    case 'well': {
      draw(ctx, p.sprite, x, y - 4)
      if (k >= 0)
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.5
          const d = k * 14
          ctx.fillStyle = `rgba(190,226,255,${1 - k})`
          ctx.fillRect(Math.round(x + 15 + Math.cos(a) * d), Math.round(y + 6 + Math.sin(a) * d + k * k * 10), 2, 2)
        }
      break
    }
    case 'house': {
      draw(ctx, p.sprite, x, y)
      if (k >= 0) for (let i = 0; i < 3; i++) pixel(ctx, 'smoke', x + 46 + i * 2, y + 4 - k * 18 - i * 6, (1 - k) * 0.9, 1 + k + i * 0.3)
      break
    }
    case 'chest': {
      const lifting = e.scrollsLifted > 0 || (e.phase === 'clarify' && e.head.scrollT > 0 && !e.out.clarify)
      const open = k >= 0 || lifting || (e.seedFly && e.seedFly.t > 0.8)
      draw(ctx, open ? 'chest_open' : 'chest', x, y)
      break
    }
    default: {
      const hop = k >= 0 ? Math.sin(k * Math.PI) * 3 : 0
      draw(ctx, p.sprite, x, y - hop)
    }
  }
  ctx.restore()
}

type EmoteKind = 'alert' | 'question' | 'sleep' | 'check' | 'cross'

// An emote drawn in world space, over a plot.
function worldEmote(ctx: CanvasRenderingContext2D, x: number, y: number, kind: EmoteKind, clock: number, pulse = false) {
  const name = `emote_${kind}`
  if (!hasFrame(name)) return
  const [, , w, h] = frameSize(name)
  const s = 0.55 * (pulse && !reduced ? 1 + Math.max(0, Math.sin(clock * 6)) * 0.15 : 1)
  draw(ctx, name, Math.round(x - (w * s) / 2), Math.round(y - h * s), { scale: s })
}

function px(r: Rect): Rect {
  return { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE }
}


export function fmtK(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k` : `${Math.round(n)}`
}

function headWaiting(e: Engine) {
  return e.activeAsk?.from === 'head' || e.replan?.status === 'open'
}

function headStatus(e: Engine) {
  if (e.phase === 'brief') return 'Waiting for your brief'
  if (e.headThinking > 0) return 'Thinking…'
  if (e.phase === 'clarify') return 'Has a few questions for you'
  if (e.phase === 'plan') return e.planReady ? 'Waiting for you to approve the plan' : 'Tilling a patch per task'
  if (e.openAsks.length) return `Relaying ${e.openAsks.length} ask${e.openAsks.length > 1 ? 's' : ''}`
  return 'Watching the crew'
}

function statsFor(e: Engine, name: string) {
  // Each farm shows the crew it runs: ours is the team template picked in the Brief.
  const s = { ...VALLEY_STATS[name], crew: name === FARM.name ? e.team.name : (VALLEY_CREWS[name] ?? '') }
  if (name === FARM.name) {
    s.energyWeek = e.energyUsed
    s.pests = e.tasks.reduce((n, t) => n + t.pests.length, 0)
    s.waiting = e.openAsks.length
    s.harvests = e.harvestReady ? 1 : 0
  }
  return s
}

const FONT = '"SproutLands", "JetBrains Mono", monospace'
const SANS = "'Atkinson Hyperlegible Next', system-ui, sans-serif"
const INK = '#241d33'
const FAIL = '#b0412e'
const OUT = '#2d5da8'

type Box = { x: number; y: number; w: number; h: number }
export type Glyph = { kind: 'work' } | { kind: 'sleep' } | { kind: 'ask'; reason: ReasonLabel }

// The one glyph over a farmhand. The engine's glyph, with the harvest's own moments on top:
// nothing while the crew carries crops in, a red cross on the farmhand whose code failed review.
function fhGlyph(e: Engine, fh: Farmhand): Glyph | null {
  if (e.phase === 'harvest') {
    if (e.harvestStage === 'map') return null
    if (fh.id === e.task(REVIEW_FAIL.taskId).assignee) {
      const s = e.fhStatus(fh)
      if (s.startsWith('Waiting for you')) return { kind: 'ask', reason: 'Failure' }
      if (s.startsWith('Fixing')) return { kind: 'work' }
    }
    if (fh.id === 'reviewer' && e.harvestGates.review.state === 'run') return { kind: 'work' }
  }
  const g = e.glyphOf(fh)
  return g ? (g.kind === 'ask' ? { kind: 'ask', reason: g.reason } : { kind: g.kind }) : null
}

// What the line under a farmhand says after its name: short, like the panel's rows.
function stateLine(e: Engine, fh: Farmhand): string {
  if (fh.paused) return 'Paused'
  if (fh.status === 'asking') return 'Needs you'
  if (e.phase === 'harvest' && fh.id === e.task(REVIEW_FAIL.taskId).assignee) {
    const s = e.fhStatus(fh)
    if (s.startsWith('Waiting for you')) return 'Waiting on you'
    if (s.startsWith('Fixing')) return s
  }
  if (fh.id === 'reviewer') {
    if (e.phase === 'harvest' && e.harvestGates.review.state === 'run') return 'Reviewing'
    if (e.phase !== 'harvest' && e.phase !== 'ship') return 'Reviews at the harvest'
  }
  if (e.carrying[fh.id] || (e.phase === 'harvest' && e.harvestStage === 'map')) return 'Harvesting'
  if (fh.status === 'done') return 'Done'
  const job = fh.job
  if (job?.kind === 'fix') return 'Fixing a test'
  const t = e.tasks.find((x) => x.assignee === fh.id && (job?.kind === 'sub' ? x.id === job.taskId : true))
  if (e.phase === 'plan') return t ? 'Up next' : 'No task'
  if (fh.moving && job) return 'On the way'
  if (fh.status === 'waiting') return 'Waiting'
  if (t) return e.taskStatus(t).text
  return 'Ready'
}

// One line under a farmhand in the panel's sans: the name in bold, a thin divider, then the state.
// Lines that would overlap move down until they clear the ones already placed.
function nameLine(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, state: string, alpha: number, placed: Box[], selected = false, align: 'center' | 'left' = 'center') {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `700 13px ${SANS}`
  const wName = Math.ceil(ctx.measureText(name).width)
  ctx.font = `400 13px ${SANS}`
  const wState = state ? Math.ceil(ctx.measureText(state).width) : 0
  const gap = 13
  const w = wName + (state ? gap + wState : 0) + 14
  const h = 20
  let rx = Math.round(align === 'center' ? x - w / 2 : x)
  rx = Math.max(4, Math.min(viewW - w - 4, rx))
  let ry = Math.round(y)
  const hit = (yy: number) => placed.some((r) => rx < r.x + r.w + 3 && rx + w + 3 > r.x && yy < r.y + r.h + 2 && yy + h + 2 > r.y)
  for (let n = 0; n < 4 && hit(ry); n++) ry += h + 2
  placed.push({ x: rx, y: ry, w, h })
  ctx.fillStyle = selected ? '#fff3c4' : 'rgba(255, 252, 242, 0.94)'
  ctx.strokeStyle = selected ? 'rgba(36, 29, 51, 0.55)' : 'rgba(36, 29, 51, 0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(rx + 0.5, ry + 0.5, w - 1, h - 1, 5)
  ctx.fill()
  ctx.stroke()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = `700 13px ${SANS}`
  ctx.fillText(name, rx + 7, ry + h / 2 + 0.5)
  if (state) {
    ctx.fillStyle = 'rgba(36, 29, 51, 0.22)'
    ctx.fillRect(rx + 7 + wName + Math.floor(gap / 2), ry + 5, 1, h - 10)
    ctx.fillStyle = state === 'Needs you' ? '#8a5410' : '#4a4358'
    ctx.font = `400 13px ${SANS}`
    ctx.fillText(state, rx + 7 + wName + gap, ry + h / 2 + 0.5)
  }
  ctx.restore()
}

// Glyphs drawn as small bitmaps, two screen pixels per bit. Shape carries the meaning.
const BITS: Record<string, string[]> = {
  question: ['.#####.', '##...##', '.....##', '....##.', '...##..', '...##..', '.......', '...##..', '...##..'],
  bang: ['..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '......', '..##..', '..##..'],
  cross: ['##...##', '###.###', '.#####.', '..###..', '.#####.', '###.###', '##...##'],
  coin: ['..#####..', '.##...##.', '##..#..##', '#..###..#', '#...#...#', '#..###..#', '##..#..##', '.##...##.', '..#####..'],
  envelope: ['#########', '##.....##', '#.#...#.#', '#..#.#..#', '#...#...#', '#.......#', '#########'],
  sleep: ['#####....', '...#.....', '..#..####', '.#.....#.', '#####.#..', '.....####'],
}

const pulses = new Map<string, { key: string; t: number }>()

// 0..1 through the one pulse a new glyph gets, or -1 once it holds still.
function glyphPulse(id: string, g: Glyph, clock: number) {
  const key = g.kind === 'ask' ? `ask:${g.reason}` : g.kind
  const p = pulses.get(id)
  if (!p || p.key !== key) {
    pulses.set(id, { key, t: clock })
    return g.kind === 'ask' ? 0 : -1
  }
  if (g.kind !== 'ask' || reduced) return -1
  const k = (clock - p.t) / 0.7
  return k >= 0 && k <= 1 ? k : -1
}

// The one glyph over a head: on a small light plate with a tail, its bottom at y.
function glyph(ctx: CanvasRenderingContext2D, x: number, y: number, g: Glyph, pulse: number, clock: number, alpha: number) {
  const s = pulse >= 0 ? 1 + 0.35 * Math.sin(pulse * Math.PI) : 1
  const size = 30
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(Math.round(x), Math.round(y - 6))
  ctx.scale(s, s)
  // Plate and tail.
  ctx.fillStyle = 'rgba(255, 252, 242, 0.96)'
  ctx.strokeStyle = 'rgba(36, 29, 51, 0.28)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(-size / 2 + 0.5, -size + 0.5, size - 1, size - 1, 8)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-4, -1)
  ctx.lineTo(0, 5)
  ctx.lineTo(4, -1)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-4, -0.5)
  ctx.lineTo(0, 5)
  ctx.lineTo(4, -0.5)
  ctx.stroke()
  const cy = -size / 2
  if (g.kind === 'work') {
    // Three dots taking turns to hop: working.
    ctx.fillStyle = INK
    for (let i = 0; i < 3; i++) {
      const hop = reduced ? 0 : Math.max(0, Math.sin(clock * 6 - i * 0.9)) * 3
      ctx.fillRect(-9 + i * 7, Math.round(cy + 1 - hop), 4, 4)
    }
  } else {
    const name = g.kind === 'sleep' ? 'sleep' : { Anomaly: 'question', Failure: 'cross', Risk: 'bang', Cost: 'coin', Irreversible: 'envelope' }[g.reason]
    const rows = BITS[name]
    ctx.fillStyle = g.kind === 'ask' && g.reason === 'Failure' ? FAIL : g.kind === 'ask' && g.reason === 'Irreversible' ? OUT : INK
    const u = 2
    const bw = rows[0].length * u
    const bh = rows.length * u
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') ctx.fillRect(Math.round(-bw / 2) + i * u, Math.round(cy - bh / 2) + j * u, u, u)
    })
  }
  ctx.restore()
}

function banner(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size = 20) {
  ctx.save()
  ctx.font = `${size}px ${FONT}`
  const w = Math.ceil(ctx.measureText(text).width) + 22
  const rx = Math.round(x - w / 2)
  const ry = Math.round(y - 12)
  ctx.fillStyle = '#c99a5b'
  ctx.fillRect(rx, ry, w, 22)
  ctx.fillStyle = '#e6c08a'
  ctx.fillRect(rx + 2, ry + 2, w - 4, 16)
  ctx.strokeStyle = '#7a4a2b'
  ctx.lineWidth = 2
  ctx.strokeRect(rx + 1, ry + 1, w - 2, 20)
  ctx.fillStyle = '#5a3520'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, Math.round(x), ry + 10)
  ctx.restore()
}

function valleyCard(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, s: ReturnType<typeof statsFor>) {
  ctx.save()
  const lines = [
    ...(s.crew ? [`Crew: ${s.crew}`] : []),
    `${s.agents} agents, ${s.waiting} waiting on a human`,
    ...(s.unattended ? [s.unattended] : []),
  ]
  ctx.font = `15px ${FONT}`
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 160) + 28
  const h = 36 + lines.length * 17
  const rx = Math.round(x - w / 2)
  const ry = Math.round(y - h / 2)
  ctx.fillStyle = 'rgba(62,49,80,0.25)'
  ctx.fillRect(rx + 4, ry + 4, w, h)
  ctx.fillStyle = '#fbf6df'
  ctx.fillRect(rx, ry, w, h)
  ctx.strokeStyle = '#5c4e92'
  ctx.lineWidth = 2
  ctx.strokeRect(rx + 1, ry + 1, w - 2, h - 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#3e3150'
  ctx.font = `22px ${FONT}`
  ctx.fillText(name, rx + 14, ry + 10)
  ctx.font = `15px ${FONT}`
  lines.forEach((l, i) => ctx.fillText(l, rx + 14, ry + 34 + i * 17))
  ctx.restore()
}

// ---- camera ----------------------------------------------------------------------------

// `inset` is the screen height the HUD covers at the top; the target is framed below it.
// With `integer`, the zoom is a whole number from 2 to 4, so the pixel art stays crisp and a farmhand is 48 to 64 px tall at 3x and 4x.
export function fitCamera(target: Rect, W: number, H: number, inset = 0, integer = false): Camera {
  const fit = Math.min(W / (target.w * TILE), (H - inset) / (target.h * TILE))
  const scale = integer ? Math.max(2, Math.min(4, Math.floor(fit + 0.02))) : fit
  const cx = (target.x + target.w / 2) * TILE
  const cy = (target.y + target.h / 2) * TILE - inset / 2 / scale
  // Keep the view inside the world so no empty margin shows; centre if the world is smaller.
  const clamp = (v: number, view: number, world: number) => (view >= world ? (world - view) / 2 : Math.max(0, Math.min(world - view, v)))
  return {
    scale,
    x: clamp(cx - W / 2 / scale, W / scale, WORLD.w * TILE),
    // The world's top edge may sit just under the HUD, never further down.
    y: H / scale >= WORLD.h * TILE ? (WORLD.h * TILE - H / scale) / 2 : Math.max(-inset / scale, Math.min(WORLD.h * TILE - H / scale, cy - H / 2 / scale)),
  }
}

// Keep a dragged camera over the world.
export function clampCamera(c: Camera, W: number, H: number): Camera {
  const vw = W / c.scale
  const vh = H / c.scale
  const ww = WORLD.w * TILE
  const wh = WORLD.h * TILE
  const clamp = (v: number, view: number, world: number) => (view >= world ? (world - view) / 2 : Math.max(0, Math.min(world - view, v)))
  return { scale: c.scale, x: clamp(c.x, vw, ww), y: clamp(c.y, vh, wh) }
}

export type { Task }

// ---- ship: the cart ------------------------------------------------------------------

function cartSpot(e: Engine): { x: number; y: number } | null {
  const c = e.cart
  // The crates wait on the cart at the barn while you review the harvest.
  if (c.state === 'none') return e.phase === 'harvest' && e.harvestStage === 'review' ? cartBarn() : null
  if (c.state === 'loaded') return cartBarn()
  if (c.state === 'gate') return cartGate()
  if (c.state === 'back') return cartBack(c.k)
  return c.k >= 1 ? null : cartOut(c.k)
}

// A small wooden cart with the harvested crates on it. On a rollback the crow sits on it.
function drawCart(ctx: CanvasRenderingContext2D, tx: number, ty: number, crow: boolean, clock: number) {
  const x = Math.round(tx * TILE - 14)
  const bottom = Math.round(ty * TILE)
  ctx.save()
  ctx.fillStyle = 'rgba(40,40,60,0.18)'
  ctx.fillRect(x - 1, bottom - 1, 30, 3)
  // Bed and rails.
  ctx.fillStyle = '#7a5236'
  ctx.fillRect(x, bottom - 12, 28, 7)
  ctx.fillStyle = '#9a6a44'
  ctx.fillRect(x + 1, bottom - 11, 26, 2)
  // Crates on the bed.
  draw(ctx, 'chest', x + 2, bottom - 24, { scale: 0.75 })
  draw(ctx, 'chest', x + 14, bottom - 24, { scale: 0.75 })
  // Wheels.
  ctx.fillStyle = '#4a3222'
  for (const wx of [x + 6, x + 22]) {
    ctx.beginPath()
    ctx.arc(wx, bottom - 4, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#c99a5b'
  for (const wx of [x + 6, x + 22]) ctx.fillRect(wx - 1, bottom - 5, 2, 2)
  if (crow) {
    const img = pixelSprite('crow0')
    ctx.drawImage(img, x + 6, bottom - 40, 20, 20)
    if (hasFrame('emote_question')) draw(ctx, 'emote_question', x + 10, bottom - 56 + (reduced ? 0 : Math.round(Math.sin(clock * 4))), { scale: 0.6 })
  }
  ctx.restore()
}
