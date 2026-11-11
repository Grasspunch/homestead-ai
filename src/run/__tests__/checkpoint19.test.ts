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

describe('checkpoint 20: an approved raise keeps its amount', () => {
  it('Builder to Opus at the cost ask, then Raise to $23: the limit goes up by what you approved, and passing it asks again', () => {
    const p = farm(SAMPLE_GOAL)
    const a = nextAsk(p)!
    p.clock = a.t
    const raise = a.alternatives!.find((o) => /^Raise its limit/.test(o))!
    store.editKit(p.id, 'builder', (e) => void (e.model = 'Claude Opus 5.5'))
    store.answer(a.id, raise)
    const lift = p.events.find((e) => e.type === 'auto_fix' && /limit went up/.test(e.what))
    const plain = farm(SAMPLE_GOAL)
    const b = nextAsk(plain)!
    plain.clock = b.t
    store.answer(b.id, raise)
    const plainLift = plain.events.find((e) => e.type === 'auto_fix' && /limit went up/.test(e.what))
    expect(lift).toBeDefined()
    expect(plainLift).toBeDefined()
    // The answer on record is the one you gave, at the price you approved.
    expect(p.events.find((e) => e.type === 'answer' && e.id === a.id && e.type === 'answer' && e.choice === raise)).toBeDefined()
    expect(p.events.some((e) => e.type === 'tool' && e.summary === `Kept going under a ${raise.replace('Raise its limit to ', '')} limit`)).toBe(true)
    expect(p.events.some((e) => e.type === 'ask' && e.limitFor === 'builder')).toBe(true)
  })
})

describe('checkpoint 20: taking a file away never fails a task that already passed', () => {
  it('help docs off after "Index the help docs" passed: no failed check, no ask, the task stays in', () => {
    const p = farm(SAMPLE_GOAL)
    // Past the cost ask and every check of the first task.
    for (let i = 0; i < 30; i++) {
      const a = nextAsk(p)
      if (!a) break
      p.clock = Math.max(p.clock!, a.t)
      store.answer(a.id, a.suggested)
      const ok = p.events.find((e) => e.type === 'check' && e.task === 'docs-index' && e.pass)
      if (ok && ok.t < p.clock!) break
    }
    const ok = p.events.find((e) => e.type === 'check' && e.task === 'docs-index' && e.pass)!
    p.clock = Math.max(p.clock!, ok.t + 60_000)
    store.editKit(p.id, 'builder', (e) => void (e.contextOff = [...(e.contextOff ?? []), 'docs/help/']))
    expect(p.events.some((e) => e.type === 'check' && e.task === 'docs-index' && !e.pass && e.t > ok.t)).toBe(false)
    expect(p.events.some((e) => e.type === 'ask' && e.need?.path === 'docs/help/')).toBe(false)
    expect(p.events.some((e) => e.type === 'stop' && e.task === 'docs-index')).toBe(false)
  })
})

describe('checkpoint 20: a check you stopped never holds the release', () => {
  it('Tester without Drive a browser, Stop this task, then Merge: it ships, and your stop isn’t a caught problem', () => {
    const p = store.newProject(SAMPLE_GOAL)
    const plan = simulatePlan(SAMPLE_GOAL)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.editKit(p.id, 'tester', (e) => void (e.off = [...e.off, 'browser']))
    store.approve(p.id)
    store.pause()
    let stopped = false
    for (let i = 0; i < 30; i++) {
      const a = nextAsk(p)
      if (!a) break
      p.clock = Math.max(p.clock!, a.t)
      if (a.need) stopped = true
      store.answer(a.id, a.need ? 'Stop this task' : a.suggested)
    }
    p.clock = doneT(p)!
    const s = store.state(p)!
    expect(stopped).toBe(true)
    expect(s.deploy.some((d) => d.stage === '10%')).toBe(true)
    expect(s.tasks.flatMap((t) => t.checks).some((c) => c.yours)).toBe(true)
  })
})
