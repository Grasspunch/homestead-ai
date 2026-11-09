import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import sprout, { type PackFile, type PackId } from 'virtual:sprout-lands'
import manifestJson from '../../../art/manifest.json'
import atlasJson from '../../map/atlas.json'
import { Button, Checkbox, Sprite, TextInput } from '../../ds'
import { GroundPicker, useGroundStyle, type Ground } from '../Stage'
import '../art.css'

// The art browser: every file in the four Sprout Lands packs (served by scripts/vite-sprout-lands.ts),
// and every frame the app draws (art/manifest.json, cut into the committed atlas).

type Rect = [number, number, number, number]
type Sheet = {
  pack: PackId
  file: string
  tile?: number
  _note?: string
  frames?: { name: string; tile?: [number, number]; rect?: Rect; trim?: boolean }[]
  anim?: { prefix: string; cell: [number, number]; columns: number; dirs: string[]; rows: Record<string, number> }
}
type Manifest = { packs: Record<PackId, string>; titles: Record<string, string>; groups: Record<string, Sheet[]> }

const manifest = manifestJson as unknown as Manifest
const atlasFrames = atlasJson.frames as unknown as Record<string, Rect>
const atlasCounts = atlasJson.counts as Record<string, number>
const [ATLAS_W, ATLAS_H] = atlasJson.size as [number, number]

const CREDIT = 'https://cupnooble.itch.io/sprout-lands-asset-pack'
const IMPORT = 'npm run assets -- ~/Downloads/sprout-lands'
const ZOOMS = [1, 2, 3, 4]
const PACKS: Record<PackId, { title: string; about: string }> = {
  'sprites-premium': { title: 'Sprites, premium pack', about: 'characters and their tools, animals, crops, ground tiles, buildings and objects.' },
  'sprites-basic': { title: 'Sprites, basic pack', about: 'the free set: one character, chickens and a cow, basic tiles, plants and furniture.' },
  'ui-premium': { title: 'UI, premium pack', about: 'buttons, dialogue boxes, icons, emotes, cursors and five pixel fonts.' },
  'ui-basic': { title: 'UI, basic pack', about: 'the free UI set: dialogue boxes, icons, cursors, a settings menu and one pixel font.' },
}

/* ---------- small helpers ---------- */

function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('art.' + key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

function usePref<T>(key: string, fallback: T) {
  const [v, setV] = useState<T>(() => pref(key, fallback))
  useEffect(() => {
    try {
      localStorage.setItem('art.' + key, JSON.stringify(v))
    } catch {
      // private window: keep it for this visit only
    }
  }, [key, v])
  return [v, setV] as const
}

function bytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function inPack(f: PackFile) {
  return f.dir ? `${f.dir}/${f.name}` : f.name
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// One counter for everything animated on a view, at a steady fps.
function useTick(fps: number, on: boolean) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setT((n) => n + 1), 1000 / fps)
    return () => clearInterval(id)
  }, [fps, on])
  return t
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(null), 1400)
    return () => clearTimeout(id)
  }, [copied])
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(key),
      () => setCopied(null),
    )
  }
  return [copied, copy] as const
}

// The largest whole-number scale, up to `want`, that fits the box. Never below 1.
function fitScale(w: number, h: number, want: number, maxW: number, maxH: number) {
  let s = want
  while (s > 1 && (w * s > maxW || h * s > maxH)) s--
  return s
}

/* ---------- page ---------- */

export function ArtPage({ arg }: { arg?: string }) {
  if (arg === 'used') return <UsedView />
  const pack = (arg && arg in PACKS ? arg : 'sprites-premium') as PackId
  return <PackView key={pack} pack={pack} />
}

function ArtHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="ds-head art-head">
      <h1>{title}</h1>
      <p>{children}</p>
      <p className="art-credit">
        <a href={CREDIT} target="_blank" rel="noreferrer">
          Sprout Lands by Cup Nooble
        </a>
      </p>
    </header>
  )
}

function Toolbar({
  search,
  onSearch,
  placeholder,
  ground,
  onGround,
  zoom,
  onZoom,
  frames,
  onFrames,
}: {
  search: string
  onSearch: (s: string) => void
  placeholder: string
  ground: Ground
  onGround: (g: Ground) => void
  zoom: number
  onZoom: (z: number) => void
  frames?: boolean
  onFrames?: (v: boolean) => void
}) {
  return (
    <div className="art-bar" role="toolbar" aria-label="View">
      <div className="art-bar-row">
        <div className="art-search">
          <TextInput type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label="Search" />
        </div>
        {onFrames && <Checkbox label="Show frames the app uses" checked={!!frames} onChange={(e) => onFrames(e.target.checked)} />}
      </div>
      <div className="art-bar-row">
        <GroundPicker value={ground} onChange={onGround} />
        <ZoomPicker value={zoom} onChange={onZoom} options={ZOOMS} />
      </div>
    </div>
  )
}

function ZoomPicker({ value, onChange, options, label = 'Zoom' }: { value: number; onChange: (z: number) => void; options: number[]; label?: string }) {
  return (
    <div className="ds-seg" role="radiogroup" aria-label={label}>
      {options.map((z) => (
        <button key={z} type="button" role="radio" aria-checked={value === z} onClick={() => onChange(z)}>
          {z}x
        </button>
      ))}
    </div>
  )
}

/* ---------- one pack ---------- */

function PackView({ pack }: { pack: PackId }) {
  const info = sprout.packs.find((p) => p.id === pack)
  const meta = PACKS[pack]
  const [search, setSearch] = useState('')
  const [ground, setGround] = usePref<Ground>('ground', 'sheet')
  const [zoom, setZoom] = usePref('zoom', 2)
  const [showFrames, setShowFrames] = usePref('frames', false)
  const [open, setOpen] = useState<PackFile | null>(null)
  const g = useGroundStyle(ground, zoom)

  const folders = useMemo(() => {
    const q = search.trim().toLowerCase()
    const by = new Map<string, PackFile[]>()
    for (const f of sprout.files) {
      if (f.pack !== pack) continue
      if (q && !inPack(f).toLowerCase().includes(q)) continue
      by.set(f.dir, [...(by.get(f.dir) ?? []), f])
    }
    return [...by.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'en', { numeric: true })))
  }, [pack, search])

  if (!info?.present) {
    return (
      <>
        <ArtHead title={meta.title}>Not imported here yet.</ArtHead>
        <Missing all={sprout.missing} folder={manifest.packs[pack]} />
      </>
    )
  }

  const shown = folders.reduce((n, [, fs]) => n + fs.length, 0)
  const hasUsed = sprout.files.some((f) => f.pack === pack && f.usedBy)
  return (
    <>
      <ArtHead title={meta.title}>
        {info.count} files: {meta.about}
      </ArtHead>
      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Filter by file or folder name"
        ground={ground}
        onGround={setGround}
        zoom={zoom}
        onZoom={setZoom}
        frames={showFrames}
        onFrames={hasUsed ? setShowFrames : undefined}
      />
      {search && (
        <p className="art-count" aria-live="polite">
          {shown ? `${shown} of ${info.count} files match.` : 'No files match.'}
        </p>
      )}
      {folders.map(([dir, files]) => (
        <Folder key={dir} dir={dir} root={info.title} files={files} zoom={zoom} ground={g} showFrames={hasUsed && showFrames} onOpen={setOpen} />
      ))}
      {open && <Detail file={open} ground={ground} onGround={setGround} onClose={() => setOpen(null)} />}
    </>
  )
}

type GroundStyle = ReturnType<typeof useGroundStyle>

function Folder({
  dir,
  root,
  files,
  zoom,
  ground,
  showFrames,
  onOpen,
}: {
  dir: string
  root: string
  files: PackFile[]
  zoom: number
  ground: GroundStyle
  showFrames: boolean
  onOpen: (f: PackFile) => void
}) {
  const images = files.filter((f) => f.kind === 'png' || f.kind === 'gif')
  const fonts = files.filter((f) => f.kind === 'font')
  const license = files.find((f) => f.kind === 'text' && /read_?me/i.test(f.name) && f.text)
  const rest = files.filter((f) => f.kind !== 'png' && f.kind !== 'gif' && f.kind !== 'font' && f !== license)
  return (
    <section className="art-folder" aria-label={dir || root}>
      <h2 className="art-dir">
        <code>{dir ? `${dir}/` : `${root}/`}</code>
        <span>{files.length === 1 ? '1 file' : `${files.length} files`}</span>
      </h2>
      {images.length > 0 && (
        <div className="art-grid">
          {images.map((f) => (
            <Specimen key={f.url} file={f} zoom={zoom} ground={ground} showFrames={showFrames} onOpen={onOpen} />
          ))}
        </div>
      )}
      {fonts.length > 0 && <Fonts files={fonts} zoom={zoom} />}
      {rest.length > 0 && (
        <ul className="art-quiet">
          {rest.map((f) => (
            <li key={f.url}>
              <code>{f.name}</code>
              <span>{bytes(f.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      {license && (
        <details className="art-license">
          <summary>
            License <code>{license.name}</code> <span>{bytes(license.bytes)}</span>
          </summary>
          <pre>{license.text!.trim()}</pre>
        </details>
      )}
    </section>
  )
}

const MAX_W = 936
const MAX_H = 560

function Specimen({ file, zoom, ground, showFrames, onOpen }: { file: PackFile; zoom: number; ground: GroundStyle; showFrames: boolean; onOpen: (f: PackFile) => void }) {
  const w = file.w ?? 16
  const h = file.h ?? 16
  const s = fitScale(w, h, zoom, MAX_W, MAX_H)
  const used = file.usedBy?.length ?? 0
  return (
    <button type="button" className="art-spec" style={{ width: `min(100%, ${Math.max(w * s + 32, 136)}px)` }} onClick={() => onOpen(file)} aria-label={`${file.name}, ${w} by ${h}. Open`}>
      <span className={`art-ground ${ground.className}`} style={{ ...ground.style, height: Math.min(h * s, MAX_H) + 32 }}>
        <span className="art-pic" style={{ width: w * s, height: h * s }}>
          <img src={file.url} alt="" width={w * s} height={h * s} loading="lazy" decoding="async" draggable={false} />
          {showFrames && file.rects && <Rects w={w} h={h} rects={file.rects} />}
        </span>
      </span>
      <span className="art-cap">
        <b>{file.name}</b>
        <code>
          {w}x{h}
          {showFrames && used > 0 && <em>{used === 1 ? ' 1 frame used' : ` ${used} frames used`}</em>}
        </code>
      </span>
    </button>
  )
}

// Manifest frames outlined over a sheet, in source pixels.
function Rects({ w, h, rects, hover, onHover, pick }: { w: number; h: number; rects: PackFile['rects']; hover?: string | null; onHover?: (n: string | null) => void; pick?: Rect | null }) {
  return (
    <svg className="art-rects" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {rects!.map(([x, y, rw, rh, name]) => (
        <rect
          key={name}
          x={x + 0.5}
          y={y + 0.5}
          width={rw - 1}
          height={rh - 1}
          className={hover === name ? 'on' : undefined}
          onMouseEnter={onHover && (() => onHover(name))}
          onMouseLeave={onHover && (() => onHover(null))}
        >
          <title>{name}</title>
        </rect>
      ))}
      {pick && <rect className="pick" x={pick[0] + 0.5} y={pick[1] + 0.5} width={pick[2] - 1} height={pick[3] - 1} />}
    </svg>
  )
}

/* ---------- fonts ---------- */

const SAMPLE = 'Water the carrots before noon. 0123456789'
const loaded = new Map<string, Promise<void>>()

function fontFamily(f: PackFile) {
  return 'sl-' + f.url.replace(/[^a-z0-9]/gi, '').slice(-40)
}

function useFont(f: PackFile) {
  const fam = fontFamily(f)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!loaded.has(fam)) {
      const face = new FontFace(fam, `url(${f.url})`)
      loaded.set(
        fam,
        face.load().then((ff) => {
          document.fonts.add(ff)
        }),
      )
    }
    let alive = true
    loaded.get(fam)!.then(
      () => alive && setReady(true),
      () => alive && setReady(false),
    )
    return () => {
      alive = false
    }
  }, [fam, f.url])
  return ready ? fam : null
}

function Fonts({ files, zoom }: { files: PackFile[]; zoom: number }) {
  return (
    <ul className="art-fonts">
      {files.map((f) => (
        <FontRow key={f.url} file={f} zoom={zoom} />
      ))}
    </ul>
  )
}

function FontRow({ file, zoom }: { file: PackFile; zoom: number }) {
  const fam = useFont(file)
  return (
    <li>
      <span className="art-font-sample" style={{ fontFamily: fam ? `'${fam}'` : undefined, fontSize: 8 * (zoom + 1), visibility: fam ? 'visible' : 'hidden' }}>
        {SAMPLE}
      </span>
      <span className="art-font-meta">
        <code>{file.name}</code>
        <span>{bytes(file.bytes)}</span>
      </span>
    </li>
  )
}

/* ---------- missing packs ---------- */

function Missing({ all, folder }: { all: boolean; folder: string }) {
  const [copied, copy] = useCopy()
  return (
    <section className="art-missing" aria-labelledby="art-missing-h">
      <h2 id="art-missing-h">{all ? 'The Sprout Lands packs are not here' : 'This pack is not here'}</h2>
      <p>
        The license lets us use the art in this project, with credit, but not share the packs themselves. So they stay out of git and
        each person imports their own copy. Download the four packs from{' '}
        <a href={CREDIT} target="_blank" rel="noreferrer">
          itch.io
        </a>
        , then run:
      </p>
      <div className="art-cmd">
        <code>{IMPORT}</code>
        <Button size="sm" onClick={() => copy('cmd', IMPORT)}>
          {copied === 'cmd' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p>
        The folder can hold the zips, under any names, or the packs already unzipped. They land in <code className="ds-code">public/assets/sprout-lands/</code>
        {all ? '' : <> as <code className="ds-code">{folder}</code></>} and this page updates on its own.
      </p>
      <p>
        The frames the app draws are already in the repo, in the atlas. <a href="#/art/used">See them in Used by the app.</a>
      </p>
    </section>
  )
}

/* ---------- detail ---------- */

const CELLS = [16, 32, 48, 64]
const GRIDS = [0, 16, 32, 48]

function guessCell(f: PackFile) {
  if (f.usedBy?.some((n) => n.startsWith('char_')) || /charakter|character/i.test(f.name)) return 48
  if (/cow/i.test(f.dir + f.name)) return 32
  return 16
}

// Which cells of a sheet hold any pixels, read once from one canvas for the open file.
function useAlpha(url: string, on: boolean) {
  const [data, setData] = useState<ImageData | null>(null)
  useEffect(() => {
    setData(null)
    if (!on) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      setData(ctx.getImageData(0, 0, c.width, c.height))
    }
    img.src = url
    return () => {
      alive = false
    }
  }, [url, on])
  return data
}

function filledCells(data: ImageData | null, cell: number, w: number, h: number) {
  const cols = Math.floor(w / cell)
  const rows = Math.floor(h / cell)
  const out: number[][] = []
  for (let r = 0; r < rows; r++) {
    const row: number[] = []
    for (let c = 0; c < cols; c++) {
      if (!data) {
        row.push(c)
        continue
      }
      let hit = false
      for (let y = r * cell; y < (r + 1) * cell && !hit; y++) {
        let i = (y * data.width + c * cell) * 4 + 3
        for (let x = 0; x < cell; x++, i += 4) {
          if (data.data[i]) {
            hit = true
            break
          }
        }
      }
      if (hit) row.push(c)
    }
    out.push(row)
  }
  return out
}

function Detail({ file, ground, onGround, onClose }: { file: PackFile; ground: Ground; onGround: (g: Ground) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const w = file.w ?? 16
  const h = file.h ?? 16
  const isSheet = file.kind === 'png'
  const [zoom, setZoom] = useState(() => fitScale(w, h, 4, 840, 4000))
  const [grid, setGrid] = useState(0)
  const [showRects, setShowRects] = useState(true)
  const [hover, setHover] = useState<string | null>(null)
  const [cell, setCell] = useState(() => guessCell(file))
  const [copied, copy] = useCopy()
  const g = useGroundStyle(ground, zoom)

  // Open as a modal: focus moves in, Tab stays in, Esc closes, focus goes back to the specimen.
  const [back] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => {
    const d = ref.current!
    if (!d.open) d.showModal()
    return () => back?.focus()
  }, [back])

  const alpha = useAlpha(file.url, isSheet)
  const cells = useMemo(() => filledCells(alpha, cell, w, h), [alpha, cell, w, h])
  const playable = isSheet && cells.some((r) => r.length > 0) && (w >= cell * 2 || h >= cell * 2)
  const firstRow = Math.max(0, cells.findIndex((r) => r.length > 0))
  const [row, setRow] = useState(firstRow)
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(() => !reducedMotion())
  useEffect(() => {
    setRow(firstRow)
    setI(0)
  }, [cell, firstRow])
  const frames = cells[row] ?? []
  const tick = useTick(8, playable && playing && frames.length > 1)
  useEffect(() => {
    if (tick) setI((n) => (frames.length ? (n + 1) % frames.length : 0))
  }, [tick, frames.length])
  const col = frames[Math.min(i, frames.length - 1)] ?? 0
  const pick: Rect | null = playable ? [col * cell, row * cell, cell, cell] : null

  const onPick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!playable) return
    const box = e.currentTarget.getBoundingClientRect()
    const c = Math.floor((e.clientX - box.left) / zoom / cell)
    const r = Math.floor((e.clientY - box.top) / zoom / cell)
    const idx = cells[r]?.indexOf(c) ?? -1
    if (idx < 0) return
    setRow(r)
    setI(idx)
    setPlaying(false)
  }

  const path = inPack(file)
  const match = pick && file.rects?.find((r) => r[0] === pick[0] && r[1] === pick[1] && r[2] === pick[2] && r[3] === pick[3])
  const frameName = match?.[4] ?? `${file.name.replace(/\.[a-z]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${col}_${row}`
  const frameJson =
    cell === 16 ? `{"name": ${JSON.stringify(frameName)}, "tile": [${col}, ${row}]}` : `{"name": ${JSON.stringify(frameName)}, "rect": [${col * cell}, ${row * cell}, ${cell}, ${cell}]}`
  const snippet = `{"pack": ${JSON.stringify(file.pack)}, "file": ${JSON.stringify(path)}, "frames": [\n  ${frameJson}\n]}`
  const pz = Math.max(1, Math.floor(144 / cell))
  const gridStyle: CSSProperties | undefined = grid ? ({ '--cell': `${grid * zoom}px` } as CSSProperties) : undefined

  return (
    <dialog
      ref={ref}
      className="art-drawer"
      aria-labelledby="art-detail-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close()
      }}
    >
      <header className="art-drawer-head">
        <div>
          <h2 id="art-detail-title">{file.name}</h2>
          <p>
            <code>{path}</code>
          </p>
          <p className="art-drawer-meta">
            <code>
              {w}x{h}
            </code>
            <code>{bytes(file.bytes)}</code>
            {file.usedBy && <span>{file.usedBy.length === 1 ? '1 frame used by the app' : `${file.usedBy.length} frames used by the app`}</span>}
          </p>
        </div>
        <Button kind="quiet" size="sm" onClick={() => ref.current?.close()} aria-label="Close" keycap="Esc">
          Close
        </Button>
      </header>

      <div className="art-drawer-body">
        <div className="art-drawer-tools">
          <ZoomPicker value={zoom} onChange={setZoom} options={[1, 2, 3, 4, 5, 6]} />
          <div className="ds-seg" role="radiogroup" aria-label="Grid">
            {GRIDS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={grid === n} onClick={() => setGrid(n)}>
                {n ? `${n} px grid` : 'No grid'}
              </button>
            ))}
          </div>
          {file.rects && (
            <div className="ds-seg" role="radiogroup" aria-label="Frames the app uses">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" role="radio" aria-checked={showRects === v} onClick={() => setShowRects(v)}>
                  {v ? 'Show app frames' : 'Hide app frames'}
                </button>
              ))}
            </div>
          )}
          <GroundPicker value={ground} onChange={onGround} />
        </div>

        <div className="art-view" tabIndex={0} aria-label={`${file.name} at ${zoom}x`}>
          <div className={`art-canvas ${g.className}`} style={{ ...g.style, width: w * zoom, height: h * zoom }} onClick={onPick} data-pick={playable || undefined}>
            <img src={file.url} alt={file.name} width={w * zoom} height={h * zoom} draggable={false} />
            {grid > 0 && <i className="art-gridlines" style={gridStyle} aria-hidden />}
            {((showRects && file.rects) || pick) && <Rects w={w} h={h} rects={showRects ? file.rects ?? [] : []} hover={hover} onHover={setHover} pick={pick} />}
          </div>
        </div>
        <p className="art-readout" aria-live="polite">
          {hover ? (
            <>
              <code>{hover}</code> <span>{rectText(file.rects?.find((r) => r[4] === hover))}</span>
            </>
          ) : file.rects && showRects ? (
            <span>Point at an outlined frame to see its name.</span>
          ) : playable ? (
            <span>Click a cell to pick it for the player.</span>
          ) : (
            <span>&nbsp;</span>
          )}
        </p>

        {playable && (
          <section className="art-player" aria-label="Frame player">
            <h3>Frame player</h3>
            <div className="art-player-row">
              <span className={`art-frame ${g.className}`} style={g.style}>
                <span
                  className="art-frame-img"
                  role="img"
                  aria-label={`Row ${row + 1}, frame ${Math.min(i, frames.length - 1) + 1}`}
                  style={{
                    width: cell * pz,
                    height: cell * pz,
                    backgroundImage: `url("${file.url}")`,
                    backgroundSize: `${w * pz}px ${h * pz}px`,
                    backgroundPosition: `${-col * cell * pz}px ${-row * cell * pz}px`,
                  }}
                />
              </span>
              <div className="art-player-controls">
                <div className="art-player-line">
                  <div className="ds-seg" role="radiogroup" aria-label="Cell size">
                    {CELLS.filter((c) => c <= Math.max(w, h)).map((c) => (
                      <button key={c} type="button" role="radio" aria-checked={cell === c} onClick={() => setCell(c)}>
                        {c} px
                      </button>
                    ))}
                  </div>
                  <label className="art-select">
                    <span>Row</span>
                    <select value={row} onChange={(e) => (setRow(Number(e.target.value)), setI(0))}>
                      {cells.map((r, n) =>
                        r.length ? (
                          <option key={n} value={n}>
                            {n + 1} ({r.length === 1 ? '1 frame' : `${r.length} frames`})
                          </option>
                        ) : null,
                      )}
                    </select>
                  </label>
                </div>
                <div className="art-player-line">
                  <Button size="sm" onClick={() => setPlaying((p) => !p)} disabled={frames.length < 2} aria-pressed={playing}>
                    {playing ? 'Pause' : 'Play'}
                  </Button>
                  <input
                    className="art-scrub"
                    type="range"
                    min={0}
                    max={Math.max(0, frames.length - 1)}
                    value={Math.min(i, frames.length - 1)}
                    onChange={(e) => (setI(Number(e.target.value)), setPlaying(false))}
                    aria-label="Frame"
                  />
                  <code className="art-player-count">
                    {Math.min(i, frames.length - 1) + 1} / {frames.length}
                  </code>
                </div>
                <p className="art-player-at">
                  <code>{frameName}</code>{' '}
                  <span>
                    cell {col}, {row} at {col * cell}, {row * cell}
                  </span>
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="art-copy" aria-label="Copy">
          <h3>Use it</h3>
          <div className="art-copy-row">
            <code>{path}</code>
            <Button size="sm" onClick={() => copy('path', path)}>
              {copied === 'path' ? 'Copied' : 'Copy path'}
            </Button>
          </div>
          {isSheet && (
            <div className="art-copy-row">
              <pre>{snippet}</pre>
              <Button size="sm" onClick={() => copy('json', snippet)}>
                {copied === 'json' ? 'Copied' : 'Copy manifest entry'}
              </Button>
            </div>
          )}
          {isSheet && <p className="art-hint">Add the entry to art/manifest.json, then run npm run art:atlas.</p>}
        </section>

        {file.usedBy && (
          <section className="art-usedby" aria-label="Frames the app uses">
            <h3>Frames the app uses</h3>
            {file.usedBy.length > 24 ? (
              <details>
                <summary>All {file.usedBy.length} names</summary>
                <FrameNames names={file.usedBy} onHover={setHover} />
              </details>
            ) : (
              <FrameNames names={file.usedBy} onHover={setHover} />
            )}
          </section>
        )}
      </div>
    </dialog>
  )
}

// Frame names; pointing at or focusing one outlines it on the sheet.
function FrameNames({ names, onHover }: { names: string[]; onHover: (n: string | null) => void }) {
  return (
    <ul>
      {names.map((n) => (
        <li key={n}>
          <button type="button" onMouseEnter={() => onHover(n)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(n)} onBlur={() => onHover(null)}>
            {n}
          </button>
        </li>
      ))}
    </ul>
  )
}

function rectText(r?: [number, number, number, number, string]) {
  return r ? `${r[2]}x${r[3]} at ${r[0]}, ${r[1]}` : ''
}

/* ---------- used by the app ---------- */

type UsedSheet = { pack: PackId; file: string; note?: string; frames: string[]; anim?: { name: string; dirs: { dir: string; frames: string[] }[] }[] }

function usedGroups() {
  return Object.entries(manifest.groups).map(([id, sheets]) => ({
    id,
    title: manifest.titles[id] ?? id,
    sheets: sheets.map((s): UsedSheet => {
      const out: UsedSheet = { pack: s.pack, file: s.file, note: s._note, frames: (s.frames ?? []).map((f) => f.name).filter((n) => n in atlasFrames) }
      if (s.anim) {
        const a = s.anim
        out.anim = Object.keys(a.rows).map((name) => ({
          name,
          dirs: a.dirs.map((dir) => ({
            dir,
            frames: Array.from({ length: atlasCounts[`${name}_${dir}`] ?? 0 }, (_, n) => `${a.prefix}_${name}_${dir}_${n}`).filter((n) => n in atlasFrames),
          })),
        }))
        out.frames = out.anim.flatMap((x) => x.dirs.flatMap((d) => d.frames))
      }
      return out
    }),
  }))
}

function UsedView() {
  const [search, setSearch] = useState('')
  const [ground, setGround] = usePref<Ground>('ground', 'sheet')
  const [zoom, setZoom] = usePref('zoom', 2)
  const g = useGroundStyle(ground, zoom)
  const all = useMemo(usedGroups, [])
  const total = Object.keys(atlasFrames).length
  const sheetCount = all.reduce((n, gr) => n + gr.sheets.length, 0)

  const q = search.trim().toLowerCase()
  const groups = all
    .map((gr) => ({
      ...gr,
      sheets: gr.sheets
        .map((s) => {
          if (!q || s.file.toLowerCase().includes(q) || gr.title.toLowerCase().includes(q)) return s
          const anim = s.anim?.filter((a) => `${a.name}`.includes(q) || a.dirs.some((d) => d.frames.some((f) => f.includes(q))))
          return { ...s, anim, frames: s.frames.filter((f) => f.includes(q)) }
        })
        .filter((s) => s.frames.length > 0),
    }))
    .filter((gr) => gr.sheets.length > 0)

  return (
    <>
      <ArtHead title="Used by the app">
        {total} frames from {sheetCount} sheets, packed into one {ATLAS_W}x{ATLAS_H} atlas. These come from the committed atlas, so they show even
        without the packs.
      </ArtHead>
      <Toolbar search={search} onSearch={setSearch} placeholder="Filter by frame or file name" ground={ground} onGround={setGround} zoom={zoom} onZoom={setZoom} />
      {groups.length === 0 && <p className="art-count">No frames match.</p>}
      {groups.map((gr) => (
        <section key={gr.id} className="art-used-group" aria-labelledby={`art-g-${gr.id}`}>
          <h2 id={`art-g-${gr.id}`}>
            {gr.title}
            <span>{gr.sheets.reduce((n, s) => n + s.frames.length, 0)}</span>
          </h2>
          {gr.sheets.map((s) => (
            <div key={s.file} className="art-used-sheet">
              <h3>
                <code>{s.file}</code>
                <span>{PACKS[s.pack as PackId]?.title ?? 'Our own art, art/authored'}</span>
              </h3>
              {s.note && <p className="art-hint">{s.note}</p>}
              {s.anim ? (
                <AnimRows anims={s.anim} zoom={zoom} ground={g} />
              ) : (
                <div className="art-grid">
                  {s.frames.map((name) => (
                    <UsedFrame key={name} name={name} zoom={zoom} ground={g} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </>
  )
}

function UsedFrame({ name, zoom, ground }: { name: string; zoom: number; ground: GroundStyle }) {
  const [, , w, h] = atlasFrames[name]
  return (
    <figure className="art-used" style={{ width: Math.max(w * zoom + 32, 112) }}>
      <span className={`art-ground ${ground.className}`} style={{ ...ground.style, height: h * zoom + 32 }}>
        <Sprite name={name} scale={zoom} />
      </span>
      <figcaption className="art-cap">
        <b>
          <code>{name}</code>
        </b>
        <code>
          {w}x{h}
        </code>
      </figcaption>
    </figure>
  )
}

// Character animations: one ruled row per direction, the playing frame first, then every frame.
function AnimRows({ anims, zoom, ground }: { anims: NonNullable<UsedSheet['anim']>; zoom: number; ground: GroundStyle }) {
  const s = Math.min(zoom, 2)
  return (
    <ul className="art-anims">
      {anims.flatMap((a) =>
        a.dirs
          .filter((d) => d.frames.length > 0)
          .map((d) => {
            const [, , w, h] = atlasFrames[d.frames[0]]
            return (
              <li key={`${a.name}_${d.dir}`}>
                <span className="art-anim-cap">
                  <b>
                    <code>
                      {a.name}_{d.dir}
                    </code>
                  </b>
                  <code>
                    {d.frames.length} frames, {w}x{h}
                  </code>
                </span>
                <span className={`art-anim-play ${ground.className}`} style={ground.style}>
                  <AnimPlay frames={d.frames} scale={s} title={`${a.name} ${d.dir}, playing`} />
                </span>
                <span className={`art-anim-strip ${ground.className}`} style={{ ...ground.style, minHeight: h * s }}>
                  {d.frames.map((f) => (
                    <Sprite key={f} name={f} scale={s} title={f} />
                  ))}
                </span>
              </li>
            )
          }),
      )}
    </ul>
  )
}

// Each playing frame keeps its own clock, so the rest of the page doesn't re-render 8 times a second.
function AnimPlay({ frames, scale, title }: { frames: string[]; scale: number; title: string }) {
  const tick = useTick(8, !reducedMotion())
  return <Sprite name={frames[tick % frames.length]} scale={scale} title={title} />
}
