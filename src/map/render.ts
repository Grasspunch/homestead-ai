// Draws the valley. The map shows state at a glance; every decision lives in the quest log.
import { draw, frame as frameSize, hasFrame, animCounts, pixelSprite } from './atlas'
import { cropTiles, type Engine } from '../sim/engine'
import { CLASH, CROW_SPOT, FARM, ROADS, type ValleyState, MISSING, SIGNS, NEIGHBOUR, NEIGHBOUR_PLOTS, OTHER_FARMS, PROPS, TILE, VALLEY_STATS, WORLD, type Prop } from '../sim/scenario'
import type { Dir, Farmhand, ReasonLabel, Rect, RoleId, Task } from '../sim/types'
import { usd } from '../sim/settings'
import type { FieldSlot } from '../sim/scenario'
import { NEIGHBOUR_CREWS } from '../sim/templates'
import { HARVEST_FAIL } from '../sim/review'
import { cartBack, cartBarn, cartGate, cartOut } from '../sim/ship'

export interface Camera {
  x: number // world px at screen left
  y: number
  scale: number
}

export interface Hit {
  kind: 'plot' | 'farmhand' | 'head' | 'signpost' | 'pest' | 'crow' | 'neighbour' | 'nplot' | 'farm' | 'prop' | 'chicken' | 'sign' | 'crate' | 'helper' | 'field'
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

// Smooth 2D value noise, 0..1.
function noise2(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx
  const b = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx
  return a * (1 - sy) + b * sy
}

// Worn dirt paths, painted pixel by pixel onto a canvas: soft wandering edges, rounded inside
// corners where paths meet, a shadow lip on the low side, specks, pebbles and grass at the edges.
// rects are in tiles, in world coordinates; origin is where world (0, 0) sits on this canvas, in px.
export function drawPaths(ctx: CanvasRenderingContext2D, rects: Rect[], origin = { x: 0, y: 0 }, round = 6) {
  if (!rects.length) return
  const T = TILE
  const m = round + 4
  // Work only inside the rects' bounds on this canvas.
  const bx0 = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.x)) * T + origin.x - m))
  const by0 = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.y)) * T + origin.y - m))
  const bx1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...rects.map((r) => r.x + r.w)) * T + origin.x + m))
  const by1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...rects.map((r) => r.y + r.h)) * T + origin.y + m))
  const W = bx1 - bx0
  const H = by1 - by0
  if (W <= 0 || H <= 0) return
  const ox = origin.x - bx0 // world px -> local px
  const oy = origin.y - by0
  let mask = new Uint8Array(W * H)
  rects.forEach((r, k) => {
    const s0 = (k + 1) * 31
    const x0 = r.x * T
    const x1 = (r.x + r.w) * T
    const y0 = r.y * T
    const y1 = (r.y + r.h) * T
    for (let y = Math.max(0, Math.floor(y0 + oy - 2)); y < Math.min(H, Math.ceil(y1 + oy + 2)); y++)
      for (let x = Math.max(0, Math.floor(x0 + ox - 2)); x < Math.min(W, Math.ceil(x1 + ox + 2)); x++) {
        const wx = x - ox
        const wy = y - oy
        if (wx < x0 + Math.round(wander(s0, wy / 6) * 1.5)) continue
        if (wx >= x1 + Math.round(wander(s0 + 1, wy / 6) * 1.5)) continue
        if (wy < y0 + Math.round(wander(s0 + 2, wx / 6) * 1.5)) continue
        if (wy >= y1 + Math.round(wander(s0 + 3, wx / 6) * 1.5)) continue
        mask[y * W + x] = 1
      }
  })
  // Round the inside corners where paths meet: a closing (grow by round, then shrink by round).
  const dist = (src: Uint8Array, want: number) => {
    // Chamfer distance (in px) from each pixel to the nearest pixel whose value is want.
    const d = new Float32Array(W * H)
    const INF = 1e6
    for (let i = 0; i < W * H; i++) d[i] = src[i] === want ? 0 : INF
    const D = Math.SQRT2
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        let v = d[i]
        if (x > 0) v = Math.min(v, d[i - 1] + 1)
        if (y > 0) {
          v = Math.min(v, d[i - W] + 1)
          if (x > 0) v = Math.min(v, d[i - W - 1] + D)
          if (x < W - 1) v = Math.min(v, d[i - W + 1] + D)
        }
        d[i] = v
      }
    for (let y = H - 1; y >= 0; y--)
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x
        let v = d[i]
        if (x < W - 1) v = Math.min(v, d[i + 1] + 1)
        if (y < H - 1) {
          v = Math.min(v, d[i + W] + 1)
          if (x < W - 1) v = Math.min(v, d[i + W + 1] + D)
          if (x > 0) v = Math.min(v, d[i + W - 1] + D)
        }
        d[i] = v
      }
    return d
  }
  if (round > 0) {
    const toDirt = dist(mask, 1)
    const grown = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) grown[i] = toDirt[i] <= round ? 1 : 0
    const toGrass = dist(grown, 0)
    const closed = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) closed[i] = mask[i] || toGrass[i] > round ? 1 : 0
    // Keep the edges at the bounds square: a path that runs off the canvas stays open.
    mask = closed
  }

  const img = ctx.getImageData(bx0, by0, W, H)
  const d = img.data
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 1 : mask[y * W + x])
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
      const wx = x - ox
      const wy = y - oy
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)
      let c = BASE
      // Worn patches: a slow wash a shade darker.
      if (noise2(wx / 13, wy / 9) > 0.7) c = SPECK
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
  const g0x = Math.floor(-ox / 9) * 9 + ox
  const g0y = Math.floor(-oy / 9) * 9 + oy
  for (let cy = g0y - 9 * Math.ceil(g0y / 9); cy < H; cy += 9)
    for (let cx = g0x - 9 * Math.ceil(g0x / 9); cx < W; cx += 9) {
      const wx = cx - ox
      const wy = cy - oy
      const h = hash(wx * 13 + 5, wy * 17 + 3)
      if (h > 0.13) continue
      const x = cx + Math.floor(hash(wx, wy + 1) * 6)
      const y = cy + Math.floor(hash(wx + 1, wy) * 6)
      let ok = true
      for (let j = -2; j < 5 && ok; j++) for (let i = -2; i < 5 && ok; i++) if (x + i < 0 || y + j < 0 || x + i >= W || y + j >= H || !mask[(y + j) * W + x + i]) ok = false
      if (!ok) continue
      const wide = h < 0.06
      put(x, y, 0xf3e6c8)
      put(x + 1, y, 0xcfb084)
      if (wide) put(x + 2, y, 0xcfb084)
      put(x, y + 1, 0xcfb084)
      put(x + 1, y + 1, 0xb8966a)
      if (wide) put(x + 2, y + 1, 0xb8966a)
    }
  ctx.putImageData(img, bx0, by0)
}

// The region's roads: north-south and east-west between the valleys, out past the world's edges,
// and a short spur from each valley gate to its road. All in tiles.
export function roadRects(): Rect[] {
  const big = PAD + 2
  const out: Rect[] = [
    { x: ROADS.x, y: -big, w: ROADS.width, h: WORLD.h + big * 2 },
    { x: -big, y: ROADS.y, w: WORLD.w + big * 2, h: ROADS.width },
  ]
  const half = 14 / TILE
  const rx0 = ROADS.x
  const rx1 = ROADS.x + ROADS.width
  const ry0 = ROADS.y
  const ry1 = ROADS.y + ROADS.width
  for (const g of farmGates()) {
    const r = g.rect
    const c = g.at + 0.5
    // From one tile inside the gate to the road.
    if (g.side === 'e') out.push({ x: r.x + r.w - 2 + 0.125, y: c - half, w: rx0 - (r.x + r.w - 2 + 0.125), h: half * 2 })
    if (g.side === 'w') out.push({ x: rx1, y: c - half, w: r.x + 1 - 0.125 - rx1, h: half * 2 })
    if (g.side === 's') out.push({ x: c - half, y: r.y + r.h - 2 + 0.125, w: half * 2, h: ry0 - (r.y + r.h - 2 + 0.125) })
    if (g.side === 'n') out.push({ x: c - half, y: ry1, w: half * 2, h: r.y + 1 + 0.875 - ry1 })
  }
  return out
}

// Farm fences and their gates. The gates face the lanes.
function farmGates() {
  const out: { rect: Rect; side: 'w' | 'e' | 's' | 'n'; at: number }[] = []
  for (const fm of farmFences()) for (const g of fm.gates) out.push({ rect: fm.rect, side: g.side, at: g.at })
  return out
}

function farmFences() {
  const [bl, br] = OTHER_FARMS
  const ours = FARM.rect
  const nb = NEIGHBOUR.rect
  return [
    { rect: ours, gates: [{ side: 'e' as const, at: ours.y + 10 }, { side: 's' as const, at: ours.x + 17 }] },
    { rect: nb, gates: [{ side: 'w' as const, at: nb.y + 10 }, { side: 's' as const, at: nb.x + 17 }] },
    { rect: bl.rect, gates: [{ side: 'e' as const, at: bl.rect.y + 6 }, { side: 'n' as const, at: bl.rect.x + 17 }] },
    { rect: br.rect, gates: [{ side: 'w' as const, at: br.rect.y + 6 }, { side: 'n' as const, at: br.rect.x + 17 }] },
  ]
}

// Past the padded ground (only very tall or wide windows get there) the roads carry on:
// a stretch of each road is cut from the ground and repeated out to the edge of the view.
function extendRoads(ctx: CanvasRenderingContext2D, ground: HTMLCanvasElement, cam: Camera, W: number, H: number) {
  const T = TILE
  const P = PAD * T
  const vx0 = cam.x
  const vy0 = cam.y
  const vx1 = cam.x + W / cam.scale
  const vy1 = cam.y + H / cam.scale
  const seg = 64
  // North-south road: its stretch from the top of the padding.
  const sx = (ROADS.x - 1) * T
  const sw = (ROADS.width + 2) * T
  for (const [from, to] of [[vy0, -P], [WORLD.h * T + P, vy1]] as const)
    for (let y = from < 0 ? -P - seg : WORLD.h * T + P; from < 0 ? y + seg > from : y < to; y += from < 0 ? -seg : seg)
      ctx.drawImage(ground, sx + P, 2 * T, sw, seg, sx, y, sw, seg)
  // East-west road: its stretch from the left of the padding.
  const sy = (ROADS.y - 1) * T
  const sh = (ROADS.width + 2) * T
  for (const [from, to] of [[vx0, -P], [WORLD.w * T + P, vx1]] as const)
    for (let x = from < 0 ? -P - seg : WORLD.w * T + P; from < 0 ? x + seg > from : x < to; x += from < 0 ? -seg : seg)
      ctx.drawImage(ground, 2 * T, sy + P, seg, sh, x, sy, seg, sh)
}

// Fields in the neighbouring valleys, in world tiles. The Staff schedule fields are drawn live
// (one of them dries up in the story); the others are painted once.
function regionFields() {
  const out: { plot: Rect; crop: string; stage: number; drawn: boolean }[] = []
  for (const np of NEIGHBOUR_PLOTS) out.push({ plot: np.plot, crop: np.crop, stage: np.stage, drawn: true })
  for (const o of OTHER_FARMS)
    for (const fd of o.fields) out.push({ plot: { x: o.rect.x + fd.x, y: o.rect.y + fd.y, w: fd.w, h: fd.h }, crop: fd.crop, stage: fd.stage, drawn: false })
  return out
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
  drawPaths(g.ctx, roadRects(), { x: PAD * TILE, y: PAD * TILE }, 7)
  g.ctx.translate(PAD * TILE, PAD * TILE)
  drawPond(g.ctx, 0)
  // Flowers in the grass.
  draw(g.ctx, 'flower_1', 8 * TILE, 21.5 * TILE)
  draw(g.ctx, 'flower_4', 30.5 * TILE, 21.5 * TILE)
  draw(g.ctx, 'flower_6', 4 * TILE, 20 * TILE)

  // The neighbouring valleys' fields: a bed of crops each, fenced, with a gate on the low side.
  for (const fd of regionFields()) {
    if (!fd.drawn) {
      bed(g.ctx, fd.plot, false)
      for (let j = 0; j < fd.plot.h; j++) for (let i = 0; i < fd.plot.w; i++) draw(g.ctx, `crop_${fd.crop}_${fd.stage}`, (fd.plot.x + i) * TILE, (fd.plot.y + j) * TILE)
    }
  }
  const f = layer()
  for (const fm of farmFences()) fenceRect(f.ctx, fm.rect, fm.gates)
  for (const fd of regionFields()) fenceRect(f.ctx, { x: fd.plot.x - 2, y: fd.plot.y - 2, w: fd.plot.w + 4, h: fd.plot.h + 4 }, [{ side: 's', at: fd.plot.x + Math.floor(fd.plot.w / 2) }])

  const b = layer(PAD)
  // Trees along the valley edge.
  // Trees along the region's edges and the roadsides, past the world too, so the edge never looks cut.
  const trees: [string, number, number][] = []
  for (let y = -PAD; y < WORLD.h + PAD; y += 3)
    for (let x = -PAD; x < WORLD.w + PAD; x += 3) {
      const inside = x > -2 && y > -2 && x < WORLD.w && y < WORLD.h - 1
      const road = (x + 2 > ROADS.x - 1 && x < ROADS.x + ROADS.width + 1) || (y + 1 > ROADS.y - 1 && y - 1 < ROADS.y + ROADS.width + 1)
      if (inside || road) continue
      const n = hash(x * 7 + 3, y * 11 + 5)
      if (n < 0.55) trees.push([n < 0.15 ? 'tree_big' : n < 0.35 ? 'tree' : 'tree_small', x + n * 1.5, y + hash(x, y) * 1.5])
    }
  for (const [n, x, y] of trees) draw(b.ctx, n, (x + PAD) * TILE, (y + PAD) * TILE - 8)
  b.ctx.translate(PAD * TILE, PAD * TILE)
  // The garden valley keeps flowers by its house; the orchard valley keeps rows of fruit trees.
  const garden = OTHER_FARMS[0]
  for (let i = 0; i < 6; i++) draw(b.ctx, `flower_${(i * 5) % 12}`, (garden.house.x + i * 0.9) * TILE, (garden.house.y + 4.6 + (i % 2) * 0.4) * TILE)
  const orchard = OTHER_FARMS[1].rect
  const fruit = ['tree_apple', 'tree_orange', 'tree_pear', 'tree_peach']
  for (let y = orchard.y + 8; y < orchard.y + orchard.h - 3; y += 4)
    for (let x = orchard.x + 21; x < orchard.x + orchard.w - 3; x += 4) draw(b.ctx, fruit[(x + y) % 4], x * TILE, y * TILE - 8)
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
  extendRoads(ctx, L.ground, cam, W, H)
  drawPond(ctx, Math.floor(clock * 2.5) % 4)
  ctx.globalAlpha = fade(0.35)
  ctx.drawImage(L.fences, 0, 0)
  const built = fade(0.7)
  ctx.globalAlpha = built
  ctx.drawImage(L.buildings, -PAD * TILE, -PAD * TILE)
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
    hits.push({ kind: 'nplot', id: np.name, rect: px(np.plot), title: np.name, body: `${NEIGHBOUR.name}${dry ? `. ${CLASH.change}` : ''}` })
  }

  // Two pages share this map. The valley page shows each field as its agent, one big character standing on it.
  // A farm page is one agent's field, filling the view with its plots, its farmhand and its helpers.
  const farmPage = e.view === 'farm' && e.fieldPage ? e.fieldOf(e.fieldPage) : null
  const big = e.view === 'farm' && !farmPage
  // During an ask (or the re-plan it leads to), only the asking agent's field stays lit, with the crow.
  const focusField = farmPage ? null : focusOf(e)
  const focusRoles: RoleId[] = focusField?.roles ?? []
  const fieldTasks = (f: FieldSlot) => e.tasks.filter((t) => f.roles.includes(t.assignee))
  const fieldDone = (f: FieldSlot) => planned && fieldTasks(f).length > 0 && fieldTasks(f).every((t) => e.taskRipe(t)) && !(e.phase === 'harvest' && e.harvestStage === 'map')

  // Plots. During Plan the head farmer tills them one by one. Finished plots fade back.
  const drawPlot = (t: Task, i: number, again = false) => {
    const r = t.plot
    const bedRect = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }
    let shown = planned
    ctx.save()
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
      if (em) worldEmote(ctx, (bedRect.x + bedRect.w / 2) * TILE, sy + 6, em, clock)
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
    const cost = `${fmtK(t.used)} tokens, $${usd(t.used, e.settings).toFixed(2)}`
    hits.push({
      kind: 'plot',
      id: t.id,
      rect: px(r),
      title: t.name,
      body: planned ? `${e.farmhands[t.assignee].role}. ${st.text}. ${cost}.` : `Proposed for ${e.farmhands[t.assignee].role}`,
    })
  }

  // Dependencies between agents are paths between fields: dotted while waiting, solid once the upstream draft is ready.
  if (planning || planned) drawDeps(ctx, e)

  // The fields: one per agent, fenced in its colours, with its plots and the files, skills and tools on its top rail.
  const drawField = (f: FieldSlot, again = false) => {
    const r = f.rect
    ctx.save()
    if (!again && !farmPage && fieldDone(f)) ctx.globalAlpha *= 0.6
    fieldFence(ctx, r, f.style.fence)
    if (big) {
      // One patch of the field's crop, as ripe as its least-grown task, for the big character to stand on.
      const ts = fieldTasks(f)
      if (ts.length && (planning || planned)) {
        const patch = { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: 2 }
        bed(ctx, patch, false)
        if (planned) {
          const p = Math.min(...ts.map((t) => (e.taskRipe(t) ? 1 : t.subtasks.reduce((n, x) => n + (x.done ? 1 : x.progress), 0) / t.subtasks.length)))
          const st = p >= 1 ? 3 : p > 0.55 ? 2 : p > 0 ? 1 : 0
          for (let j = 0; j < patch.h; j++) for (let i = 0; i < patch.w; i++) draw(ctx, `crop_${ts[0].crop}_${st}`, (patch.x + i) * TILE, (patch.y + j) * TILE)
        }
      }
      ctx.restore()
      if (!again) hits.push({ kind: 'field', id: f.id, rect: px(r), title: f.name, body: f.roles.length ? 'Open this farm' : 'No task in this plan' })
      return
    }
    if (planning || planned) {
      const posts: { t: Task; s: string; missing?: boolean }[] = []
      for (const t of fieldTasks(f)) {
        for (const sp of t.signposts) if (!posts.some((p) => p.s === sp)) posts.push({ t, s: sp })
        if (replay && t.id === MISSING.taskId && !t.signposts.includes(MISSING.file)) posts.push({ t, s: MISSING.file, missing: true })
      }
      const step = Math.min(0.75, (r.w - 2.4) / Math.max(1, posts.length))
      posts.forEach((p, k) => {
        const px0 = Math.round((r.x + r.w - 1.15 - k * step) * TILE)
        const py0 = Math.round((r.y - 0.85) * TILE)
        if (p.missing) {
          // The missing file: what this agent never saw.
          ctx.save()
          ctx.globalAlpha *= 0.5 + 0.3 * Math.sin(clock * 5)
          ctx.strokeStyle = '#d9715f'
          ctx.strokeRect(px0 + 1.5, py0 + 1.5, 13, 13)
          ctx.restore()
          return
        }
        const kind = e.lib(p.s).kind
        draw(ctx, 'sign_blank', px0, py0)
        if (kind === 'tool') {
          // An MCP tool: a small teal plate on the sign, so tools read apart from files and skills.
          ctx.fillStyle = '#2f6b5e'
          ctx.fillRect(px0 + 5, py0 + 4, 6, 4)
        }
        const verb = kind === 'tool' ? 'Called by' : kind === 'skill' ? 'Used by' : 'Read by'
        const added = p.s === MISSING.file && e.flags.has('replanApplied')
        if (!again) hits.push({ kind: 'signpost', id: `${p.t.id}:${p.s}`, rect: { x: px0, y: py0, w: 16, h: 16 }, title: p.s, body: added ? 'Added by the re-plan' : `${verb} ${f.name}` })
      })
    }
    e.tasks.forEach((t, i) => {
      if (f.roles.includes(t.assignee)) drawPlot(t, i, again)
    })
    ctx.restore()
    if (!again) hits.push({ kind: 'field', id: f.id, rect: px(r), title: f.name, body: fieldTasks(f).length ? fieldTasks(f).map((t) => t.name).join(', ') : 'No task in this plan' })
  }
  for (const f of e.fields) drawField(f)
  // A task whose agent has no field of its own still gets its plot.
  e.tasks.forEach((t, i) => {
    if (!e.fieldOf(t.assignee)) drawPlot(t, i)
  })
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

  // The shipping crate in front of the barn, where the harvest waits for the cart. Same size as the other props.
  const sh = FARM.shipping
  const shipK = reactK(e.pokes.shipping, clock)
  const shipOpen = shipK >= 0 || (e.phase === 'harvest' && e.harvestStage === 'map')
  list.push({ y: sh.y + 0.55, fn: () => drawCrate(ctx, sh.x, sh.y, shipOpen, e.picked.size) })
  hits.push({ kind: 'crate', id: 'shipping', rect: { x: sh.x * TILE - 10, y: sh.y * TILE - 6, w: 20, h: 16 }, title: 'Shipping crate', body: 'Ripe crops wait here for the cart.' })

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
      drawChar(ctx, hf.x, hf.y, hf.anim, dir, clock, undefined, 1)
    },
  })
  hits.push({ kind: 'head', id: 'head', rect: { x: hf.x * TILE - 8, y: hf.y * TILE - 18, w: 16, h: 20 }, title: 'Head farmer', body: headStatus(e) })

  for (const fh of Object.values(e.farmhands)) {
    if (fh.inside || (big && e.fieldOf(fh.id) && !e.carrying[fh.id]) || (big && onAField(e, fh))) continue
    list.push({ y: fh.y, fn: () => drawFarmhand(ctx, e, fh, clock) })
    // The hit box is the body; collision elsewhere uses only the feet.
    hits.push({ kind: 'farmhand', id: fh.id, rect: { x: fh.x * TILE - 8, y: fh.y * TILE - 18, w: 16, h: 20 }, title: fh.role, body: e.fhStatus(fh) })
  }

  // Helpers: a subagent the agent started, smaller, at the other end of the plot. It leaves when its subtask is done.
  if (!big)
    for (const t of e.tasks) {
      const sub = e.helperOn(t)
      if (!sub) continue
      const fh = e.farmhands[t.assignee]
      const left = fh.x > t.plot.x + t.plot.w / 2
      const hx = left ? t.plot.x + 0.35 : t.plot.x + t.plot.w - 0.35
      const hy = t.plot.y + t.plot.h + 0.55
      list.push({ y: hy, fn: () => drawSmallChar(ctx, hx, hy, 'water', 'up', clock + 1.7, { body: fh.color, shade: fh.colorDark }, 0.7) })
      hits.push({ kind: 'helper', id: `${t.id}:helper`, rect: { x: hx * TILE - 6, y: hy * TILE - 13, w: 12, h: 14 }, title: `${fh.role}'s helper`, body: `A subagent working on ${sub.name}. It leaves when that's done.` })
    }
  // An agent with no builder role in this crew still stands on its field.
  if (!big && (planning || planned))
    for (const f of e.fields) {
      if (f.roles.length) continue
      const x = f.rect.x + f.rect.w / 2
      const y = f.rect.y + 4.55
      list.push({ y, fn: () => drawChar(ctx, x, y, 'idle', 'down', clock + f.rect.x, { body: f.style.body, shade: f.style.shade }, 0.85) })
    }

  // The neighbouring valleys' crews: one farmhand per field, working along it in a loop.
  // In the region view their head farmers stand big in the middle instead (drawn later, on screen).
  const region = e.view === 'valley'
  const lead = { x: NEIGHBOUR.house.x - 1.5 + Math.sin(clock * 0.3) * 0.4, y: NEIGHBOUR.house.y + 5.6 }
  if (!region) {
    list.push({ y: lead.y, fn: () => drawChar(ctx, lead.x, lead.y, 'idle', 'down', clock, { body: '#d7c6f0', shade: '#a596c9' }) })
    hits.push({ kind: 'neighbour', id: 'lead', rect: { x: lead.x * TILE - 8, y: lead.y * TILE - 18, w: 16, h: 20 }, title: `${NEIGHBOUR.name} head farmer`, body: NEIGHBOUR.team })
  }
  const crews = [
    { tint: { body: '#c9d3dc', shade: '#9aa6b2' }, plots: NEIGHBOUR_PLOTS.map((np) => np.plot) },
    ...OTHER_FARMS.map((o, oi) => ({
      tint: oi === 0 ? { body: '#e7dcc4', shade: '#c4b79a' } : { body: '#d9e6c4', shade: '#aebd96' },
      plots: o.fields.map((fd) => ({ x: o.rect.x + fd.x, y: o.rect.y + fd.y, w: fd.w, h: fd.h })),
    })),
  ]
  crews.forEach((c, ci) =>
    c.plots.forEach((plot, i) => {
      const pose = fieldWork(plot, clock, ci * 5 + i)
      list.push({ y: pose.y, fn: () => drawChar(ctx, pose.x, pose.y, pose.anim, pose.dir, clock + i, c.tint) })
    }),
  )

  // Chickens. Clicked: a heart over it, no hop. Three clicks and it runs off.
  e.chickens.forEach((c, i) => {
    const k = reactK(e.pokes[`chicken-${i}`], clock)
    const hop = 0
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

  // A farm page: everything outside the one field sits under a solid veil, so the field reads as its own page.
  if (farmPage) {
    const r = farmPage.rect
    ctx.save()
    ctx.fillStyle = 'rgba(52, 44, 62, 0.72)'
    ctx.beginPath()
    ctx.rect(-PAD * TILE, -PAD * TILE, (WORLD.w + PAD * 2) * TILE, (WORLD.h + PAD * 2) * TILE)
    ctx.rect((r.x - 0.25) * TILE, (r.y - 1.1) * TILE, (r.w + 0.5) * TILE, (r.h + 1.35) * TILE)
    ctx.fill('evenodd')
    ctx.restore()
  }

  // Focus on an ask: a dark veil over the valley, then the asking field and its farmhand again on top.
  if (focusField) {
    ctx.save()
    ctx.fillStyle = 'rgba(46, 36, 58, 0.42)'
    ctx.fillRect(-PAD * TILE, -PAD * TILE, (WORLD.w + PAD * 2) * TILE, (WORLD.h + PAD * 2) * TILE)
    ctx.restore()
    drawField(focusField, true)
    if (!big)
      for (const r of focusRoles) {
        const ffh = e.farmhands[r]
        if (!ffh.inside) drawFarmhand(ctx, e, ffh, clock)
      }
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
      const ours = e.task(e.activeAsk?.taskId ?? MISSING.taskId).plot
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

  if (e.view === 'farm') {
    const placed: Box[] = []
    const dimOf = (id: RoleId | 'head') => (focusField && !(id !== 'head' && focusRoles.includes(id)) ? 0.45 : 1)
    // Each field's name on a plate over its top rail at the left, with a bar in the field's colour.
    for (const f of e.fields) {
      if (farmPage && f !== farmPage) continue
      const p = toScreen(f.rect.x + 0.1, f.rect.y + 0.25)
      if (p.x > W || p.y > H || p.x < -200 || p.y < -40) continue
      p.y -= 11
      const a = (focusField && focusField !== f ? 0.45 : 1) * (fieldDone(f) && !farmPage ? 0.75 : 1)
      nameLine(ctx, p.x, p.y, f.name, '', a, placed, false, 'left', f.style.fence)
    }
    // Zoomed out: one big character per field is the field's status.
    if (big)
      for (const f of e.fields) {
        const st = fieldState(e, f)
        const feet = toScreen(f.rect.x + f.rect.w / 2, f.rect.y + 4.7)
        if (feet.x < -40 || feet.x > W + 40 || feet.y < 0 || feet.y > H + 300) continue
        const S = Math.max(4, Math.min(6, Math.round(cam.scale * 2.5)))
        const key = `${f.id}:${st.state}`
        const prev = bigSince.get(f.id)
        if (!prev || prev.key !== key) bigSince.set(f.id, { key, t: clock })
        const a = focusField && focusField !== f ? 0.45 : 1
        ctx.save()
        ctx.globalAlpha = a
        drawBigChar(ctx, Math.round(feet.x), Math.round(feet.y), st.state, f.roles.length ? { body: e.farmhands[f.roles[0]].color, shade: e.farmhands[f.roles[0]].colorDark } : { body: f.style.body, shade: f.style.shade }, clock, S, { reason: st.reason, age: clock - bigSince.get(f.id)!.t, anim: st.anim })
        ctx.restore()
        hits.push({ kind: 'field', id: f.id, rect: { x: (f.rect.x + 0.5) * TILE, y: (f.rect.y + 0.2) * TILE, w: (f.rect.w - 1) * TILE, h: (f.rect.h - 0.2) * TILE }, title: f.name, body: `${st.words}. ${f.roles.length ? 'Click to open this farm.' : ''}` })
        nameLine(ctx, feet.x, feet.y + 4, f.name, st.words, a, placed)
      }
    // The head farmer: its line, and the ask glyph when the ask is its own.
    const hfeet = toScreen(hf.x, hf.y)
    const inView = (p: { x: number; y: number }) => p.x > 0 && p.x < W && p.y > 0 && p.y < H + 24
    if (!farmPage && inView(hfeet)) {
      const asking = headWaiting(e)
      const g: Glyph | null = asking ? { kind: 'ask', reason: e.activeAsk?.from === 'head' ? e.activeAsk.label : 'Anomaly' } : e.headThinking > 0 ? { kind: 'work' } : null
      const a = dimOf('head')
      if (g) glyph(ctx, hfeet.x, hfeet.y - (HEAD + 2) * cam.scale, g, glyphPulse('head', g, clock), clock, a)
      nameLine(ctx, hfeet.x, hfeet.y + 3, 'Head farmer', asking ? 'Needs you' : '', a, placed)
    }
    for (const fh of Object.values(e.farmhands)) {
      if (fh.inside || fh.fade <= 0.05 || (big && e.fieldOf(fh.id) && !e.carrying[fh.id]) || (big && onAField(e, fh))) continue
      if (farmPage && !farmPage.roles.includes(fh.id)) continue
      const feet = toScreen(fh.x, fh.y)
      if (!inView(feet)) continue
      const g = fhGlyph(e, fh)
      const a = dimOf(fh.id) * (g?.kind === 'done' ? 0.6 : 1) * fh.fade
      // The head's top: the body spans frame rows 16 to 32 with the feet at 33, so 17 world px above the feet.
      const head = feet.y - HEAD * cam.scale
      const reacting = clock - fh.react < REACT * 2
      if (reacting) {
        // A heart just above the head, rising a little as it fades.
        const k = (clock - fh.react) / (REACT * 2)
        ctx.save()
        ctx.imageSmoothingEnabled = false
        pixel(ctx, 'heart', Math.round(feet.x), Math.round(head - 6 * cam.scale - (reduced ? 0 : k * 4 * cam.scale)), 1 - k * 0.5, cam.scale * 0.75)
        ctx.restore()
      } else if (g && !e.carrying[fh.id]) glyph(ctx, feet.x, head - 2 * cam.scale, g, glyphPulse(fh.id, g, clock), clock, a)
      nameLine(ctx, feet.x, feet.y + 3, fh.role, stateLine(e, fh), a, placed, e.selected === fh.id)
    }
    if (e.crow.state === 'landed' && (!farmPage || farmPage.roles.includes(e.task(MISSING.taskId).assignee))) {
      const p = toScreen(CROW_SPOT.x, CROW_SPOT.y - 1.2)
      glyph(ctx, p.x, p.y, { kind: 'ask', reason: 'Anomaly' }, glyphPulse('crow', { kind: 'ask', reason: 'Anomaly' }, clock), clock, 1)
    }
    // The task name for the plot in focus, just above its bed, right of the crop sign.
    if ((planning || planned) && !big)
      e.tasks.forEach((t, i) => {
        if (farmPage ? !farmPage.roles.includes(t.assignee) : !focusIds.has(t.id)) return
        if (planning && i >= e.planShown) return
        const p = toScreen(t.plot.x + 0.35, t.plot.y - 1.05)
        nameLine(ctx, p.x, p.y - 19, t.name, '', focusField && !focusRoles.includes(t.assignee) ? 0.45 : 1, placed, false, 'left')
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
    if (e.view === 'valley') regionValley(ctx, e, f.name, f.rect, cam, toScreen, clock)
    else if (f.name === FARM.name || f.name === NEIGHBOUR.name || f.name === e.peekName) banner(ctx, p.x, p.y, f.name)
    ctx.restore()
    hits.push({ kind: 'farm', id: f.name, rect: px(f.rect), title: f.name, body: f.team })
  }
  // Over the valleys' veils: the dependency between our project and the Staff schedule.
  if (e.view === 'valley') dependencyPath(ctx, e, toScreen, clock)
  // Each valley's signpost: what it believes about Saturdays. On Valleys, and on the neighbour's page.
  if (e.view === 'valley' || e.peekName === NEIGHBOUR.name) {
    const ours = toScreen(FARM.rect.x + FARM.rect.w / 2, FARM.rect.y + FARM.rect.h - 2.6)
    // On the neighbour's own page its card covers the right side, so the sign moves left.
    const theirs = toScreen(NEIGHBOUR.rect.x + (e.view === 'valley' ? NEIGHBOUR.rect.w / 2 : 9), NEIGHBOUR.rect.y + NEIGHBOUR.rect.h - 2.6)
    if (e.view === 'valley') banner(ctx, ours.x, ours.y, e.flags.has('hoursSettled') ? SIGNS.oursFixed : SIGNS.ours, 14)
    banner(ctx, theirs.x, theirs.y, SIGNS.theirs, 14)
  }

  if (farmPage) {
    const r = px({ x: farmPage.rect.x - 0.25, y: farmPage.rect.y - 1.1, w: farmPage.rect.w + 0.5, h: farmPage.rect.h + 1.35 })
    return { hits: hits.filter((h) => h.rect.x + h.rect.w > r.x && h.rect.x < r.x + r.w && h.rect.y + h.rect.h > r.y && h.rect.y < r.y + r.h) }
  }
  return { hits }
}

// A farmhand working a field in a loop: walk to a spot along the field's low edge, water or till
// there facing the crop for a few seconds, then on to the next. Facing always matches the motion.
function fieldWork(plot: Rect, clock: number, seed: number): { x: number; y: number; anim: string; dir: Dir } {
  const spots = [0.2, 0.55, 0.85, 0.55].map((k) => plot.x + 0.5 + k * (plot.w - 1))
  const y = plot.y + plot.h + 0.55
  const WALK = 1.4
  const WORK = 3.2
  const leg = WALK + WORK
  const t = (clock + hash(seed, 7) * leg * spots.length) % (leg * spots.length)
  const i = Math.floor(t / leg)
  const u = t - i * leg
  const from = spots[(i + spots.length - 1) % spots.length]
  const to = spots[i]
  if (u < WALK && Math.abs(to - from) > 0.01) {
    const k = u / WALK
    return { x: from + (to - from) * (k * k * (3 - 2 * k)), y, anim: 'walk', dir: to > from ? 'right' : 'left' }
  }
  return { x: to, y, anim: seed % 3 === 1 ? 'till' : 'water', dir: 'up' }
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
  const resting = fhGlyph(e, fh)?.kind === 'done'
  drawChar(ctx, fh.x, fh.y, anim, dir, t, tint, fh.fade * (fh.paused ? 0.55 : 1) * (resting ? 0.6 : 1))
}

// The head's top: the body spans frame rows 16 to 32 with the feet at 33, so 17 world px above the feet.
const HEAD = 17

// A smaller character (a helper subagent) at world (x, y), feet on the ground.
function drawSmallChar(ctx: CanvasRenderingContext2D, x: number, y: number, anim: string, dir: Dir, clock: number, tint: { body: string; shade: string }, s: number) {
  ctx.save()
  ctx.fillStyle = 'rgba(40,40,60,0.18)'
  ctx.beginPath()
  ctx.ellipse(x * TILE, y * TILE - 1, 6 * s, 2.5 * s, 0, 0, Math.PI * 2)
  ctx.fill()
  draw(ctx, charFrame(anim, dir, clock), Math.round(x * TILE - 24 * s), Math.round(y * TILE - 33 * s), { tint, scale: s })
  ctx.restore()
}

// A field's fence in its agent's colour: posts at every tile, two rails, and a gate gap top and bottom.
function fieldFence(ctx: CanvasRenderingContext2D, r: Rect, color: string) {
  const x0 = r.x * TILE
  const y0 = r.y * TILE
  const x1 = (r.x + r.w) * TILE
  const y1 = (r.y + r.h) * TILE
  const g0 = Math.floor(r.x + r.w / 2 - 0.5) * TILE
  const g1 = g0 + TILE
  ctx.save()
  // The ground inside reads a touch lighter than the paths around it.
  ctx.fillStyle = 'rgba(255, 250, 220, 0.10)'
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  const rail = (ax: number, bx: number, y: number) => {
    ctx.fillStyle = color
    ctx.fillRect(ax, y - 6, bx - ax, 2)
    ctx.fillRect(ax, y - 2, bx - ax, 2)
    ctx.fillStyle = 'rgba(40, 28, 36, 0.35)'
    ctx.fillRect(ax, y - 4, bx - ax, 1)
    ctx.fillRect(ax, y, bx - ax, 1)
  }
  const post = (x: number, y: number) => {
    ctx.fillStyle = 'rgba(40, 28, 36, 0.45)'
    ctx.fillRect(x - 2, y - 9, 4, 10)
    ctx.fillStyle = color
    ctx.fillRect(x - 1, y - 8, 2, 8)
  }
  for (const y of [y0 + 4, y1 - 2]) {
    rail(x0, g0, y)
    rail(g1, x1, y)
  }
  for (const x of [x0 + 1, x1 - 1]) {
    ctx.fillStyle = color
    ctx.fillRect(x - 1, y0 + 4, 2, y1 - y0 - 6)
    ctx.fillStyle = 'rgba(40, 28, 36, 0.35)'
    ctx.fillRect(x + 1, y0 + 4, 1, y1 - y0 - 6)
  }
  for (let i = 0; i <= r.w; i++) {
    const x = Math.min(x1 - 1, Math.max(x0 + 1, x0 + i * TILE))
    if (x > g0 && x < g1) continue
    post(x, y0 + 4)
    post(x, y1 - 2)
  }
  for (let j = 1; j < r.h; j++) {
    post(x0 + 1, y0 + j * TILE + 4)
    post(x1 - 1, y0 + j * TILE + 4)
  }
  ctx.restore()
}

// Dependencies between agents, as paths between their fields through the gaps around them:
// dotted while the downstream agent waits, solid once the upstream draft (or the file it sets) is there.
function drawDeps(ctx: CanvasRenderingContext2D, e: Engine) {
  const edges = new Map<string, { from: FieldSlot; to: FieldSlot; ready: boolean }>()
  for (const t of e.tasks) {
    const to = e.fieldOf(t.assignee)
    if (!to) continue
    for (const sub of t.subtasks)
      for (const f of sub.needs ?? [])
        for (const o of e.tasks) {
          if (o === t || !o.subtasks.some((x) => x.sets?.includes(f))) continue
          const from = e.fieldOf(o.assignee)
          if (!from || from === to) continue
          const key = `${from.id}>${to.id}`
          const ready = e.flags.has(f) || !!e.draftFor(o.id)
          const prev = edges.get(key)
          edges.set(key, { from, to, ready: (prev?.ready ?? true) && ready })
        }
  }
  let n = 0
  for (const { from, to, ready } of edges.values()) {
    const a = from.rect
    const b = to.rect
    const off = (n++ % 3) * 0.3 - 0.3
    const ax = a.x + a.w / 2 + off
    const bx = b.x + b.w / 2 + off
    const pts: [number, number][] = []
    if (a.y < b.y) {
      const gy = a.y + a.h + 0.5 + off * 0.5
      pts.push([ax, a.y + a.h - 0.2], [ax, gy], [bx, gy], [bx, b.y + 0.2])
    } else if (a.y > b.y) {
      const gy = a.y - 0.5 + off * 0.5
      pts.push([ax, a.y + 0.2], [ax, gy], [bx, gy], [bx, b.y + b.h - 0.2])
    } else {
      const gy = a.y + a.h + 0.5 + off * 0.5
      pts.push([ax, a.y + a.h - 0.2], [ax, gy], [bx, gy], [bx, b.y + b.h - 0.2])
    }
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const path = () => {
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * TILE, y * TILE) : ctx.moveTo(x * TILE, y * TILE)))
    }
    if (ready) {
      ctx.strokeStyle = 'rgba(92, 64, 40, 0.45)'
      ctx.lineWidth = 5
      path()
      ctx.stroke()
      ctx.strokeStyle = '#d8b27a'
      ctx.lineWidth = 3
    } else {
      ctx.strokeStyle = '#b98a55'
      ctx.lineWidth = 2
      ctx.setLineDash([3, 4])
    }
    path()
    ctx.stroke()
    // An arrowhead into the field that waits.
    const [ex, ey] = pts[pts.length - 1]
    const py0 = pts[pts.length - 2][1]
    const d = Math.sign(ey - py0) || 1
    ctx.setLineDash([])
    ctx.fillStyle = ready ? '#d8b27a' : '#b98a55'
    ctx.beginPath()
    ctx.moveTo(ex * TILE - 4, ey * TILE - d * 4)
    ctx.lineTo(ex * TILE + 4, ey * TILE - d * 4)
    ctx.lineTo(ex * TILE, ey * TILE + d * 1)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

// An agent with no field of its own, standing in another's: hidden on the valley page so it never overlaps that field's big character.
function onAField(e: Engine, fh: { id: RoleId; x: number; y: number }) {
  return !e.fieldOf(fh.id) && e.fields.some((f) => fh.x >= f.rect.x && fh.x <= f.rect.x + f.rect.w && fh.y >= f.rect.y && fh.y <= f.rect.y + f.rect.h)
}

// What a field's big character shows on the valley page.
function fieldState(e: Engine, f: FieldSlot): { state: ValleyState; reason?: ReasonLabel; anim?: string; words: string } {
  const fhs = f.roles.map((r) => e.farmhands[r])
  const ts = e.tasks.filter((t) => f.roles.includes(t.assignee))
  for (const fh of fhs) {
    const g = fhGlyph(e, fh)
    if (g?.kind !== 'ask') continue
    if (g.reason === 'Failure' && e.phase === 'harvest') return { state: 'failed', words: ts.map((t) => e.taskStatus(t)).find((x) => x.tone === 'fail')?.text ?? 'Gate failed' }
    return { state: 'needs', reason: g.reason, words: 'Needs you' }
  }
  if (focusOf(e) === f) return { state: 'needs', reason: e.activeAsk?.label ?? 'Anomaly', words: 'Needs you' }
  const bad = ts.find((t) => e.taskStatus(t).tone === 'fail')
  if (bad) return { state: 'failed', words: e.taskStatus(bad).text }
  const working = fhs.find((fh) => fh.status === 'working' || fhGlyph(e, fh)?.kind === 'work')
  if (working) {
    const job = working.job
    const first = job?.kind === 'sub' && e.task(job.taskId).subtasks[0]?.id === job.subId
    return { state: 'working', anim: job?.kind === 'fix' ? 'chop' : first ? 'till' : 'water', words: stateLine(e, working) }
  }
  const grown = e.phase === 'grow' || e.phase === 'harvest' || e.phase === 'ship'
  if (grown && ts.length && ts.every((t) => e.taskRipe(t))) return { state: 'done', words: 'Done' }
  // An agent with no plot of its own (the Reviewer) is done when it says so.
  if (grown && fhs.length && fhs.every((fh) => fh.status === 'done')) return { state: 'done', words: 'Done' }
  return { state: 'idle', words: fhs[0] ? stateLine(e, fhs[0]) : 'No task' }
}

function focusOf(e: Engine) {
  return e.askingField() ?? (e.phase === 'grow' && e.replan?.status === 'open' ? e.fieldOf(e.task(MISSING.taskId).assignee) : null)
}

// When each field's big character last changed state, so a new "needs" bounces once.
const bigSince = new Map<string, { key: string; t: number }>()

// One oversized character for a field or a whole valley, standing with its feet at screen (x, y), scale S.
// Each wears a straw hat. Not started: leans on a pitchfork, chewing a straw. Working: waters its crop.
// Needs you: hops once, then looks around and tips its hat for you. Done: stands still, eyes open, beside a
// basket of its harvest, under a tick. Failed: slumps under a red cross, its hat knocked to the ground.
// Returns the y of the top of its hat. Shared with the Valleys page.
export function drawBigChar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  state: ValleyState,
  tint: { body: string; shade: string } | undefined,
  clock: number,
  S: number,
  opts: { reason?: ReasonLabel; age?: number; anim?: string } = {},
) {
  const age = opts.age ?? 99
  ctx.save()
  ctx.imageSmoothingEnabled = false
  // Big characters water: the till and chop swings have a motion smear and a tool below the feet that read as glitches at this size.
  const anim = state === 'working' ? 'water' : 'idle'
  const { dir, dy } = bigIdle(state, clock, age, S)
  const squash = state === 'failed' ? 0.86 : 1
  ctx.fillStyle = 'rgba(40,40,60,0.2)'
  ctx.beginPath()
  ctx.ellipse(x, y - S, 6 * S, 2.4 * S, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.translate(x, y)
  ctx.scale(1, squash)
  if (state === 'failed') ctx.rotate(0.06)
  const f = bigFrame(anim, dir, state, clock)
  draw(ctx, f.name, -24 * S, -33 * S + dy, { tint, scale: S })
  farmerKit(ctx, S, -33 * S + dy, state, anim, dir, f.i, clock)
  ctx.restore()
  const head = Math.round(y - (state === 'failed' ? HEAD : HEAD + 4) * S * squash + dy)
  if (state === 'done') glyph(ctx, x, head - 4, { kind: 'check' }, -1, clock, 1)
  if (state === 'needs') glyph(ctx, x, head - 4, { kind: 'ask', reason: opts.reason ?? 'Anomaly' }, -1, clock, 1)
  if (state === 'failed') glyph(ctx, x, head - 4, { kind: 'ask', reason: 'Failure' }, -1, clock, 1)
  if (state === 'working') glyph(ctx, x, head - 4, { kind: 'work' }, -1, clock, 1)
  return head
}

// How a big character idles, so each state reads at a glance.
// Needs you: it hops once when the ask arrives, then looks left and right for you.
// Done and not started: it stands facing you.
function bigIdle(state: ValleyState, clock: number, age: number, S: number): { dir: Dir; dy: number } {
  if (reduced) return { dir: 'down', dy: 0 }
  if (state === 'needs') {
    const look: Dir[] = ['down', 'left', 'down', 'right']
    const dy = age < 0.6 ? -Math.round(Math.sin((age / 0.6) * Math.PI) * S * 3) : 0
    return { dir: look[Math.floor(clock * 0.9) % look.length], dy }
  }
  return { dir: 'down', dy: 0 }
}

// The frame a big character shows. Done holds one frame, eyes open, so it never pulls your eye.
function bigFrame(anim: string, dir: Dir, state: ValleyState, clock: number) {
  const fps = anim === 'idle' ? 5 : 8
  const t = reduced || state === 'done' ? 0 : clock
  const n = animCounts[`${anim}_${dir}`] ?? 1
  return { name: charFrame(anim, dir, t, fps), i: Math.floor(t * fps) % n }
}

// The farmer's kit, drawn in the sprite's own pixels over a big character.
// k outline, y straw, d straw in shade, b hat band, m fork tines, h fork handle.
const KIT: Record<string, string> = { k: '#5c4e92', y: '#ecc969', d: '#c99a45', b: '#8a5a34', m: '#8d93a0', h: '#b07a45', o: '#e58f3a', g: '#6f9a4e', s: '#e3c46c', t: '#b8913f' }
const HAT = ['......kkkkkk......', '.....kyyyyyyk.....', '.....kyyyyyyk.....', '.....kbbbbbbk.....', '.kkkkyyyyyyyykkkk.', 'kyyyyyyyyyyyyyyyyk', '.kddddddddddddddk.', '..kkkkkkkkkkkkkk..']
const FORK = ['m.m.m', 'm.m.m', 'm.m.m', 'mmmmm', ...Array(21).fill('.khk.'), '.kkk.']
// The harvest piled in the basket: carrots with their tops.
const PRODUCE = ['..g...g..g..', '.ooo.ooo.oo.', 'oooooooooooo']
// How far the head sits from its idle place in each watering frame, in sprite pixels.
const WATER_HEAD = [1, -2, -1, -1, -1, -1, -2, 1]

function farmerKit(ctx: CanvasRenderingContext2D, S: number, oy: number, state: ValleyState, anim: string, dir: Dir, fi: number, clock: number) {
  const ox = -24 * S
  const paint = (rows: string[], c0: number, r0: number) =>
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const col = KIT[row[c]]
        if (!col) continue
        ctx.fillStyle = col
        ctx.fillRect(ox + (c0 + c) * S, oy + (r0 + r) * S, S, S)
      }
    })
  // The head's top row in the frame: 17 standing, a little lower or higher as it waters.
  const top = 17 + (anim === 'water' && dir === 'down' ? WATER_HEAD[fi] ?? 0 : 0)
  if (state === 'failed') {
    // Knocked off, lying on the ground beside it.
    paint(HAT, 28, 26)
    return
  }
  if (state === 'idle' || state === 'needs') paint(FORK, 29, 8)
  if (state === 'done') {
    // A basket of the harvest on the ground beside it, a little smaller than the farmer.
    const u = Math.max(2, Math.round(S * 0.6))
    const bx = ox + 29 * S
    const by = oy + 33 * S - 15 * u
    draw(ctx, 'basket', bx, by, { scale: u })
    PRODUCE.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (!KIT[row[c]]) continue
        ctx.fillStyle = KIT[row[c]]
        ctx.fillRect(bx + (2 + c) * u, by + (1 + r) * u, u, u)
      }
    })
  }
  // Needs you: every few seconds it lifts its hat to you.
  const tip = state === 'needs' && !reduced && clock % 2.6 < 0.5 ? -2 : 0
  paint(HAT, 15, top - 4 + tip)
  if (state === 'idle' && dir === 'down') {
    // Chewing a straw: its tip nods now and then.
    const nod = !reduced && Math.floor(clock * 1.4) % 3 === 0 ? 1 : 0
    paint(['s'], 20, 23)
    paint(['s'], 19, 23)
    paint(['s'], 18, 22 + nod)
    paint(['s'], 17, 22 + nod)
    paint(['t'], 16, 21 + nod)
  }
}


// The shipping crate: a chest at 1x on a small pallet, lid open while crops arrive.
function drawCrate(ctx: CanvasRenderingContext2D, tx: number, ty: number, open: boolean, filled: number) {
  const x = Math.round(tx * TILE - 8)
  const bottom = Math.round((ty + 0.55) * TILE)
  const y = bottom - 14
  ctx.save()
  ctx.fillStyle = 'rgba(40,40,60,0.18)'
  ctx.fillRect(x - 2, bottom + 1, 20, 2)
  ctx.fillStyle = '#7a5236'
  ctx.fillRect(x - 2, bottom - 1, 20, 2)
  draw(ctx, open ? 'chest_open' : 'chest', x, y)
  // Crops already shipped peek out of the open lid.
  if (open && filled > 0) {
    ctx.fillStyle = '#94b85c'
    for (let i = 0; i < Math.min(3, filled); i++) ctx.fillRect(x + 3 + i * 4, y + 3, 2, 2)
  }
  ctx.restore()
}

// The well's bucket: it goes down on its rope, out of sight into the water, and comes back up full,
// with the crank turning while it rises and a drip or two at the top. (sx, sy) is the sprite's top-left;
// the sprite is 31x29 with the roof's underside at y 9 and the front rim at y 14.
function drawWellBucket(ctx: CanvasRenderingContext2D, sx: number, sy: number, clock: number) {
  const CYCLE = 7
  const t = reduced ? 5.5 : (clock + 1.3) % CYCLE
  const TOP = 10 // bucket top at its highest, just under the roof
  const LOW = 19 // fully under the rim
  const ease = (v: number) => v * v * (3 - 2 * v)
  // 0-1.6 down, 1.6-2.6 under water, 2.6-4.8 up while the crank turns, 4.8-7 resting at the top.
  let by = TOP
  let full = true
  if (t < 1.6) {
    by = TOP + (LOW - TOP) * ease(t / 1.6)
    full = false
  } else if (t < 2.6) by = LOW
  else if (t < 4.8) by = LOW - (LOW - TOP) * ease((t - 2.6) / 2.2)
  const cranking = t >= 2.6 && t < 4.8
  const cx = sx + 15
  const top = sy + 9
  const yb = Math.round(sy + by)
  ctx.save()
  // The crank on the right post: a small handle that turns while the bucket rises.
  const ang = cranking ? (t - 2.6) * 6 : 0
  const hx = sx + 27
  const hy = sy + 11
  ctx.fillStyle = '#5a3520'
  ctx.fillRect(hx - 1, hy - 1, 2, 2)
  ctx.fillRect(Math.round(hx + Math.cos(ang) * 3) - 1, Math.round(hy + Math.sin(ang) * 3) - 1, 2, 2)
  // Everything below the front rim is hidden, so the bucket sinks into the well.
  ctx.beginPath()
  ctx.rect(sx, sy, 31, 14)
  ctx.clip()
  // Rope.
  ctx.fillStyle = '#c8a46a'
  ctx.fillRect(cx, top, 1, Math.max(0, yb - top))
  // Bucket: 5 wide, 4 tall, a wooden pail with a metal band, water on top when full.
  ctx.fillStyle = '#7a4a2b'
  ctx.fillRect(cx - 2, yb, 5, 4)
  ctx.fillStyle = '#9b6a3f'
  ctx.fillRect(cx - 1, yb + 1, 3, 2)
  ctx.fillStyle = '#5c4e64'
  ctx.fillRect(cx - 2, yb + 2, 5, 1)
  if (full) {
    ctx.fillStyle = '#7cc3e8'
    ctx.fillRect(cx - 1, yb, 3, 1)
  }
  ctx.restore()
  // A drip falls back in while the full bucket rests at the top.
  if (!reduced && t > 4.8 && t < 6.2) {
    const d = ((t - 4.8) % 0.7) / 0.7
    ctx.fillStyle = `rgba(124,195,232,${1 - d})`
    ctx.fillRect(cx + 1, Math.round(sy + TOP + 4 + d * 5), 1, 1)
  }
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
      drawWellBucket(ctx, x, y - 4, clock)
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
  if (e.openAsks.length) return 'Passing on what the crew asks'
  return 'Watching the crew'
}

function statsFor(e: Engine, name: string) {
  // Each farm shows the crew it runs: ours is the team template picked in the Brief.
  const s = { ...VALLEY_STATS[name], crew: name === FARM.name ? e.team.name : (NEIGHBOUR_CREWS[[NEIGHBOUR.name, ...OTHER_FARMS.map((f) => f.name)].indexOf(name)] ?? '') }
  if (name === FARM.name) {
    s.energyWeek = e.energyUsed
    s.pests = e.tasks.reduce((n, t) => n + t.pests.length, 0)
    s.waiting = e.openAsks.length
    s.harvests = e.harvestReady ? 1 : 0
  }
  return s
}

// Every label on the map uses the panel's font, on a solid plate, at whole pixels.
const SANS = "'Atkinson Hyperlegible Next', system-ui, sans-serif"
const INK = '#241d33'
const FAIL = '#b0412e'
const OUT = '#2d5da8'

type Box = { x: number; y: number; w: number; h: number }
export type Glyph = { kind: 'work' } | { kind: 'done' } | { kind: 'check' } | { kind: 'ask'; reason: ReasonLabel }

// The one glyph over a farmhand. The engine's glyph, with the harvest's own moments on top:
// nothing while the crew carries crops in, a red cross on the farmhand whose code failed a gate.
function fhGlyph(e: Engine, fh: Farmhand): Glyph | null {
  if (e.phase === 'harvest') {
    if (e.harvestStage === 'map') return null
    if (fh.id === e.task(HARVEST_FAIL.taskId).assignee) {
      const s = e.fhStatus(fh)
      if (s.startsWith('Waiting for you')) return { kind: 'ask', reason: 'Failure' }
      if (s.startsWith('Fixing')) return { kind: 'work' }
    }
    if (fh.id === 'reviewer' && e.harvestGates.review.state === 'run') return { kind: 'work' }
  }
  const g = e.glyphOf(fh)
  return g ? (g.kind === 'ask' ? { kind: 'ask', reason: g.reason } : g.kind === 'done' ? { kind: 'done' } : { kind: 'work' }) : null
}

// What the line under a farmhand says after its name: short, like the panel's rows.
function stateLine(e: Engine, fh: Farmhand): string {
  if (fh.paused) return 'Paused'
  if (fh.status === 'asking') return 'Needs you'
  if (e.phase === 'harvest' && fh.id === e.task(HARVEST_FAIL.taskId).assignee) {
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
function nameLine(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, state: string, alpha: number, placed: Box[], selected = false, align: 'center' | 'left' = 'center', bar?: string) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `700 14px ${SANS}`
  const wName = Math.ceil(ctx.measureText(name).width)
  ctx.font = `400 14px ${SANS}`
  const wState = state ? Math.ceil(ctx.measureText(state).width) : 0
  const gap = 13
  const lead = bar ? 5 : 0
  const w = wName + (state ? gap + wState : 0) + 16 + lead
  const h = 22
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
  if (bar) {
    ctx.fillStyle = bar
    ctx.fillRect(rx + 1, ry + 1, 4, h - 2)
  }
  // Alphabetic baseline on a whole pixel, so the text stays sharp.
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = `700 14px ${SANS}`
  ctx.fillText(name, rx + 8 + lead, ry + 16)
  if (state) {
    ctx.fillStyle = 'rgba(36, 29, 51, 0.25)'
    ctx.fillRect(rx + 8 + lead + wName + Math.floor(gap / 2), ry + 5, 1, h - 10)
    ctx.fillStyle = state === 'Needs you' ? '#7a4a0c' : '#3d3649'
    ctx.font = `400 14px ${SANS}`
    ctx.fillText(state, rx + 8 + lead + wName + gap, ry + 16)
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
  // Two beamed eighth notes: whistling, done.
  notes: ['..#######', '..#######', '..#.....#', '..#.....#', '..#.....#', '###...###', '###...###', '###...###'],
  // A tick: the whole field or valley is done.
  check: ['.......##', '......###', '.....###.', '##..###..', '#####....', '.###.....'],
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
    const name = g.kind === 'done' ? 'notes' : g.kind === 'check' ? 'check' : { Anomaly: 'question', Failure: 'cross', Risk: 'bang', Cost: 'coin', Irreversible: 'envelope' }[g.reason]
    const rows = BITS[name]
    ctx.fillStyle = g.kind === 'check' ? '#3f7a2c' : g.kind === 'ask' && g.reason === 'Failure' ? FAIL : g.kind === 'ask' && g.reason === 'Irreversible' ? OUT : INK
    const u = 2
    const bw = rows[0].length * u
    const bh = rows.length * u
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') ctx.fillRect(Math.round(-bw / 2) + i * u, Math.round(cy - bh / 2) + j * u, u, u)
    })
  }
  ctx.restore()
}

// A headline on a solid light plate: bold sans, dark ink, whole pixels.
function banner(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size = 16) {
  ctx.save()
  ctx.font = `700 ${size}px ${SANS}`
  const w = Math.ceil(ctx.measureText(text).width) + 28
  const h = size + 14
  const rx = Math.round(x - w / 2)
  const ry = Math.round(y - h / 2)
  ctx.fillStyle = 'rgba(36, 29, 51, 0.18)'
  ctx.beginPath()
  ctx.roundRect(rx + 1, ry + 2, w, h, 7)
  ctx.fill()
  ctx.fillStyle = '#fffcf2'
  ctx.strokeStyle = 'rgba(36, 29, 51, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(rx + 0.5, ry + 0.5, w - 1, h - 1, 7)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, Math.round(x), ry + Math.round(h / 2 + size * 0.36))
  ctx.restore()
}

// A valley's overall state: ours follows the work; the others come from their data.
function valleyState(e: Engine, name: string): { state: ValleyState; reason?: ReasonLabel } {
  if (name !== FARM.name) {
    const v = VALLEY_STATS[name]
    return { state: v?.state ?? 'idle', reason: v?.reason }
  }
  const ask = e.activeAsk
  if (ask) return { state: 'needs', reason: ask.label }
  if (e.replan?.status === 'open') return { state: 'needs', reason: 'Anomaly' }
  const st = e.shipStage
  if (st === 'live' || st === 'announced') return { state: 'done' }
  if (e.gateFailed || st === 'rollback' || st === 'rolledback' || st === 'cifailed') return { state: 'failed' }
  if (e.phase === 'grow' || e.phase === 'harvest' || e.phase === 'ship') return { state: 'working' }
  return { state: 'idle' }
}

// What a valley's label says about it, so the Valleys page reads without being explained.
const STATE_WORDS: Record<ValleyState, string> = { working: 'Working', idle: 'Not started', needs: 'Needs you', done: 'Done', failed: 'Failed' }
const since = new Map<string, { key: string; t: number }>()

// The region view of one valley: a light veil over its detail, its head farmer drawn big in the
// valley's state, and a card with its name and numbers under the feet. All on screen, in whole pixels.
function regionValley(ctx: CanvasRenderingContext2D, e: Engine, name: string, r: Rect, cam: Camera, toScreen: (x: number, y: number) => { x: number; y: number }, clock: number) {
  const a = toScreen(r.x + 0.5, r.y + 0.5)
  const b = toScreen(r.x + r.w - 0.5, r.y + r.h - 0.5)
  ctx.fillStyle = 'rgba(255, 251, 238, 0.42)'
  ctx.fillRect(Math.round(a.x), Math.round(a.y), Math.round(b.x - a.x), Math.round(b.y - a.y))
  const { state, reason } = valleyState(e, name)
  const key = `${state}:${reason ?? ''}`
  const prev = since.get(name)
  if (!prev || prev.key !== key) since.set(name, { key, t: clock })
  const t0 = since.get(name)!.t
  const feet = toScreen(r.x + r.w / 2, r.y + r.h * 0.56)
  const S = Math.max(3, Math.round(cam.scale * 5))
  const tint = name === FARM.name ? undefined : name === NEIGHBOUR.name ? { body: '#d7c6f0', shade: '#a596c9' } : name === OTHER_FARMS[0].name ? { body: '#e7dcc4', shade: '#c4b79a' } : { body: '#d9e6c4', shade: '#aebd96' }
  const top = bigChar(ctx, Math.round(feet.x), Math.round(feet.y), S, state, reason, clock, clock - t0, tint)
  // The card under the feet, and on ours a count of the asks waiting for you.
  const card = valleyCard(ctx, Math.round(feet.x), Math.round(feet.y + S * 2 + 6), name, statsFor(e, name), state)
  const asks = name === FARM.name ? e.openAsks.length : 0
  if (asks > 0) askBadge(ctx, card.x + card.w - 4, card.y + 4, asks)
  return top
}

// One oversized character for a whole valley, standing at (x, y) on screen with scale S, in the same
// clothes and moods as a field's. Returns the y of the top of its hat.
function bigChar(ctx: CanvasRenderingContext2D, x: number, y: number, S: number, state: ValleyState, reason: ReasonLabel | undefined, clock: number, age: number, tint?: { body: string; shade: string }) {
  ctx.save()
  ctx.imageSmoothingEnabled = false
  const anim = state === 'working' ? 'water' : 'idle'
  const { dir, dy } = bigIdle(state, clock, age, S)
  const squash = state === 'failed' ? 0.84 : 1
  // Shadow.
  ctx.fillStyle = 'rgba(40,40,60,0.2)'
  ctx.beginPath()
  ctx.ellipse(x, y, 6 * S, 2.4 * S, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.translate(x, y)
  ctx.scale(1, squash)
  if (state === 'failed') ctx.rotate(0.06)
  const f = bigFrame(anim, dir, state, clock)
  draw(ctx, f.name, -24 * S, -33 * S + dy, { tint, scale: S })
  farmerKit(ctx, S, -33 * S + dy, state, anim, dir, f.i, clock)
  ctx.restore()
  const head = y - Math.round((state === 'failed' ? 17 : 21) * S * squash) + dy
  if (state === 'done') glyph(ctx, x, head - 4, { kind: 'check' }, -1, clock, 1)
  if (state === 'needs' && reason) glyph(ctx, x, head - 4, { kind: 'ask', reason }, -1, clock, 1)
  if (state === 'failed') glyph(ctx, x, head - 4, { kind: 'ask', reason: 'Failure' }, -1, clock, 1)
  if (state === 'working') glyph(ctx, x, head - 4, { kind: 'work' }, -1, clock, 1)
  return head
}

// A valley's card: its name in bold, then its crew, its numbers and its state, on a solid light plate.
// A round count of the asks waiting in a valley, pinned to its card's corner.
function askBadge(ctx: CanvasRenderingContext2D, x: number, y: number, n: number) {
  ctx.save()
  const r = 12
  ctx.fillStyle = '#b8741a'
  ctx.beginPath()
  ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#fffcf3'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = `700 14px ${SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(n), Math.round(x), Math.round(y) + 1)
  ctx.restore()
}

// A dependency between projects: Vet booking takes its opening hours from the Staff schedule. Dotted while ours
// still reads the out-of-date hours sheet, solid once the re-plan settles the hours.
function dependencyPath(ctx: CanvasRenderingContext2D, e: Engine, toScreen: (x: number, y: number) => { x: number; y: number }, clock: number) {
  const ours = FARM.rect
  const theirs = NEIGHBOUR.rect
  const a = toScreen(ours.x + ours.w * 0.72, ours.y + ours.h * 0.2)
  const b = toScreen(theirs.x + theirs.w * 0.12, theirs.y + theirs.h * 0.2)
  const fixed = e.flags.has('hoursSettled')
  const mx = (a.x + b.x) / 2
  const my = Math.min(a.y, b.y) - 70
  ctx.save()
  ctx.lineCap = 'round'
  // A light halo under the line so it reads on grass and road.
  ctx.strokeStyle = 'rgba(255, 252, 243, 0.9)'
  ctx.lineWidth = 7
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.quadraticCurveTo(mx, my, b.x, b.y)
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.setLineDash(fixed ? [] : [2, 7])
  if (!fixed && !reduced) ctx.lineDashOffset = -clock * 12
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.quadraticCurveTo(mx, my, b.x, b.y)
  ctx.stroke()
  // Arrowhead into the Staff schedule.
  ctx.setLineDash([])
  const ang = Math.atan2(b.y - my, b.x - mx)
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - Math.cos(ang - 0.45) * 11, b.y - Math.sin(ang - 0.45) * 11)
  ctx.lineTo(b.x - Math.cos(ang + 0.45) * 11, b.y - Math.sin(ang + 0.45) * 11)
  ctx.closePath()
  ctx.fill()
  // What the dependency is, on a plate at the top of the curve.
  // Neutral until the crow catches the mismatch, so the Valleys page doesn't give the catch away.
  const caught = e.asks.some((a) => a.id === 'crow')
  const text = fixed ? 'Hours from the staff schedule' : caught ? 'Hours sheet out of date' : 'Shares hours'
  ctx.font = `700 13px ${SANS}`
  const w = Math.ceil(ctx.measureText(text).width) + 16
  const lx = Math.round(mx - w / 2)
  const ly = Math.round((a.y + b.y) / 4 + my / 2 - 12)
  ctx.fillStyle = '#fffcf3'
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.fillRect(lx, ly, w, 22)
  ctx.strokeRect(lx + 0.5, ly + 0.5, w - 1, 21)
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, Math.round(mx), ly + 11.5)
  ctx.restore()
}

function valleyCard(ctx: CanvasRenderingContext2D, x: number, top: number, name: string, s: ReturnType<typeof statsFor>, state: ValleyState) {
  ctx.save()
  const lines = [
    ...(s.crew ? [`Crew: ${s.crew}`] : []),
    ...(s.unattended ? [s.unattended] : []),
  ]
  ctx.font = `400 14px ${SANS}`
  const wLines = Math.max(...lines.map((l) => ctx.measureText(l).width))
  ctx.font = `700 16px ${SANS}`
  const word = STATE_WORDS[state]
  const wName = ctx.measureText(name).width
  ctx.font = `700 13px ${SANS}`
  const wWord = ctx.measureText(word).width + 14
  const w = Math.ceil(Math.max(wLines, wName + 10 + wWord)) + 24
  const h = 34 + lines.length * 19
  const rx = Math.round(x - w / 2)
  const ry = Math.round(top)
  ctx.fillStyle = 'rgba(36,29,51,0.18)'
  ctx.fillRect(rx + 2, ry + 3, w, h)
  ctx.fillStyle = '#fffcf3'
  ctx.fillRect(rx, ry, w, h)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = INK
  ctx.font = `700 16px ${SANS}`
  ctx.fillText(name, rx + 12, ry + 24)
  // The state as a small pill beside the name: red only when it failed.
  const px0 = Math.round(rx + 12 + wName + 10)
  ctx.fillStyle = state === 'failed' ? FAIL : state === 'needs' ? '#f6e3b4' : '#ece7da'
  ctx.beginPath()
  ctx.roundRect(px0, ry + 10, Math.ceil(wWord), 19, 9.5)
  ctx.fill()
  ctx.fillStyle = state === 'failed' ? '#fff' : INK
  ctx.font = `700 13px ${SANS}`
  ctx.fillText(word, px0 + 7, ry + 24)
  ctx.font = `400 14px ${SANS}`
  ctx.fillStyle = '#3b3350'
  lines.forEach((l, i) => ctx.fillText(l, rx + 12, ry + 46 + i * 19))
  ctx.restore()
  return { x: rx, y: ry, w, h }
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
