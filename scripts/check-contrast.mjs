#!/usr/bin/env node
// Grade every declared text/ground pair in src/ds/tokens.css against WCAG.
//
//   npm run contrast                      table, exit 1 if any pair is under its minimum
//   npm run contrast -- --json            the results as JSON on stdout (for the library's Color page)
//   npm run contrast -- --json <file>     write that JSON to a file
//   npm run contrast -- --json <file> --check   exit 1 if the file is stale
//
// The pairs live in scripts/contrast-pairs.json, grouped by population (sheet, plate, chip, button).
// Translucent tokens are composited over their ground ("--plate over --grass") before grading.
// Quieter text comes from size and weight. Never fix a failure with opacity or a paler grey.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOKENS = join(ROOT, 'src/ds/tokens.css')
const PAIRS = join(ROOT, 'scripts/contrast-pairs.json')

// ---- tokens --------------------------------------------------------------------------

// Custom properties from the first :root block (the reduced-motion block only retimes).
export function parseTokens(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const root = clean.match(/:root\s*\{([^}]*)\}/)
  if (!root) throw new Error('no :root block in tokens.css')
  const out = {}
  for (const m of root[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

function resolve(tokens, value, seen = []) {
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, name, fallback) => {
    if (seen.includes(name)) throw new Error(`var() cycle: ${[...seen, name].join(' -> ')}`)
    if (name in tokens) return resolve(tokens, tokens[name], [...seen, name])
    if (fallback) return resolve(tokens, fallback.trim(), seen)
    throw new Error(`unknown token ${name}`)
  })
}

// Returns [r, g, b, a] with r,g,b in 0..255 and a in 0..1.
function parseColor(str) {
  const s = str.trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) throw new Error(`bad hex ${str}`)
    const n = (i) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    const ch = (p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p))
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    return [ch(parts[0]), ch(parts[1]), ch(parts[2]), a]
  }
  if (s === 'white') return [255, 255, 255, 1]
  if (s === 'black') return [0, 0, 0, 1]
  throw new Error(`cannot read colour "${str}"`)
}

function over(top, under) {
  const a = top[3] + under[3] * (1 - top[3])
  if (a === 0) return [0, 0, 0, 0]
  const c = (i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a
  return [c(0), c(1), c(2), a]
}

const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

function luminance([r, g, b]) {
  const lin = (v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

// "--plate over --grass over --sheet": composite right to left. The last layer sits on white.
function ground(tokens, expr) {
  const layers = expr.split(/\s+over\s+/).map((t) => parseColor(resolve(tokens, `var(${t.trim()})`)))
  let c = [255, 255, 255, 1]
  for (const layer of layers.reverse()) c = over(layer, c)
  return c
}

// ---- grading ---------------------------------------------------------------------------

export function evaluate(css, spec) {
  const tokens = parseTokens(css)
  const results = []
  for (const g of spec.groups) {
    const min = g.large ? Math.min(g.min ?? 3, 3) : (g.min ?? 4.5)
    for (const bgExpr of g.bg) {
      const bg = ground(tokens, bgExpr)
      for (const fgName of g.fg) {
        const fg = over(parseColor(resolve(tokens, `var(${fgName})`)), bg)
        const r = ratio(fg, bg)
        results.push({
          population: g.population,
          what: g.what ?? '',
          fg: fgName,
          bg: bgExpr,
          fgHex: hex(fg),
          bgHex: hex(bg),
          ratio: Math.round(r * 100) / 100,
          min,
          large: !!g.large,
          pass: r >= min,
        })
      }
    }
  }
  return results
}

// ---- cli -------------------------------------------------------------------------------

function table(results) {
  const rows = results.map((r) => [r.population, r.fg, r.bg, r.fgHex, r.bgHex, r.ratio.toFixed(2), r.min.toFixed(1) + (r.large ? ' large' : ''), r.pass ? 'ok' : 'FAIL'])
  const head = ['population', 'text', 'ground', 'text hex', 'ground hex', 'ratio', 'min', '']
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (r) => r.map((c, i) => (i === 5 || i === 6 ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ').trimEnd()
  const out = [line(head), w.map((n) => '-'.repeat(n)).join('  ')]
  let last = ''
  for (const r of rows) {
    if (last && r[0] !== last) out.push('')
    last = r[0]
    out.push(line(r))
  }
  return out.join('\n')
}

function main(argv) {
  const css = readFileSync(TOKENS, 'utf8')
  const spec = JSON.parse(readFileSync(PAIRS, 'utf8'))
  const results = evaluate(css, spec)
  const failures = results.filter((r) => !r.pass)
  const ji = argv.indexOf('--json')
  if (ji >= 0) {
    const file = argv[ji + 1] && !argv[ji + 1].startsWith('--') ? resolvePath(process.env.INIT_CWD || process.cwd(), argv[ji + 1]) : null
    const doc = {
      source: [relative(ROOT, TOKENS), relative(ROOT, PAIRS)],
      populations: [...new Set(spec.groups.map((g) => g.population))],
      results,
      failures: failures.length,
    }
    const text = JSON.stringify(doc, null, 2) + '\n'
    if (!file) {
      process.stdout.write(text)
    } else if (argv.includes('--check')) {
      let old = ''
      try {
        old = readFileSync(file, 'utf8')
      } catch {}
      if (old !== text) {
        console.error(`${relative(ROOT, file)} is stale. Run: npm run contrast -- --json ${relative(ROOT, file)}`)
        return 1
      }
      console.log(`${relative(ROOT, file)} is current`)
    } else {
      writeFileSync(file, text)
      console.error(`wrote ${relative(ROOT, file)}`)
    }
    return failures.length ? 1 : 0
  }
  console.log(table(results))
  console.log('')
  if (failures.length) {
    console.log(`${failures.length} of ${results.length} pairs are under their minimum:`)
    for (const f of failures) console.log(`  ${f.fg} on ${f.bg}: ${f.ratio.toFixed(2)} < ${f.min}`)
    console.log('Fix the token, not the call site. Quieter text comes from size and weight.')
    return 1
  }
  console.log(`All ${results.length} pairs clear their minimum.`)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)))
