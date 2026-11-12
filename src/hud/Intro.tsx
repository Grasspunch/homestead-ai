// The pitch's opening visual: the babysitter on the farm. Shown only at /?demo, over Home.
// Beat 0 (on load): the farm, working quietly, so the presenter can share the screen first.
// Beat 1 (click or →): five farmers keep asking small things. You run from plot to plot answering,
//   and the questions pile up faster than you can clear them. You go red and start to shake as they do.
// Beat 2 (click or →): while you're busy, a plot on the far side wilts. Nobody asked about that one.
// Beat 3 (click or →): you storm to the middle of the farm, boil over and slam the hoe down. The
//   shockwave bursts every question and heals the plot. Four plots are picked, the Planner brings the
//   basket to your porch ("4 tasks done. 1 needs your OK."), and the Homestead AI logo comes in.
// Next click: the farm lifts away to Home, which has been mounted underneath all along.
import '../fonts'
import './hud.css'
import { useEffect, useRef } from 'react'
import { draw } from '../map/atlas'
import { atlasLoaded } from './bits'
import { TINT } from '../run/crew'
import type { FarmerId } from '../run/types'

const PX = 16
const WW = 28 // world size in tiles
const WH = 16
type Dir = 'down' | 'up' | 'left' | 'right'
type Tint = { body: string; shade: string }
const YOU: Tint = { body: '#f2b4a8', shade: '#d98f82' }

type Plot = { x: number; y: number; crop: string; who: FarmerId }
const PLOTS: Plot[] = [
  { x: 8, y: 2.5, crop: 'wheat', who: 'planner' },
  { x: 14.5, y: 2.5, crop: 'carrot', who: 'builder' },
  { x: 21, y: 2.5, crop: 'tulip', who: 'designer' },
  { x: 10.5, y: 10, crop: 'cabbage', who: 'tester' },
  { x: 18, y: 10, crop: 'pumpkin', who: 'deployer' },
]
const PW = 3
const PH = 2
const PORCH = { x: 3.1, y: 6.1 }
const CENTER = { x: 14.5, y: 8.4 } // where you storm to before the slam
const CALLER = 4 // the Deployer raises the one "!" on beat 3

const ASKS: Record<FarmerId, string[]> = {
  planner: ['Read package.json?', 'Open README?', 'Search for "coin"?', 'Check the issue?'],
  builder: ['npm install?', 'Edit top-bar.tsx?', 'Run git status?', 'Run the linter?', 'Add @types/react?'],
  designer: ['Take a screenshot?', 'Change a colour?', 'Rename Button.tsx?', 'Export the icon?'],
  tester: ['Run tests again?', 'Start dev server?', 'Delete a snapshot?', 'Write a test file?'],
  deployer: ['Read the CI config?', 'Check build logs?', 'Bump the version?', 'Open the dashboard?'],
}

// A farmer stands in its plot, the way they do on the real farm.
const spot = (i: number, t: number) => {
  const p = PLOTS[i]
  const sway = (Math.sin(t / 2600 + i * 1.7) + 1) / 2
  return { x: p.x + 0.5 + sway * (PW - 1), y: p.y + 1.7 }
}

type Req = { who: number; text: string; born: number }

type Sim = {
  t: number
  beat: number
  beatAt: number[]
  reqs: Req[]
  nextAt: number
  gap: number
  n: number
  you: { x: number; y: number; dir: Dir; moving: boolean }
  target: number | null
  waitUntil: number
  cleared: { who: number; at: number }[]
  wiltAt: number
  broken: number // the plot that wilts on beat 2: the one farthest from you
  pops: { x: number; y: number; at: number }[]
  slam: { x: number; y: number; at: number } | null // where and when the hoe hits on beat 3
  bursts: { x: number; y: number; at: number; text: string; n: number }[]
  stress: number // 0 calm .. 1 boiling over: redder and shakier
  dashFrom: number // when you start storming to the centre
}

function newSim(): Sim {
  return {
    t: 0,
    beat: 0,
    beatAt: [0, 0],
    reqs: [],
    nextAt: Infinity,
    gap: 1500,
    n: 0,
    you: { x: PORCH.x + 2, y: PORCH.y + 1, dir: 'right', moving: false },
    target: null,
    waitUntil: 0,
    cleared: [],
    wiltAt: -1,
    broken: -1,
    pops: [],
    slam: null,
    bursts: [],
    stress: 0,
    dashFrom: 0,
  }
}

// A fixed order of who asks next, so every run looks the same.
const ORDER = [1, 3, 0, 2, 4, 1, 2, 3, 1, 0, 4, 3, 1, 2, 0, 1, 4, 3, 2, 1, 0, 3, 4, 2]

function step(s: Sim, dt: number) {
  s.t += dt
  const t = s.t
  if (s.beat === 1 || s.beat === 2) {
    // Questions arrive faster and faster.
    while (t >= s.nextAt) {
      const who = ORDER[s.n % ORDER.length]
      const list = ASKS[PLOTS[who].who]
      s.reqs.push({ who, text: list[Math.floor(s.n / ORDER.length + s.n) % list.length], born: s.nextAt })
      s.n++
      s.nextAt += s.gap
      s.gap = Math.max(420, s.gap * 0.93)
    }
  }
  const you = s.you
  let goal: { x: number; y: number } | null = null
  if (s.beat === 0) goal = null
  else if (s.beat < 3) {
    // Once something has broken, you're too busy elsewhere to go near it.
    if (s.target === null) s.target = s.reqs.find((r) => r.who !== s.broken)?.who ?? null
    if (s.target !== null) {
      const f = spot(s.target, t)
      goal = { x: f.x + (you.x < f.x ? -1.1 : 1.1), y: f.y + 0.2 }
    }
  } else if (s.slam && s.t < s.slam.at - WIND) goal = CENTER
  else goal = s.slam && s.t < s.slam.at + WAVE + 350 ? null : PORCH
  you.moving = false
  if (goal) {
    const dx = goal.x - you.x
    const dy = goal.y - you.y
    const d = Math.hypot(dx, dy)
    const dashing = s.beat === 3 && !!s.slam && s.t < s.slam.at - WIND
    const speed = (dashing ? DASH_SPEED : s.beat < 3 ? 7.5 : 5) / 1000
    if (d > 0.08) {
      const m = Math.min(d, speed * dt)
      you.x += (dx / d) * m
      you.y += (dy / d) * m
      you.moving = true
      you.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
      s.waitUntil = t + 260
    } else if (s.beat < 3 && s.target !== null) {
      // Arrived: a moment to read it, then answer one question and run to the next.
      const f = spot(s.target, t)
      you.dir = f.x > you.x ? 'right' : 'left'
      if (t >= s.waitUntil) {
        const i = s.reqs.findIndex((r) => r.who === s.target)
        if (i >= 0) {
          s.reqs.splice(i, 1)
          s.cleared.push({ who: s.target, at: t })
        }
        s.target = null
      }
    } else if (s.beat === 3) you.dir = 'down'
  } else if (s.beat === 3) {
    you.dir = 'down'
  } else if (s.beat === 0) {
    // Waiting by the porch for the pitch to start.
    you.dir = 'down'
  }
  s.cleared = s.cleared.filter((c) => t - c.at < 700)
  if (s.slam && t >= s.slam.at) {
    // Each pile of questions bursts the moment the ring reaches it.
    const r = ring(s, t)
    PLOTS.forEach((_, i) => {
      const mine = s.reqs.filter((q) => q.who === i)
      if (!mine.length) return
      const f = spot(i, t)
      if (Math.hypot(f.x - s.slam!.x, f.y - s.slam!.y) > r) return
      s.bursts.push({ x: f.x, y: f.y, at: t, text: mine[0].text, n: mine.length })
      s.reqs = s.reqs.filter((q) => q.who !== i)
    })
  }
  s.bursts = s.bursts.filter((b) => t - b.at < 450)
  // Stress follows the pile: a few questions turn you pink, a dozen make you shake, a broken plot tips you over.
  let want = 0
  if (s.beat === 1 || s.beat === 2) want = Math.min(0.92, 0.12 + s.reqs.length / 11 + (s.beat === 2 ? 0.3 : 0))
  else if (s.beat === 3 && s.slam) want = t < s.slam.at ? 1 : 0
  const rate = s.beat === 3 && s.slam && t >= s.slam.at ? 700 : 900
  s.stress += (want - s.stress) * Math.min(1, dt / rate)
  if (s.beat === 3 && s.slam && t < s.slam.at && t > s.dashFrom + 150) s.stress = Math.max(s.stress, 0.97)
}

// After the slam: four plots are picked one after another, and the Planner carries the basket to your porch.
// The Deployer's plot stays ripe: that's the one that needs your OK.
const HARVEST_FROM = 300 // ms after the wave
const HARVEST_STEP = 220
const COURIER = 0
const DROP = { x: 5.0, y: 6.7 }
const CARRY_FROM = 1600
const CARRY_SPEED = 4.5 // tiles a second
const afterWave = (s: Sim, t: number) => (s.slam ? t - s.slam.at - WAVE : -Infinity)
const harvestAt = (i: number) => (i === CALLER ? Infinity : HARVEST_FROM + PLOTS.filter((_, j) => j !== CALLER).indexOf(PLOTS[i]) * HARVEST_STEP)
// Where the Planner is while it carries the basket, and whether it has arrived.
const courier = (s: Sim, t: number) => {
  const from = spot(COURIER, s.slam ? s.slam.at + WAVE + CARRY_FROM : t)
  const d = Math.hypot(DROP.x - from.x, DROP.y - from.y)
  const k = Math.min(1, Math.max(0, (afterWave(s, t) - CARRY_FROM) / ((d / CARRY_SPEED) * 1000)))
  return { x: from.x + (DROP.x - from.x) * k, y: from.y + (DROP.y - from.y) * k, k, left: DROP.x < from.x, arrivedAt: CARRY_FROM + (d / CARRY_SPEED) * 1000 }
}

const DASH_SPEED = 15 // tiles a second, storming to the centre
const BOIL = 650 // ms you stand in the centre, shaking and red, before the wind-up

// The hit: a short wind-up, then a ring that reaches the far corner of the farm in WAVE ms.
const WIND = 240
const WAVE = 520
const REACH = Math.hypot(WW, WH)
const ring = (s: Sim, t: number) => {
  if (!s.slam || t < s.slam.at) return 0
  const k = Math.min(1, (t - s.slam.at) / WAVE)
  return REACH * (1 - Math.pow(1 - k, 2.2))
}
// When the ring reaches a point, in ms since the slam (inverse of the ease above).
const reachAt = (s: Sim, x: number, y: number) => {
  if (!s.slam) return Infinity
  const d = Math.min(1, Math.hypot(x - s.slam.x, y - s.slam.y) / REACH)
  return s.slam.at + WAVE * (1 - Math.pow(1 - d, 1 / 2.2))
}

export function Intro({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    let raf = 0
    let alive = true
    const s = newSim()
    let last = 0
    let ready = false

    // The brand loader sits on top until it has dissolved; input goes to it until then.
    const loading = () => !!document.querySelector('[data-brand-loader]')
    const advance = () => {
      if (!ready || loading()) return
      if (s.beat === 0) {
        s.beat = 1
        s.nextAt = s.t + 400
      } else if (s.beat === 1) {
        s.beat = 2
        s.wiltAt = s.t
        const d = (i: number) => {
          const f = spot(i, s.t)
          return Math.hypot(f.x - s.you.x, f.y - s.you.y)
        }
        s.broken = [0, 1, 2, 3, 4].filter((i) => i !== CALLER).sort((a, b) => d(b) - d(a))[0]
        if (s.target === s.broken) s.target = null
      } else if (s.beat === 2) {
        s.beat = 3
        s.beatAt[1] = s.t
        s.pops = []
        s.target = null
        // You stop dead and slam the hoe down. The shockwave clears whatever it passes.
        const dash = Math.max(250, (Math.hypot(CENTER.x - s.you.x, CENTER.y - s.you.y) / DASH_SPEED) * 1000)
        s.dashFrom = s.t
        s.slam = { x: CENTER.x, y: CENTER.y, at: s.t + dash + BOIL + WIND }
      } else onDone()
    }
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', ' ', 'Enter', 'PageDown'].includes(e.key)) {
        // Home sits underneath: keep these keys from reaching it while the intro is up.
        e.preventDefault()
        e.stopImmediatePropagation()
        advance()
      }
    }
    c.addEventListener('pointerdown', advance)
    window.addEventListener('keydown', key, true)

    Promise.all([atlasLoaded(), document.fonts.load('20px px7'), document.fonts.load('14px px4')]).then(() => {
      if (!alive) return
      ready = true
      const frame = (now: number) => {
        if (!alive) return
        const dt = last ? Math.min(50, now - last) : 16
        last = now
        step(s, dt)
        render(c, s)
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      c.removeEventListener('pointerdown', advance)
      window.removeEventListener('keydown', key, true)
    }
  }, [onDone])
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, zIndex: 1000, width: '100vw', height: '100vh', display: 'block', cursor: 'pointer', background: '#8fc77a' }} />
}

function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function render(c: HTMLCanvasElement, s: Sim) {
  const dpr = window.devicePixelRatio || 1
  const W = window.innerWidth
  const H = window.innerHeight
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
  }
  const g = c.getContext('2d')!
  const t = s.t
  const punch = s.slam && t >= s.slam.at && t < s.slam.at + 320 ? (1 - (t - s.slam.at) / 320) ** 2 * 0.045 : 0
  const sc = Math.min(W / (WW * PX), H / (WH * PX)) * (1 + punch)
  // The hit shakes the whole farm for a moment.
  const since0 = s.slam ? t - s.slam.at : -1
  const quake = since0 >= 0 && since0 < 380 ? (1 - since0 / 380) ** 2 * 9 : 0
  const ox = (W - WW * PX * sc) / 2 + Math.round(Math.sin(t * 0.21) * quake)
  const oy = (H - WH * PX * sc) / 2 + Math.round(Math.cos(t * 0.27) * quake)
  // World tile to screen pixel.
  const sx = (x: number) => ox + x * PX * sc
  const sy = (y: number) => oy + y * PX * sc

  g.setTransform(1, 0, 0, 1, 0, 0)
  g.imageSmoothingEnabled = false
  g.fillStyle = '#8fc77a'
  g.fillRect(0, 0, c.width, c.height)
  g.setTransform(sc * dpr, 0, 0, sc * dpr, ox * dpr, oy * dpr)
  const spr = (name: string, x: number, y: number, o: { tint?: Tint; flip?: boolean } = {}) => draw(g, name, Math.round(x * PX), Math.round(y * PX), o)

  const x0 = Math.floor(-ox / (PX * sc)) - 1
  const y0 = Math.floor(-oy / (PX * sc)) - 1
  for (let y = y0; y < WH - y0; y++)
    for (let x = x0; x < WW - x0; x++) {
      spr('grass', x, y)
      const n = rand(x * 73 + y * 151)
      if (n < 0.1) spr(`grass_deco_${Math.floor(n * 100) % 12}`, x, y)
    }

  // Scenery.
  spr('house_2', 1, 1)
  for (const [n, x, y] of [
    ['tree_big', -0.5, 11.5],
    ['tree', 26, -0.4],
    ['tree_apple', 26.2, 7.5],
    ['tree_small', 0, 7],
    ['bush_0', 6.2, 0.4],
    ['bush_1', 25, 13.6],
    ['well', 5.3, 8.6],
    ['flower_2', 6, 13],
    ['flower_5', 7, 13.4],
    ['sunflower', 7.9, 12.3],
    ['flower_8', 25.4, 5.5],
    ['flower_3', 13.6, 7],
  ] as [string, number, number][])
    spr(n, x, y)
  const peck = (i: number) => (Math.floor(t / 500 + i * 3) % 7 === 0 ? 1 : 0)
  spr(`chicken_${peck(0)}`, 3.5, 9.6)
  spr(`chicken_${peck(1)}`, 4.6, 10.4, { flip: true })

  // Beds and crops.
  const fixAt = (p: Plot) => (s.beat === 3 ? reachAt(s, p.x + PW / 2, p.y + PH / 2) : Infinity)
  const fixStart = s.broken >= 0 ? fixAt(PLOTS[s.broken]) : Infinity
  PLOTS.forEach((p, i) => {
    const dry = i === s.broken && s.wiltAt >= 0 && t - s.wiltAt > 200 && t < fixStart
    for (let y = 0; y < PH + 2; y++)
      for (let x = 0; x < PW + 2; x++) {
        const r = y === 0 ? 0 : y === PH + 1 ? 2 : 1
        const cc = x === 0 ? 0 : x === PW + 1 ? 2 : 1
        spr(`bed_${dry ? 'dry' : 'wet'}_${cc}${r}`, p.x - 1 + x, p.y - 1 + y)
      }
    spr(`sign_${p.crop}`, p.x - 2, p.y - 1)
    let k = 0
    for (let y = 0; y < PH; y++)
      for (let x = 0; x < PW; x++, k++) {
        let wilt = false
        if (i === s.broken && s.wiltAt >= 0) {
          wilt = t - s.wiltAt > 250 + k * 220
          if (t - fixStart > k * 35) wilt = false
        }
        const picked = afterWave(s, t) - harvestAt(i) - k * 30
        if (picked > 0) {
          // picked: the crop lifts off the bed and fades
          const q = picked / 260
          if (q < 1) {
            g.globalAlpha = 1 - q
            spr(`crop_${p.crop}_3`, p.x + x, p.y + y - 3 / 16 - q * 0.6)
            g.globalAlpha = 1
          }
        } else if (wilt) {
          g.save()
          g.filter = 'grayscale(1) sepia(1) brightness(0.62) contrast(1.3)'
          spr(`crop_${p.crop}_2`, p.x + x, p.y + y + 0.1)
          g.restore()
        } else spr(`crop_${p.crop}_3`, p.x + x, p.y + y - 3 / 16)
      }
  })

  // Farmers, then you, drawn back to front.
  type Body = { x: number; y: number; draw: () => void }
  const bodies: Body[] = []
  PLOTS.forEach((p, i) => {
    const f0 = spot(i, t)
    const hit = s.slam ? t - reachAt(s, f0.x, f0.y) : -1
    const f = { x: f0.x, y: f0.y - (hit >= 0 && hit < 260 ? Math.sin((hit / 260) * Math.PI) * 0.45 : 0) }
    const fixing = i === s.broken && s.beat === 3 && t >= fixStart && t < fixStart + 2400
    const anim = fixing ? 'water' : p.who === 'designer' ? 'water' : 'till'
    const aw = afterWave(s, t)
    if (i === COURIER && aw > CARRY_FROM) {
      // The Planner walks the basket over to your porch and sets it down.
      const c = courier(s, t)
      const walking = c.k < 1
      bodies.push({
        x: c.x,
        y: c.y,
        draw: () => {
          const fr = Math.floor(t / (walking ? 80 : 140)) % 8
          spr(`char_${walking ? 'walk' : 'idle'}_${walking ? (c.left ? 'left' : 'right') : 'left'}_${fr}`, c.x - 1.5, c.y - 30 / 16 - 0.1, { tint: TINT[p.who] })
          if (walking) spr('basket', c.x - 0.5, c.y - 2.55 + (fr % 2) * 0.06)
          else spr('basket', c.x - 1.55, c.y - 0.75)
        },
      })
      return
    }
    const done = aw - harvestAt(i)
    bodies.push({
      x: f.x,
      y: f.y,
      draw: () => {
        const fr = Math.floor(t / 125 + i * 3) % 8
        spr(`char_${done > 0 ? 'idle' : anim}_down_${fr}`, f.x - 1.5, f.y - 30 / 16 - 0.1, { tint: TINT[p.who] })
        if (done > 0 && done < 900) {
          g.globalAlpha = Math.min(1, (900 - done) / 300)
          spr('emote_check', f.x - 0.9, f.y - 3.4 - Math.min(1, done / 300) * 0.3)
          g.globalAlpha = 1
        }
      },
    })
  })
  const you = s.you
  const st = s.stress
  const boiling = s.slam && t < s.slam.at - WIND && t > s.slam.at - WIND - BOIL
  // Shaking: a tremble that grows with stress, violent while you stand in the centre about to blow.
  const jit = boiling ? 0.22 : st > 0.35 && !you.moving ? (st - 0.35) * 0.12 : 0
  const jx = jit ? Math.sin(t * 1.9) * jit + Math.sin(t * 3.1) * jit * 0.5 : 0
  // The whole of you goes red as it builds, and flashes red while you stand there about to blow.
  const red = boiling ? 0.55 + 0.3 * Math.abs(Math.sin(t / 70)) : Math.min(0.62, st ** 1.6 * 0.62)
  const g0 = g
  const youSpr = (name: string, x: number, y: number) => redSprite(g0, name, x * PX, y * PX, YOU, red)
  bodies.push({
    x: you.x,
    y: you.y,
    draw: () => {
      const sl = s.slam
      if (sl && t < sl.at + 420) {
        // Wind up, then the hoe comes down on the hit and stays there a beat.
        const fr = t < sl.at ? Math.min(SWING_HIT - 1, Math.floor(((t - (sl.at - WIND)) / WIND) * SWING_HIT)) : SWING_HIT
        // a little jump on the wind-up, then down hard
        const up = t < sl.at ? Math.sin(((t - (sl.at - WIND)) / WIND) * Math.PI * 0.5) ** 2 * 0.7 : 0
        youSpr(`char_till_down_${Math.max(0, fr)}`, you.x - 1.5, you.y - 30 / 16 - 0.1 - up)
        return
      }
      const fr = Math.floor(t / (you.moving ? (st > 0.9 ? 45 : 70) : boiling ? 60 : 140)) % 8
      youSpr(`char_${you.moving ? 'walk' : 'idle'}_${boiling ? 'down' : you.dir}_${fr}`, you.x - 1.5 + jx, you.y - 30 / 16 - 0.1)
    },
  })
  bodies.sort((a, b) => a.y - b.y).forEach((b) => b.draw())
  const youTag = { x: you.x + jx, y: you.y }

  // Ticks over the farmer you just answered.
  for (const cl of s.cleared) {
    const f = spot(cl.who, t)
    const k = (t - cl.at) / 700
    g.globalAlpha = 1 - k * k
    spr('emote_check', f.x - 0.9, f.y - 3.4 - k * 0.4)
    g.globalAlpha = 1
  }

  // Everything below is drawn in screen pixels, so text stays crisp.
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const fs = Math.round(Math.max(15, Math.min(22, 17 * (sc / 2.8))))
  tag(g, 'YOU', sx(youTag.x), sy(youTag.y + 0.15), '#4a3426', Math.round(fs * 0.8))
  stressFx(g, s, t, sx(youTag.x), sy(you.y - 1.1), (PX * sc) / 16, !!boiling)

  // The broken plot: a slow red pulse and a tag nobody sent you.
  if (s.wiltAt >= 0 && t - fixStart < 200) {
    const p = PLOTS[s.broken]
    const a = Math.min(1, (t - s.wiltAt) / 900) * (0.75 + 0.25 * Math.sin(t / 220))
    const fade = s.beat === 3 ? Math.max(0, Math.min(1, 1 - (t - fixStart) / 200)) : 1
    g.globalAlpha = a * fade
    g.strokeStyle = '#c4615a'
    g.lineWidth = 4
    g.strokeRect(sx(p.x - 1.15), sy(p.y - 1.15), (PW + 2.3) * PX * sc, (PH + 2.3) * PX * sc)
    g.globalAlpha = Math.min(1, (t - s.wiltAt) / 900) * fade
    tag(g, 'BROKEN', sx(p.x + PW / 2), sy(p.y + PH + 1.25), '#c4615a', fs)
    g.globalAlpha = 1
  }

  // Each farmer's waiting questions: the oldest one shown, with a count of the rest.
  // On beat 3 they stay up until the shockwave reaches them.
  const waveDone = !!s.slam && t > s.slam.at + WAVE
  if (s.beat < 3 || !waveDone) {
    PLOTS.forEach((_, i) => {
      const mine = s.reqs.filter((r) => r.who === i)
      if (!mine.length) return
      const f = spot(i, t)
      const pop = Math.min(1, (t - mine[mine.length - 1].born) / 160)
      bubble(g, mine[0].text, sx(f.x), sy(f.y - 2.35), fs, { badge: mine.length > 1 ? mine.length : 0, pop })
    })
    // A running count of everything waiting on you.
    const n = s.reqs.length
    if (s.n > 0) pill(g, `Waiting on you: ${n}`, 16, 16, fs + 2, n > 12 ? '#c4615a' : '#4a3426')
  }
  // Questions caught by the ring burst and blow outward.
  for (const b of s.bursts) {
    const k = (t - b.at) / 450
    const dx = s.slam ? b.x - s.slam.x : 0
    const dy = s.slam ? b.y - s.slam.y : 0
    const d = Math.hypot(dx, dy) || 1
    g.globalAlpha = Math.max(0, 1 - k) ** 1.5
    bubble(g, b.text, sx(b.x + (dx / d) * k * 2.6), sy(b.y - 2.35 + (dy / d) * k * 2.6) - k * 24, fs, { pop: 1 + k * 1.2, badge: b.n > 1 ? b.n : 0 })
    g.globalAlpha = 1
  }
  if (s.slam && t >= s.slam.at) shock(g, s, t, sx, sy, PX * sc)
  if (s.beat === 3 && waveDone) {
    const n = 0
    const fadeOut = Math.max(0, 1 - (t - s.slam!.at - WAVE) / 500)
    if (fadeOut > 0) {
      g.globalAlpha = fadeOut
      pill(g, `Waiting on you: ${n}`, 16, 16, fs + 2, '#5b8a3c')
      g.globalAlpha = 1
    }
    // Quiet. Then the result lands on your porch: what's done, and the one thing that's yours to OK.
    const since = t - s.slam!.at - WAVE
    const c = courier(s, t)
    const cardAt = c.arrivedAt + 250
    if (since > cardAt) {
      const k = Math.min(1, (since - cardAt) / 180)
      bubble(g, '4 tasks done. 1 needs your OK.', sx(DROP.x + 0.4), sy(DROP.y - 1.75), Math.round(fs * 1.3), { pop: k })
    }
    // The name, settling in at the top.
    const a = Math.max(0, Math.min(1, (since - 150) / 450))
    g.globalAlpha = a
    // The real Homestead AI logo, the same lockup the loader builds.
    if (LOGO.complete && LOGO.naturalWidth) {
      const lw = Math.min(W * 0.42, 620)
      const lh = (lw * LOGO.naturalHeight) / LOGO.naturalWidth
      const pop = 0.92 + 0.08 * Math.min(1, a * 1.4)
      const sm = g.imageSmoothingEnabled
      g.imageSmoothingEnabled = true
      g.drawImage(LOGO, W / 2 - (lw * pop) / 2, H - lh - 22 + (1 - a) * 12, lw * pop, lh * pop)
      g.imageSmoothingEnabled = sm
    }
    g.globalAlpha = 1
  }
}

const ANGER = [
  '...#.#...',
  '...#.#...',
  '.###.###.',
  '.........',
  '.###.###.',
  '...#.#...',
  '...#.#...',
]

// One character frame drawn through a small canvas, so the whole sprite (outline and all) can be washed red.
let off: HTMLCanvasElement | null = null
function redSprite(g: CanvasRenderingContext2D, name: string, x: number, y: number, tint: Tint, red: number) {
  if (red <= 0.01) return draw(g, name, Math.round(x), Math.round(y), { tint })
  off ??= Object.assign(document.createElement('canvas'), { width: 48, height: 48 })
  const o = off.getContext('2d')!
  o.imageSmoothingEnabled = false
  o.globalCompositeOperation = 'source-over'
  o.clearRect(0, 0, 48, 48)
  draw(o, name, 0, 0, { tint })
  o.globalCompositeOperation = 'source-atop'
  o.fillStyle = `rgba(226,52,40,${red})`
  o.fillRect(0, 0, 48, 48)
  g.drawImage(off, Math.round(x), Math.round(y))
}

// Pixel-art stress over your head: a throbbing anger mark, then steam.
// (hx, hy) is the top of your head in screen pixels; u is one sprite pixel.
function stressFx(g: CanvasRenderingContext2D, s: Sim, t: number, hx: number, hy: number, u: number, boiling: boolean) {
  const st = s.stress
  if (st < 0.2) return
  const px = (x: number, y: number, w = 1, h = 1) => g.fillRect(Math.round(hx + x * u), Math.round(hy + y * u), Math.ceil(w * u), Math.ceil(h * u))
  // An emote bubble over your head, farm-game style: a throbbing anger mark once the pile gets big.
  if (st > 0.55) {
    const pop = boiling ? 1.15 + 0.12 * Math.abs(Math.sin(t / 60)) : 1
    const bw = 13 * pop
    const bh = 12 * pop
    const bx = -bw / 2
    const by = -5 - bh
    g.fillStyle = '#4a3426'
    px(bx - 1, by, bw + 2, bh)
    px(bx, by - 1, bw, bh + 2)
    g.fillStyle = '#fff6e4'
    px(bx, by, bw, bh)
    // tail
    g.fillStyle = '#4a3426'
    px(-2, by + bh, 4, 1)
    px(-1, by + bh + 1, 2, 2)
    g.fillStyle = '#fff6e4'
    px(-1, by + bh - 1, 2, 2)
    const cx = 0
    const cy = by + bh / 2
    {
      // the anger mark: four bent strokes with their corners turned in, throbbing
      const k = pop * (1 + 0.2 * Math.abs(Math.sin(t / (boiling ? 55 : 160))))
      ANGER.forEach((row, ry) =>
        [...row].forEach((ch, rx) => {
          if (ch === '.') return
          g.fillStyle = ch === '#' ? '#d8342a' : '#8f1f19'
          px(cx + (rx - 4.5) * 0.95 * k, cy + (ry - 3.5) * 0.95 * k, 0.95 * k, 0.95 * k)
        }),
      )
    }
  }
  // Steam: puffs rising off your head once you're about to blow.
  if (st > 0.85) {
    for (let i = 0; i < (boiling ? 4 : 2); i++) {
      const per = boiling ? 420 : 650
      const k = ((t + i * per * 0.27) % per) / per
      const side = i % 2 ? -1 : 1
      const sz = 2 + k * 3
      g.globalAlpha = 0.85 * (1 - k)
      g.fillStyle = '#f4f1ea'
      px(side * (3 + k * 5) - sz / 2, -4 - k * 12 - sz / 2, sz, sz)
    }
    g.globalAlpha = 1
  }
}

// Which frame of the till animation is the hoe hitting the ground.
const SWING_HIT = 5

// The shockwave: a white flash on the hit, a dust burst at the hoe, and a bright ring racing outward.
function shock(g: CanvasRenderingContext2D, s: Sim, t: number, sx: (x: number) => number, sy: (y: number) => number, tile: number) {
  const sl = s.slam!
  const since = t - sl.at
  const cx = sx(sl.x)
  const cy = sy(sl.y)
  const W = window.innerWidth
  const H = window.innerHeight
  if (since < 140) {
    g.fillStyle = `rgba(255,250,235,${0.55 * (1 - since / 140)})`
    g.fillRect(0, 0, W, H)
  }
  const r = ring(s, t) * tile
  const k = Math.min(1, since / WAVE)
  if (k < 1) {
    g.save()
    // a soft trailing band, then the bright edge
    g.globalAlpha = 0.35 * (1 - k)
    g.strokeStyle = '#fff6e4'
    g.lineWidth = tile * 2.2
    g.beginPath()
    g.arc(cx, cy, Math.max(1, r - tile * 1.2), 0, Math.PI * 2)
    g.stroke()
    g.globalAlpha = 0.9 * (1 - k * 0.7)
    g.lineWidth = tile * 0.45
    g.beginPath()
    g.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2)
    g.stroke()
    g.restore()
  }
  // Dust kicked up where the hoe hit.
  if (since < 600) {
    const d = since / 600
    g.fillStyle = `rgba(214,190,150,${0.85 * (1 - d)})`
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3
      const rr = tile * (0.4 + d * 2.4)
      const size = tile * (0.38 * (1 - d) + 0.12)
      g.fillRect(Math.round(cx + Math.cos(a) * rr - size / 2), Math.round(cy + Math.sin(a) * rr * 0.55 - size / 2), size, size)
    }
  }
}

const LOGO = Object.assign(new Image(), { src: '/brand/homestead-ai-logo-b-barn-lockup@8x.png' })

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function bubble(g: CanvasRenderingContext2D, text: string, cx: number, by: number, fs: number, o: { badge?: number; pop?: number; tone?: 'gold'; alert?: boolean }) {
  const k = 0.6 + 0.4 * (o.pop ?? 1)
  g.save()
  g.translate(cx, by)
  g.scale(k, k)
  g.font = `${fs}px px7`
  const lead = o.alert ? fs + 10 : 0
  const w = Math.ceil(g.measureText(text).width) + 20 + lead
  const h = fs + 16
  const x = -w / 2
  const y = -h - 8
  // Unanswered ones stack up behind.
  for (let j = Math.min(3, (o.badge ?? 1) - 1); j > 0; j--) {
    g.fillStyle = '#efe0c4'
    g.strokeStyle = '#4a3426'
    g.lineWidth = 2
    roundRect(g, x + j * 5, y - j * 5, w, h, 6)
    g.fill()
    g.stroke()
  }
  g.fillStyle = 'rgba(46,34,26,.3)'
  roundRect(g, x + 2, y + 3, w, h, 6)
  g.fill()
  g.fillStyle = o.tone === 'gold' ? '#fbe7b0' : '#fff6e4'
  g.strokeStyle = o.tone === 'gold' ? '#b98322' : '#4a3426'
  g.lineWidth = 2.5
  roundRect(g, x, y, w, h, 6)
  g.fill()
  g.stroke()
  // Tail.
  g.beginPath()
  g.moveTo(-7, y + h - 1)
  g.lineTo(0, 0)
  g.lineTo(7, y + h - 1)
  g.fill()
  g.stroke()
  g.fillRect(-6, y + h - 3, 12, 3)
  g.fillStyle = '#4a3426'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, lead / 2, y + h / 2 + 1)
  if (o.alert) {
    g.fillStyle = '#c4615a'
    g.beginPath()
    g.arc(x + 10 + fs / 2, y + h / 2, fs / 2 + 2, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff6e4'
    g.fillText('!', x + 10 + fs / 2, y + h / 2 + 1)
  }
  if (o.badge) {
    const r = fs * 0.62
    const st = Math.min(3, o.badge - 1) * 5
    const bx = x + w - 2 + st
    const byy = y + 1 - st
    g.fillStyle = '#c4615a'
    g.beginPath()
    g.arc(bx, byy, r, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff6e4'
    g.font = `${Math.round(fs * 0.8)}px px4`
    g.fillText(String(o.badge), bx, byy + 1)
  }
  g.restore()
}

function pill(g: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, color: string) {
  g.font = `${fs}px px7`
  const w = Math.ceil(g.measureText(text).width) + 28
  const h = fs + 18
  g.fillStyle = 'rgba(46,34,26,.3)'
  roundRect(g, x + 2, y + 3, w, h, 8)
  g.fill()
  g.fillStyle = '#fff6e4'
  g.strokeStyle = color
  g.lineWidth = 3
  roundRect(g, x, y, w, h, 8)
  g.fill()
  g.stroke()
  g.fillStyle = color
  g.textAlign = 'left'
  g.textBaseline = 'middle'
  g.fillText(text, x + 14, y + h / 2 + 1)
}

function tag(g: CanvasRenderingContext2D, text: string, cx: number, y: number, bg: string, fs: number) {
  g.font = `${Math.round(fs * 0.9)}px px4`
  const w = Math.ceil(g.measureText(text).width) + 18
  const h = fs + 8
  g.fillStyle = bg
  roundRect(g, cx - w / 2, y, w, h, 4)
  g.fill()
  g.fillStyle = '#fff6e4'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, cx, y + h / 2 + 1)
}
