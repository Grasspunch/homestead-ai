// Small pieces shared by the HUD: pixel icons, farmer portraits, swatches and number formats.
import { useEffect, useRef } from 'react'
import { draw, frame, loadAtlas } from '../map/atlas'
import { SWATCH, TINT } from '../run/crew'
import type { AskReason, FarmerId } from '../run/types'

// Icons from the Sprout Lands icon sheet (16 px cells). Names map to [column, row] in one colour set.
const ICONS = {
  gear: [0, 0], help: [1, 0], star: [2, 0],
  check: [0, 2], cross: [1, 2], no: [2, 2],
  skip: [0, 3], play: [1, 3], pause: [2, 3],
  heart: [0, 4], sprout: [1, 4],
  chat: [1, 5],
  alert: [0, 6], coin: [1, 6],
  plus: [0, 7], minus: [1, 7], home: [2, 7],
  enter: [1, 8], exit: [2, 8], back: [3, 8],
} as const
export type IconName = keyof typeof ICONS

// Pixel icons only scale by whole numbers (16 or 32 px); anything else smears the pixels.
// 'bold' is the pack's filled, outlined set, for the top bar.
export function Ico({ name, size: asked = 16, tone = 'dark' }: { name: IconName; size?: number; tone?: 'dark' | 'light' | 'green' | 'bold' }) {
  const size = asked >= 44 ? 48 : asked >= 28 ? 32 : 16 // whole pixel scales only
  const [c, r] = ICONS[name]
  const col = tone === 'dark' || tone === 'bold' ? c + 12 : tone === 'light' ? c + 4 : c
  const row = tone === 'green' || tone === 'bold' ? r + 10 : r
  return (
    <i
      className="ico"
      aria-hidden
      style={{ width: size, height: size, ['--ico' as string]: `${size}px`, backgroundSize: `${(256 * size) / 16}px ${(320 * size) / 16}px`, backgroundPosition: `-${col * size}px -${row * size}px` }}
    />
  )
}

let atlasReady: Promise<void> | null = null
export const atlasLoaded = () => (atlasReady ??= loadAtlas())

// The farmer's head and shoulders, in its shirt colour.
export function Portrait({ farmer, size = 108 }: { farmer: FarmerId; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    atlasLoaded().then(() => {
      const c = ref.current
      if (!live || !c || !frame('char_idle_down_0')) return
      c.width = 24
      c.height = 24
      const g = c.getContext('2d')!
      g.imageSmoothingEnabled = false
      g.clearRect(0, 0, 24, 24)
      // The 48 px frame, offset so its head and shoulders fill the 24 px canvas.
      draw(g, 'char_idle_down_0', -12, -8, { tint: TINT[farmer] })
    })
    return () => {
      live = false
    }
  }, [farmer])
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />
}

// A plot's sign, drawn from the atlas at twice its size, so a task reads the same here as on the farm.
export function Sign({ crop, size = 32 }: { crop: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    atlasLoaded().then(() => {
      const c = ref.current
      const f = frame(`sign_${crop}`)
      if (!live || !c || !f) return
      c.width = f[2]
      c.height = f[3]
      const g = c.getContext('2d')!
      g.imageSmoothingEnabled = false
      g.clearRect(0, 0, f[2], f[3])
      draw(g, `sign_${crop}`, 0, 0)
    })
    return () => {
      live = false
    }
  }, [crop])
  return <canvas ref={ref} className="sign-ico" style={{ width: size, height: size }} aria-hidden />
}

export function Swatch({ farmer }: { farmer: FarmerId }) {
  const t = SWATCH[farmer]
  return <span className="sw" style={{ background: t.body, boxShadow: `inset 0 0 0 2px ${t.shade}` }} aria-hidden />
}

// Why an agent stopped for you, in words someone new can read: "Designer needs you: two agents disagree".
export const ASK_WHY: Record<AskReason, string> = {
  anomaly: 'a check failed',
  cost: 'going over budget',
  big: 'a big change to approve',
  irreversible: 'ready to reach real users',
  risk: 'ship again?',
  disagree: 'two agents disagree',
}

export const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`
// A task's own cost, to the cent: the same number the ask about it used.
export const cents = (n: number) => `$${n.toFixed(2)}`
export const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h ${Math.round(n % 60)} min` : `${Math.round(n)} min`)
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

// A limit you type: "$ 53" or "50 min". Saves on Enter or when you leave the field.
// With max, a bigger number is pulled down to it rather than refused.
export function LimitField({ value, unit, label, min = 1, max, onChange }: { value: number; unit: '$' | 'min'; label: string; min?: number; max?: number; onChange: (v: number) => void }) {
  const commit = (el: HTMLInputElement) => {
    const typed = Math.round(Number(el.value.replace(/[^0-9.]/g, '')))
    const v = max !== undefined ? Math.min(max, typed) : typed
    if (Number.isFinite(v) && v >= min && v !== value) onChange(v)
    else el.value = String(Math.round(value))
  }
  return (
    <label className="limit-field">
      {unit === '$' && <span>$</span>}
      <input
        key={value}
        defaultValue={Math.round(value)}
        inputMode="numeric"
        aria-label={label}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {unit === 'min' && <span>min</span>}
    </label>
  )
}

// The pack's tick meter: 20 ticks, green for what's spent, honey once past 85%.
export function Ticks({ used, total, n = 20 }: { used: number; total: number; n?: number }) {
  const on = Math.min(n, Math.round((used / Math.max(0.01, total)) * n))
  return (
    <span className={`ticks${used > total * 0.85 ? ' warm' : ''}`} role="meter" aria-valuenow={Math.round(used)} aria-valuemax={Math.round(total)} aria-label="Spent of its limit">
      <i style={{ width: on * 10 }} />
      <b style={{ width: (n - on) * 10 }} />
    </span>
  )
}

// The pack's check and cross, for pass and fail.
export const Mark = ({ pass }: { pass: boolean }) => <span className={`mark ${pass ? 'yes' : 'no'}`} aria-label={pass ? 'passed' : 'failed'} />

// The one tag for anything not real: "Simulated sample", "Simulated run", "Simulated team", "Simulated", "Projection".
// Same class and colour everywhere, so a simulated thing always looks the same.
export const SimTag = ({ children = 'Simulated', title }: { children?: React.ReactNode; title?: string }) => (
  <span className="tag sim" title={title}>
    {children}
  </span>
)

// A quiet state: nothing here yet, nothing stands out, a call that failed, a run you paused.
// One line in body ink and at most one meta line under it, on the flat tint. Berry only for a failure.
export function Quiet({ icon, tone, title, children }: { icon?: IconName; tone?: 'bad'; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={`quiet${tone ? ` ${tone}` : ''}`} role={tone === 'bad' ? 'alert' : undefined}>
      {icon && <Ico name={icon} />}
      <span>
        <b>{title}</b>
        {children && <span className="quiet-sub">{children}</span>}
      </span>
    </div>
  )
}
