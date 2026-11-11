// The first line of the Planner's Done dialogue: what is in and where it is now.
import type { Estimate, RunEvent, RunState } from './types'

// It counts every plot on the farm, the release and any split-off "Hard cases" included,
// the same as the top bar's "N of M tasks done", so the number matches what you see.
export function doneLead(s: Pick<RunState, 'tasks' | 'deploy'>) {
  const all = s.tasks
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
