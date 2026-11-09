// The end of the harvest, after the merge: CI on main, the deploy to production, the canary, the rollback,
// the fix and the text to pet owners. The engine keeps this as its own phase, 'ship'; on screen it is part of Harvest.
// Deploying and the text are the outbound steps, so they alone are drawn in blue.
import './ship.css'
import { useState } from 'react'
import { ANNOUNCE, CI_JOBS, HEALTH, fmtHealth } from '../sim/ship'
import { OUTPUT } from '../sim/review'
import { useEngine } from '../ui'
import { Envelope } from './Cards'
import { GateMark } from './Detail'
import { Row, StaysWithYou } from './Overview'

type E = ReturnType<typeof useEngine>

// One line for the Ship row in the overview.
export function shipSub(e: E): string {
  switch (e.shipStage) {
    case 'ci':
      return 'CI is running on main'
    case 'cifailed':
      return 'CI failed on main'
    case 'deploy':
      return e.rolledBack ? 'Waiting for you to redeploy' : 'Waiting for you to deploy'
    case 'held':
      return 'Deploy held'
    case 'canary':
    case 'canary2':
      return 'Canary on 5% of visitors'
    case 'rollback':
    case 'rolledback':
      return 'Rolled back to “Call us to book”'
    case 'fixing':
      return 'Fixing availability search'
    case 'rollout':
      return `Rolling out, ${e.rollout}% of visitors`
    case 'live':
      return 'Live for everyone'
    case 'announced':
      return `Live, ${ANNOUNCE.audience} texted`
    default:
      return 'CI, deploy, canary'
  }
}

export function ShipNow() {
  const e = useEngine()
  const st = e.shipStage
  const live = st === 'live' || st === 'announced'
  const deploying = st === 'canary' || st === 'canary2' || st === 'rollback' || st === 'rolledback' || st === 'rollout' || e.canaryKept || (e.rolledBack && !live)
  const waitingOnYou = e.openAsks.length > 0
  // Once CI passes it folds into one line, so the deploy stays in view.
  const ciDone = CI_JOBS.every((j) => e.ci[j.id].state === 'pass')
  const [showCi, setShowCi] = useState(false)
  const release = live ? 'Everyone' : st === 'rollout' ? `${e.rollout}%` : st === 'canary' || st === 'canary2' || e.canaryKept ? '5% canary' : e.rolledBack ? 'Rolled back' : 'Not deployed'
  const fixed = e.queryFixed
  const announce = e.asks.find((a) => a.id === 'announce')
  const textEnd = st === 'announced' ? 'Sent' : announce?.status === 'resolved' ? 'Not sent' : ANNOUNCE.cost
  return (
    <>
      <p className="headline" data-testid="ship-headline">
        {e.shipHeadline}
      </p>
      <ul className="rows">
        <li>
          <Row mark={<span className="kind pr">PR</span>} label={`Pull request #${OUTPUT.pr}`} end={`Merged into ${OUTPUT.base}`} tone="done" onClick={() => e.go({ kind: 'step', id: 'harvest' })} testId="out-pr-merged" />
        </li>
        {ciDone && !showCi ? (
          <li>
            <Row mark={<GateMark s="pass" />} label={`CI on ${OUTPUT.base}`} end={`${CI_JOBS.length} of ${CI_JOBS.length} passed`} tone="done" onClick={() => setShowCi(true)} testId="ci-summary" />
          </li>
        ) : (
          CI_JOBS.map((j) => {
            const r = e.ci[j.id]
            const mark = r.state === 'pass' ? 'pass' : r.state === 'fail' ? 'fail' : r.state === 'wait' ? 'wait' : 'run'
            const end = r.state === 'pass' ? (j.outcome === 'flaky' ? `${j.time}, retried once` : j.time) : r.state === 'fail' ? 'Failed' : r.state === 'retry' ? 'Retrying a flaky test' : r.state === 'run' ? 'Running' : 'Waiting'
            return (
              <li key={j.id}>
                <Row mark={<GateMark s={mark} />} label={`CI: ${j.name}`} end={end} tone={r.state === 'pass' ? 'done' : r.state === 'fail' ? 'fail' : ''} testId={`ci-${j.id}`} />
              </li>
            )
          })
        )}
      </ul>
      <div className={`outbox deploybox ${live ? 'sent' : ''}`} data-testid="deploy-box">
        <ul className="rows">
          <li>
            <Row mark={<Envelope />} label="Online booking" end={release} tone={live ? 'done' : ''} />
          </li>
          {live && (
            <li>
              <Row mark={<GateMark s="pass" />} label="Canary health" end={`${HEALTH.length} of ${HEALTH.length} passed`} tone="done" testId="health-summary" />
            </li>
          )}
          {deploying &&
            HEALTH.map((h) => {
              const r = e.health[h.id]
              const watching = st === 'canary' || st === 'canary2'
              return (
                <li key={h.id}>
                  <Row mark={<GateMark s={!r.ok ? 'fail' : watching ? 'run' : 'pass'} />} label={h.name} end={r.ok ? fmtHealth(h, r.value) : `${fmtHealth(h, r.value)}, limit ${h.threshold.replace(/^(At least|Under) /, '')}`} tone={!r.ok ? 'fail' : watching ? '' : 'done'} testId={`health-${h.id}`} />
                </li>
              )
            })}
          {e.rolledBack && (
            <li>
              <Row label="Rolled back" end="5% for 6 min" onClick={() => e.go({ kind: 'log', tab: 'auto' })} testId="rollback-row" />
            </li>
          )}
          {e.rolledBack && (st === 'fixing' || fixed) && (
            <li>
              <Row mark={<GateMark s={fixed ? 'pass' : 'run'} />} label="One query for 8 weeks" end={fixed ? '0.3 s on staging' : 'Fixing'} tone={fixed ? 'done' : ''} testId="fix-row" />
            </li>
          )}
        </ul>
        {st === 'held' && !waitingOnYou && (
          <div className="send">
            {e.canaryKept ? (
              <button className="btn primary full" onClick={() => e.rollbackNow()} data-testid="rollback-now">
                Put the old page back
              </button>
            ) : e.rolledBack ? (
              <button className="btn primary full" onClick={() => e.requestDeploy()} data-testid="deploy">
                {e.queryFixed ? 'Redeploy' : 'Fix and redeploy'}
              </button>
            ) : (
              <button className="btn out full" onClick={() => e.requestDeploy()} data-testid="deploy">
                Deploy to production
              </button>
            )}
          </div>
        )}
      </div>
      {live && (
        <div className={`outbox deploybox ${st === 'announced' ? 'sent' : ''}`} data-testid="announce-box">
          <ul className="rows">
            <li>
              <Row mark={<Envelope />} label={`Text to ${ANNOUNCE.audience}`} end={textEnd} tone={st === 'announced' ? 'done' : ''} testId="announce-row" />
            </li>
          </ul>
          {st === 'live' && !waitingOnYou && (
            <div className="send">
              <button className="btn out full" onClick={() => e.requestAnnounce()} data-testid="announce">
                Text {ANNOUNCE.audience}
              </button>
            </div>
          )}
        </div>
      )}
      <StaysWithYou />
    </>
  )
}
