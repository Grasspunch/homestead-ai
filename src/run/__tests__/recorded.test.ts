import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
beforeAll(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

// The live Planner, faked: `answer` decides whether this call reaches the model.
const answer = { live: false }
vi.mock('../agent', async (orig) => {
  const real = await orig<typeof import('../agent')>()
  const { simulatePlan } = await import('../simPlan')
  return {
    ...real,
    getLiveMode: () => true,
    plan: async (goal: string) => {
      const data = { ...simulatePlan(goal), name: answer.live ? 'Live plan' : 'Sim plan' }
      return answer.live ? { data, live: true, source: 'Lovable AI' } : { data, live: false, error: 'Could not reach the agent server.' }
    },
  }
})

import { DEMO_GOALS, EXAMPLE_GOALS, isDemoGoal, recordedPlan, remember } from '../recorded'
import { planInto } from '../planning'
import { SAMPLE_GOAL, store } from '../store'
import { simulatePlan } from '../simPlan'

beforeEach(() => mem.clear())

describe('recorded live plans', () => {
  it('keeps the sample goal and the Home starters', () => {
    expect(DEMO_GOALS[0]).toBe(SAMPLE_GOAL)
    expect(EXAMPLE_GOALS.length).toBeGreaterThan(0)
    expect(isDemoGoal(`  ${EXAMPLE_GOALS[0].toUpperCase()}.`)).toBe(true)
    expect(isDemoGoal('A todo app')).toBe(false)
  })

  it('remembers live plans for demo goals only, newest first', () => {
    const plan = simulatePlan(SAMPLE_GOAL)
    remember('A todo app', plan)
    expect(recordedPlan('A todo app')).toBeUndefined()
    remember(SAMPLE_GOAL, { ...plan, name: 'Old' }, 'Lovable AI', undefined, '2026-11-01T10:00:00Z')
    expect(recordedPlan(SAMPLE_GOAL)?.plan.name).toBe('Old')
    remember(SAMPLE_GOAL, { ...plan, name: 'New' }, 'Lovable AI', undefined, '2026-11-10T10:00:00Z')
    expect(recordedPlan(SAMPLE_GOAL)).toMatchObject({ source: 'Lovable AI', at: '2026-11-10T10:00:00Z' })
  })

  it('a live plan is kept, and a failed live call falls back to it, labelled as earlier', async () => {
    const goal = EXAMPLE_GOALS[1]
    answer.live = true
    const a = store.newProject(goal)
    await planInto(a)
    expect(a).toMatchObject({ name: 'Live plan', plannedLive: true, liveSource: 'Lovable AI' })
    expect(a.plannedEarlier).toBeUndefined()

    answer.live = false
    const b = store.newProject(goal)
    await planInto(b)
    expect(b.name).toMatch(/^Live plan/)
    expect(b.plannedLive).toBe(true)
    expect(b.plannedEarlier).toBeTruthy()
    expect(b.liveNote).toBe('Could not reach the agent server.')
  })

  it('a failed live call with nothing kept stays simulated and says why', async () => {
    answer.live = false
    const p = store.newProject('A todo app')
    await planInto(p)
    expect(p).toMatchObject({ name: 'Sim plan', plannedLive: false })
    expect(p.plannedEarlier).toBeUndefined()
  })

  it('a crew change is never answered from a kept plan', async () => {
    answer.live = true
    const goal = EXAMPLE_GOALS[2]
    await planInto(store.newProject(goal))
    answer.live = false
    const p = store.newProject(goal)
    await planInto(p, ['builder', 'tester'])
    expect(p.plannedEarlier).toBeUndefined()
  })
})
