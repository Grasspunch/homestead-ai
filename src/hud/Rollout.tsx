// The rollout, drawn as a field instrument: the reading up top, stages as tinted bands behind the line,
// the limit as a dashed rule, and a crosshair to read any point. The line is drawn up to the run's clock,
// so it grows as readings come in and draws itself in when the chart first opens.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { motion, useAnimationFrame, useReducedMotion } from 'motion/react'
import type { Metrics, RunState } from '../run/types'
import { ERROR_LIMIT } from '../run/simulate'
import { scenario } from '../run/simPlan'
import './rollout.css'

const MIN = 60_000
type Size = 'full' | 'compact' | 'pop'
type Reading = { t: number; m: Metrics }

const PLOT_H: Record<Size, number> = { full: 150, compact: 112, pop: 58 }
const r1 = (v: number) => Math.round(v * 10) / 10

export function Rollout({ state, compact = false, size }: { state: RunState; compact?: boolean; size?: Size }) {
  const sz: Size = size ?? (compact ? 'compact' : 'full')
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const box = useRef<HTMLDivElement>(null)
  const W = useWidth(box)
  const still = !!useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)

  const deploys = state.deploy
  const t0 = deploys[0]?.t ?? 0

  // Judged by synthetic tests, the line is tests passing (all of them at the top) and one failing is over the limit.
  const synth = state.monitor.some((p) => p.metrics.synth) || deploys.some((d) => d.metrics?.synth)
  const total = state.monitor.find((p) => p.metrics.synth)?.metrics.synth?.total ?? 12
  const val = (m: Metrics) => (synth ? m.synth?.pass ?? total : m.errorRate ?? 0)
  const bad = (v: number) => (synth ? v < total : v > ERROR_LIMIT)

  // Lines: each starts where it ships and breaks where it rolls back.
  const lines: Reading[][] = []
  const all: Reading[] = [
    ...deploys.filter((d) => d.stage !== 'rollback' && d.metrics).map((d) => ({ t: d.t, m: d.metrics! })),
    ...state.monitor.map((p) => ({ t: p.t, m: p.metrics })),
  ].sort((a, b) => a.t - b.t)
  for (const r of all) {
    const cur = lines[lines.length - 1]
    const broke = cur && deploys.some((d) => d.stage === 'rollback' && d.t > cur[cur.length - 1].t && d.t <= r.t)
    if (!cur || broke) lines.push([r])
    else cur.push(r)
  }
  const lastDeploy = deploys[deploys.length - 1]
  const lastT = all.length ? all[all.length - 1].t : t0
  // The clock the chart is drawn to: the run's time, held at a reading's interval past the last one,
  // or a few minutes into a rollback while the fix goes in.
  const cap = lastDeploy?.stage === 'rollback' ? lastDeploy.t + 4 * MIN : lastT + 0.6 * MIN
  const target = Math.max(t0, Math.min(state.t, cap))

  // The drawn clock eases toward the run's clock: from the first deploy when the chart opens, and over any jump.
  const [clock, setClockState] = useState(() => (still ? target : t0))
  const now = useRef(clock)
  const want = useRef(target)
  want.current = target
  const setClock = (v: number) => {
    now.current = v
    setClockState(v)
  }
  useEffect(() => {
    if (still || target < now.current) setClock(target)
  }, [target, still])
  useAnimationFrame((_, dt) => {
    const gap = want.current - now.current
    if (Math.abs(gap) < 1) return
    if (still || Math.abs(gap) < 0.04 * MIN) setClock(want.current)
    else setClock(now.current + gap * Math.min(1, (dt / 1000) * 3.2))
  })

  if (!deploys.length) return null

  // Scales. The x axis runs at least four minutes, so a fresh rollout has room to grow into.
  const H = PLOT_H[sz]
  const pop = sz === 'pop'
  const padT = pop ? 4 : 20
  const padB = pop ? 2 : 20
  const padL = pop ? 2 : synth ? 26 : 34
  const padR = pop ? 6 : 12
  const xEnd = Math.max(t0 + 4 * MIN, clock + (lastDeploy?.stage === '100%' ? 0 : 0.6 * MIN), lastT)
  const plotW = Math.max(W - padL - padR, 1)
  const x = (t: number) => padL + ((t - t0) / Math.max(1, xEnd - t0)) * plotW
  const peakErr = Math.max(0, ...all.map((r) => r.m.errorRate ?? 0))
  const yMax = Math.max(0.04, Math.ceil((peakErr + 0.004) * 100) / 100)
  const lo = synth ? total - 4 : 0
  const hi = synth ? total : yMax
  const y = (v: number) => padT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * H
  const yLimit = y(synth ? total : ERROR_LIMIT)
  const base = padT + H
  const svgH = base + padB

  // What has been drawn so far: whole readings up to the clock, and the tip between two of them.
  const drawn = lines
    .map((ln) => {
      const out: { t: number; v: number; m: Metrics }[] = []
      for (let i = 0; i < ln.length; i++) {
        const r = ln[i]
        if (r.t <= clock) out.push({ t: r.t, v: val(r.m), m: r.m })
        else {
          if (i > 0) {
            const a = ln[i - 1]
            const k = (clock - a.t) / (r.t - a.t)
            out.push({ t: clock, v: val(a.m) + (val(r.m) - val(a.m)) * k, m: a.m })
          }
          break
        }
      }
      return out
    })
    .filter((d) => d.length)
  const tip = drawn.length ? drawn[drawn.length - 1][drawn[drawn.length - 1].length - 1] : undefined
  const readings = all.filter((r) => r.t <= clock)

  // Stage bands, each growing to the clock.
  const bands = deploys
    .map((d, i) => ({ d, a: d.t, b: Math.min(deploys[i + 1]?.t ?? Infinity, clock) }))
    .filter((b) => b.b > b.a)
  const rollback = deploys.find((d) => d.stage === 'rollback' && d.t <= clock)
  const peakBefore = rollback ? all.filter((r) => r.t <= rollback.t).pop() : undefined

  const stageNow = [...deploys].reverse().find((d) => d.t <= clock)?.stage ?? deploys[0].stage
  const who = stageNow === 'rollback' ? 'Nobody' : stageNow === '100%' ? 'Everyone' : '1 in 10 users'
  const show = tip ?? (peakBefore ? { t: peakBefore.t, v: val(peakBefore.m), m: peakBefore.m } : undefined)
  const big = show ? (synth ? `${Math.round(show.v)} of ${total}` : `${r1(show.v * 100).toFixed(1)}%`) : '–'
  const over = show ? bad(show.v) : false
  const answers = scenario(state.goal).name === 'Support assistant'

  // x labels: whole minutes from the first deploy, spaced so they never touch.
  const span = (xEnd - t0) / MIN
  const step = [1, 2, 5, 10, 20].find((s) => (s / span) * plotW >= 48) ?? 30
  const mins: number[] = []
  for (let m = 0; m <= span + 1e-6; m += step) mins.push(m)

  // Crosshair: the nearest reading drawn so far.
  const tracking = !pop && readings.length > 0
  const hit = hover === null || !readings.length ? null : readings.reduce((a, b) => (Math.abs(b.t - hover) < Math.abs(a.t - hover) ? b : a))
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!tracking) return
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    setHover(t0 + ((px - padL) / plotW) * (xEnd - t0))
  }
  const onKey = (e: KeyboardEvent) => {
    if (!tracking) return
    const i = hit ? readings.indexOf(hit) : -1
    const next = e.key === 'ArrowRight' ? Math.min(readings.length - 1, i + 1) : e.key === 'ArrowLeft' ? (i < 0 ? readings.length - 1 : Math.max(0, i - 1)) : e.key === 'Home' ? 0 : e.key === 'End' ? readings.length - 1 : e.key === 'Escape' ? null : undefined
    // Esc with no reading picked is not the chart's: it closes the panel as anywhere else.
    if (next === undefined || (next === null && hover === null)) return
    e.preventDefault()
    setHover(next === null ? null : readings[next].t)
  }
  const fmt = (v: number) => (synth ? `${Math.round(v)} of ${total} passing` : `${r1(v * 100).toFixed(1)}% errors`)
  const stageAt = (t: number) => {
    const d = [...deploys].reverse().find((k) => k.t <= t)
    return d?.stage === '100%' ? 'everyone' : d?.stage === 'rollback' ? 'nobody' : '1 in 10 users'
  }
  const spring = still ? { duration: 0 } : { type: 'spring' as const, stiffness: 600, damping: 45 }
  const label = synth ? 'Synthetic tests passing during the rollout' : `Error rate during the rollout, against the ${ERROR_LIMIT * 100}% limit`

  return (
    <div className={`roll roll-${sz}`}>
      {!pop && (
        <div className="roll-head">
          <div>
            <span className="roll-lbl">{synth ? 'Synthetic tests' : 'Errors'}</span>
            <span className={`roll-big${over ? ' bad' : ''}`}>{big}</span>
          </div>
          {show && <span className={`tag ${over ? 'red' : 'green'}`}>{synth ? (over ? 'One failing' : 'All passing') : over ? `Over ${ERROR_LIMIT * 100}%` : `Under ${ERROR_LIMIT * 100}%`}</span>}
          <div className="roll-who">
            <span className="roll-lbl">Who sees it</span>
            <b>{who}</b>
          </div>
        </div>
      )}
      <div
        ref={box}
        className="roll-plot"
        role={tracking ? 'group' : undefined}
        aria-label={tracking ? `${label}. Use the arrow keys to read each point.` : undefined}
        tabIndex={tracking ? 0 : undefined}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <svg width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <pattern id={`${uid}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
              <rect x="1" y="1" width="2" height="2" fill="var(--leaf)" />
            </pattern>
            <pattern id={`${uid}-dots-bad`} width="5" height="5" patternUnits="userSpaceOnUse">
              <rect x="1" y="1" width="2" height="2" fill="var(--berry)" />
            </pattern>
            <pattern id={`${uid}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--berry-wash)" />
              <rect width="2" height="7" fill="rgba(196, 97, 90, .28)" />
            </pattern>
            <clipPath id={`${uid}-over`}>
              {synth ? <rect x="0" y={yLimit + 1} width={W} height={svgH} /> : <rect x="0" y="-20" width={W} height={yLimit + 20} />}
            </clipPath>
          </defs>

          {bands.map(({ d, a, b }) => (
            <g key={d.t}>
              <rect x={x(a)} y={pop ? padT : padT - 16} width={Math.max(0, x(b) - x(a))} height={pop ? H : H + 16} className={`band ${d.stage === 'rollback' ? 'off' : d.stage === '100%' ? 'all' : 'ten'}`} fill={d.stage === 'rollback' ? `url(#${uid}-hatch)` : undefined} />
              {!pop && d.stage !== 'rollback' && x(b) - x(a) > 52 && (
                <text x={x(a) + 5} y={padT - 5} className={`band-lbl ${d.stage === '100%' ? 'all' : ''}`}>
                  {d.stage === '100%' ? 'EVERYONE' : '1 IN 10'}
                </text>
              )}
            </g>
          ))}

          {!pop &&
            (synth ? [total - 4, total - 2, total] : Array.from({ length: Math.round(yMax * 100) + 1 }, (_, i) => i / 100)).map((v) => (
              <g key={v}>
                <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className={v === lo ? 'grid base' : 'grid'} />
                <text x={padL - 7} y={y(v) + 4} textAnchor="end" className="axis">
                  {synth ? v : `${Math.round(v * 100)}%`}
                </text>
              </g>
            ))}
          {!pop &&
            mins.map((m) => (
              <text key={m} x={x(t0 + m * MIN)} y={base + 15} textAnchor="middle" className="axis">
                {m === mins[mins.length - 1] && m > 0 ? `${m} min` : m}
              </text>
            ))}

          <line x1={padL} x2={W - padR} y1={yLimit} y2={yLimit} className="limit" />
          {!pop && (
            <text x={W - padR - 2} y={synth ? yLimit + 13 : yLimit - 6} textAnchor="end" className="band-lbl limit-lbl">
              {synth ? `ALL ${total} MUST PASS` : `LIMIT ${ERROR_LIMIT * 100}%`}
            </text>
          )}

          {drawn.map((pts, i) => {
            const P = pts.map((p) => [x(p.t), y(p.v)] as [number, number])
            const line = mono(P)
            const area = `${line}L${P[P.length - 1][0]},${base}L${P[0][0]},${base}Z`
            return (
              <g key={i}>
                <path d={area} fill={`url(#${uid}-dots)`} opacity=".45" />
                <path d={area} fill={`url(#${uid}-dots-bad)`} opacity=".7" clipPath={`url(#${uid}-over)`} />
                <path d={line} className="ln" />
                <path d={line} className="ln bad" clipPath={`url(#${uid}-over)`} />
              </g>
            )
          })}
          {!pop &&
            readings.map((r) => {
              const v = val(r.m)
              return <rect key={r.t} x={x(r.t) - 2} y={y(v) - 2} width="4" height="4" className={bad(v) ? 'pt bad' : 'pt'} />
            })}

          {/* Where it came back: a red rule at the moment, and the peak that tripped it. No words; the dialogue has them. */}
          {rollback && peakBefore && (
            <g>
              <line x1={x(rollback.t)} x2={x(rollback.t)} y1={pop ? padT : padT - 16} y2={base} className="back" />
              {!pop && (
                <g transform={`translate(${Math.min(Math.max(x(peakBefore.t), padL + 26), W - padR - 26)},${Math.max(padT - 4, y(val(peakBefore.m)) - 10)})`}>
                  <rect x={synth ? -26 : -19} y="-11" width={synth ? 52 : 38} height="15" rx="2" className="peak" />
                  <text x="0" y="0" textAnchor="middle" className="band-lbl peak-lbl">
                    {synth ? `${Math.round(val(peakBefore.m))} OF ${total}` : `${r1(val(peakBefore.m) * 100).toFixed(1)}%`}
                  </text>
                </g>
              )}
            </g>
          )}

          {tip && stageNow !== 'rollback' && (
            <g>
              <rect x={x(tip.t) - (pop ? 5 : 7)} y={y(tip.v) - (pop ? 5 : 7)} width={pop ? 10 : 14} height={pop ? 10 : 14} className="tip-ring" />
              <rect x={x(tip.t) - (pop ? 3 : 4)} y={y(tip.v) - (pop ? 3 : 4)} width={pop ? 6 : 8} height={pop ? 6 : 8} className={bad(tip.v) ? 'tip bad' : 'tip'} />
            </g>
          )}

          {tracking && (
            <motion.g pointerEvents="none" initial={false} animate={{ opacity: hit ? 1 : 0, x: hit ? x(hit.t) : 0 }} transition={{ opacity: { duration: 0.12 }, x: spring }}>
              <line x1="0" x2="0" y1={padT - 16} y2={base} className="cross" />
            </motion.g>
          )}
          {tracking && hit && <rect x={x(hit.t) - 5} y={y(val(hit.m)) - 5} width="10" height="10" className={bad(val(hit.m)) ? 'hit bad' : 'hit'} pointerEvents="none" />}
        </svg>
        {tracking && (
          <div
            className={`roll-tip${hit ? ' on' : ''}`}
            style={hit ? { left: Math.min(Math.max(x(hit.t), 100), W - 100), top: Math.max(y(val(hit.m)) - 12, 30) } : undefined}
            aria-live="polite"
          >
            {hit && (
              <>
                <b>{fmt(val(hit.m))}</b> · min {r1((hit.t - t0) / MIN)} · {stageAt(hit.t)}
              </>
            )}
          </div>
        )}
      </div>
      {pop ? (
        show && (
          <div className="roll-nums">
            <span>
              <b className={over ? 'bad' : ''}>{big}</b> {synth ? 'passing' : 'errors'}
            </span>
            <span className="roll-who-s">{who === 'Nobody' ? 'Nobody sees it' : who === 'Everyone' ? 'Everyone sees it' : '1 in 10 see it'}</span>
          </div>
        )
      ) : (
        show && (
          <div className="roll-nums">
            <span>
              <b>{((show.m.p95ms ?? 0) / 1000).toFixed(1)} s</b> slowest 5%
            </span>
            {answers && (
              // Answer quality is a support assistant's measure; other apps show errors and speed only.
              <span>
                <b>{Math.round((show.m.answerScore ?? 0) * 100)}%</b> good answers
              </span>
            )}
          </div>
        )
      )}
    </div>
  )
}

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  // Drawn at its real width, one unit to a pixel, so its labels are true type sizes.
  const [w, setW] = useState(400)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(160, Math.round(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// A monotone curve through the readings: smooth, and never bulging past a reading.
function mono(P: [number, number][]) {
  const n = P.length
  if (n === 1) return `M${P[0][0]},${P[0][1]}`
  const dx: number[] = []
  const s: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = P[i + 1][0] - P[i][0] || 1e-6
    s[i] = (P[i + 1][1] - P[i][1]) / dx[i]
  }
  m[0] = s[0]
  m[n - 1] = s[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / s[i - 1] + (dx[i] + 2 * dx[i - 1]) / s[i])
  const f = (v: number) => Math.round(v * 10) / 10
  let d = `M${f(P[0][0])},${f(P[0][1])}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${f(P[i][0] + h)},${f(P[i][1] + m[i] * h)} ${f(P[i + 1][0] - h)},${f(P[i + 1][1] - m[i + 1] * h)} ${f(P[i + 1][0])},${f(P[i + 1][1])}`
  }
  return d
}
