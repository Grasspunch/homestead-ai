// The end of the harvest, after the merge: CI on main, the deploy to production, the canary and the rollback.
// The engine keeps this as its own phase, 'ship'; on screen it is part of Harvest.
// Deploying is the one outbound step, so it alone is drawn in blue.
import './ship.css'
import { useState } from 'react'
import { CI_JOBS, HEALTH, RELEASE, fmtHealth } from '../sim/ship'
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
      return 'Canary on 5% of users'
    case 'rollback':
      return `Rolling back to ${RELEASE.previous}`
    case 'rolledback':
      return `Rolled back to ${RELEASE.previous}`
    case 'rollout':
      return `Rolling out, ${e.rollout}% of users`
    case 'live':
      return `Live for ${RELEASE.users} users`
    default:
      return 'CI, deploy, canary'
  }
}

export function ShipNow() {
  const e = useEngine()
  const st = e.shipStage
  const deploying = st === 'canary' || st === 'canary2' || st === 'rollback' || st === 'rolledback' || st === 'rollout' || (st === 'deploy' && e.rolledBack) || (st === 'held' && e.deploys > 0)
  const live = st === 'live'
  const waitingOnYou = e.openAsks.length > 0
  // Once CI passes it folds into one line, so the deploy stays in view.
  const ciDone = CI_JOBS.every((j) => e.ci[j.id].state === 'pass')
  const [showCi, setShowCi] = useState(false)
  const release = live ? `${RELEASE.users} users` : st === 'rollout' ? `${e.rollout}%` : e.rollout ? '5% canary' : e.rolledBack ? 'Rolled back' : 'Not deployed'
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
            <Row mark={<Envelope />} label={`${RELEASE.app} ${RELEASE.version} to production`} end={release} tone={live ? 'done' : ''} />
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
                  <Row mark={<GateMark s={!r.ok ? 'fail' : watching ? 'run' : 'pass'} />} label={h.name} end={r.ok ? fmtHealth(h, r.value) : `${fmtHealth(h, r.value)}, needs ${h.threshold.replace(/^At least /, '')}`} tone={!r.ok ? 'fail' : watching ? '' : 'done'} testId={`health-${h.id}`} />
                </li>
              )
            })}
          {e.rolledBack && (
            <li>
              <Row label={`Rolled back to ${RELEASE.previous}`} end="5% of users, 6 min" onClick={() => e.go({ kind: 'log', tab: 'auto' })} testId="rollback-row" />
            </li>
          )}
        </ul>
        {st === 'held' && !waitingOnYou && (
          <div className="send">
            <button className="btn out full" onClick={() => e.requestDeploy()} data-testid="deploy">
              Deploy to production
            </button>
          </div>
        )}
      </div>
      <StaysWithYou />
    </>
  )
}
