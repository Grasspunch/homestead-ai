import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'

/* ---------- Button ----------
   Drawn like the farm: a light face, a lighter top edge, a lip two pixels deep and a dark line with cut
   corners, all on the --px grid. Pressing squashes the lip.
   sprout: the one main action on a screen. out: anything that reaches people outside (deploy, send).
   plain: secondary actions. quiet: low-stakes actions inside a row, no border. */
export type ButtonKind = 'sprout' | 'out' | 'plain' | 'quiet'

export function Button({
  kind = 'plain',
  size = 'md',
  busy,
  keycap,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; size?: 'md' | 'sm'; busy?: boolean; keycap?: string; icon?: ReactNode }) {
  return (
    <button type="button" className={`hs-btn ${kind} ${size} ${className ?? ''}`} aria-busy={busy || undefined} disabled={rest.disabled || busy} {...rest}>
      {busy ? <Seed /> : icon}
      <span>{children}</span>
      {keycap && <Kbd>{keycap}</Kbd>}
    </button>
  )
}

// Loading: three seeds pop in turn. Under reduced motion they hold still.
export function Seed() {
  return (
    <span className="hs-seed" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="hs-kbd">{children}</kbd>
}

/* ---------- Press and hold ----------
   For outbound acts that can't be undone (deploy, send): the fill climbs while held, and the act runs
   only when it reaches the end. Letting go early cancels. Keyboard: hold Enter or Space. */
export function HoldButton({
  onHold,
  children,
  kind = 'out',
  size = 'md',
  ms = 680,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { onHold: () => void; kind?: ButtonKind; size?: 'md' | 'sm'; ms?: number }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const stop = () => {
    window.clearTimeout(timer.current)
    setHolding(false)
  }
  const start = () => {
    if (rest.disabled) return
    setHolding(true)
    timer.current = window.setTimeout(() => {
      setHolding(false)
      onHold()
    }, ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className={`hs-btn ${kind} ${size} hold ${holding ? 'is-holding' : ''} ${className ?? ''}`}
      aria-description="Press and hold"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault()
          start()
        }
      }}
      onKeyUp={stop}
      onBlur={stop}
      {...rest}
      style={{ ['--hold' as string]: `${ms}ms`, ...rest.style }}
    >
      <span>{children}</span>
    </button>
  )
}

/* ---------- Pixel tick: 5 by 4 farm pixels ---------- */
export function PixelTick() {
  const rows = ['....#', '...#.', '#.#..', '.#...']
  return (
    <svg className="hs-tick" viewBox="0 0 5 4" width={15} height={12} shapeRendering="crispEdges" fill="currentColor" aria-hidden>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null)))}
    </svg>
  )
}

/* ---------- Checkbox: a sunk box with the pixel line; checked, the sprout face and a pixel tick ---------- */
export function Checkbox({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId()
  return (
    <label className="hs-check" htmlFor={id}>
      <input id={id} type="checkbox" {...rest} />
      <span className="hs-check-box" aria-hidden>
        <PixelTick />
      </span>
      <span className="hs-check-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

/* ---------- Toggle: a sunk track and a square knob that steps across ---------- */
export function Toggle({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="hs-toggle-row">
      <span className="hs-check-text">
        <label htmlFor={id}>{label}</label>
        {hint && <small>{hint}</small>}
      </span>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} className="hs-toggle" onClick={() => onChange(!checked)}>
        <i />
      </button>
    </div>
  )
}

/* ---------- Text fields: inset, a shade darker than the sheet ---------- */
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className={`hs-field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <p className="hs-field-error">{error}</p> : hint ? <p className="hs-field-hint">{hint}</p> : null}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="hs-input" {...props} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="hs-input hs-textarea" {...props} />
}

/* ---------- Choice: an ask option. The assumed default has a dashed edge until you pick. ---------- */
export function Choice({ keycap, title, detail, selected, assumed, onClick }: { keycap?: string; title: ReactNode; detail?: ReactNode; selected?: boolean; assumed?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`hs-choice ${assumed ? 'assumed' : ''}`} aria-pressed={selected} onClick={onClick}>
      {keycap && <Kbd>{keycap}</Kbd>}
      <span>
        <b>{title}</b>
        {detail && <small>{detail}</small>}
      </span>
    </button>
  )
}

/* ---------- Energy: chunky pixel ticks. Green ticks are what's left. Low energy is never red: red means failure. ---------- */
export function Energy({ used, total, ticks = 12, label = 'Energy' }: { used: number; total: number; ticks?: number; label?: string }) {
  const left = Math.max(0, total - used)
  const on = Math.round((left / total) * ticks)
  return (
    <div className="hs-energy" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={left}>
      <span className="hs-energy-ticks" aria-hidden>
        {Array.from({ length: ticks }, (_, i) => (
          <i key={i} className={i < on ? 'on' : ''} />
        ))}
      </span>
      <b>{Math.round((left / total) * 100)}%</b>
    </div>
  )
}

/* ---------- Progress: a plot's growth bar, in whole pixels ---------- */
export function Progress({ value, of, tone = 'sprout' }: { value: number; of: number; tone?: 'sprout' | 'fail' }) {
  const pct = Math.max(0, Math.min(1, value / of))
  return (
    <span className={`hs-progress ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={value}>
      <i style={{ width: `${pct * 100}%` }} />
    </span>
  )
}
