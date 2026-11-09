// Draws the valley. The map shows state at a glance; every decision lives in the quest log.
import { draw, hasFrame, animCounts, pixelSprite } from './atlas'
import { cropTiles, type Engine } from '../sim/engine'
import { CROW_SPOT, FARM, NEIGHBOUR, NEIGHBOUR_PLOTS, OTHER_FARMS, TILE, VALLEY_STATS, WORLD } from '../sim/scenario'
import type { Farmhand, Rect, Task } from '../sim/types'

export interface Camera {
  x: number // world px at screen left
  y: number
  scale: number
}

export interface Hit {
  kind: 'plot' | 'farmhand' | 'head' | 'signpost' | 'pest' | 'crow' | 'seeds' | 'neighbour' | 'nplot' | 'farm'
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

// ---- static background ----------------------------------------------------------

let bg: HTMLCanvasElement | null = null

function fenceRect(ctx: CanvasRenderingContext2D, r: Rect, gate: { side: 'w' | 'e' | 's'; at: number }[] = []) {
  const x0 = r.x
  const y0 = r.y
  const x1 = r.x + r.w - 1
  const y1 = r.y + r.h - 1
  const isGate = (x: number, y: number) =>
    gate.some((g) => (g.side === 'w' && x === x0 && Math.abs(y - g.at) <= 1) || (g.side === 'e' && x === x1 && Math.abs(y - g.at) <= 1) || (g.side === 's' && y === y1 && Math.abs(x - g.at) <= 1))
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

function buildBackground() {
  const c = document.createElement('canvas')
  c.width = WORLD.w * TILE
  c.height = WORLD.h * TILE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < WORLD.h; y++)
    for (let x = 0; x < WORLD.w; x++) {
      draw(ctx, 'grass', x * TILE, y * TILE)
      const n = hash(x, y)
      if (n < 0.16) draw(ctx, `grass_deco_${Math.floor(n * 75) % 12}`, x * TILE, y * TILE)
    }
  // Dirt lanes between farms.
  const lane = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) draw(ctx, 'path_11', x * TILE, y * TILE)
  }
  lane({ x: 37, y: 0, w: 2, h: WORLD.h })
  lane({ x: 0, y: 23.5, w: WORLD.w, h: 2 })

  // Pond in the PM farm corner.
  const pond = { x: 28, y: 4, w: 5, h: 3 }
  for (let y = pond.y; y < pond.y + pond.h; y++) for (let x = pond.x; x < pond.x + pond.w; x++) draw(ctx, 'water_0', x * TILE, y * TILE)

  const farms = [
    { rect: FARM.rect, gates: [{ side: 'e' as const, at: 12 }, { side: 's' as const, at: 19 }] },
    { rect: NEIGHBOUR.rect, gates: [{ side: 'w' as const, at: 12 }, { side: 's' as const, at: 57 }] },
    ...OTHER_FARMS.map((f) => ({ rect: f.rect, gates: [{ side: 'w' as const, at: f.rect.y + 6 }] })),
  ]
  for (const f of farms) fenceRect(ctx, f.rect, f.gates)

  // Trees along the valley edge.
  const trees: [string, number, number][] = [
    ['tree_big', 0, 0], ['tree', 35, 0.5], ['tree_small', 39.5, 22], ['tree', 74, 0.2], ['tree_big', 73, 20],
    ['tree', 0, 21], ['tree_small', 36, 43], ['tree', 74, 43], ['tree_big', 0.2, 43],
  ]
  for (const [n, x, y] of trees) draw(ctx, n, x * TILE, y * TILE - 8)

  // PM farm decoration.
  draw(ctx, 'bush_1', 26 * TILE, 4 * TILE)
  draw(ctx, 'bush_0', 33 * TILE, 8 * TILE)
  draw(ctx, 'sunflower', 34 * TILE, 17 * TILE)
  draw(ctx, 'flower_1', 9 * TILE, 18 * TILE)
  draw(ctx, 'flower_4', 15 * TILE, 19 * TILE)
  draw(ctx, 'flower_6', 4 * TILE, 19 * TILE)
  draw(ctx, 'well', 17 * TILE, 4 * TILE)

  // Brand refresh: a flower garden. Invoices: an orchard.
  const garden = OTHER_FARMS[0].rect
  for (let y = garden.y + 6; y < garden.y + garden.h - 2; y += 2)
    for (let x = garden.x + 4; x < garden.x + garden.w - 3; x += 2) {
      const n = hash(x, y)
      draw(ctx, n < 0.5 ? `crop_tulip_${n < 0.2 ? 2 : 3}` : `flower_${Math.floor(n * 8)}`, x * TILE, y * TILE)
    }
  const orchard = OTHER_FARMS[1].rect
  const fruit = ['tree_apple', 'tree_orange', 'tree_pear', 'tree_peach']
  for (let y = orchard.y + 6; y < orchard.y + orchard.h - 3; y += 4)
    for (let x = orchard.x + 3; x < orchard.x + orchard.w - 4; x += 4) draw(ctx, fruit[(x + y) % 4], x * TILE, y * TILE - 8)

  // Houses go last so they sit on top of decoration.
  for (const h of [FARM.house, NEIGHBOUR.house, ...OTHER_FARMS.map((f) => f.house)]) draw(ctx, h.sprite, h.x * TILE, h.y * TILE)
  bg = c
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

function stageOf(p: number, done: boolean) {
  if (done) return 3
  if (p > 0.55) return 2
  if (p > 0) return 1
  return 0
}

type Dir = 'down' | 'up' | 'left' | 'right'

function charFrame(anim: string, dir: Dir, clock: number, fps = 8) {
  const n = animCounts[`${anim}_${dir}`] ?? 1
  return `char_${anim}_${dir}_${Math.floor(clock * fps) % n}`
}

function drawChar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  anim: string,
  dir: Dir,
  clock: number,
  tint?: { body: string; shade: string },
  alpha = 1,
) {
  // Frames are 48x48 with the feet around y=32.
  ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(40,40,60,0.18)'
  ctx.beginPath()
  ctx.ellipse(x * TILE, y * TILE - 1, 6, 2.5, 0, 0, Math.PI * 2)
  ctx.fill()
  draw(ctx, charFrame(anim, dir, clock), Math.round(x * TILE - 24), Math.round(y * TILE - 33), { tint })
  ctx.globalAlpha = 1
}

// ---- main render ------------------------------------------------------------------

export interface RenderOut {
  hits: Hit[]
}

let viewW = 0

export function render(ctx: CanvasRenderingContext2D, e: Engine, cam: Camera, W: number, H: number, dpr: number): RenderOut {
  viewW = W
  if (!bg) buildBackground()
  const hits: Hit[] = []
  const clock = e.clock
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#9bcf6a'
  ctx.fillRect(0, 0, W, H)

  ctx.save()
  ctx.scale(cam.scale, cam.scale)
  ctx.translate(-cam.x, -cam.y)

  // Water shimmer: redraw pond frames over the baked background.
  ctx.drawImage(bg!, 0, 0)
  const wf = Math.floor(clock * 2.5) % 4
  for (let y = 4; y < 7; y++) for (let x = 28; x < 33; x++) draw(ctx, `water_${wf}`, x * TILE, y * TILE)

  const replay = !!e.trace
  const showPlan = e.phase === 'plan' && e.headThinking === 0
  const planned = e.phase === 'grow' || e.phase === 'harvest'
  const reveal = e.planRevealT > 0 ? Math.max(0, clock - e.planRevealT) : 0

  // Neighbour plots.
  for (const np of NEIGHBOUR_PLOTS) {
    const dry = np.drought && e.neighbourDrought
    bed(ctx, np.plot, !!dry)
    for (let j = 0; j < np.plot.h; j++)
      for (let i = 0; i < np.plot.w; i++) {
        const st = dry ? Math.max(0, np.stage - 1) : np.stage
        draw(ctx, `crop_${np.crop}_${st}`, (np.plot.x + i) * TILE, (np.plot.y + j) * TILE)
      }
    hits.push({ kind: 'nplot', id: np.name, rect: px(np.plot), title: `${np.name}, Priya’s farm`, body: dry ? 'Drought: blocked by the auth dependency' : 'Growing' })
  }

  // Plots.
  e.tasks.forEach((t, i) => {
    const r = t.plot
    if (showPlan) {
      const k = Math.min(1, Math.max(0, (reveal - i * 0.18) / 0.35))
      if (k <= 0) return
      ctx.save()
      ctx.globalAlpha = k
      ctx.fillStyle = 'rgba(255,248,220,0.35)'
      ctx.fillRect((r.x - 1) * TILE, (r.y - 1) * TILE, (r.w + 2) * TILE, (r.h + 2) * TILE)
      ctx.strokeStyle = 'rgba(92, 78, 146, 0.6)'
      ctx.lineWidth = 1
      ctx.strokeRect((r.x - 1) * TILE + 0.5, (r.y - 1) * TILE + 0.5, (r.w + 2) * TILE - 1, (r.h + 2) * TILE - 1)
      ctx.restore()
    } else if (planned) {
      bed(ctx, r, t.dry)
      const tiles = cropTiles(t)
      for (const c of tiles) {
        const s = t.subtasks[c.sub]
        if (!s) continue
        const st = stageOf(s.progress, s.done)
        // Ripe crops hold still on their full-grown sprite.
        draw(ctx, `crop_${t.crop}_${st}`, c.x * TILE, c.y * TILE)
      }
      // energy bar along the top edge of the plot
      const frac = Math.min(1, t.used / t.budget)
      const bw = r.w * TILE - 6
      ctx.fillStyle = 'rgba(62,49,80,0.55)'
      ctx.fillRect(r.x * TILE + 3, (r.y - 1) * TILE - 4, bw, 3)
      ctx.fillStyle = frac >= 0.75 ? '#e8a05a' : '#7fc06a'
      ctx.fillRect(r.x * TILE + 3, (r.y - 1) * TILE - 4, Math.max(1, bw * frac), 3)
    } else return

    // Signposts: one sign per attached file, along the left edge.
    t.signposts.forEach((s, k) => {
      const sx = (r.x - 2) * TILE
      const sy = (r.y + k * 0.7 - 0.2) * TILE
      if (k > r.h + 1) return
      const isNew = s === 'eng-standup-notes/'
      draw(ctx, 'sign_blank', sx, sy)
      hits.push({ kind: 'signpost', id: `${t.id}:${s}`, rect: { x: sx, y: sy, w: 16, h: 16 }, title: s, body: isNew ? 'Added by the re-plan' : `Attached to ${t.name}` })
    })
    if (replay && t.id === 'draft' && !t.signposts.includes('eng-standup-notes/')) {
      // The missing signpost: what the Writer never saw.
      const k = t.signposts.length
      const sx = (r.x - 2) * TILE
      const sy = (r.y + k * 0.7 - 0.2) * TILE
      ctx.save()
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(clock * 5)
      ctx.strokeStyle = '#d9715f'
      ctx.strokeRect(sx + 1.5, sy + 1.5, 13, 13)
      ctx.restore()
    }

    // Pests.
    for (const p of t.pests) {
      const img = pixelSprite('beetle')
      const s = 0.6 + 0.4 * p.size
      const bx = (p.tile.x + 0.5) * TILE + Math.sin(clock * 3) * 2
      const by = (p.tile.y + 0.5) * TILE + Math.cos(clock * 2.3) * 1.5
      ctx.drawImage(img, bx - (img.width * s) / 2, by - (img.height * s) / 2, img.width * s, img.height * s)
      hits.push({ kind: 'pest', id: p.id, rect: { x: bx - 8, y: by - 8, w: 16, h: 16 }, title: 'Beetle', body: p.label })
    }

    hits.push({
      kind: 'plot',
      id: t.id,
      rect: px(r),
      title: t.name,
      body: planned
        ? `${t.subtasks.filter((s) => s.done).length} of ${t.subtasks.length} crops ripe${t.dry ? ', energy running low' : ''}`
        : `Proposed for the ${cap(t.assignee)}`,
    })
  })

  // Seed library chest.
  const sl = FARM.seedLibrary
  draw(ctx, e.seedFly && e.seedFly.t > 0.8 ? 'chest_open' : 'chest', sl.x * TILE, sl.y * TILE)
  hits.push({ kind: 'seeds', id: 'seeds', rect: { x: sl.x * TILE, y: sl.y * TILE, w: 24, h: 20 }, title: `Seed library (${e.seeds.length})`, body: e.seeds.map((s) => s.file).join('\n') })

  // ---- characters, sorted by y ----
  type Drawable = { y: number; fn: () => void }
  const list: Drawable[] = []

  // Head farmer by the house.
  const hf = FARM.headFarmer
  list.push({
    y: hf.y,
    fn: () => drawChar(ctx, hf.x, hf.y, 'idle', 'down', clock, undefined),
  })
  hits.push({ kind: 'head', id: 'head', rect: { x: hf.x * TILE - 8, y: hf.y * TILE - 18, w: 16, h: 20 }, title: 'Head farmer', body: headStatus(e) })

  if (planned || e.phase === 'plan') {
    for (const fh of Object.values(e.farmhands)) {
      if (e.phase === 'plan') continue
      list.push({ y: fh.y, fn: () => drawFarmhand(ctx, e, fh, clock) })
      hits.push({ kind: 'farmhand', id: fh.id, rect: { x: fh.x * TILE - 8, y: fh.y * TILE - 20, w: 16, h: 22 }, title: fh.role, body: fhStatus(e, fh) })
    }
  }

  // Neighbour Priya and her crew, wandering between plots.
  const priya = { x: 64.5 + Math.sin(clock * 0.3) * 0.4, y: 8.6 }
  list.push({ y: priya.y, fn: () => drawChar(ctx, priya.x, priya.y, 'idle', 'down', clock, { body: '#d7c6f0', shade: '#a596c9' }) })
  hits.push({ kind: 'neighbour', id: 'priya', rect: { x: priya.x * TILE - 8, y: priya.y * TILE - 18, w: 16, h: 20 }, title: 'Priya, eng lead', body: 'Runs the Auth SDK v2 farm' })
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

  // Chickens on the PM farm.
  for (let i = 0; i < 3; i++) {
    const ph = clock * 0.35 + i * 2
    const x = 22 + i * 2.2 + Math.sin(ph) * 1.6
    const y = 6.2 + i * 0.6
    list.push({ y, fn: () => draw(ctx, `chicken_${Math.floor(clock * 3 + i) % 2}`, x * TILE - 8, y * TILE - 14, { flip: Math.cos(ph) < 0 }) })
  }

  list.sort((a, b) => a.y - b.y).forEach((d) => d.fn())

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
      const ours = e.task('draft').plot
      const theirs = NEIGHBOUR_PLOTS.find((p) => p.drought)?.plot ?? NEIGHBOUR_PLOTS[0].plot
      ctx.save()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(122, 82, 170, 0.9)'
      for (const r of [ours, theirs]) {
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo((r.x + r.w / 2) * TILE, r.y * TILE - 2)
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
    // a fence post to stand on
    if (!flying) draw(ctx, 'fence_03', CROW_SPOT.x * TILE - 8, CROW_SPOT.y * TILE - 6)
    ctx.save()
    if (e.crow.state === 'leaving') {
      ctx.translate(cx + 16, cy)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0)
    } else if (flying) ctx.drawImage(img, cx, cy)
    else ctx.drawImage(img, cx - 4, cy - 16, 24, 24)
    ctx.restore()
    hits.push({ kind: 'crow', id: 'crow', rect: { x: cx - 2, y: cy - 10, w: 20, h: 20 }, title: 'Crow', body: 'Two launch dates conflict: March 12 vs March 26' })
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

  // ---- screen-space overlays: labels, emotes ----
  const toScreen = (wx: number, wy: number) => ({ x: (wx * TILE - cam.x) * cam.scale, y: (wy * TILE - cam.y) * cam.scale })

  if (replay) {
    ctx.save()
    ctx.fillStyle = 'rgba(112, 82, 40, 0.20)'
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  if (e.view === 'farm' && (showPlan || planned)) {
    // Plot labels. Each one moves down until it clears the labels already placed.
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const focus = new Set(e.tasks.filter((t) => (e.selected && t.assignee === e.selected) || e.activeAsk?.taskId === t.id).map((t) => t.id))
    e.tasks.forEach((t) => {
      if (!focus.has(t.id)) return
      const p = toScreen(t.plot.x + t.plot.w / 2, t.plot.y + t.plot.h + (planned ? 1.35 : 0.2))
      const sub = planned ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : cap(t.assignee)
      const accent = planned ? e.farmhands[t.assignee].color : undefined
      label(ctx, p.x, p.y + (showPlan ? 4 : 0), t.name, sub, t.dry ? '#e8a05a' : accent, cam.scale, placed)
    })
  }

  if (e.view === 'farm') {
    const hfp = toScreen(hf.x, hf.y - 1.55)
    nameTag(ctx, hfp.x, hfp.y, 'Head farmer', '#f3f2c0')
    if (e.headThinking > 0 || headWaiting(e)) emote(ctx, hfp.x, hfp.y - 14, e.headThinking > 0 ? 'question' : 'alert', clock, cam.scale)

    if (planned) {
      for (const fh of Object.values(e.farmhands)) {
        const p = toScreen(fh.x, fh.y - 1.5)
        if (e.selected === fh.id || fh.status === 'asking') nameTag(ctx, p.x, p.y, fh.role, fh.color, e.selected === fh.id)
        const em = fh.status === 'asking' ? 'alert' : fh.status === 'waiting' ? 'sleep' : null
        if (em) emote(ctx, p.x, p.y - 14, em, clock, cam.scale)
      }
    }
    const pp = toScreen(priya.x, priya.y - 1.55)
    nameTag(ctx, pp.x, pp.y, 'Priya', '#d7c6f0')

    if (e.crow.state === 'landed') {
      const p = toScreen(CROW_SPOT.x, CROW_SPOT.y - 2.2)
      emote(ctx, p.x, p.y, 'question', clock, cam.scale)
    }
  }

  // Farm name banners (farm view: just this farm and the neighbour; valley view: all four with stats).
  const farmsForBanner = [
    { name: FARM.name, rect: FARM.rect, owner: 'You (PM)' },
    { name: NEIGHBOUR.name, rect: NEIGHBOUR.rect, owner: 'Priya (eng lead)' },
    ...OTHER_FARMS.map((f) => ({ name: f.name, rect: f.rect, owner: `${f.owner} (${f.ownerRole})` })),
  ]
  for (const f of farmsForBanner) {
    if (e.view === 'farm' && !(f.name === FARM.name || f.name === NEIGHBOUR.name)) continue
    const p = toScreen(f.rect.x + f.rect.w / 2, f.rect.y + 0.1)
    if (e.view === 'valley') valleyCard(ctx, p.x, toScreen(0, f.rect.y + f.rect.h / 2).y, f.name, f.owner, statsFor(e, f.name))
    else banner(ctx, p.x, p.y, f.name)
    hits.push({ kind: 'farm', id: f.name, rect: px(f.rect), title: f.name, body: f.owner })
  }

  return { hits }
}

// ---- small drawing helpers ----------------------------------------------------------

function drawFarmhand(ctx: CanvasRenderingContext2D, e: Engine, fh: Farmhand, clock: number) {
  const tint = { body: fh.color, shade: fh.colorDark }
  let anim = 'idle'
  let dir: Dir = 'down'
  if (fh.path.length) {
    anim = 'walk'
    const p = fh.path[0]
    const dx = p.x - fh.x
    const dy = p.y - fh.y
    dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
  } else if (fh.status === 'working') {
    const job = fh.job
    const first = job?.kind === 'sub' && e.task(job.taskId).subtasks[0]?.id === job.subId
    anim = job?.kind === 'fix' ? 'chop' : first ? 'till' : 'water'
    dir = 'up'
  }
  const sel = e.selected === fh.id
  if (sel) {
    ctx.save()
    ctx.strokeStyle = '#fff6c8'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.ellipse(fh.x * TILE, fh.y * TILE - 1, 9, 4, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  drawChar(ctx, fh.x, fh.y, anim, dir, clock, tint)
}

function px(r: Rect): Rect {
  return { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE }
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1)
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
  if (e.phase === 'clarify') return 'Has 3 questions for you'
  if (e.phase === 'plan') return 'Proposed a quest plan. Waiting for your approval.'
  if (e.openAsks.length) return `Relaying ${e.openAsks.length} ask${e.openAsks.length > 1 ? 's' : ''}`
  return 'Watching the crew'
}

function fhStatus(e: Engine, fh: Farmhand) {
  const job = fh.job
  if (fh.status === 'asking') return 'Waiting for your answer'
  if (job?.kind === 'fix') return `Fixing: ${job.label}`
  if (job?.kind === 'sub') {
    const t = e.task(job.taskId)
    const s = t.subtasks.find((x) => x.id === job.subId)
    return `${t.name} → ${s?.name}`
  }
  if (fh.status === 'waiting') return 'Waiting on another task'
  return 'Done for now'
}

function statsFor(e: Engine, name: string) {
  const s = { ...VALLEY_STATS[name] }
  if (name === FARM.name) {
    s.energyWeek = e.energyUsed
    s.pests = e.tasks.reduce((n, t) => n + t.pests.length, 0)
    s.waiting = e.openAsks.length
    s.harvests = e.harvestReady ? 1 : 0
  }
  return s
}

const FONT = '"SproutLands", "JetBrains Mono", monospace'

function nameTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, selected = false) {
  ctx.save()
  ctx.font = `16px ${FONT}`
  const w = Math.ceil(ctx.measureText(text).width) + 10
  const h = 15
  const rx = Math.round(Math.max(4, Math.min(viewW - w - 4, x - w / 2)))
  const ry = Math.round(y - h)
  ctx.fillStyle = selected ? '#fff6c8' : 'rgba(255,250,232,0.92)'
  ctx.fillRect(rx, ry, w, h)
  ctx.fillStyle = color
  ctx.fillRect(rx, ry + h - 3, w, 3)
  ctx.strokeStyle = '#5c4e92'
  ctx.lineWidth = 1
  ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1)
  ctx.fillStyle = '#3e3150'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, rx + w / 2, ry + 6.5)
  ctx.restore()
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, sub: string, accent: string | undefined, scale: number, placed: { x: number; y: number; w: number; h: number }[]) {
  if (scale < 1.2) return
  ctx.save()
  ctx.font = `16px ${FONT}`
  const t = `${text}  ${sub}`
  const w = Math.ceil(ctx.measureText(t).width) + 12
  const rx = Math.round(Math.max(4, Math.min(viewW - w - 4, x - w / 2)))
  let ry = Math.round(y)
  const hits = (yy: number) => placed.some((r) => rx < r.x + r.w + 4 && rx + w + 4 > r.x && yy < r.y + r.h + 2 && yy + 15 + 2 > r.y)
  while (hits(ry)) ry += 17
  placed.push({ x: rx, y: ry, w, h: 15 })
  ctx.fillStyle = 'rgba(62,49,80,0.78)'
  ctx.fillRect(rx, ry, w, 15)
  if (accent) {
    ctx.fillStyle = accent
    ctx.fillRect(rx, ry, 3, 15)
  }
  ctx.fillStyle = '#fbf6df'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(t, rx + w / 2, ry + 7)
  ctx.restore()
}

function banner(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.save()
  ctx.font = `20px ${FONT}`
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

function valleyCard(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, owner: string, s: ReturnType<typeof statsFor>) {
  ctx.save()
  const lines = [
    `${s.agents} agents, ${s.waiting} waiting on a human`,
    ...(s.unattended ? [s.unattended] : []),
  ]
  ctx.font = `15px ${FONT}`
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 160) + 28
  const h = 50 + lines.length * 17
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
  ctx.fillStyle = '#766daa'
  ctx.fillText(owner, rx + 14, ry + 31)
  ctx.fillStyle = '#3e3150'
  lines.forEach((l, i) => ctx.fillText(l, rx + 14, ry + 50 + i * 17))
  ctx.restore()
}

function emote(ctx: CanvasRenderingContext2D, x: number, y: number, kind: 'alert' | 'question' | 'sleep' | 'check', clock: number, scale: number) {
  const name = `emote_${kind}`
  if (!hasFrame(name)) return
  const bob = Math.round(Math.sin(clock * 5) * 2)
  const s = Math.max(1, Math.min(2, scale * 0.45))
  ctx.save()
  ctx.imageSmoothingEnabled = false
  draw(ctx, name, Math.round(x - 8 * s), Math.round(y - 20 * s + bob), { scale: s * 0.6 })
  ctx.restore()
}

// ---- camera ----------------------------------------------------------------------------

// `inset` is the screen height the HUD covers at the top; the target is framed below it.
export function fitCamera(target: Rect, W: number, H: number, inset = 0): Camera {
  const scale = Math.min(W / (target.w * TILE), (H - inset) / (target.h * TILE))
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

export type { Task }
