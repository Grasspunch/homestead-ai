// Findings from the live Planner test: a reset only touches parts you changed, and what the live Planner says
// about a change reaches its card.
import { beforeAll, describe, expect, it } from 'vitest'
import { BAR_DEFAULT, uiLookOf, uiNoop, type UiId } from '../ui'
import { simulatePlan } from '../simPlan'
import { store } from '../store'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

describe('live Planner findings', () => {
  it('a part shifted along by another part’s move is not changed', () => {
    const last = BAR_DEFAULT[BAR_DEFAULT.length - 1] as UiId
    const look = uiLookOf([{ kind: 'uiMove', el: last, to: 'start' }])
    expect(look.order.join()).not.toBe(BAR_DEFAULT.join())
    expect(uiNoop({ kind: 'uiReset', el: last }, look)).toBe(false)
    for (const el of ['inbox', 'skip', 'play'] as UiId[]) expect(uiNoop({ kind: 'uiReset', el }, look)).toBe(true)
  })

  it('the live Planner’s words on a change go on the card', async () => {
    const goal = 'A habit tracker app'
    const p = store.newProject(goal)
    const plan = simulatePlan(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    const warn = 'The pull request button is hidden right now, so you won’t see the new name until you show it.'
    const res = await store.proposeChanges(p.id, 'rename the pr button to Review', async (text, ctx) => {
      const { readChanges } = await import('../reshape')
      const r = readChanges(text, ctx)
      return { proposal: r.kind === 'changes' ? r.proposal : null, reply: warn }
    })
    expect(res).toBe('card')
    expect(store.pending?.proposal.note).toContain(warn)
  })
})
