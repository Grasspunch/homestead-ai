// Checkpoint 19: the Raise path with a late model change reaches Done, and nothing reads as a stop you never made.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store, type Project } from '../store'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const GOALS = [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A dashboard of weekly signups', 'A tool that drafts replies to app store reviews']

function farm(goal: string) {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.pause()
  return p
}
const nextAsk = (p: Project) => {
  const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
  return a && a.type === 'ask' ? a : null
}
const doneT = (p: Project) => p.events.find((e) => e.type === 'done')?.t
const lastT = (p: Project) => Math.max(...p.events.filter((e) => e.type !== 'done').map((e) => e.t))

describe('checkpoint 19: Raise, then a late model change', () => {
  for (const goal of GOALS)
    for (const frac of [0.9, 0.95, 0.99])
      it(`${goal.slice(0, 24)}: Raise, Builder to Opus at ${frac * 100}%, still reaches Done with no phantom stop`, () => {
        const p = farm(goal)
        // Answer the first ask with Raise when it offers one, the rest with their suggestion.
        let raised = false
        for (let i = 0; i < 30; i++) {
          const a = nextAsk(p)
          if (!a) break
          p.clock = Math.max(p.clock!, a.t)
          const r = !raised ? a.alternatives?.find((o) => /^raise/i.test(o)) ?? (/^raise/i.test(a.suggested) ? a.suggested : undefined) : undefined
          if (r) raised = true
          store.answer(a.id, r ?? a.suggested)
        }
        const end = doneT(p)!
        p.clock = Math.round(end * frac)
        store.editKit(p.id, 'builder', (e) => void (e.model = 'Claude Opus 5.5'))
        for (let i = 0; i < 30; i++) {
          const a = nextAsk(p)
          if (!a) break
          p.clock = Math.max(p.clock!, a.t)
          store.answer(a.id, a.suggested)
        }
        expect(doneT(p)).toBeDefined()
        expect(doneT(p)!).toBeGreaterThan(lastT(p))
        expect(p.events.some((e) => e.type === 'stop')).toBe(false)
      })
})

describe('checkpoint 19: Run again never stacks tasks', () => {
  it('runs 1 to 5 of the sample keep the same number of plots', () => {
    const p = farm(SAMPLE_GOAL)
    const counts: number[] = []
    for (let run = 0; run < 5; run++) {
      if (run > 0) {
        store.open(p.id)
        store.runAgain()
        store.pause()
      }
      for (let i = 0; i < 30; i++) {
        const a = nextAsk(p)
        if (!a) break
        p.clock = Math.max(p.clock!, a.t)
        store.answer(a.id, a.suggested)
      }
      p.clock = doneT(p)!
      ;(store as unknown as { finishRun(p: Project): void }).finishRun(p)
      counts.push(store.state(p)!.tasks.length)
      expect(store.state(p)!.tasks.filter((t) => t.name === 'Hard cases').length).toBeLessThanOrEqual(1)
    }
    expect(new Set(counts.slice(1)).size).toBe(1)
    expect(counts[0]).toBe(counts[1])
  })
})
