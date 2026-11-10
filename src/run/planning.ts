// Asks the Planner (simulated, or live in Live mode) for a plan and puts it on the farm.
import { plan as askPlan } from './agent'
import { store, type Project } from './store'
import type { FarmerId } from './types'

export async function planInto(p: Project, crewSize?: number | FarmerId[], change?: string) {
  p.planning = true
  p.error = undefined
  store.notify()
  const goal = change ? `${p.goal}\n\nChange to the plan: ${change}` : p.goal
  try {
    const r = await askPlan(goal, crewSize)
    store.setPlan(p.id, r.data.name, r.data.farmers, r.data.tasks, r.data.estimate, r.data.singleAgentEstimate)
    p.liveNote = r.error
    if (r.error) store.say(r.error)
  } catch (e) {
    store.planFailed(p.id, e instanceof Error ? e.message : String(e))
  }
}
