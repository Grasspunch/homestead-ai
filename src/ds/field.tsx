import type { ReactNode } from 'react'
import { Emoji } from './Icon'
import { REASONS, type Reason } from './panel'
import { Sprite } from './Sprite'

/* Things drawn over the farm. They sit on the farm's integer scale (--px, 3x) and on a light plate,
   so they read on grass, soil and water alike. One glyph per farmhand at a time. */

export type GlyphState = { kind: 'working' } | { kind: 'ask'; reason: Reason } | { kind: 'done' }

export function FieldGlyph({ state, pulse }: { state: GlyphState; pulse?: boolean }) {
  let art: ReactNode
  if (state.kind === 'working') art = <span className="hs-glyph-work" aria-hidden><i /><i /><i /></span>
  else if (state.kind === 'done') art = <Emoji name="sleep" />
  else {
    const r = REASONS[state.reason]
    art = r.sprite ? <Sprite name={r.sprite} scale={2} /> : <Emoji name={r.emoji} />
  }
  const label = state.kind === 'ask' ? `Needs you: ${REASONS[state.reason].label}` : state.kind === 'done' ? 'Done' : 'Working'
  return (
    <span className={`hs-glyph ${state.kind} ${state.kind === 'ask' ? REASONS[state.reason].tone : ''} ${pulse ? 'pulse' : ''}`} role="img" aria-label={label}>
      {art}
    </span>
  )
}

/** The one line under a farmhand on the field: its role, then its state. */
export function FieldLine({ role, state }: { role: string; state: string }) {
  return (
    <span className="hs-fieldline">
      <b>{role}</b> {state}
    </span>
  )
}

/** A farmhand standing on the field with its glyph and line, as one unit. */
export function Farmhand({ glyph, role, state, frame = 'char_idle_down_0', dim }: { glyph: GlyphState; role: string; state: string; frame?: string; dim?: boolean }) {
  return (
    <span className={`hs-hand ${dim ? 'dim' : ''}`}>
      <FieldGlyph state={glyph} pulse={glyph.kind === 'ask'} />
      <Sprite name={frame} scale={3} className="hs-hand-sprite" />
      <FieldLine role={role} state={state} />
    </span>
  )
}

/** A plot: soil bed tiles, its crop stage, a progress bar under the sign and at most one crate. */
export function Plot({ crop = 'carrot', stage, cols = 3, rows = 2, wet, crate, progress }: { crop?: string; stage: 0 | 1 | 2 | 3; cols?: number; rows?: number; wet?: boolean; crate?: boolean; progress?: number }) {
  const bed = wet ? 'bed_wet' : 'bed_dry'
  const tiles: ReactNode[] = []
  for (let y = 0; y < rows + 2; y++)
    for (let x = 0; x < cols + 2; x++) {
      const cx = x === 0 ? 0 : x === cols + 1 ? 2 : 1
      const cy = y === 0 ? 0 : y === rows + 1 ? 2 : 1
      tiles.push(<Sprite key={`b${x}-${y}`} name={`${bed}_${cx}${cy}`} scale={3} style={{ position: 'absolute', left: x * 48, top: y * 48 }} />)
      if (x > 0 && x <= cols && y > 0 && y <= rows) tiles.push(<Sprite key={`c${x}-${y}`} name={`crop_${crop}_${stage}`} scale={3} style={{ position: 'absolute', left: x * 48, top: y * 48 }} />)
    }
  return (
    <span className="hs-plot" style={{ width: (cols + 2) * 48, height: (rows + 2) * 48 }}>
      {tiles}
      <span className="hs-plot-sign">
        <Sprite name={`sign_${crop}`} scale={3} />
        {progress !== undefined && (
          <span className="hs-plot-bar">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        )}
      </span>
      {crate && <Sprite name="chest" scale={3} className="hs-plot-crate" title="Draft ready" />}
    </span>
  )
}
