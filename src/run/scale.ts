// The run's own numbers multiplied out over a month of your own runs, labelled as a projection. Nothing here is measured.
import type { RunState } from './types'
import { BY_YOU } from './rollback'

export const PACE = { perWeek: 2, weeks: 4 } // features you hand off a week, over a month

// Problems a separate check caught before the merge, and bad releases the 10% stage stopped, counted the way
// Done counts them (a rollback you made yourself isn't one).
export function caughtCounts(s: RunState) {
  const checks = s.tasks.reduce((n, t) => n + t.checks.filter((c) => !c.pass && !c.yours).length, 0)
  const canary = s.deploy.filter((d, i) => d.stage === 'rollback' && d.reason !== BY_YOU && s.deploy[i - 1]?.stage === '10%').length
  return { checks, canary }
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`

export function scaleLine(s: RunState): string | null {
  if (!s.done) return null
  const runs = PACE.perWeek * PACE.weeks
  const { checks, canary } = caughtCounts(s)
  const parts = [`${checks * runs} problems caught before merge`]
  if (canary) parts.push(`${canary * runs} bad releases stopped at 10%`)
  parts.push(`${usd(s.done.usd * runs)} in all`)
  return `${PACE.perWeek} features a week for a month, at this run’s rates: ${parts.join(', ')}.`
}
