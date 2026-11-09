import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { draw, loadAtlas } from './map/atlas'
import atlas from './map/atlas.json'
import { engine } from './sim/engine'

export function useEngine() {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  return engine
}

// A farm word; its plain meaning is in the tooltip.
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

// A farmhand's face, tinted like its sprite on the map.
export function Portrait({ color, shade, size = 24 }: { color: string; shade: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true
    loadAtlas().then(() => {
      const c = ref.current
      if (!alive || !c) return
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, c.width, c.height)
      draw(ctx, 'char_idle_down_0', -14, -15, { tint: { body: color, shade } })
    })
    return () => {
      alive = false
    }
  }, [color, shade])
  return <canvas ref={ref} width={20} height={20} className="portrait" style={{ width: size, height: size }} aria-hidden />
}

export function fmtK(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`
  if (n >= 100) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n)}`
}

export function fmtT(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// 32px cells in the Sprout Lands UI pack's emoji sheet (5 columns, 19 rows).
const ICONS = {
  check: [0, 7],
  cross: [1, 7],
  alert: [2, 7],
  question: [3, 7],
  sleep: [4, 7],
  coin: [1, 8],
  heart: [3, 8],
  star: [4, 8],
  skull: [2, 1],
  sprout: [0, 12],
  wheat: [1, 13],
  hammer: [0, 16],
  sun: [0, 18],
} as const
export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const [c, r] = ICONS[name]
  const k = size / 32
  return (
    <span
      className="icon"
      aria-hidden
      style={{ width: size, height: size, backgroundSize: `${160 * k}px ${608 * k}px`, backgroundPosition: `${-c * size}px ${-r * size}px` }}
    />
  )
}

export const REASON_ICON: Record<string, IconName> = { Cost: 'coin', Risk: 'alert', Irreversible: 'cross', Failure: 'skull', Anomaly: 'question' }

export function Reason({ label, icon }: { label: string; icon?: IconName }) {
  return (
    <span className={`reason ${label}`}>
      <Icon name={icon ?? REASON_ICON[label] ?? 'question'} />
      {label}
    </span>
  )
}
