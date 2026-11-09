import type { CSSProperties } from 'react'
import atlas from '../map/atlas.json'

// Every pixel image in the UI comes from the one committed atlas, built from art/manifest.json.
const frames = atlas.frames as unknown as Record<string, [number, number, number, number]>
const [AW, AH] = atlas.size as [number, number]

export function hasSprite(name: string) {
  return name in frames
}

export function spriteSize(name: string): [number, number] {
  const f = frames[name]
  return f ? [f[2], f[3]] : [0, 0]
}

/** One atlas frame at a whole-number scale. Renders nothing for an unknown frame. */
export function Sprite({ name, scale = 2, className, style, title }: { name: string; scale?: number; className?: string; style?: CSSProperties; title?: string }) {
  const f = frames[name]
  if (!f) return null
  const k = Math.max(1, Math.round(scale))
  const [x, y, w, h] = f
  return (
    <span
      className={`hs-sprite ${className ?? ''}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{
        width: w * k,
        height: h * k,
        backgroundImage: 'url(/sprites/atlas.png)',
        backgroundSize: `${AW * k}px ${AH * k}px`,
        backgroundPosition: `${-x * k}px ${-y * k}px`,
        ...style,
      }}
    />
  )
}
