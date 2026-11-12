// Asks the Planner (simulated, or live in Live mode) for a plan and puts it on the farm.
import { getLiveMode, plan as askPlan } from './agent'
import { recordedPlan, remember } from './recorded'
import { store, type Project } from './store'
import type { FarmerId } from './types'

export async function planInto(p: Project, crewSize?: number | FarmerId[], change?: string) {
  p.planning = true
  p.error = undefined
  store.notify()
  const goal = change ? `${p.goal}\n\nChange to the plan: ${change}` : p.goal
  try {
    // The Planner's own model decides which provider plans: Claude, or Codex if you switched it.
    const model = store.kit[p.id]?.planner?.model ?? store.state(p)?.farmers.planner?.model
    const r = await askPlan(goal, crewSize, model)
    // The goal as typed, with the Planner choosing the crew: the one plan worth keeping, and the one a kept plan answers.
    const plain = !change && crewSize === undefined
    if (r.live && plain) remember(p.goal, r.data, r.source, model)
    // Live mode, and the live call failed: a live plan for this goal from earlier beats a simulated one.
    const earlier = !r.live && getLiveMode() && plain ? recordedPlan(p.goal) : undefined
    const data = earlier?.plan ?? r.data
    store.setPlan(p.id, data.name, data.farmers, data.tasks, data.estimate, data.singleAgentEstimate)
    p.liveNote = r.error
    p.plannedLive = r.live || !!earlier
    p.liveSource = earlier ? earlier.source : r.source
    p.plannedEarlier = earlier?.at
    if (r.error && !earlier) store.say(r.error)
  } catch (e) {
    store.planFailed(p.id, e instanceof Error ? e.message : String(e))
  }
}
