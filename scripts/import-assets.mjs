#!/usr/bin/env node
// Puts the four Sprout Lands packs (by Cup Nooble) into public/assets/sprout-lands/.
//
//   npm run assets -- <folder>
//
// <folder> holds the zips as downloaded from itch.io (any file names: each zip is
// recognised by what is inside it) or the packs already unzipped. The packs are
// licensed for use, not redistribution, so that folder is git-ignored: each person
// imports their own copy. Uses the system unzip, or tar where unzip is missing (macOS bsdtar reads zips).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DEST = path.join(ROOT, 'public', 'assets', 'sprout-lands')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'art', 'manifest.json'), 'utf8'))

// Pack id -> folder name, from the manifest. A file each pack has, for zips without the top folder.
const PACKS = Object.entries(manifest.packs).map(([id, folder]) => ({ id, folder }))
const SIGNATURE = {
  'sprites-premium': 'Characters/Premium Charakter Spritesheet.png',
  'sprites-basic': 'Objects/Basic Plants.png',
  'ui-premium': 'emojis/Emoji spritesheet.png',
  'ui-basic': 'Sprite sheets/Sprite sheet for Basic Pack.png',
}
const LABEL = {
  'sprites-premium': 'Sprites, premium',
  'sprites-basic': 'Sprites, basic',
  'ui-premium': 'UI, premium',
  'ui-basic': 'UI, basic',
}

const README = `# Sprout Lands packs

This folder holds the four Sprout Lands asset packs by Cup Nooble, unzipped:

- Sprout Lands - Sprites - premium pack
- Sprout Lands - Sprites - Basic pack
- Sprout Lands - UI Pack - Premium pack
- Sprout Lands - UI Pack - Basic pack

Everything here except this README is git-ignored. The license lets us use the art in an
open-source project with credit, but not redistribute the packs themselves, so each person
downloads them from https://cupnooble.itch.io/sprout-lands-asset-pack and imports their own copy:

    npm run assets -- ~/Downloads/sprout-lands

That folder can hold the zips (any names) or the unzipped packs.

What uses them:

- The design library (npm run design, then Art) browses every file in the packs.
- \`npm run art:atlas\` cuts the frames listed in \`art/manifest.json\` into the committed atlas
  (\`public/sprites/atlas.png\`, \`src/map/atlas.json\`). The app only ever loads that atlas,
  so it runs without this folder.
- \`npm run art:check\` confirms the committed atlas still matches the manifest.

Credit: Sprout Lands by Cup Nooble.
`

function has(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const UNZIP = has('unzip')

function isZip(file) {
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(4)
    fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    return buf.readUInt32LE(0) === 0x04034b50
  } catch {
    return false
  }
}

function listZip(file) {
  const out = UNZIP
    ? execFileSync('unzip', ['-Z1', file], { maxBuffer: 64 << 20 })
    : execFileSync('tar', ['-tf', file], { maxBuffer: 64 << 20 })
  return out.toString('utf8').split('\n').filter(Boolean)
}

function extractZip(file, into, entries) {
  const mac = entries.some((e) => e.split('/').includes('__MACOSX'))
  const skip = mac ? ['-x', '__MACOSX/*', '*/__MACOSX/*'] : []
  if (UNZIP) execFileSync('unzip', ['-q', '-o', file, ...skip, '-d', into], { stdio: ['ignore', 'ignore', 'inherit'] })
  else execFileSync('tar', ['-xf', file, '-C', into, '--exclude', '__MACOSX'], { stdio: 'inherit' })
}

// Which pack an entry list (zip entries or relative file paths) holds, and the path prefix of its root.
function identify(entries) {
  const norm = entries.map((e) => e.replace(/\\/g, '/')).filter((e) => !e.split('/').includes('__MACOSX'))
  for (const p of PACKS) {
    const want = p.folder.toLowerCase()
    for (const e of norm) {
      const parts = e.split('/')
      const i = parts.findIndex((s) => s.toLowerCase() === want)
      if (i >= 0) return { pack: p, root: parts.slice(0, i + 1).join('/') }
    }
  }
  for (const p of PACKS) {
    const sig = SIGNATURE[p.id]?.toLowerCase()
    if (!sig) continue
    const hit = norm.find((e) => e.toLowerCase().endsWith(sig))
    if (hit) return { pack: p, root: hit.slice(0, hit.length - sig.length).replace(/\/$/, '') }
  }
  return null
}

function walk(dir, depth, out = []) {
  let items = []
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const it of items) {
    if (it.name === '__MACOSX' || it.name.startsWith('.')) continue
    const full = path.join(dir, it.name)
    if (it.isDirectory()) {
      if (depth > 0 && path.resolve(full) !== DEST) walk(full, depth - 1, out)
      out.push({ full, dir: true })
    } else out.push({ full, dir: false })
  }
  return out
}

// Files under a folder, relative, for identifying an unzipped pack (bounded so a big folder stays quick).
function relFiles(dir, limit = 4000) {
  const out = []
  const stack = [dir]
  while (stack.length && out.length < limit) {
    const d = stack.pop()
    for (const it of fs.readdirSync(d, { withFileTypes: true })) {
      if (it.name === '__MACOSX') continue
      const full = path.join(d, it.name)
      if (it.isDirectory()) stack.push(full)
      else out.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  return out
}

function install(fromDir, pack) {
  const to = path.join(DEST, pack.folder)
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(DEST, { recursive: true })
  fs.cpSync(fromDir, to, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes('__MACOSX') && path.basename(src) !== '.DS_Store',
  })
  let n = 0
  const count = (d) => {
    for (const it of fs.readdirSync(d, { withFileTypes: true })) {
      if (it.isDirectory()) count(path.join(d, it.name))
      else n++
    }
  }
  count(to)
  return n
}

function tilde(p) {
  const home = os.homedir()
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length)
  const r = path.relative(process.cwd(), p)
  return r && !r.startsWith('..') ? r : p
}

function main() {
  const arg = process.argv[2]
  fs.mkdirSync(DEST, { recursive: true })
  fs.writeFileSync(path.join(DEST, 'README.md'), README)
  if (!arg || arg === '-h' || arg === '--help') {
    console.log('Usage: npm run assets -- <folder with the Sprout Lands zips or unzipped packs>')
    console.log('Example: npm run assets -- ~/Downloads/sprout-lands')
    process.exit(arg ? 0 : 1)
  }
  const src = path.resolve(arg.replace(/^~(?=$|\/)/, os.homedir()))
  if (!fs.existsSync(src)) {
    console.error(`No such folder: ${arg}`)
    process.exit(1)
  }
  if (src === DEST) {
    console.error('That is where the packs go already. Point this at the folder holding the downloads.')
    process.exit(1)
  }
  if (!UNZIP && !has('tar')) console.warn('Neither unzip nor tar is installed, so zips will be skipped.')

  const found = new Map() // pack id -> { from, files }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprout-lands-'))
  try {
    const entries = fs.statSync(src).isDirectory() ? walk(src, 3) : [{ full: src, dir: false }]
    // Zips first, then folders: a folder found later replaces nothing already taken from a zip.
    for (const e of entries.filter((x) => !x.dir && isZip(x.full))) {
      let id, list
      try {
        list = listZip(e.full)
        id = identify(list)
      } catch (err) {
        console.warn(`Could not read ${tilde(e.full)}: ${err.message.split('\n')[0]}`)
        continue
      }
      if (!id || found.has(id.pack.id)) continue
      const into = path.join(tmp, id.pack.id)
      fs.mkdirSync(into)
      extractZip(e.full, into, list)
      const files = install(path.join(into, id.root), id.pack)
      found.set(id.pack.id, { from: e.full, kind: 'zip', files })
    }
    for (const e of entries.filter((x) => x.dir)) {
      const pack = PACKS.find((p) => p.folder.toLowerCase() === path.basename(e.full).toLowerCase())
      if (!pack || found.has(pack.id)) continue
      const files = install(e.full, pack)
      found.set(pack.id, { from: e.full, kind: 'folder', files })
    }
    // A pack unzipped without its top folder: the given folder itself.
    if (found.size === 0 && fs.statSync(src).isDirectory()) {
      const id = identify(relFiles(src))
      if (id) found.set(id.pack.id, { from: src, kind: 'folder', files: install(path.join(src, id.root), id.pack) })
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  if (found.size) {
    console.log(`Found in ${tilde(src)}:`)
    for (const p of PACKS) {
      const f = found.get(p.id)
      if (f) console.log(`  ${LABEL[p.id].padEnd(17)} ${String(f.files).padStart(4)} files  from ${f.kind} ${path.basename(f.from)}`)
    }
  }
  const missing = PACKS.filter((p) => !found.has(p.id))
  if (missing.length) {
    console.log(found.size ? 'Missing:' : `No Sprout Lands packs found in ${tilde(src)}. Missing:`)
    for (const p of missing) console.log(`  ${LABEL[p.id].padEnd(17)} ${p.folder}`)
    console.log('Download them from https://cupnooble.itch.io/sprout-lands-asset-pack')
  }
  if (found.size) {
    console.log(`Copied to ${path.relative(ROOT, DEST)}/ (git-ignored).`)
    const need = new Set(Object.values(manifest.groups).flatMap((sheets) => sheets.map((s) => s.pack)))
    const lacking = [...need].filter((id) => !fs.existsSync(path.join(DEST, manifest.packs[id])))
    if (lacking.length === 0) console.log('Next: npm run art:check confirms the committed atlas matches the packs.')
  }
  process.exit(found.size ? 0 : 1)
}

main()
