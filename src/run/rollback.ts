// You rolled a live release back from the pull request. The run log is rewritten from that moment.
// - During a release that was going bad: your rollback lands first, and the fix and the next release come sooner.
// - During a healthy release: it comes down, and the Deployer asks whether to ship to 10% again.
import type { RunEvent } from './types'

const MIN = 60_000
export const BY_YOU = 'Rolled back by you'
export const SHIP_AGAIN = 'Ship to 10% again'
export const LEAVE_IT = 'Leave it rolled back'
type Done = Extract<RunEvent, { type: 'done' }>

// The release stage live at time t, if any.
export function liveStage(events: RunEvent[], t: number) {
  let stage: string | null = null
  for (const e of events) {
    if (e.t > t) break
    if (e.type === 'deploy') stage = e.stage
    if (e.type === 'stop' && stage) stage = null
  }
  return stage === '10%' || stage === '100%' ? stage : null
}

export function rollBack(events: RunEvent[], t0: number, askId: string, choice?: string): RunEvent[] {
  if (!liveStage(events, t0)) return events
  const plan = events.find((e) => e.type === 'plan')
  // The release task: the gated one that ships (another gated task, such as an email, isn't a release).
  const gates = new Set(plan && plan.type === 'plan' ? plan.tasks.filter((t) => t.gate && /ship|deploy|launch|release|live/i.test(t.name + t.id)).map((t) => t.id) : [])
  const deploys = events.filter((e) => e.type === 'deploy')
  const next = deploys.find((e) => e.t > t0)
  const shipper = [...events].reverse().find((e) => e.type === 'task_start' && e.t <= t0 && gates.has(e.task))
  if (!shipper || shipper.type !== 'task_start') return events
  const gate = shipper.task
  // Part of the release itself: the stages, their metrics, and everything the release task did, said or logged.
  const rollout = (e: RunEvent) =>
    e.type === 'deploy' || e.type === 'monitor' || (e.type !== 'task_start' && 'task' in e && e.task === gate)
  const withDone = (out: RunEvent[]) => {
    const done = events.find((e) => e.type === 'done')
    const body: RunEvent[] = out.filter((e) => e.type !== 'done').sort((a, b) => a.t - b.t)
    if (done) {
      const last = body[body.length - 1]?.t ?? 0
      const usd = body.reduce((n, e) => n + (e.type === 'usage' ? e.usd : 0), 0)
      const end: Done = { ...(done as Done), t: last + 30_000, usd: +usd.toFixed(2), minutes: Math.round(last / MIN), asks: body.filter((e) => e.type === 'ask').length }
      body.push(end)
    }
    return body
  }

  // Going bad: it would have rolled back by itself at `next`. Yours lands now, and what follows comes sooner.
  if (next && next.type === 'deploy' && next.stage === 'rollback') {
    const gap = next.t - t0
    const out = events
      .filter((e) => !(e.t > t0 && e.t <= next.t && e.type === 'monitor'))
      .filter((e) => !(e.type === 'auto_fix' && e.task === gate && e.t > next.t && e.t <= next.t + MIN && /rolled back by itself/i.test(e.what)))
      .map((e) => (e === next ? { ...e, t: t0, reason: BY_YOU } : e.t > next.t ? { ...e, t: e.t - gap } : e))
    return withDone(out)
  }

  // Healthy: it comes down, and the Deployer asks whether to ship again.
  const at = (dm: number) => Math.round(t0 + dm * MIN)
  const before = events.filter((e) => e.t <= t0 || !rollout(e))
  const added: RunEvent[] = [
    { t: at(0), type: 'deploy', stage: 'rollback', reason: BY_YOU },
    { t: at(0.05), type: 'progress', task: gate, value: 0.1 },
    {
      t: at(0.3), type: 'ask', id: askId, farmer: shipper.farmer, task: gate, reason: 'risk',
      question: 'Rolled back as you asked. Nothing is live now. Ship to 10% again?',
      impact: 'Same rule as before: if errors pass 2%, I roll back by myself.',
      suggested: SHIP_AGAIN, alternatives: [LEAVE_IT],
    },
  ]
  const c = choice ?? SHIP_AGAIN
  added.push({ t: at(1.3), type: 'answer', id: askId, choice: c, by: 'human' })
  if (c === LEAVE_IT) {
    added.push({ t: at(1.4), type: 'stop', task: gate, reason: 'You rolled it back. The pull request is merged, and nothing is live.' })
    return withDone([...before, ...added])
  }
  // Ship again: the release replays from its last 10% stage.
  const from = [...deploys].reverse().find((e) => e.t <= t0 && e.type === 'deploy' && e.stage === '10%')
  if (!from) return withDone([...before, ...added])
  const shift = at(1.5) - from.t
  const again = events.filter((e) => e.t >= from.t && rollout(e) && !(e.type === 'deploy' && e.stage === 'rollback')).map((e) => ({ ...e, t: e.t + shift }))
  return withDone([...before, ...added, ...again])
}
