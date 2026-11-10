import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

// Serves `virtual:sprout-lands`: every file in the Sprout Lands packs under public/assets/sprout-lands,
// with image sizes read from the file headers and the art/manifest.json frames cut from each sheet.
// The packs are git-ignored (licensed for use, not redistribution), so the list can be empty: then
// `missing` is true and the design library shows how to import them. Types: src/design/sprout-lands.d.ts.
// A production build never ships them: the module reports them missing, and the copy Vite makes of
// public/assets/sprout-lands is deleted from the output once the build is written.

const ID = 'virtual:sprout-lands'
const RESOLVED = '\0' + ID
const DIR = 'public/assets/sprout-lands'
const URL_BASE = '/assets/sprout-lands/'

type Kind = 'png' | 'gif' | 'font' | 'aseprite' | 'text' | 'other'
type Rect = [number, number, number, number, string]
type Sheet = {
  pack: string
  file: string
  tile?: number
  frames?: { name: string; tile?: [number, number]; rect?: [number, number, number, number] }[]
  anim?: { prefix: string; cell: [number, number]; columns: number; dirs: string[]; rows: Record<string, number> }
}
type Manifest = { packs: Record<string, string>; groups: Record<string, Sheet[]> }

const KIND: Record<string, Kind> = {
  '.png': 'png',
  '.gif': 'gif',
  '.ttf': 'font',
  '.otf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
  '.aseprite': 'aseprite',
  '.ase': 'aseprite',
  '.txt': 'text',
  '.md': 'text',
}

// Width and height from the first bytes of a PNG or GIF.
function imageSize(file: string, kind: Kind): [number, number] | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(24)
    fs.readSync(fd, b, 0, 24, 0)
    if (kind === 'png' && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') return [b.readUInt32BE(16), b.readUInt32BE(20)]
    if (kind === 'gif' && b.toString('ascii', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)]
  } catch {
    // unreadable: no size
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  return null
}

// Manifest frames per "<pack>/<file>": the source rectangles, before any trim.
function manifestRects(manifest: Manifest) {
  const out = new Map<string, Rect[]>()
  for (const sheets of Object.values(manifest.groups)) {
    for (const s of sheets) {
      const key = `${s.pack}/${s.file}`
      const list = out.get(key) ?? []
      if (s.anim) {
        const { prefix, cell, columns, dirs, rows } = s.anim
        for (const [anim, row0] of Object.entries(rows))
          dirs.forEach((d, di) => {
            for (let c = 0; c < columns; c++) list.push([c * cell[0], (row0 + di) * cell[1], cell[0], cell[1], `${prefix}_${anim}_${d}_${c}`])
          })
      }
      const size = s.tile ?? 16
      for (const f of s.frames ?? []) {
        if (f.tile) list.push([f.tile[0] * size, f.tile[1] * size, size, size, f.name])
        else if (f.rect) list.push([...f.rect, f.name])
      }
      out.set(key, list)
    }
  }
  return out
}

function walk(dir: string, out: string[] = []) {
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    if (it.name === '__MACOSX' || it.name.startsWith('.')) continue
    const full = path.join(dir, it.name)
    if (it.isDirectory()) walk(full, out)
    else if (it.isFile()) out.push(full)
  }
  return out
}

export function scan(root: string, build = false, urlBase = URL_BASE) {
  const base = path.join(root, DIR)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'art', 'manifest.json'), 'utf8')) as Manifest
  const rects = manifestRects(manifest)
  const packs = []
  const files = []
  for (const [id, folder] of Object.entries(manifest.packs)) {
    if (folder.startsWith('./')) continue // our own art (art/authored), not a Sprout Lands pack
    const dir = path.join(base, folder)
    const present = !build && fs.existsSync(dir) && fs.statSync(dir).isDirectory()
    const list = present ? walk(dir).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : []
    packs.push({ id, title: folder, present, count: list.length })
    for (const full of list) {
      const rel = path.relative(dir, full).split(path.sep).join('/')
      const name = path.posix.basename(rel)
      const kind = KIND[path.extname(name).toLowerCase()] ?? 'other'
      const size = kind === 'png' || kind === 'gif' ? imageSize(full, kind) : null
      const bytes = fs.statSync(full).size
      const r = rects.get(`${id}/${rel}`)
      files.push({
        pack: id,
        packTitle: folder,
        dir: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel),
        name,
        // Commas stay as they are: Vite looks public files up by the raw path, so %2C misses
        url: urlBase + [folder, ...rel.split('/')].map((s) => encodeURIComponent(s).replace(/%2C/g, ',')).join('/'),
        kind,
        ...(size ? { w: size[0], h: size[1] } : {}),
        bytes,
        ...(r ? { usedBy: r.map((x) => x[4]), rects: r } : {}),
        ...(kind === 'text' && bytes < 16384 ? { text: fs.readFileSync(full, 'utf8') } : {}),
      })
    }
  }
  return { missing: !packs.some((p) => p.present), packs, files }
}

export function sproutLands(): Plugin {
  let root = process.cwd()
  let build = false
  let outDir = ''
  return {
    name: 'homestead-sprout-lands',
    configResolved(config) {
      root = config.root
      build = config.command === 'build'
      outDir = path.resolve(config.root, config.build.outDir)
    },
    resolveId(source) {
      return source === ID ? RESOLVED : null
    },
    load(id) {
      if (id !== RESOLVED) return null
      this.addWatchFile(path.join(root, 'art', 'manifest.json'))
      return `export default ${JSON.stringify(scan(root, build))}`
    },
    closeBundle() {
      if (build && outDir) fs.rmSync(path.join(outDir, 'assets', 'sprout-lands'), { recursive: true, force: true })
    },
    configureServer(server: ViteDevServer) {
      const base = path.join(root, DIR)
      const manifest = path.join(root, 'art', 'manifest.json')
      fs.mkdirSync(base, { recursive: true })
      server.watcher.add([base, manifest])
      let timer: ReturnType<typeof setTimeout> | undefined
      const changed = (file: string) => {
        if (!file.startsWith(base) && file !== manifest) return
        clearTimeout(timer)
        // Unzipping writes hundreds of files: wait for it to settle, then reload once.
        timer = setTimeout(() => {
          const graphs = server.environments ? Object.values(server.environments).map((e) => e.moduleGraph) : [server.moduleGraph]
          for (const g of graphs) {
            const mod = g.getModuleById(RESOLVED)
            if (mod) g.invalidateModule(mod)
          }
          server.ws.send({ type: 'full-reload' })
        }, 300)
      }
      for (const ev of ['add', 'unlink', 'addDir', 'unlinkDir', 'change'] as const) server.watcher.on(ev, changed)
    },
  }
}
