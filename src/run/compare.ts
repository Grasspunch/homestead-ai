// Crew against one agent, from the finished run: what this run's own work would have cost one Sonnet agent
// doing it all in a row, with no checker. Both columns come from the same events, never from the plan.
import { MODELS } from './kit'
import { SOLO } from './simPlan'
import type { Estimate, FarmerId, RunEvent } from './types'

const MIN = 60_000
const rate = (model?: string) => MODELS.find((m) => m.model === model)?.rate ?? 1

export function soloFromRun(events: RunEvent[]): Estimate {
  const model: Partial<Record<FarmerId, string>> = {}
  const checker = new Set<FarmerId>()
  for (const e of events) {
    if (e.type === 'farmer') model[e.id] = e.model
    if (e.type === 'check' || e.type === 'verify') checker.add(e.by)
  }
  // The work: every step a maker took, repriced to Sonnet. The checking, and the Tester's own task, are left out.
  const starts = new Map<string, { t: number; f: FarmerId }>()
  let usd = 0
  let ms = 0
  const owner = new Map<string, FarmerId>()
  for (const e of events) {
    if (e.type === 'task_start') {
      starts.set(e.task, { t: e.t, f: e.farmer })
      owner.set(e.task, e.farmer)
    }
    if (e.type === 'usage' && e.task && owner.get(e.task) === e.farmer && e.task !== 'e2e-check' && e.farmer !== 'tester')
      usd += (e.usd / rate(model[e.farmer])) * rate(SOLO.model)
    if ((e.type === 'task_built' || e.type === 'stop') && starts.has(e.task) && e.task !== 'e2e-check') {
      ms += e.t - starts.get(e.task)!.t
      starts.delete(e.task)
    }
  }
  return { usd: +(usd * SOLO.contextCost).toFixed(2), minutes: Math.round((ms / MIN) * SOLO.contextTime) }
}

// What the checking cost in this run: every read of someone else's task by a checker, and the end-to-end check.
// The Planner reading a task to split or re-plan it is planning, not checking.
export function checkCost(events: RunEvent[]): number {
  const owner = new Map<string, FarmerId>()
  let usd = 0
  for (const e of events) {
    if (e.type === 'task_start' && !owner.has(e.task)) owner.set(e.task, e.farmer)
    if (e.type === 'usage' && e.task && (e.task === 'e2e-check' || (e.kind === 'read' && e.farmer !== 'planner' && owner.has(e.task) && owner.get(e.task) !== e.farmer))) usd += e.usd
  }
  return +usd.toFixed(2)
}
