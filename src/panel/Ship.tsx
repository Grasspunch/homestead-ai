// The end of the harvest, after the merge: CI on main, the deploy to production, the canary and the rollback.
// The engine keeps this as its own phase, 'ship'; on screen it is part of Harvest.
// Deploying is the one outbound step, so it alone is drawn in blue.
import './ship.css'
import { useState } from 'react'
import { CI_JOBS, HEALTH, PIPELINE, RELEASE, fmtHealth } from '../sim/ship'
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
  const deploying = st === 'canary' || st === 'canary2' || st === 'rollback' || st === 'rolledback' || st === 'rollout' || st === 'live' || (st === 'deploy' && e.rolledBack) || (st === 'held' && e.deploys > 0)
  const live = st === 'live'
  const waitingOnYou = e.openAsks.length > 0
  // Once CI passes it folds into one line, so the deploy stays in view.
  const ciDone = CI_JOBS.every((j) => e.ci[j.id].state === 'pass')
  const [showCi, setShowCi] = useState(false)
  return (
    <>
      <p className="headline" data-testid="ship-headline">
        {e.shipHeadline}
      </p>
      <ul className="rows">
        <li>
          <Row
            mark={<span className="kind pr">PR</span>}
            label={`Pull request #${OUTPUT.pr}`}
            sub={`Merged into ${OUTPUT.base}. Every gate passed and you approved.`}
            end="Merged"
            tone="done"
            onClick={() => e.go({ kind: 'step', id: 'harvest' })}
            testId="out-pr-merged"
          />
        </li>
      </ul>
      {ciDone && !showCi ? (
        <ul className="rows">
          <li>
            <Row
              mark={<GateMark s="pass" />}
              label={`CI on ${OUTPUT.base}`}
              sub={`${CI_JOBS.length} of ${CI_JOBS.length} jobs passed. 1 known flaky test retried on its own.`}
              end="Passed"
              tone="done"
              onClick={() => setShowCi(true)}
              testId="ci-summary"
            />
          </li>
        </ul>
      ) : (
        <>
          <p className="sublabel">CI on {OUTPUT.base}</p>
          <ul className="rows ci-rows" data-testid="ci-rows">
            {CI_JOBS.map((j) => {
              const r = e.ci[j.id]
              const mark = r.state === 'pass' ? 'pass' : r.state === 'fail' ? 'fail' : r.state === 'wait' ? 'wait' : 'run'
              const end = r.state === 'pass' ? 'Passed' : r.state === 'fail' ? 'Failed' : r.state === 'retry' ? 'Retrying' : r.state === 'run' ? 'Running' : 'Waiting'
              return (
                <li key={j.id}>
                  <Row
                    mark={<GateMark s={mark} />}
                    label={j.name}
                    sub={r.state === 'pass' || r.state === 'fail' ? r.text : r.state === 'retry' ? `${j.flaky?.test}, retried once on its own` : r.text}
                    end={end}
                    tone={r.state === 'pass' ? 'done' : r.state === 'fail' ? 'fail' : ''}
                    testId={`ci-${j.id}`}
                  />
                </li>
              )
            })}
          </ul>
          <p className="fine-line">
            {PIPELINE.provider}, <span className="mono">{PIPELINE.workflow}</span>
          </p>
        </>
      )}
      <div className={`outbox deploybox ${live ? 'sent' : ''}`} data-testid="deploy-box">
        <div className="out-line">
          <Envelope />
          <span>{live ? `Live for ${RELEASE.users} users` : `Deploy to production reaches ${RELEASE.users} users`}</span>
        </div>
        <ul className="rows">
          <li>
            <Row label={`${RELEASE.app} ${RELEASE.version}`} sub={`PR #${OUTPUT.pr}, merged into ${OUTPUT.base}`} end={live ? '100%' : st === 'rollout' ? `${e.rollout}%` : e.rollout ? '5%' : e.rolledBack ? 'Rolled back' : 'Not deployed'} />
          </li>
        </ul>
        {live && (
          <ul className="rows">
            <li>
              <Row mark={<GateMark s="pass" />} label="Canary health" sub={`${HEALTH.length} of ${HEALTH.length} checks passed on 5% of users, then it rolled out to everyone`} end="Passed" tone="done" testId="health-summary" />
            </li>
          </ul>
        )}
        {deploying && !live && (
          <>
            <p className="sublabel">Canary health, 5% of users</p>
            <ul className="rows" data-testid="health-rows">
              {HEALTH.map((h) => {
                const r = e.health[h.id]
                const failed = !r.ok
                const watching = st === 'canary' || st === 'canary2'
                const end = failed ? 'Failed' : watching ? (r.seen ? 'Watching' : 'Starting') : 'Passed'
                return (
                  <li key={h.id}>
                    <Row
                      mark={<GateMark s={failed ? 'fail' : watching ? 'run' : 'pass'} />}
                      label={h.name}
                      sub={`${fmtHealth(h, r.value)}, needs ${h.threshold.toLowerCase()}`}
                      end={end}
                      tone={failed ? 'fail' : watching ? '' : 'done'}
                      testId={`health-${h.id}`}
                    />
                  </li>
                )
              })}
            </ul>
          </>
        )}
        {e.rolledBack && (
          <ul className="rows">
            <li>
              <Row label={`Rolled back to ${RELEASE.previous} on its own`} sub={`Sign-in failed for ${RELEASE.exposure}. Logged under Decided without you.`} onClick={() => e.go({ kind: 'log', tab: 'auto' })} testId="rollback-row" />
            </li>
          </ul>
        )}
        {st === 'held' && !waitingOnYou && (
          <div className="send">
            <button className="btn out full" onClick={() => e.requestDeploy()} data-testid="deploy">
              Deploy to production
            </button>
            <p className="quiet">You’ll see the release, the rollout plan and the rollback rule before it goes.</p>
          </div>
        )}
        {live && <p className="out-done">Live for {RELEASE.users} users.</p>}
      </div>
      <StaysWithYou />
    </>
  )
}
