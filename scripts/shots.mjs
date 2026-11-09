#!/usr/bin/env node
// Screenshots of the library and the app, made from the list in scripts/shots/states.json.
//
//   npm run shots                     every state -> shots/out/<id>.png
//   npm run shots:check               "ref" states only, compared with shots/ref/; diffs in shots/diff/; exit 1 on change
//   npm run shots -- --update         make the "ref" states and copy them into shots/ref/ (a change of its own)
//   npm run shots -- --only a,b       just these ids
//   npm run shots -- --base <url>     use this server (default: a dev server on 5199 or 5173 if one answers, else start Vite)
//   npm run shots -- --ref <dir> --out <dir> --diff <dir>   other folders (for trying the pipeline)
//
// Shots are deterministic: CSS animations and transitions are off, the caret is hidden, Math.random is
// seeded, and app states run on Playwright's fake clock, so the map's requestAnimationFrame loop only
// moves when a state's actions advance time.

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const RUNNING = ['http://localhost:5199', 'http://localhost:5173'] // a dev server already up (npm run design is 5173)

// ---- args ------------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { check: false, update: false, only: null, base: null }
  const dirs = { ref: 'shots/ref', out: 'shots/out', diff: 'shots/diff' }
  const cwd = process.env.INIT_CWD || process.cwd()
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--check') a.check = true
    else if (k === '--update') a.update = true
    else if (k === '--only') a.only = new Set(argv[++i].split(','))
    else if (k === '--base') a.base = argv[++i].replace(/\/$/, '')
    else if (k === '--ref' || k === '--out' || k === '--diff') dirs[k.slice(2)] = resolve(cwd, argv[++i])
    else throw new Error(`unknown argument ${k}`)
  }
  for (const k of Object.keys(dirs)) dirs[k] = resolve(ROOT, dirs[k])
  return { ...a, dirs }
}

// ---- server ----------------------------------------------------------------------------

async function answers(url) {
  try {
    const r = await fetch(url + '/design.html', { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

async function server(base) {
  if (base) {
    if (!(await answers(base))) throw new Error(`nothing answers at ${base}`)
    return { base, stop: () => {} }
  }
  for (const url of RUNNING) if (await answers(url)) return { base: url, stop: () => {} }
  const port = 5290 + Math.floor(Math.random() * 9)
  const vite = spawn(join(ROOT, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
  const url = `http://localhost:${port}`
  for (let i = 0; i < 100; i++) {
    if (await answers(url)) return { base: url, stop: () => vite.kill() }
    await new Promise((r) => setTimeout(r, 200))
  }
  vite.kill()
  throw new Error('Vite did not start')
}

// ---- page setup ------------------------------------------------------------------------

const STILL_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
  caret-color: transparent !important; scroll-behavior: auto !important;
}`

// Runs before any app code: a seeded Math.random, so chores, glances and chicken walks repeat.
function seedRandom(seed) {
  let s = seed >>> 0
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const T0 = new Date('2026-04-01T09:00:00Z').getTime()

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))))))
  })
}

// Real-time wait for React and the browser to paint. Never on the page's (possibly fake) clock.
const flush = (page) => page.waitForTimeout(60)

async function advance(page, state, ms) {
  if (state.clock) await page.clock.runFor(ms)
  else await page.waitForTimeout(ms)
  await flush(page)
}

async function act(page, state, step) {
  if ('click' in step) await page.click(step.click)
  else if ('hover' in step) await page.hover(step.hover)
  else if ('key' in step) await page.keyboard.press(step.key)
  else if ('fill' in step) await page.fill(step.fill[0], step.fill[1])
  else if ('scroll' in step) await page.locator(step.scroll).scrollIntoViewIfNeeded()
  else if ('wait' in step) await advance(page, state, step.wait)
  else if ('waitFor' in step) await page.waitForSelector(step.waitFor)
  else if ('ready' in step) {
    // Loading (sprites, fonts) happens in real time. Wait for it without moving the page's clock,
    // so the first frame after loading is the same in every run.
    const until = Date.now() + (step.max ?? 15000)
    while (!(await page.evaluate(step.ready))) {
      if (Date.now() > until) throw new Error(`${state.id}: "${step.ready}" still false`)
      await page.waitForTimeout(50)
    }
  }
  else if ('until' in step) {
    // Advance time in steps until the expression holds in the page (it can read window.engine).
    const every = step.every ?? 250
    const max = step.max ?? 120000
    for (let t = 0; ; t += every) {
      if (await page.evaluate(step.until)) break
      if (t >= max) throw new Error(`${state.id}: "${step.until}" still false after ${max} ms`)
      await advance(page, state, every)
    }
  } else throw new Error(`${state.id}: unknown action ${JSON.stringify(step)}`)
  await flush(page)
}

async function shoot(browser, base, state, file) {
  const [w, h] = state.viewport
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: state.reducedMotion ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(seedRandom, state.seed ?? 1)
  // Hold Vite's hot-reload socket open but silent, so an edit elsewhere can't reload the page mid-shot.
  await page.routeWebSocket(/\/\?token=|vite-hmr/, () => {})
  if (state.clock) {
    await page.clock.install({ time: T0 })
    await page.clock.pauseAt(T0 + 1000)
  }
  await page.goto(base + state.url, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: STILL_CSS })
  await settle(page)
  for (const step of state.actions ?? []) await act(page, state, step)
  await settle(page)
  if (state.fitHeight) {
    // The library scrolls inside .ds-main, so grow the window to show the whole page.
    const full = await page.evaluate((sel) => document.querySelector(sel)?.scrollHeight ?? 0, state.fitHeight)
    if (full > h) await page.setViewportSize({ width: w, height: full })
    await flush(page)
  }
  await page.mouse.move(0, 0)
  mkdirSync(dirname(file), { recursive: true })
  if (state.element) await page.locator(state.element).first().screenshot({ path: file })
  else if (state.crop) {
    const [x, y, cw, ch] = state.crop
    await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch } })
  } else await page.screenshot({ path: file })
  await context.close()
  return errors
}

// ---- main ------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const spec = JSON.parse(readFileSync(join(ROOT, 'scripts/shots/states.json'), 'utf8'))
  const refOnly = args.check || args.update
  const states = spec.states
    .map((s) => ({ ...spec.defaults, ...s }))
    .filter((s) => (!args.only || args.only.has(s.id)) && (!refOnly || s.kind === 'ref'))
  if (args.only) for (const id of args.only) if (!states.some((s) => s.id === id)) throw new Error(`no state "${id}"${refOnly ? ' of kind ref' : ''}`)

  const { chromium } = require('playwright')
  const srv = await server(args.base)
  const browser = await chromium.launch()
  let failed = 0
  try {
    console.log(`server ${srv.base}`)
    for (const s of states) {
      const file = join(args.dirs.out, `${s.id}.png`)
      const errors = await shoot(browser, srv.base, s, file)
      console.log(`shot ${s.id} (${s.kind})`)
      for (const e of errors) console.log(`  page error: ${e}`)
    }
  } finally {
    await browser.close()
    srv.stop()
  }

  if (args.update) {
    mkdirSync(args.dirs.ref, { recursive: true })
    for (const s of states) copyFileSync(join(args.dirs.out, `${s.id}.png`), join(args.dirs.ref, `${s.id}.png`))
    console.log(`updated ${states.length} references in ${args.dirs.ref}`)
  }

  if (args.check) {
    for (const s of states) {
      const ref = join(args.dirs.ref, `${s.id}.png`)
      if (!existsSync(ref)) {
        console.log(`${s.id}.png: no reference. Make one with: npm run shots -- --update --only ${s.id}`)
        failed++
        continue
      }
      const r = spawnSync('python3', [join(ROOT, 'scripts/compare-shots.py'), ref, join(args.dirs.out, `${s.id}.png`), join(args.dirs.diff, `${s.id}.png`)], { stdio: 'inherit' })
      if (r.status !== 0) failed++
    }
    if (failed) {
      console.log(`\n${failed} of ${states.length} shots changed. If the change is intended, refresh the references in a change of its own: npm run shots -- --update`)
      process.exit(1)
    }
    console.log(`\nAll ${states.length} shots match their references.`)
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
