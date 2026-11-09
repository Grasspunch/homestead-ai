#!/usr/bin/env node
// Screenshot one specimen in the design library and blow it up 3x, nearest-neighbour, to judge pixel art.
//
//   node scripts/crop-shot.mjs '#/glyphs' --el '.ds-stage >> nth=0' --name alert
//   node scripts/crop-shot.mjs '#/art/used' --clip 40,120,320,200 --name plots
//   node scripts/crop-shot.mjs '/?replay' --clip 0,0,640,400 --name farm      (the app)
//
// Options: --el <selector> (first match) or --clip x,y,w,h (page pixels; neither = the window),
//          --scale <n> (default 3), --name <file stem> (default crop), --base <url> (default: whichever of 5199 and 5173 answers),
//          --viewport WxH (default 1280x800), --out <dir> (default shots/crops),
//          --at <ms> (default 1000): the page runs on a paused clock and is shot this many ms after it loads, so two
//          runs of the same art give the same picture. Shoot at two times (--at 1000, --at 1250) to see idle frames.
// Writes <out>/<name>.png. A crop already there moves to <name>-prev.png first, and the script says how many
// pixels changed between the two, so "visibly different from the last try" is a number, not a feeling.
// Needs the dev server running (npm run design). The picture is taken at deviceScaleFactor 1, the way the farm
// draws, then scaled, so what you judge is what a person sees, only bigger.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const STILL_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}'
const T0 = new Date('2026-04-01T09:00:00Z').getTime()

function args(argv) {
  const a = { at: 1000, target: null, el: null, clip: null, scale: 3, name: 'crop', base: null, viewport: [1280, 800], out: 'shots/crops' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = () => argv[++i]
    if (k === '--el') a.el = v()
    else if (k === '--clip') a.clip = v().split(',').map(Number)
    else if (k === '--scale') a.scale = Math.max(1, Math.round(Number(v())))
    else if (k === '--name') a.name = v()
    else if (k === '--base') a.base = v().replace(/\/$/, '')
    else if (k === '--viewport') a.viewport = v().split('x').map(Number)
    else if (k === '--out') a.out = v()
    else if (k === '--at') a.at = Math.max(0, Number(v()))
    else if (!a.target) a.target = k
    else throw new Error(`unknown argument ${k}`)
  }
  if (!a.target) throw new Error("say what to shoot: a library hash like '#/glyphs' or a full URL")
  return a
}

// The dev server the person already has open: npm run design (Vite's 5173) or the 5199 one.
async function findBase() {
  for (const url of ['http://localhost:5199', 'http://localhost:5173']) {
    try {
      if ((await fetch(url + '/design.html', { signal: AbortSignal.timeout(1500) })).ok) return url
    } catch {}
  }
  throw new Error('No dev server on 5199 or 5173. Start one with: npm run design (or pass --base <url>)')
}

async function main() {
  const a = args(process.argv.slice(2))
  if (!/^https?:/.test(a.target)) a.base ??= await findBase()
  // '#/glyphs' is a library page, '/?replay' a path on the same server, or a full URL.
  const url = /^https?:/.test(a.target) ? a.target : a.target.startsWith('/') ? a.base + a.target : `${a.base}/design.html${a.target.startsWith('#') ? a.target : '#/' + a.target}`
  const outDir = resolve(process.env.INIT_CWD || process.cwd(), a.out === 'shots/crops' ? join(ROOT, a.out) : a.out)
  const file = join(outDir, `${a.name}.png`)
  const prev = join(outDir, `${a.name}-prev.png`)

  const { chromium } = require('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: a.viewport[0], height: a.viewport[1] }, deviceScaleFactor: 1 })
    await page.clock.install({ time: T0 })
    await page.clock.pauseAt(T0 + 1000)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: STILL_CSS })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300) // real time, for anything still loading; the page's own clock stays put
    await page.clock.runFor(a.at)
    await page.waitForTimeout(60)
    await page.mouse.move(0, 0)

    let shot
    let size
    if (a.el) {
      const loc = page.locator(a.el).first()
      await loc.scrollIntoViewIfNeeded()
      const box = await loc.boundingBox()
      if (!box) throw new Error(`nothing visible matches ${a.el}`)
      size = [Math.round(box.width), Math.round(box.height)]
      shot = await loc.screenshot()
    } else if (a.clip) {
      const [x, y, w, h] = a.clip
      size = [w, h]
      shot = await page.screenshot({ clip: { x, y, width: w, height: h } })
    } else {
      size = a.viewport
      shot = await page.screenshot()
    }

    // Scale in the browser: a canvas with smoothing off is an exact nearest-neighbour upscale.
    const before = existsSync(file) ? readFileSync(file).toString('base64') : null
    const result = await page.evaluate(
      async ({ png, scale, before }) => {
        const load = (b64) =>
          new Promise((ok, fail) => {
            const im = new Image()
            im.onload = () => ok(im)
            im.onerror = fail
            im.src = 'data:image/png;base64,' + b64
          })
        const im = await load(png)
        const c = document.createElement('canvas')
        c.width = im.width * scale
        c.height = im.height * scale
        const ctx = c.getContext('2d')
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(im, 0, 0, c.width, c.height)
        let changed = null
        if (before) {
          const old = await load(before)
          if (old.width !== c.width || old.height !== c.height) changed = 'size'
          else {
            const o = document.createElement('canvas')
            o.width = old.width
            o.height = old.height
            const octx = o.getContext('2d')
            octx.drawImage(old, 0, 0)
            const A = ctx.getImageData(0, 0, c.width, c.height).data
            const B = octx.getImageData(0, 0, c.width, c.height).data
            let n = 0
            for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) n++
            changed = n / (scale * scale)
          }
        }
        return { data: c.toDataURL('image/png').split(',')[1], changed, total: im.width * im.height }
      },
      { png: shot.toString('base64'), scale: a.scale, before },
    )

    mkdirSync(outDir, { recursive: true })
    if (before) renameSync(file, prev)
    writeFileSync(file, Buffer.from(result.data, 'base64'))
    console.log(`${file}`)
    console.log(`  ${size[0]}x${size[1]} screen px, shown at ${a.scale}x. At the farm's --px of 3 that is ${(size[0] / 3).toFixed(1)}x${(size[1] / 3).toFixed(1)} art px.`)
    if (result.changed === 'size') console.log(`  The size changed since the last try (${prev}).`)
    else if (result.changed !== null) {
      const pct = (100 * result.changed) / result.total
      console.log(`  ${result.changed} of ${result.total} screen px changed since the last try (${pct.toFixed(2)}%).${result.changed === 0 ? ' Nothing changed: did the edit reach the page?' : ''}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
