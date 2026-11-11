import { describe, expect, it } from 'vitest'
import { AGENT_DASH_GOAL, isAgentDashboard, isSmallChange, scenario, simulatePlan } from '../simPlan'
import { REVIEW, fitLimits, pairMoment, simulateRun } from '../simulate'
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
    expect(plan.tasks.map((t) => t.id)).toEqual(['agent-status', 'dash-design', 'swap-button', 'live-rows', 'e2e-check', 'ship'])
    // The Designer swaps the button, so it and the Builder build side by side the whole way.
    expect(plan.tasks.find((t) => t.id === 'swap-button')?.farmer).toBe('designer')
  })

  it('stops for you on cost, the disagreement and the merge, and rolls back once', () => {
    const { ev } = run()
    const asks = ev.filter((e) => e.type === 'ask')
    expect(asks.map((a) => (a.type === 'ask' ? a.reason : ''))).toEqual(['cost', 'disagree', 'big', 'irreversible'])
    const stages = ev.filter((e) => e.type === 'deploy').map((e) => (e.type === 'deploy' ? e.stage : ''))
    expect(stages).toEqual(['10%', 'rollback', '10%', '100%'])
    expect(ev.some((e) => e.type === 'check' && !e.pass && e.task === 'live-rows')).toBe(true)
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

  it('has three farmers on plots from the start, and the Tester waits beside its own until the others’ work is in', () => {
    const { ev } = run()
    const starts = ev.filter((e) => e.type === 'task_start' && e.t < 60_000).map((e) => (e.type === 'task_start' ? e.farmer : ''))
    expect(starts.sort()).toEqual(['builder', 'designer', 'tester'])
    const early = (t: number) => reduce(ev, t, {})
    const wait = ev.find((e) => e.type === 'tool' && e.farmer === 'tester' && e.tool === 'wait')!
    expect(early(wait.t - 1).farmers.tester?.state).toBe('working')
    expect(early(wait.t).farmers.tester?.state).toBe('idle')
    expect(early(wait.t).tasks.find((t) => t.id === 'e2e-check')?.status).toBe('growing')
    // Building side by side after ask 2: the Builder on Keep it live while the Designer swaps the button.
    const mid = early(ev.find((e) => e.type === 'task_start' && e.task === 'swap-button')!.t + 60_000)
    expect([mid.farmers.builder?.task, mid.farmers.designer?.task]).toEqual(['live-rows', 'swap-button'])
  })

  it('ripens two plots together just after ask 2, and the Tester walks over and checks both in turn', () => {
    const { ev } = run()
    const m = pairMoment(ev)!
    const ask2 = ev.find((e) => e.type === 'answer' && e.id === 'ask-2')!
    expect(m.from).toBeGreaterThan(ask2.t)
    expect(ev.some((e) => e.type === 'ask' && e.t > m.from - 6_000 && e.t < m.to)).toBe(false)
    const walks = ev.filter((e) => e.type === 'tool' && e.tool === REVIEW).map((e) => (e.type === 'tool' ? e.task : ''))
    expect(walks).toEqual(['dash-design', 'agent-status'])
    // Both stand ready, unchecked, as the Tester sets off.
    const s0 = reduce(ev, m.from, {})
    expect(walks.map((id) => s0.tasks.find((t) => t.id === id)?.status)).toEqual(['checking', 'checking'])
    // The first is checked before the Tester walks to the second, and both are in by the end of the moment.
    const checks = walks.map((id) => ev.find((e) => e.type === 'check' && e.task === id && e.pass && e.t >= m.from)!.t)
    expect(checks[0]).toBeLessThan(ev.filter((e) => e.type === 'tool' && e.tool === REVIEW)[1].t)
    const s1 = reduce(ev, m.to, {})
    expect(walks.map((id) => s1.tasks.find((t) => t.id === id)?.status)).toEqual(['accepted', 'accepted'])
    expect(s1.farmers.tester?.state).toBe('idle')
  })
})
