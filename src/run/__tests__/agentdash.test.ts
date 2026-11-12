import { describe, expect, it } from 'vitest'
import { AGENT_DASH_GOAL, isAgentDashboard, isSmallChange, scenario, simulatePlan } from '../simPlan'
import { fitLimits, simulateRun } from '../simulate'
import { reduce } from '../reduce'
import { agentsLive } from '../../hud/Agents'
import type { Project } from '../store'

const run = (goal = AGENT_DASH_GOAL) => {
  const plan = simulatePlan(goal)
  plan.farmers = fitLimits({ goal, ...plan })
  return { plan, ev: simulateRun({ goal, ...plan }) }
}

describe('the agent dashboard demo run', () => {
  it('matches the demo goal and the ways people say it', () => {
    for (const g of [
      AGENT_DASH_GOAL,
      'replace the cost button with an agent dashboard where you can see each agent on the farm, what they are working on, etc.',
      'An agents dashboard',
      'a dashboard of every agent and what it is doing',
      'Swap the spend counter for a crew overview',
    ])
      expect(isAgentDashboard(g), g).toBe(true)
    for (const g of ['A dashboard of new sign-ups each week', 'Card checkout for an online shop', 'Fix the typo on the checkout page']) expect(isAgentDashboard(g), g).toBe(false)
    expect(scenario(AGENT_DASH_GOAL)).toMatchObject({ matched: true, name: 'Agent dashboard' })
    expect(scenario(AGENT_DASH_GOAL).script.ships).toBe('agents')
  })

  it('is a full crew run, not a small change', () => {
    expect(isSmallChange(AGENT_DASH_GOAL)).toBe(false)
    const { plan } = run()
    expect(plan.farmers.map((f) => f.id).sort()).toEqual(['builder', 'deployer', 'designer', 'planner', 'tester'])
    expect(plan.tasks.map((t) => t.id)).toEqual(['agent-status', 'swap-button', 'live-rows', 'dash-design', 'e2e-check', 'ship'])
  })

  it('stops for you on cost, the disagreement and the merge, and rolls back once', () => {
    const { ev } = run()
    const asks = ev.filter((e) => e.type === 'ask')
    expect(asks.map((a) => (a.type === 'ask' ? a.reason : ''))).toEqual(['cost', 'disagree', 'big', 'irreversible'])
    const stages = ev.filter((e) => e.type === 'deploy').map((e) => (e.type === 'deploy' ? e.stage : ''))
    expect(stages).toEqual(['10%', 'rollback', '10%', '100%'])
    expect(ev.some((e) => e.type === 'check' && !e.pass && e.task === 'swap-button')).toBe(true)
    expect(ev.some((e) => e.type === 'check' && e.proof?.kind === 'screens' && e.proof.screen === 'agents')).toBe(true)
    expect(ev[ev.length - 1].type).toBe('done')
  })

  it('puts the dashboard in the top bar only while its release is live, and takes it away on the rollback', () => {
    const { ev } = run()
    const p = { approved: true, goal: AGENT_DASH_GOAL } as Project
    const deploys = ev.filter((e) => e.type === 'deploy')
    const at = (t: number) => agentsLive(p, reduce(ev, t, {}))
    expect(at(deploys[0].t - 1)).toBe(false)
    expect(deploys.map((d) => at(d.t))).toEqual([true, false, true, true])
    expect(at(ev[ev.length - 1].t)).toBe(true)
    // Another farm's release never swaps it in, and nor does a plan you haven't approved.
    expect(agentsLive({ ...p, goal: 'Card checkout for an online shop' } as Project, reduce(ev, ev[ev.length - 1].t, {}))).toBe(false)
    expect(agentsLive({ ...p, approved: false } as Project, reduce(ev, ev[ev.length - 1].t, {}))).toBe(false)
  })
})
