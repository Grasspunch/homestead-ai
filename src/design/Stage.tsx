import { useEffect, useState, type ReactNode } from 'react'
import atlas from '../map/atlas.json'

// A specimen ground. Pixel art is judged on the ground it will sit on, so every specimen
// can switch between the white sheet and real farm tiles from the committed atlas.
export type Ground = 'sheet' | 'grass' | 'soil' | 'wet' | 'water' | 'checker'

const TILE: Partial<Record<Ground, string>> = { grass: 'grass', soil: 'bed_dry_11', wet: 'bed_wet_11', water: 'water_0' }
const frames = atlas.frames as unknown as Record<string, [number, number, number, number]>
const cache = new Map<string, Promise<string>>()
let atlasImg: Promise<HTMLImageElement> | null = null

function loadAtlas() {
  atlasImg ??= new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = '/sprites/atlas.png'
  })
  return atlasImg
}

// One atlas tile, scaled by a whole number, as a data URL for a repeating background.
export function tileUrl(name: string, scale: number) {
  const key = `${name}@${scale}`
  if (!cache.has(key)) {
    cache.set(
      key,
      loadAtlas().then((img) => {
        const [x, y, w, h] = frames[name]
        const c = document.createElement('canvas')
        c.width = w * scale
        c.height = h * scale
        const ctx = c.getContext('2d')!
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, x, y, w, h, 0, 0, w * scale, h * scale)
        return c.toDataURL()
      }),
    )
  }
  return cache.get(key)!
}

export function useGroundStyle(ground: Ground, scale = 3) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const name = TILE[ground]
    if (!name) return setUrl(null)
    let alive = true
    tileUrl(name, scale).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [ground, scale])
  if (ground === 'checker') return { className: 'ground-checker' }
  if (ground === 'sheet') return { className: 'ground-sheet' }
  return { className: `ground-${ground}`, style: url ? { backgroundImage: `url(${url})` } : undefined }
}

export const GROUNDS: { id: Ground; label: string }[] = [
  { id: 'sheet', label: 'Sheet' },
  { id: 'grass', label: 'Grass' },
  { id: 'soil', label: 'Soil' },
  { id: 'wet', label: 'Watered' },
  { id: 'water', label: 'Water' },
  { id: 'checker', label: 'Transparent' },
]

export function GroundPicker({ value, onChange }: { value: Ground; onChange: (g: Ground) => void }) {
  return (
    <div className="ds-seg" role="radiogroup" aria-label="Ground">
      {GROUNDS.map((g) => (
        <button key={g.id} type="button" role="radio" aria-checked={value === g.id} onClick={() => onChange(g.id)}>
          <GroundSwatch ground={g.id} />
          {g.label}
        </button>
      ))}
    </div>
  )
}

function GroundSwatch({ ground }: { ground: Ground }) {
  const s = useGroundStyle(ground, 1)
  return <i className={`ds-swatch ${s.className}`} style={s.style} aria-hidden />
}

// A framed specimen on a chosen ground.
export function Stage({ ground = 'sheet', children, pad = 24, scale = 3, className = '' }: { ground?: Ground; children: ReactNode; pad?: number; scale?: number; className?: string }) {
  const s = useGroundStyle(ground, scale)
  return (
    <div className={`ds-stage ${s.className} ${className}`} style={{ padding: pad, ...s.style }}>
      {children}
    </div>
  )
}
