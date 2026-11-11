import { beforeAll, describe, expect, it } from 'vitest'
import { reduce } from '../reduce'
import { simulatePlan } from '../simPlan'
import { BRAND_ASK, BRAND_FIX } from '../simulate'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { applyEdit } from '../kit'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

// A farm for the sample's goal, approved, with the clock at the brand ask.
function atBrandAsk(): Project {
  const p = store.newProject(SAMPLE_GOAL)
  const plan = simulatePlan(SAMPLE_GOAL)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.pause()
  const ask = p.events.find((e) => e.type === 'ask' && e.id === BRAND_ASK)!
  // Answer every ask before it with its suggestion, as the sample does.
  for (const e of p.events) if (e.type === 'ask' && e.t < ask.t) store.answer(e.id, e.suggested)
  p.clock = ask.t
  return p
}
const brandCheck = (p: Project, pass: boolean) => p.events.find((e) => e.type === 'check' && e.task === 'chat-widget' && e.pass === pass && e.proof?.shots?.some((s) => s.state === 'offbrand'))
const designerSees = (p: Project) => applyEdit(reduce(p.events, Infinity).farmers.designer!, store.kit[p.id]?.designer).context

describe('what each farmer can see', () => {
  it('the sample plan leaves the brand guide out of the Designer’s context', () => {
    const plan = simulatePlan(SAMPLE_GOAL)
    expect(plan.farmers.find((f) => f.id === 'designer')!.context).not.toContain('docs/brand.md')
  })

  it('without the guide the widget fails an off-brand check that names the Designer’s context', () => {
    const p = atBrandAsk()
    const fail = brandCheck(p, false)
    expect(fail && fail.type === 'check' && fail.notes).toMatch(/docs\/brand\.md.*Designer’s context/)
    const ask = p.events.find((e) => e.type === 'ask' && e.id === BRAND_ASK)
    expect(ask && ask.type === 'ask' && ask.suggested).toBe(BRAND_FIX)
  })

  it('adding the guide from the ask puts it in the Designer’s context, and the widget passes', () => {
    const p = atBrandAsk()
    store.answer(BRAND_ASK, BRAND_FIX)
    expect(designerSees(p)).toContain('docs/brand.md')
    expect(brandCheck(p, false)).toBeTruthy() // the failure stays in the past
    const s = reduce(p.events, Infinity)
    expect(s.tasks.find((t) => t.id === 'chat-widget')!.status).toBe('accepted')
  })

  it('adding the guide on the Designer’s page answers the ask', () => {
    const p = atBrandAsk()
    store.editKit(p.id, 'designer', (e) => (e.contextAdd = [...e.contextAdd, 'docs/brand.md']))
    expect(store.viewerAnswers[BRAND_ASK]).toBe(BRAND_FIX)
    expect(brandCheck(p, false)).toBeTruthy()
  })

  it('with the guide in its context from the start, nothing fails for it', () => {
    const p = store.newProject(SAMPLE_GOAL)
    const plan = simulatePlan(SAMPLE_GOAL)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.editKit(p.id, 'designer', (e) => (e.contextAdd = ['docs/brand.md']))
    store.approve(p.id)
    store.pause()
    expect(brandCheck(p, false)).toBeUndefined()
    expect(p.events.some((e) => e.type === 'ask' && e.id === BRAND_ASK)).toBe(false)
  })
})
