import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { store } from '../store'
import { pendingAsk } from '../reduce'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const GOAL = 'Stripe checkout for our pricing page'

function farm() {
  const p = store.newProject(GOAL)
  const plan = simulatePlan(GOAL)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.open(p.id)
  store.pause()
  return p
}

// Answer every ask up to the first two, then sit just after the second.
function pastTwoAsks() {
  const p = farm()
  const asks = p.events.filter((e) => e.type === 'ask')
  const [a, b] = asks as Extract<(typeof asks)[number], { type: 'ask' }>[]
  p.clock = a.t
  store.answer(a.id, a.suggested)
  p.clock = b.t
  store.answer(b.id, b.suggested)
  return { p, a, b }
}

describe('changing an answer you gave', () => {
  it('lists what you decided, newest first, each changeable before a release', () => {
    const { p, a, b } = pastTwoAsks()
    const d = store.decided(p)
    expect(d.map((x) => x.id)).toEqual([b.id, a.id])
    expect(d.every((x) => x.canChange)).toBe(true)
    expect(d[1].options).toContain(a.suggested)
  })
  it('reopening goes back to the question, keeps earlier answers and clears later ones', () => {
    const { p, a, b } = pastTwoAsks()
    expect(store.reopen(a.id)).toBe('')
    expect(p.clock).toBe(a.t)
    expect(p.answers?.[a.id]).toBeUndefined()
    expect(p.answers?.[b.id]).toBeUndefined()
    expect(pendingAsk(p.events, p.clock!, p.answers ?? {})).toBe(a.id)
  })
  it('reopening with a new choice answers it and the run forks from there', () => {
    const { p, a } = pastTwoAsks()
    const other = (a.alternatives ?? []).find((x) => !/^show me/i.test(x))!
    expect(store.reopen(a.id, other)).toBe('')
    expect(p.answers?.[a.id]).toBe(other)
    const rec = p.events.find((e) => e.type === 'answer' && e.id === a.id)
    expect(rec && rec.type === 'answer' && rec.choice).toBe(other)
  })
  it('an answer a release went out after can’t be un-asked, and says why', () => {
    const p = farm()
    const dep = p.events.find((e) => e.type === 'deploy')!
    const before = p.events.filter((e) => e.type === 'ask' && e.t < dep.t)
    for (const e of before) if (e.type === 'ask') {
      p.clock = e.t
      store.answer(e.id, e.suggested)
    }
    const a = p.events.find((e) => e.type === 'ask' && e.t < dep.t)!
    p.clock = dep.t
    const d = store.decided(p).find((x) => x.id === (a.type === 'ask' ? a.id : ''))
    expect(d?.canChange).toBe(false)
    expect(store.reopen(d!.id)).toMatch(/roll the release back/)
  })
})
