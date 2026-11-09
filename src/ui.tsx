import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import atlas from './map/atlas.json'
import { engine } from './sim/engine'

export function useEngine() {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  return engine
}

// A farm word with its plain meaning inline, so nobody has to hover to learn the metaphor.
export function Term({ w, m }: { w: string; m: string }) {
  return (
    <span className="term" title={m}>
      {w}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>
}

const frames = atlas.frames as Record<string, number[]>
const [AW, AH] = atlas.size

export function Sprite({ name, scale = 2, style, className }: { name: string; scale?: number; style?: CSSProperties; className?: string }) {
  const f = frames[name]
  if (!f) return null
  const [x, y, w, h] = f
  return (
    <span
      className={className}
      aria-hidden
      style={{
        display: 'inline-block',
        width: w * scale,
        height: h * scale,
        backgroundImage: 'url(/sprites/atlas.png)',
        backgroundSize: `${AW * scale}px ${AH * scale}px`,
        backgroundPosition: `${-x * scale}px ${-y * scale}px`,
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  )
}

// Crops a 48x48 character frame down to the body.
export function Avatar({ frame = 'char_idle_down_0', size = 40 }: { frame?: string; size?: number }) {
  const f = frames[frame]
  if (!f) return <span className="avatar" />
  const [x, y] = f
  const s = size / 20
  return (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        backgroundImage: 'url(/sprites/atlas.png)',
        backgroundSize: `${AW * s}px ${AH * s}px`,
        backgroundPosition: `${-(x + 14) * s}px ${-(y + 14) * s}px`,
        backgroundColor: 'var(--sky)',
      }}
    />
  )
}

export function fmtK(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return `${Math.round(n)}`
}

export function fmtT(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
