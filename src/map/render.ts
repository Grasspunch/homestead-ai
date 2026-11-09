// Draws the valley. The map shows state at a glance; every decision lives in the quest log.
import { draw, frame as frameSize, hasFrame, animCounts, pixelSprite } from './atlas'
import { cropTiles, type Engine } from '../sim/engine'
import { CROW_SPOT, FARM, NEIGHBOUR, NEIGHBOUR_PLOTS, OTHER_FARMS, PROPS, TILE, VALLEY_STATS, WORLD, type Prop } from '../sim/scenario'
import type { Dir, Farmhand, Rect, Task } from '../sim/types'

export interface Camera {
  x: number // world px at screen left
  y: number
  scale: number
}

export interface Hit {
  kind: 'plot' | 'farmhand' | 'head' | 'signpost' | 'pest' | 'crow' | 'neighbour' | 'nplot' | 'farm' | 'prop' | 'chicken' | 'sign'
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

function layer() {
  const c = document.createElement('canvas')
  c.width = WORLD.w * TILE
  c.height = WORLD.h * TILE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  return { c, ctx }
}

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

const POND = PROPS.find((p) => p.kind === 'pond')!

function buildBackground() {
  const g = layer()
  for (let y = 0; y < WORLD.h; y++)
    for (let x = 0; x < WORLD.w; x++) {
      draw(g.ctx, 'grass', x * TILE, y * TILE)
      const n = hash(x, y)
      if (n < 0.16) draw(g.ctx, `grass_deco_${Math.floor(n * 75) % 12}`, x * TILE, y * TILE)
    }
  // Dirt lanes between farms.
  const lane = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) draw(g.ctx, 'path_11', x * TILE, y * TILE)
  }
  lane({ x: 37, y: 0, w: 2, h: WORLD.h })
  lane({ x: 0, y: 23.5, w: WORLD.w, h: 2 })
  for (let y = POND.y; y < POND.y + POND.h; y++) for (let x = POND.x; x < POND.x + POND.w; x++) draw(g.ctx, 'water_0', x * TILE, y * TILE)
  // Flowers in the grass.
  draw(g.ctx, 'flower_1', 9 * TILE, 21 * TILE)
  draw(g.ctx, 'flower_4', 15 * TILE, 20.5 * TILE)
  draw(g.ctx, 'flower_6', 4 * TILE, 20 * TILE)

  const f = layer()
  const farms = [
    { rect: FARM.rect, gates: [{ side: 'e' as const, at: 12 }, { side: 's' as const, at: 19 }] },
    { rect: NEIGHBOUR.rect, gates: [{ side: 'w' as const, at: 12 }, { side: 's' as const, at: 57 }] },
    ...OTHER_FARMS.map((o) => ({ rect: o.rect, gates: [{ side: 'w' as const, at: o.rect.y + 6 }] })),
  ]
  for (const fm of farms) fenceRect(f.ctx, fm.rect, fm.gates)

  const b = layer()
  // Trees along the valley edge.
  const trees: [string, number, number][] = [
    ['tree_big', 0, 0], ['tree', 35, 0.5], ['tree_small', 39.5, 22], ['tree', 74, 0.2], ['tree_big', 73, 20],
    ['tree', 0, 21], ['tree_small', 36, 43], ['tree', 74, 43], ['tree_big', 0.2, 43],
  ]
  for (const [n, x, y] of trees) draw(b.ctx, n, x * TILE, y * TILE - 8)
  // Brand refresh: a flower garden. Invoices: an orchard.
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
  if (st.tone === 'warn') return 'cross'
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
  ctx.drawImage(L.ground, 0, 0)
  const wf = Math.floor(clock * 2.5) % 4
  for (let y = POND.y; y < POND.y + POND.h; y++) for (let x = POND.x; x < POND.x + POND.w; x++) draw(ctx, `water_${wf}`, x * TILE, y * TILE)
  ctx.globalAlpha = fade(0.35)
  ctx.drawImage(L.fences, 0, 0)
  const built = fade(0.7)
  ctx.globalAlpha = built
  ctx.drawImage(L.buildings, 0, 0)
  ctx.globalAlpha = 1

  const replay = !!e.trace
  const planning = e.phase === 'plan'
  const planned = e.phase === 'grow' || e.phase === 'harvest'
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
    hits.push({ kind: 'nplot', id: np.name, rect: px(np.plot), title: np.name, body: `${NEIGHBOUR.name}${dry ? ', blocked by the auth dependency' : ''}` })
  }

  // Plots. During Plan the head farmer tills them one by one.
  e.tasks.forEach((t, i) => {
    const r = t.plot
    const bedRect = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }
    let shown = planned
    if (planning) {
      const k = i < e.planShown ? 1 : i === e.planShown ? (e.head.till[i] ?? 0) : 0
      if (k <= 0) return
      shown = k >= 1
      ctx.save()
      ctx.beginPath()
      ctx.rect(bedRect.x * TILE, bedRect.y * TILE, bedRect.w * TILE * k, bedRect.h * TILE)
      ctx.clip()
      bed(ctx, r, false)
      ctx.restore()
    } else if (planned) {
      bed(ctx, r, t.dry)
      if (!e.picked.has(t.id)) {
        for (const c of cropTiles(t)) {
          const s = t.subtasks[c.sub]
          if (!s) continue
          draw(ctx, `crop_${t.crop}_${stageOf(s.progress, s.done)}`, c.x * TILE, c.y * TILE)
        }
      }
    } else return
    if (!shown) return

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
    hits.push({ kind: 'sign', id: `sign-${t.id}`, rect: { x: sx, y: sy, w: 16, h: 16 }, title: '' })
    if (planned) {
      const frac = t.subtasks.reduce((n, s) => n + (s.done ? 1 : s.progress), 0) / t.subtasks.length
      ctx.fillStyle = 'rgba(62,49,80,0.7)'
      ctx.fillRect(sx - 2, sy + 17, 20, 4)
      ctx.fillStyle = frac >= 1 ? '#4f8f3f' : t.dry ? '#e8a05a' : '#7fc06a'
      ctx.fillRect(sx - 1, sy + 18, Math.max(1, 18 * frac), 2)
      const em = e.picked.has(t.id) ? null : plotEmote(e, t)
      if (em) worldEmote(ctx, (bedRect.x + bedRect.w) * TILE - 6, bedRect.y * TILE - 2, em, clock, em === 'alert')
    }

    // Files and skills the task reads, along the left edge.
    t.signposts.forEach((s, k) => {
      const px0 = (r.x - 2) * TILE
      const py0 = (r.y + k * 0.7 + 0.3) * TILE
      if (k > r.h) return
      draw(ctx, 'sign_blank', px0, py0)
      hits.push({ kind: 'signpost', id: `${t.id}:${s}`, rect: { x: px0, y: py0, w: 16, h: 16 }, title: s, body: s === 'eng-standup-notes/' ? 'Added by the re-plan' : `Read by ${t.name}` })
    })
    if (replay && t.id === 'draft' && !t.signposts.includes('eng-standup-notes/')) {
      // The missing file: what the Writer never saw.
      const k = t.signposts.length
      const px0 = (r.x - 2) * TILE
      const py0 = (r.y + k * 0.7 + 0.3) * TILE
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
      hits.push({ kind: 'pest', id: p.id, rect: { x: bx - 8, y: by - 8, w: 16, h: 16 }, title: 'Beetle', body: p.label })
    }

    const st = e.taskStatus(t)
    hits.push({
      kind: 'plot',
      id: t.id,
      rect: px(r),
      title: t.name,
      body: planned ? `${e.farmhands[t.assignee].role}. ${st.text}.` : `Proposed for the ${e.farmhands[t.assignee].role.toLowerCase()}`,
    })
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

  // The shipping chest, where the harvest goes.
  const sh = FARM.shipping
  const shipOpen = e.phase === 'harvest' && e.harvestStage === 'map'
  list.push({ y: sh.y + 0.6, fn: () => draw(ctx, shipOpen ? 'chest_open' : 'chest', sh.x * TILE - 8, sh.y * TILE - 6) })

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
    hits.push({ kind: 'farmhand', id: fh.id, rect: { x: fh.x * TILE - 8, y: fh.y * TILE - 20, w: 16, h: 22 }, title: fh.role, body: e.fhStatus(fh) })
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
    if (crop) draw(ctx, `crop_${crop}_3`, fh.x * TILE - 8, fh.y * TILE - 46)
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
    if (!flying) draw(ctx, 'fence_03', CROW_SPOT.x * TILE - 8, CROW_SPOT.y * TILE - 6)
    ctx.save()
    if (e.crow.state === 'leaving') {
      ctx.translate(cx + 16, cy)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0)
    } else if (flying) ctx.drawImage(img, cx, cy)
    else ctx.drawImage(img, cx - 4, cy - 16, 24, 24)
    ctx.restore()
    hits.push({ kind: 'crow', id: 'crow', rect: { x: cx - 2, y: cy - 10, w: 20, h: 20 }, title: 'Crow', body: 'Two launch dates disagree' })
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

  if (e.view === 'farm' && !e.intro && (planning || planned)) {
    // Labels only for the plots in focus. Each moves down until it clears the ones already placed.
    const placed: { x: number; y: number; w: number; h: number }[] = []
    e.tasks.forEach((t, i) => {
      if (!focusIds.has(t.id) || (planning && i >= e.planShown)) return
      const p = toScreen(t.plot.x + t.plot.w / 2, t.plot.y + t.plot.h + 1.35)
      const sub = planned ? e.taskStatus(t).text : e.farmhands[t.assignee].role
      label(ctx, p.x, p.y, t.name, sub, e.farmhands[t.assignee].color, cam.scale, placed)
    })
  }

  if (e.view === 'farm' && !(e.intro && e.beat < 2)) {
    const hfp = toScreen(hf.x, hf.y - 1.55)
    if (!e.intro) nameTag(ctx, hfp.x, hfp.y, 'Head farmer', '#f3f2c0')
    if (e.headThinking > 0 || headWaiting(e)) emote(ctx, hfp.x, hfp.y - 14, e.headThinking > 0 ? 'question' : 'alert', clock, cam.scale)
    for (const fh of Object.values(e.farmhands)) {
      if (fh.inside) continue
      const p = toScreen(fh.x, fh.y - 1.5)
      const sel = e.selected === fh.id
      if (sel || fh.status === 'asking') nameTag(ctx, p.x, p.y, fh.role, fh.color, sel)
      const chore = e.choreOf(fh)
      const reacting = clock - fh.react < REACT * 2
      if (reacting) {
        ctx.save()
        ctx.imageSmoothingEnabled = false
        const s = Math.max(1, cam.scale * 0.6)
        pixel(ctx, 'heart', p.x, p.y - 14 - (reduced ? 0 : ((clock - fh.react) / (REACT * 2)) * 8), 1, s)
        ctx.restore()
        continue
      }
      const em = fh.status === 'asking' ? 'alert' : chore?.emote === 'sleep' ? 'sleep' : null
      if (em) emote(ctx, p.x, p.y - 14, em, clock, cam.scale)
    }
    if (e.crow.state === 'landed') {
      const p = toScreen(CROW_SPOT.x, CROW_SPOT.y - 2.2)
      emote(ctx, p.x, p.y, 'question', clock, cam.scale)
    }
  }

  // The harvest headline rises over the shipping chest while the crops come in.
  if (e.phase === 'harvest' && e.harvestStage === 'map') {
    const k = Math.min(1, (clock - e.harvestT) / 1.2)
    const p = toScreen(sh.x, sh.y - 2.2 - k * 1.2)
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
    banner(ctx, ours.x, ours.y, 'Launch March 12', 18)
    ctx.globalAlpha = Math.min(1, Math.max(0, (clock - e.beatT - 2.2) / 0.5))
    if (reduced) ctx.globalAlpha = 1
    banner(ctx, theirs.x, theirs.y, 'Ship March 26', 18)
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
  drawChar(ctx, fh.x, fh.y, anim, dir, t, tint, fh.fade * (fh.paused ? 0.55 : 1))
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

function emote(ctx: CanvasRenderingContext2D, x: number, y: number, kind: EmoteKind, clock: number, scale: number) {
  const name = `emote_${kind}`
  if (!hasFrame(name)) return
  const bob = reduced ? 0 : Math.round(Math.sin(clock * 5) * 2)
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
