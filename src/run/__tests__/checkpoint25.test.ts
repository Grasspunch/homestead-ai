// Checkpoint 25: "Stop the run here" ends the run cleanly. Nothing more is asked, nothing ships, Done and the
// pull request lead with the budget, and a budget ask never becomes a lesson.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { budgetStopOf, doneLead } from '../done'
import { lessonFrom } from '../learn'
import { prMarkdown } from '../export'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

type Ask = Extract<Project['events'][number], { type: 'ask' }>
const next = (p: Project) => p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id]) as Ask | undefined

function farm(goal: string) {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.pause()
  return p
}

const GOALS = [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A dashboard of weekly signups', 'A habit tracker app']

describe('checkpoint 25: Stop the run here', () => {
  for (const goal of GOALS)
    for (const at of [0, 1, 2, 3])
      for (const budget of [6, 20, 40])
        for (const astra of [false, true])
          it(`${goal.slice(0, 20)}: budget $${budget} set before ask ${at}${astra ? ', Astra Builder' : ''}, then Stop`, () => {
            const p = farm(goal)
            if (astra) store.editKit(p.id, 'builder', (e) => void (e.model = 'GPT-6 Astra'))
            let stop: Ask | undefined
            for (let i = 0; i < 40; i++) {
              if (i === at) store.setProjectBudget(p.id, budget)
              const a = next(p)
              if (!a) break
              // Nothing is asked after you stop the run.
              expect(stop, `${a.id} asked after the stop: ${a.question}`).toBeUndefined()
              p.clock = Math.max(p.clock!, a.t)
              store.answer(a.id, a.budgetFor ? 'Stop the run here' : a.suggested)
              if (a.budgetFor) stop = a
            }
            const end = p.events.find((e) => e.type === 'done')!
            p.clock = end.t
            const s = store.state(p)!
            if (!stop) return
            expect(s.deploy).toEqual([])
            expect(budgetStopOf(s)).toMatch(/^\$\d/)
            expect(doneLead(s)).toMatch(/^You stopped the run at its \$[\d,.]+ budget: \d+ of \d+ tasks done, nothing shipped\.$/)
            expect(prMarkdown(p, s)).toContain(doneLead(s))
            // A budget ask is never what the next run learns from.
            const lesson = lessonFrom(p.events, 1)
            expect(lesson === null || lesson.task !== stop.task || !!p.events.find((e) => e.type === 'ask' && e.reason === 'cost' && !e.budgetFor && !e.limitFor && e.task === stop!.task)).toBe(true)
          })
})
