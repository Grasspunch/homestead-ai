// Learning across runs: a task that ran over in run 1 is planned in two from the start in run 2, with the
// saving taken from the two runs' own events.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { duration, reduce } from '../reduce'
import { lessonFrom, lessonLine, savedBy, taskCost } from '../learn'
import { scaleLine } from '../scale'
import { SAMPLE_GOAL, store, type Project } from '../store'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

function farm(goal: string) {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.pause()
  return p
}

function playOut(p: Project, pick = (a: { suggested: string; alternatives?: string[] }) => a.suggested) {
  for (let i = 0; i < 30; i++) {
    const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
    if (!a || a.type !== 'ask') break
    p.clock = Math.max(p.clock!, a.t)
    store.answer(a.id, pick(a))
  }
  p.clock = duration(p.events)
  ;(store as unknown as { finishRun: (p: Project) => void }).finishRun(p)
}

const costAsks = (p: Project) => p.events.filter((e) => e.type === 'ask' && e.reason === 'cost' && !e.limitFor)

describe('learning across runs', () => {
  for (const goal of [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A dashboard of weekly signups']) {
    it(`${goal.slice(0, 32)}: run 2 splits the task that ran over from the start, for less, with no ask`, () => {
      const p = farm(goal)
      playOut(p)
      const first = costAsks(p)[0]
      expect(first && first.type === 'ask' && first.task).toBeTruthy()
      const task = first.type === 'ask' ? first.task! : ''
      expect(p.lesson?.task).toBe(task)
      const run1 = taskCost(p.events, task)
      expect(p.lesson?.usd).toBe(run1)

      store.runAgain()
      store.pause()
      // On the plan: the hard cases are a task from the start, and the Planner says why, with the forecast saving.
      const plan = p.events.find((e) => e.type === 'plan')
      expect(plan && plan.type === 'plan' && plan.tasks.some((t) => t.id === `${task}-rest`)).toBe(true)
      expect(costAsks(p)).toEqual([])
      const said = (store.chat[p.id] ?? []).at(-1)!
      expect(said.text).toMatch(/^Last time “.*” ran over, so I split it from the start: about \$\d+(\.\d\d)? less, and no ask\.$/)
      const saved = savedBy(p.lesson!, p.events)
      expect(saved).toBeGreaterThan(0)
      expect(said.text).toContain(saved < 10 ? saved.toFixed(2) : String(Math.round(saved)))
      // The run 2 figure is what that task really cost in run 2.
      expect(+(run1 - taskCost(p.events, task)).toFixed(2)).toBe(saved)

      playOut(p)
      expect(p.run?.lesson?.task).toBe(task)
      expect(lessonLine(p.run!.lesson!, p.events, true)).toMatch(/^Learned from run 1: “.*” split from the start, \$\d+(\.\d\d)? less, and no ask\.$/)
      // Run 2 had nothing run over, so the lesson stands for run 3.
      expect(p.lesson?.run).toBe(1)
    })
  }

  it('a task you stopped teaches nothing', () => {
    const p = farm('Stripe checkout for our pricing page')
    playOut(p, (a) => (a.alternatives?.includes('Stop it here') && !/limit/i.test(a.suggested) ? 'Stop it here' : a.suggested))
    expect(lessonFrom(p.events, 1)).toBeNull()
  })

  it('the sample learns too, and its run 2 has one money ask fewer', () => {
    store.projects = store.projects.filter((x) => x.kind !== 'sample')
    try {
      localStorage?.clear?.()
    } catch {
      // no storage in tests
    }
    store.loadSample()
    const p = store.projects.find((x) => x.kind === 'sample')!
    store.open(p.id)
    store.pause()
    playOut(p)
    const before = costAsks(p).length
    store.runAgain()
    store.pause()
    expect(costAsks(p).length).toBe(before - 1)
  })
})

describe('the scale line', () => {
  it('multiplies this run’s own numbers out over a month of your runs, and says it is a projection', () => {
    const p = farm(SAMPLE_GOAL)
    playOut(p)
    const s = reduce(p.events, Number.MAX_SAFE_INTEGER, p.answers ?? {})
    const line = scaleLine(s)!
    expect(line).toMatch(/^2 features a week for a month, at this run’s rates: /)
    const checks = s.tasks.reduce((n, t) => n + t.checks.filter((c) => !c.pass && !c.yours).length, 0)
    expect(line).toContain(`${checks * 8} problems caught before merge`)
    expect(line).toContain(`$${Math.round(s.done!.usd * 8).toLocaleString('en-US')} in all`)
  })
})
