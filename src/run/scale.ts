// The run's own numbers multiplied out across a team, labelled as a projection. Nothing here is measured.
import type { RunState } from './types'
import { BY_YOU } from './rollback'

export const TEAM = { people: 10, crewsEach: 2 }

// Problems a separate check caught before the merge, and bad releases the 10% stage stopped, counted the way
// Done counts them (a rollback you made yourself isn't one).
export function caughtCounts(s: RunState) {
  const checks = s.tasks.reduce((n, t) => n + t.checks.filter((c) => !c.pass).length, 0)
  const canary = s.deploy.filter((d, i) => d.stage === 'rollback' && d.reason !== BY_YOU && s.deploy[i - 1]?.stage === '10%').length
  return { checks, canary }
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`

export function scaleLine(s: RunState): string | null {
  if (!s.done) return null
  const runs = TEAM.people * TEAM.crewsEach
  const { checks, canary } = caughtCounts(s)
  const parts = [`${checks * runs} problems caught before merge`]
  if (canary) parts.push(`${canary * runs} bad releases stopped at 10%`)
  parts.push(`${usd(s.done.usd * runs)} of spend${s.checkUsd ? `, ${usd(s.checkUsd * runs)} of it checks` : ''}`)
  return `Projected at this run’s rates, a ${TEAM.people}-person team running ${TEAM.crewsEach} crews each a day: ${parts.join(', ')}.`
}
