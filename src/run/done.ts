// The first line of the Planner's Done dialogue: what is in and where it is now.
import type { Estimate, RunEvent, RunState } from './types'

// "N of M tasks done", as the top bar and Home both say it: every plot on the farm, the release and any
// split-off "Hard cases" included, done once its check passed. One count, so the two screens never disagree.
export function taskCount(s: Pick<RunState, 'tasks'>) {
  const done = s.tasks.filter((t) => t.status === 'ripe' || t.status === 'accepted').length
  return { done, total: s.tasks.length }
}

// It counts every plot on the farm, the release and any split-off "Hard cases" included,
// the same as the top bar's "N of M tasks done", so the number matches what you see.
export function doneLead(s: Pick<RunState, 'tasks' | 'deploy'> & Partial<Pick<RunState, 'asks'>>) {
  const all = s.tasks
  const stop = budgetStopOf(s)
  if (stop) {
    const done = all.filter((t) => t.status === 'accepted').length
    const last = s.deploy[s.deploy.length - 1]?.stage
    // Stopped after the release went out: say where it stands, not "nothing shipped".
    const where = last === '100%' ? 'live for everyone' : last === '10%' ? 'stopped after the 10% release, which stays live for 10% of users' : last === 'rollback' ? 'rolled back, so nothing is live' : 'nothing shipped'
    return `You stopped the run at its ${stop} budget: ${done} of ${all.length} tasks done, ${where}.`
  }
  const done = all.filter((t) => t.status === 'accepted').length
  const last = s.deploy[s.deploy.length - 1]?.stage
  const where = last === '100%' ? 'live for everyone' : last === '10%' ? 'live for 10% of users' : last === 'rollback' ? 'rolled back, so nothing is live' : 'not shipped yet'
  // A task you stopped part way is in, but not all of it.
  const cut = all.filter((t) => t.stopped && t.status === 'accepted').length
  if (done < all.length) return `${done} of ${all.length} tasks done, ${where}.`
  return cut ? `All ${all.length} tasks are in, ${cut} of them cut short by you, and ${where}.` : `All ${all.length} tasks are in and ${where}.`
}

// The Planner's own cost estimate, made before anything ran. The plan shows it, Done reads the real total against
// it, and the exports say the same figure.
export function plannerEstimate(events: RunEvent[]): Estimate | undefined {
  const e = events.find((x) => x.type === 'plan')
  return e && e.type === 'plan' ? e.basis ?? e.estimate : undefined
}

// The budget you stopped the run at, as the ask said it, or null when the run wasn't stopped there.
export function budgetStopOf(s: Partial<Pick<RunState, 'asks'>>): string | null {
  const a = s.asks?.find((x) => x.budgetFor && /^stop the run/i.test(x.answer?.choice ?? ''))
  return a ? /its (\$[\d,.]+) budget/.exec(a.question)?.[1] ?? 'its' : null
}
