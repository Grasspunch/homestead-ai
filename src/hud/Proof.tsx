// What a check rests on, shown rather than described: the test run, the screenshots, the rollout's numbers.
import type { Proof, RunState, Shot, TestResult } from '../run/types'
import { ERROR_LIMIT } from '../run/simulate'

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
            <span className="tick" aria-label={t.pass ? 'passed' : 'failed'}>{t.pass ? '✓' : '✗'}</span>
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
export function Screens({ shots, chat }: { shots: Shot[]; chat: boolean }) {
  return (
    <div className="shots">
      {shots.map((s) => (
        <figure key={s.device} className={`shot ${s.device}`}>
          <div className="frame">{chat ? <ChatScreen shot={s} /> : <AppScreen shot={s} />}</div>
          <figcaption>
            {s.device === 'phone' ? 'Phone, 375 px' : 'Desktop, 1280 px'}
            {s.state === 'overlap' && <span className="bad">, covers the reply box</span>}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

function ChatScreen({ shot }: { shot: Shot }) {
  const overlap = shot.state === 'overlap'
  const body = (
    <div className="chat">
      <div className="chat-top">Help</div>
      <div className="msg you">How do I get a refund?</div>
      <div className="msg bot">
        You can ask for a refund within 30 days from Orders, then Refund. It reaches your card in 3 to 5 days.
        {!overlap && <span className="src">2 sources</span>}
      </div>
      {overlap && (
        <div className="src-list">
          <div>Refunds and returns</div>
          <div>Payment methods</div>
        </div>
      )}
      <div className={`chat-in${overlap ? ' covered' : ''}`}>Ask a question</div>
    </div>
  )
  if (shot.device === 'phone') return body
  return (
    <div className="desk">
      <div className="desk-page">
        <i />
        <i />
        <i />
      </div>
      <div className="desk-widget">{body}</div>
    </div>
  )
}

function AppScreen({ shot }: { shot: Shot }) {
  const overlap = shot.state === 'overlap'
  return (
    <div className={`app ${shot.device}`}>
      <div className="chat-top">Overview</div>
      <div className="app-rows">
        <i />
        <i />
        <i />
      </div>
      <div className={`app-btn${overlap ? ' covered' : ''}`}>Continue</div>
      {overlap && <div className="app-foot" />}
    </div>
  )
}

export function ProofView({ proof, chat }: { proof: Proof; chat: boolean }) {
  if (proof.kind === 'screens' && proof.shots) return <Screens shots={proof.shots} chat={chat} />
  if (proof.tests) return <Tests tests={proof.tests} kind={proof.kind === 'integration' ? 'integration' : 'unit'} />
  return null
}

// The rollout: error rate over time against the line where it rolls back by itself.
export function Rollout({ state, compact = false }: { state: RunState; compact?: boolean }) {
  const pts = state.monitor
  const deploys = state.deploy
  if (!deploys.length) return null
  const t0 = deploys[0].t
  const t1 = Math.max(state.t, pts.length ? pts[pts.length - 1].t : t0 + 1)
  const W = 400
  const H = compact ? 90 : 120
  const max = 0.04
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (W - 8) + 4
  const y = (e: number) => H - 14 - (Math.min(e, max) / max) * (H - 24)
  const segs: { stage: string; pts: typeof pts }[] = []
  for (const p of pts) {
    const last = segs[segs.length - 1]
    // A rollback starts a new line.
    const rb = deploys.find((d) => d.stage === 'rollback' && last && last.pts.length && d.t > last.pts[last.pts.length - 1].t && d.t <= p.t)
    if (!last || rb) segs.push({ stage: p.stage, pts: [p] })
    else last.pts.push(p)
  }
  const latest = pts[pts.length - 1]?.metrics
  const now = deploys[deploys.length - 1]
  return (
    <div className="rollout">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Error rate during the rollout">
        <line x1="0" x2={W} y1={y(ERROR_LIMIT)} y2={y(ERROR_LIMIT)} className="limit" />
        <text x={W - 4} y={y(ERROR_LIMIT) - 4} textAnchor="end" className="axis">rolls back at 2%</text>
        {deploys.map((d) => (
          <g key={d.t}>
            <line x1={x(d.t)} x2={x(d.t)} y1="4" y2={H - 14} className={d.stage === 'rollback' ? 'mark back' : 'mark'} />
            <text x={x(d.t) + 3} y={H - 3} className={d.stage === 'rollback' ? 'axis bad' : 'axis'}>
              {d.stage === 'rollback' ? 'rolled back' : d.stage === '100%' ? 'everyone' : '10%'}
            </text>
          </g>
        ))}
        {segs.map((s, i) => (
          <polyline key={i} points={s.pts.map((p) => `${x(p.t)},${y(p.metrics.errorRate ?? 0)}`).join(' ')} className={s.pts.some((p) => (p.metrics.errorRate ?? 0) > ERROR_LIMIT) ? 'err bad' : 'err'} />
        ))}
        {segs.flatMap((s) => s.pts).map((p) => (
          <circle key={p.t} cx={x(p.t)} cy={y(p.metrics.errorRate ?? 0)} r="2.5" className={(p.metrics.errorRate ?? 0) > ERROR_LIMIT ? 'dot bad' : 'dot'} />
        ))}
      </svg>
      {latest && (
        <div className="nums">
          <span>
            <b className={(latest.errorRate ?? 0) > ERROR_LIMIT ? 'bad' : ''}>{((latest.errorRate ?? 0) * 100).toFixed(1)}%</b> errors
          </span>
          <span>
            <b>{((latest.p95ms ?? 0) / 1000).toFixed(1)} s</b> slowest 5%
          </span>
          <span>
            <b>{Math.round((latest.answerScore ?? 0) * 100)}%</b> good answers
          </span>
          <span className="who-sees">{now.stage === 'rollback' ? 'Nobody sees it now' : now.stage === '100%' ? 'Everyone sees it' : '1 in 10 users see it'}</span>
        </div>
      )}
    </div>
  )
}
