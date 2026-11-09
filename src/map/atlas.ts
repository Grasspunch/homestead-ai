// Loads the Sprout Lands atlas and makes recoloured copies for each farmhand.
import atlasJson from './atlas.json'

type FrameRect = [number, number, number, number]
const frames = atlasJson.frames as unknown as Record<string, FrameRect>
export const animCounts = atlasJson.counts as Record<string, number>

let base: HTMLImageElement | null = null
const tinted = new Map<string, HTMLCanvasElement>()

export function loadAtlas(): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      base = img
      resolve()
    }
    img.onerror = reject
    img.src = '/sprites/atlas.png'
  })
}

export function hasFrame(name: string) {
  return name in frames
}

export function frame(name: string) {
  return frames[name]
}

// The character's cream body and its shade, swapped for a farmhand's colours.
const BODY = [0xf3, 0xf2, 0xc0]
const SHADE = [0xdd, 0xd5, 0xde]

function hex(c: string) {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function sourceFor(tint?: { body: string; shade: string }): CanvasImageSource | null {
  if (!base) return null
  if (!tint) return base
  const key = tint.body + tint.shade
  let c = tinted.get(key)
  if (!c) {
    c = document.createElement('canvas')
    c.width = base.width
    c.height = base.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(base, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height)
    const d = data.data
    const b = hex(tint.body)
    const s = hex(tint.shade)
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue
      if (d[i] === BODY[0] && d[i + 1] === BODY[1] && d[i + 2] === BODY[2]) {
        d[i] = b[0]
        d[i + 1] = b[1]
        d[i + 2] = b[2]
      } else if (d[i] === SHADE[0] && d[i + 1] === SHADE[1] && d[i + 2] === SHADE[2]) {
        d[i] = s[0]
        d[i + 1] = s[1]
        d[i + 2] = s[2]
      }
    }
    ctx.putImageData(data, 0, 0)
    tinted.set(key, c)
  }
  return c
}

export function draw(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  opts: { tint?: { body: string; shade: string }; flip?: boolean; scale?: number; w?: number; h?: number } = {},
) {
  const f = frames[name]
  const src = sourceFor(opts.tint)
  if (!f || !src) return
  const [sx, sy, sw, sh] = f
  const s = opts.scale ?? 1
  const dw = opts.w ?? sw * s
  const dh = opts.h ?? sh * s
  if (opts.flip) {
    ctx.save()
    ctx.translate(x + dw, y)
    ctx.scale(-1, 1)
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh)
    ctx.restore()
  } else {
    ctx.drawImage(src, sx, sy, sw, sh, x, y, dw, dh)
  }
}

// ---- Custom pixel sprites (pests, crow, seed) in the Sprout Lands palette ----

const PAL: Record<string, string> = {
  k: '#3e3150', // outline
  p: '#5c4e92',
  P: '#766daa',
  g: '#6b8f47',
  G: '#94b85c',
  y: '#eae178',
  r: '#d9715f',
  w: '#f3f2c0',
  b: '#2e2a3f',
  B: '#4b4466',
  o: '#e8a05a',
  s: '#a9774a',
  S: '#7a5236',
}

const PIXELS: Record<string, string[]> = {
  beetle: [
    '..k....k..',
    '...k..k...',
    '..kkkkkk..',
    '.kgGgGgGk.',
    'kgGgykgGgk',
    'kgGgGkGgGk',
    'kgggGkgggk',
    '.kgggkggk.',
    '..kkkkkk..',
    '.k..k.k.k.',
  ],
  crow0: [
    '.....bbb........',
    '....bBBBb.......',
    '...bBwbBBb......',
    'ooobBBBBBBb.....',
    '...bBBBBBBBbb...',
    '....bBBBBBBBBbb.',
    '.....bBBBBBBBBBb',
    '......bBBBBBbbb.',
    '.......bbbbb....',
    '........k.k.....',
    '.......kk.kk....',
  ],
  crow1: [
    '..........bb....',
    '.....bbb.bBBb...',
    '....bBBBbBBBb...',
    '...bBwbBBBBb....',
    'ooobBBBBBBBb....',
    '...bBBBBBBBBbb..',
    '....bBBBBBBBBBbb',
    '.....bBBBBBBbbb.',
    '......bbbbbb....',
    '........k.k.....',
    '.......kk.kk....',
  ],
  seed: ['.kkk.', 'kssSk', 'ksSSk', 'kSSSk', '.kkk.'],
}

const pixelCache = new Map<string, HTMLCanvasElement>()

export function pixelSprite(name: string): HTMLCanvasElement {
  let c = pixelCache.get(name)
  if (c) return c
  const rows = PIXELS[name]
  c = document.createElement('canvas')
  c.width = rows[0].length
  c.height = rows.length
  const ctx = c.getContext('2d')!
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return
      ctx.fillStyle = PAL[ch]
      ctx.fillRect(x, y, 1, 1)
    }),
  )
  pixelCache.set(name, c)
  return c
}
