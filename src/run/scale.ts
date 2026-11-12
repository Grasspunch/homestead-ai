// The run's own numbers multiplied out over a month of your own runs, labelled as a projection. Nothing here is measured.
import type { RunState } from './types'
import { BY_YOU } from './rollback'

export const PACE = { perWeek: 2, weeks: 4 } // features you hand off a week, over a month

// What got caught: problems a different farmer's check found before the merge, and a bad release the 10% stage
// stopped (10% of users did see that one). One list, read by Done, the pull request, the exports and the projection.
// A check that failed because you took a file or skill away is yours, not a problem the checker caught, and a
// rollback you made yourself isn't one either.
export type Caught = { where: string; what: string; kind: 'check' | 'canary' }
export function caught(s: RunState): Caught[] {
  const out: Caught[] = []
  for (const t of s.tasks) for (const c of t.checks) if (!c.pass && !c.yours) out.push({ where: t.name, what: c.notes, kind: 'check' })
  s.deploy.forEach((d, i) => {
    if (d.stage === 'rollback' && d.reason !== BY_YOU && s.deploy[i - 1]?.stage === '10%') out.push({ where: 'Rollout', what: d.reason ?? 'Errors passed 2% at 10%, so it rolled back on its own', kind: 'canary' })
  })
  return out
}

export function caughtCounts(s: RunState) {
  const c = caught(s)
  return { checks: c.filter((x) => x.kind === 'check').length, canary: c.filter((x) => x.kind === 'canary').length }
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
