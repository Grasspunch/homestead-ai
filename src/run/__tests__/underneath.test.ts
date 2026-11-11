// Your answers, your undos and your pauses keep their meaning when the plan changes under them: a task you skip
// takes its open ask and its hard cases with it, Undo takes off only the change you undo, and a farm you paused
// or left a change card on stays paused until you say otherwise.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { duration, pendingAsk } from '../reduce'
import { readChanges, type Ctx } from '../reshape'
import { SAMPLE_GOAL, store, type Project } from '../store'
import type { RunEvent } from '../types'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

type Ask = Extract<RunEvent, { type: 'ask' }>
const asksOf = (p: Project) => p.events.filter((e): e is Ask => e.type === 'ask')
const nextAsk = (p: Project) => asksOf(p).find((e) => !(p.answers ?? {})[e.id]) ?? null

function farm(goal = SAMPLE_GOAL) {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.open(p.id)
  store.pause()
  return p
}

async function change(p: Project, text: string) {
  expect(await store.proposeChanges(p.id, text)).toBe('card')
  await store.applyChanges(store.pending!.proposal.rows.map((r) => r.id))
}

function finish(p: Project) {
  for (let i = 0; i < 30; i++) {
    const a = nextAsk(p)
    if (!a) break
    p.clock = Math.max(p.clock!, a.t)
    store.answer(a.id, a.suggested)
  }
  p.clock = duration(p.events)
}

describe('skipping a task while its question is open', () => {
  it('the open ask goes with the task, and the next one is about the task it names', async () => {
    const p = farm()
    const a1 = asksOf(p)[0]
    expect([a1.id, a1.task, a1.reason]).toEqual(['ask-1', 'docs-index', 'cost'])
    p.clock = a1.t
    await change(p, 'skip the index the help docs')
    // Nothing about the skipped task is left to answer.
    expect(asksOf(p).some((a) => a.task === 'docs-index' && !(p.answers ?? {})[a.id])).toBe(false)
    expect(pendingAsk(p.events, p.clock, p.answers ?? {})).toBeNull()
    // Every ask says what it is about: an ask numbered 1 now is about the task that ran over in its place.
    for (const a of asksOf(p).filter((x) => x.reason === 'cost' && /^ask-\d/.test(x.id))) expect(a.question.startsWith(store.state(p)!.tasks.find((t) => t.id === a.task)!.name)).toBe(true)
    const again = asksOf(p).find((a) => a.id === 'ask-1')!
    expect(again.task).toBe('answer-api')
    expect(again.t).toBeGreaterThan(p.clock)
  })

  it('an answer you gave on a task you then skipped never lands on another task', async () => {
    const p = farm()
    const a1 = asksOf(p)[0]
    p.clock = a1.t
    const raise = a1.alternatives!.find((o) => /^Raise/.test(o))!
    store.answer(a1.id, raise)
    p.clock = a1.t + 2 * 60_000
    await change(p, 'skip the index the help docs')
    // The task that runs over in its place is asked about on its own, not kept going under your earlier raise.
    const fresh = asksOf(p).find((a) => a.task === 'answer-api' && a.reason === 'cost')
    expect(fresh).toBeDefined()
    expect(fresh!.id).not.toBe(a1.id)
    expect((p.answers ?? {})[fresh!.id]).toBeUndefined()
    expect(fresh!.question.startsWith('Answer from the docs')).toBe(true)
    // Your answer stays on the question you answered.
    expect(asksOf(p).find((a) => a.id === a1.id)?.task).toBe('docs-index')
  })
})

describe('Undo takes off only that change', () => {
  it('undoing out of order never brings back a change already undone', async () => {
    const p = farm()
    const a = asksOf(p)[0]
    p.clock = a.t
    store.answer(a.id, a.suggested)
    p.clock = p.clock! + 3 * 60_000
    const before = structuredClone(p.events)
    await change(p, 'use synthetic tests for the rollout')
    await change(p, 'skip the e2e check')
    expect(p.reshapes).toHaveLength(2)
    store.undoChanges(p.reshapes![0].id)
    store.undoChanges(p.reshapes![0].id)
    expect(p.reshapes).toEqual([])
    const s = store.state(p)!
    expect(s.reshape).toBeUndefined()
    expect(p.events.some((e) => e.type === 'monitor' && !!e.metrics.synth)).toBe(false)
    expect(s.tasks.some((t) => t.id === 'e2e-check')).toBe(true)
    expect(p.events).toEqual(before)
  })

  it('a model you changed since stays changed, in the farmer and in what it spends', async () => {
    const p = farm()
    const a = asksOf(p)[0]
    p.clock = a.t
    store.answer(a.id, a.suggested)
    p.clock = p.clock! + 3 * 60_000
    await change(p, 'use synthetic tests for the rollout')
    p.clock = p.clock! + 60_000
    store.editKit(p.id, 'builder', (e) => {
      e.model = 'Claude Opus 5.5'
    })
    const after = (q: Project) => q.events.filter((e) => e.type === 'usage' && e.farmer === 'builder' && e.t > q.clock!)
    expect(after(p).length).toBeGreaterThan(0)
    expect(after(p).every((e) => e.type === 'usage' && e.rate === 1)).toBe(true)
    store.undoChanges(p.reshapes!.at(-1)!.id)
    expect(p.run!.kit.builder?.model).toBe('Claude Opus 5.5')
    expect(after(p).length).toBeGreaterThan(0)
    expect(after(p).every((e) => e.type === 'usage' && e.rate === 1)).toBe(true)
    expect(p.events.some((e) => e.type === 'monitor' && !!e.metrics.synth)).toBe(false)
  })
})

describe('skipping a task that was split', () => {
  const goal = 'A dashboard of weekly signups'
  const plan = simulatePlan(goal)
  const ctx: Ctx = {
    tasks: [...plan.tasks, { id: 'metrics-query-rest', name: 'Hard cases', farmer: 'builder' as const, gate: false }].map((t) => ({ id: t.id, name: t.name, farmer: t.farmer, gate: t.gate })),
    farmers: plan.farmers.map((f) => f.id),
  }
  const skipped = (text: string) => {
    const r = readChanges(text, ctx)
    return r.kind === 'changes' ? r.proposal.rows.flatMap((x) => (x.change.kind === 'removeTask' ? [x.change.task] : [])) : []
  }

  it('the best match wins: “skip the metrics api” skips Metrics API alone', () => {
    expect(skipped('skip the metrics api')).toEqual(['metrics-api'])
    expect(skipped('skip query the metrics')).toEqual(['metrics-query'])
    expect(skipped('skip the hard cases')).toEqual(['metrics-query-rest'])
  })

  // Plays to ask-2 (Metrics API), taking the suggestion on the two asks before it.
  const toAsk2 = () => {
    const p = farm(goal)
    for (let i = 0; i < 2; i++) {
      const a = nextAsk(p)!
      p.clock = Math.max(p.clock!, a.t)
      store.answer(a.id, a.suggested)
    }
    const a2 = asksOf(p).find((a) => a.id === 'ask-2')!
    expect(a2.task).toBe('metrics-api')
    p.clock = Math.max(p.clock!, a2.t)
    return p
  }

  it('its hard cases go with it, and the run still ends with every task done', async () => {
    const p = toAsk2()
    expect(store.state(p)!.tasks.some((t) => t.id === 'metrics-query-rest')).toBe(true)
    // Both tasks with “metrics” in their name, as the request reads: the split one takes its hard cases with it.
    await change(p, 'skip the metrics')
    finish(p)
    const s = store.state(p)!
    expect(s.done).toBeTruthy()
    expect(s.tasks.map((t) => t.id)).not.toContain('metrics-query-rest')
    expect(s.tasks.every((t) => t.status === 'accepted')).toBe(true)
    // Named once, by the tasks you skipped.
    expect(s.reshape?.skipped).toEqual(['Query the metrics', 'Metrics API'])
  })

  it('skipping the Metrics API at its ask leaves the split task and its hard cases running', async () => {
    const p = toAsk2()
    await change(p, 'skip the metrics api')
    finish(p)
    const s = store.state(p)!
    expect(s.tasks.map((t) => t.id)).toEqual(expect.arrayContaining(['metrics-query', 'metrics-query-rest']))
    expect(s.tasks.map((t) => t.id)).not.toContain('metrics-api')
    expect(s.tasks.every((t) => t.status === 'accepted')).toBe(true)
  })
})

describe('a pause holds', () => {
  it('pause, go Home and come back: still paused; playing, it plays on', () => {
    const p = farm()
    store.play()
    store.home()
    store.open(p.id)
    expect(store.playing).toBe(true)
    store.pause()
    store.home()
    store.open(p.id)
    expect(store.playing).toBe(false)
    store.play()
    store.home()
    store.open(p.id)
    expect(store.playing).toBe(true)
    store.pause()
  })

  it('a change card keeps its farm paused across Home, and closing it from another farm never plays that one', async () => {
    const a = farm()
    const b = farm()
    store.open(a.id)
    store.play()
    expect(await store.proposeChanges(a.id, 'use synthetic tests for the rollout')).toBe('card')
    expect(store.playing).toBe(false)
    store.home()
    store.open(a.id)
    expect(store.playing).toBe(false)
    // Over on another farm, paused there, the card is cancelled: that farm stays paused.
    store.open(b.id)
    store.pause()
    store.cancelChanges()
    expect(store.playing).toBe(false)
    // Its own farm plays on when you come back, as it did before the card.
    store.open(a.id)
    expect(store.playing).toBe(true)
    store.pause()
  })

  it('a reading that comes back late pauses and holds the farm you asked on, not the one open now', async () => {
    const a = farm()
    const b = farm()
    store.open(a.id)
    store.play()
    let done!: () => void
    const wait = new Promise<void>((r) => (done = r))
    const asked = store.proposeChanges(a.id, 'use synthetic tests for the rollout', async () => {
      await wait
      return { proposal: null }
    })
    store.open(b.id)
    store.play()
    done()
    expect(await asked).toBe('card')
    expect(store.playing).toBe(true)
    expect(store.pending?.pid).toBe(a.id)
    expect(store.pending?.wasPlaying).toBe(true)
    store.pause()
    store.open(a.id)
    expect(store.playing).toBe(false)
    store.cancelChanges()
    expect(store.playing).toBe(true)
    store.pause()
  })
})
