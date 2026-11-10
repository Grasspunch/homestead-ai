// What a check rests on, shown rather than described: the test run, the screenshots, the rollout's numbers.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Metrics, Proof, RunState, Screen, Shot, TaskState, TestResult } from '../run/types'
import { Mark, Swatch } from './bits'
import { ERROR_LIMIT } from '../run/simulate'
import { scenario } from '../run/simPlan'

export function Tests({ tests, kind }: { tests: TestResult[]; kind: 'unit' | 'integration' }) {
  const failed = tests.filter((t) => !t.pass)
  return (
    <div className="tests">
      <div className="tests-head">
        <span className={failed.length ? 'bad' : 'ok'}>
          <b>{tests.length - failed.length}</b> of {tests.length} {kind === 'integration' ? 'end-to-end runs' : 'tests'} pass
        </span>
        <span className="mono">{(tests.reduce((s, t) => s + t.ms, 0) / 1000).toFixed(1)} s</span>
      </div>
      <ol className="tests-list">
        {[...failed, ...tests.filter((t) => t.pass)].map((t) => (
          <li key={t.name} className={t.pass ? '' : 'fail'}>
            <Mark pass={t.pass} />
            <span className="grow">
              {t.name}
              {t.error && <span className="mono err">{t.error}</span>}
            </span>
            <span className="mono ms">{t.ms} ms</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// A screenshot of the screen the crew built, drawn here as a small mock of the product.
// Real screenshots of the built screen, cropped to what the check is about. A failed check rings the broken part.
const RING: Record<Screen, { x: number; y: number; w: number; h: number }> = {
  chat: { x: 0.068, y: 0.599, w: 0.864, h: 0.3125 },
  app: { x: 0.029, y: 0.845, w: 0.943, h: 0.117 },
  dash: { x: 0.057, y: 0.466, w: 0.336, h: 0.335 },
}

export function Screens({ shots, chat, screen, note, thumb = false }: { shots: Shot[]; chat: boolean; screen?: Screen; note?: string; thumb?: boolean }) {
  const shot = shots[shots.length - 1]
  if (!shot) return null
  const kind: Screen = screen ?? (chat ? 'chat' : 'app')
  const bad = shot.state === 'overlap'
  const r = RING[kind]
  return (
    <figure className={`shot ${kind}${thumb ? ' thumb' : ''}`}>
      <span className="shot-img">
        <img src={`/proof/${kind}-${shot.state}${thumb ? '-thumb' : ''}.png`} alt={bad ? `Screenshot: ${note ?? 'the broken part is ringed'}` : 'Screenshot of the built screen'} />
        {bad && <i className="ring" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />}
      </span>
      {!thumb && bad && note && <figcaption className="bad">{note}</figcaption>}
    </figure>
  )
}

export function ProofView({ proof, chat, note }: { proof: Proof; chat: boolean; note?: string }) {
  if (proof.kind === 'screens' && proof.shots) return <Screens shots={proof.shots} chat={chat} screen={proof.screen} note={note} />
  if (proof.tests) return <Tests tests={proof.tests} kind={proof.kind === 'integration' ? 'integration' : 'unit'} />
  return null
}

// The rollout: error rate over time against the line where it rolls back by itself.
export function Rollout({ state, compact = false }: { state: RunState; compact?: boolean }) {
  // The chart is drawn at its real width, one unit to a pixel, so its labels are true type sizes.
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(400)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(160, Math.round(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [state.deploy.length > 0])
  const pts = state.monitor
  const deploys = state.deploy
  if (!deploys.length) return null
  const t0 = deploys[0].t
  const t1 = Math.max(state.t, pts.length ? pts[pts.length - 1].t : t0 + 1)
  const H = compact ? 90 : 120
  // Judged by synthetic tests: the line is tests passing, all of them at the top, and one failing rolls it back.
  const synth = pts.some((p) => p.metrics.synth) || deploys.some((d) => d.metrics?.synth)
  const total = pts.find((p) => p.metrics.synth)?.metrics.synth?.total ?? 12
  const val = (m: Metrics) => (synth ? m.synth?.pass ?? total : m.errorRate ?? 0)
  const bad = (v: number) => (synth ? v < total : v > ERROR_LIMIT)
  const max = 0.04
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (W - 8) + 4
  const y = synth ? (pass: number) => 20 + (Math.min(4, Math.max(0, total - pass)) / 4) * (H - 40) : (e: number) => H - 14 - (Math.min(e, max) / max) * (H - 24)
  const segs: { stage: string; pts: typeof pts }[] = []
  for (const p of pts) {
    const last = segs[segs.length - 1]
    // A rollback starts a new line.
    const rb = deploys.find((d) => d.stage === 'rollback' && last && last.pts.length && d.t > last.pts[last.pts.length - 1].t && d.t <= p.t)
    if (!last || rb) segs.push({ stage: p.stage, pts: [p] })
    else last.pts.push(p)
  }
  // Stage labels that would collide stack upward instead of running into each other.
  const span = (d: (typeof deploys)[number]) => {
    const w = (d.stage === 'rollback' ? 11 : d.stage === '100%' ? 8 : 3) * 7
    const end = x(d.t) > W - 80
    return end ? [x(d.t) - 3 - w, x(d.t) - 3] : [x(d.t) + 3, x(d.t) + 3 + w]
  }
  const lift: number[] = []
  deploys.forEach((d, i) => {
    const [a0, a1] = span(d)
    const used = new Set<number>()
    for (let j = 0; j < i; j++) {
      const [b0, b1] = span(deploys[j])
      if (a0 < b1 + 4 && b0 < a1 + 4) used.add(lift[j])
    }
    let k = 0
    while (used.has(k)) k++
    lift.push(k)
  })
  const latest = pts[pts.length - 1]?.metrics
  const now = deploys[deploys.length - 1]
  return (
    <div className="rollout" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={synth ? 'Synthetic tests passing during the rollout' : 'Error rate during the rollout'}>
        {synth ? (
          <>
            <line x1="0" x2={W} y1={y(total)} y2={y(total)} className="limit" />
            <text x={W - 4} y={11} textAnchor="end" className="axis">
              {total} of {total} must pass
            </text>
          </>
        ) : (
          <>
            <line x1="0" x2={W} y1={y(ERROR_LIMIT)} y2={y(ERROR_LIMIT)} className="limit" />
            <text x={W - 4} y={y(ERROR_LIMIT) - 4} textAnchor="end" className="axis">
              rolls back at 2%
            </text>
          </>
        )}
        {deploys.map((d, i) => (
          <g key={d.t}>
            <line x1={x(d.t)} x2={x(d.t)} y1="4" y2={H - 14} className={d.stage === 'rollback' ? 'mark back' : 'mark'} />
            <text x={x(d.t) > W - 80 ? x(d.t) - 3 : x(d.t) + 3} textAnchor={x(d.t) > W - 80 ? 'end' : 'start'} y={H - 3 - lift[i] * 15} className={d.stage === 'rollback' ? 'axis bad' : 'axis'}>
              {d.stage === 'rollback' ? 'rolled back' : d.stage === '100%' ? 'everyone' : '10%'}
            </text>
          </g>
        ))}
        {segs.map((s, i) => (
          <polyline key={i} points={s.pts.map((p) => `${x(p.t)},${y(val(p.metrics))}`).join(' ')} className={s.pts.some((p) => bad(val(p.metrics))) ? 'err bad' : 'err'} />
        ))}
        {segs.flatMap((s) => s.pts).map((p) => (
          <circle key={p.t} cx={x(p.t)} cy={y(val(p.metrics))} r="2.5" className={bad(val(p.metrics)) ? 'dot bad' : 'dot'} />
        ))}
      </svg>
      {latest && (
        <div className="nums">
          {synth && latest.synth ? (
            <span>
              <b className={latest.synth.pass < latest.synth.total ? 'bad' : ''}>
                {latest.synth.pass} of {latest.synth.total}
              </b>{' '}
              synthetic tests passing
            </span>
          ) : (
            <span>
              <b className={(latest.errorRate ?? 0) > ERROR_LIMIT ? 'bad' : ''}>{((latest.errorRate ?? 0) * 100).toFixed(1)}%</b> errors
            </span>
          )}
          <span>
            <b>{((latest.p95ms ?? 0) / 1000).toFixed(1)} s</b> slowest 5%
          </span>
          {scenario(state.goal).name === 'Support assistant' && (
            // Answer quality is a support assistant's measure; other apps show errors and speed only.
            <span>
              <b>{Math.round((latest.answerScore ?? 0) * 100)}%</b> good answers
            </span>
          )}
          <span className="who-sees">{now.stage === 'rollback' ? 'Nobody sees it now' : now.stage === '100%' ? 'Everyone sees it' : '1 in 10 users see it'}</span>
        </div>
      )}
    </div>
  )
}

type Check = TaskState['checks'][number]

const WHO: Record<string, string> = { planner: 'Planner', builder: 'Builder', designer: 'Designer', tester: 'Tester', deployer: 'Deployer' }


// A check that just happened, popped over its plot: the test seeds, the screenshots or the live line.
export function ProofPop({ check, state, style, onOpen }: { check: Check; state: RunState; style: CSSProperties; onOpen: () => void }) {
  const pr = check.proof
  const chat = /support|assistant|chat/i.test(state.goal)
  const tests = pr?.tests ?? []
  const failed = tests.filter((x) => !x.pass)
  // Never under the top bar: as the camera moves, push the pop down so its top stays at least 80px from the window's.
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let raf = 0
    let dy = 0
    const tick = () => {
      const el = ref.current
      if (el) {
        const top = el.getBoundingClientRect().top - dy
        const next = Math.max(0, 80 - top)
        if (next !== dy) {
          dy = next
          el.style.marginTop = `${dy}px`
          if (dy > 0) el.removeAttribute('data-tail')
          else el.setAttribute('data-tail', 'down')
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <button
      ref={ref}
      className={`proof-pop paper bubble${check.pass ? '' : ' bad'}`}
      data-tail="down"
      style={style}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      onPointerUp={(e) => e.stopPropagation()}
      aria-label={`${WHO[check.by]} checked: ${check.notes}`}
    >
      <span className="pp-head">
        <Swatch farmer={check.by} />
        <b>{WHO[check.by]}</b>
        <span className={check.pass ? 'ok' : 'bad'}>{check.pass ? 'passed' : 'failed'}</span>
      </span>
      {pr?.kind === 'screens' && pr.shots ? (
        <span className="pp-shot-row">
          <Screens shots={pr.shots} chat={chat} screen={pr.screen} thumb />
          <span className="pp-line">{check.notes}</span>
        </span>
      ) : pr?.kind === 'rollout' ? (
        <span className="pp-roll">
          <Rollout state={state} compact />
        </span>
      ) : tests.length ? (
        <>
          <span className="seeds" aria-hidden>
            {tests.map((x, i) => (
              <i key={x.name} className={x.pass ? "ok" : "bad"} style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </span>
          <span className="pp-line">
            {failed.length ? (
              <span className="mono bad">{failed[0].error ?? failed[0].name}</span>
            ) : (
              <>
                {tests.length} of {tests.length} {pr?.kind === 'integration' ? 'end-to-end runs' : 'tests'} pass
              </>
            )}
          </span>
        </>
      ) : (
        <span className="pp-line">{check.notes}</span>
      )}
    </button>
  )
}
