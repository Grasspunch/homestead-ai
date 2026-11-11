import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { simulateRun } from '../simulate'
import { reduce } from '../reduce'
import { discussSim, intentOf, ownWayOf, OWN } from '../discuss'
import { discuss } from '../agent'
import { store } from '../store'
import { AUTONOMY_PRESETS } from '../types'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const GOAL = 'Stripe checkout for our pricing page'

// A farm paused at its disagreement ask.
function atDisagreement() {
  const p = store.newProject(GOAL)
  const plan = simulatePlan(GOAL)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.open(p.id)
  store.pause()
  const d = p.events.find((e) => e.type === 'ask' && e.reason === 'disagree')
  if (!d || d.type !== 'ask' || !d.talk) throw new Error('no disagreement')
  p.clock = d.t
  return { p, d, talk: d.talk }
}

describe('a disagreement carries what talking it through needs', () => {
  it('both sides, their options, and what each way costs', () => {
    const { d, talk } = atDisagreement()
    expect(talk.sides.map((s) => [s.farmer, s.option])).toEqual([
      ['designer', d.suggested],
      ['builder', d.alternatives![0]],
    ])
    expect(talk.ownUsd).toBeGreaterThan(talk.usd)
    expect(talk.ownMinutes).toBeGreaterThan(talk.minutes)
    expect(talk.checker).not.toBe('designer')
  })
})

describe('asking about a disagreement', () => {
  it('reads the intent: why, cost, time, compare, both', () => {
    expect(intentOf('why does the builder want that?')).toBe('why')
    expect(intentOf('what does each cost?')).toBe('cost')
    expect(intentOf('how long would it take?')).toBe('time')
    expect(intentOf('which is better for buyers?')).toBe('compare')
    expect(intentOf('tell me about both')).toBe('both')
    expect(intentOf('hmm')).toBeNull()
  })
  it('a question keeps the ask open, and the side it names answers', async () => {
    const { p, d, talk } = atDisagreement()
    const r = store.answerInWords(d.id, 'why does the builder want a strip?')
    expect(r).toEqual({ kind: 'discuss' })
    const a = await discuss('why does the builder want a strip?', talk, () => undefined)
    expect(a.live).toBe(false)
    expect(a.data).toHaveLength(1)
    expect(a.data[0].from).toBe('builder')
    expect(a.data[0].text).toBe(talk.sides[1].why.split(/(?<=\.)\s/)[0])
    store.talkOn(d.id, 'why does the builder want a strip?', a.data)
    expect(p.talks?.[d.id]?.map((l) => l.from)).toEqual(['you', 'builder'])
    expect((p.answers ?? {})[d.id]).toBeUndefined()
  })
  it('cost and time answer once, with your own way beside them', () => {
    const { talk } = atDisagreement()
    const cost = discussSim('what does it cost?', talk)
    expect(cost).toHaveLength(1)
    expect(cost[0].text).toContain(`$${talk.usd.toFixed(2)}`)
    expect(cost[0].text).toContain(`$${talk.ownUsd.toFixed(2)}`)
    expect(discussSim('how long?', talk)[0].text).toMatch(/takes about \d+ min/)
  })
  it('a question it can’t place restates both sides', () => {
    const { talk } = atDisagreement()
    const lines = discussSim('hmm, not sure', talk)
    expect(lines.map((l) => l.from)).toEqual(['designer', 'builder'])
    expect(lines[0].text.startsWith(talk.sides[0].position)).toBe(true)
  })
})

describe('your own way', () => {
  it('reads a suggestion, but not a pick of a side or a question about one', () => {
    const { talk } = atDisagreement()
    expect(ownWayOf('what about a small banner in the footer?', talk.sides)).toBe('a small banner in the footer')
    expect(ownWayOf("let's put the notice in the page header", talk.sides)).toBe('put the notice in the page header')
    expect(ownWayOf('how about the builder’s way', talk.sides)).toBeNull()
    expect(ownWayOf('can we afford the slim strip?', talk.sides)).toBeNull()
  })
  it('the Planner confirms first, and nothing changes until you say yes', () => {
    const { p, d } = atDisagreement()
    const r = store.answerInWords(d.id, 'what about a small banner in the footer?')
    expect(r).toEqual({ kind: 'confirm', choice: `${OWN}a small banner in the footer`, ask: 'Go with your way: a small banner in the footer? The Designer builds it and the Tester checks it.' })
    expect((p.answers ?? {})[d.id]).toBeUndefined()
  })
  it('on yes the run branches: the Designer reworks it at a retry cost, another farmer checks it, and it’s a commit', () => {
    const { p, d } = atDisagreement()
    store.confirmInWords(d.id, 'what about a small banner in the footer?', `${OWN}a small banner in the footer`)
    expect(p.answers?.[d.id]).toBe(`${OWN}a small banner in the footer`)
    const ev = p.events
    const after = ev.filter((e) => e.t > d.t && 'task' in e && e.task === d.task)
    const tool = after.find((e) => e.type === 'tool')
    expect(tool && tool.type === 'tool' && [tool.farmer, tool.summary]).toEqual(['designer', 'Building your way: a small banner in the footer'])
    expect(after.some((e) => e.type === 'usage' && e.farmer === 'designer' && e.kind === 'retry')).toBe(true)
    const check = after.find((e) => e.type === 'check')
    expect(check && check.type === 'check' && check.by).toBe(d.talk!.checker)
    expect(check && check.type === 'check' && check.by).not.toBe('designer')
    const ripe = after.find((e) => e.type === 'task_ripe')
    expect(ripe && ripe.type === 'task_ripe' && ripe.change).toBe('Your way: a small banner in the footer')
    // The decisions log shows it, and the chat says how it was read.
    const s = reduce(ev, Number.MAX_SAFE_INTEGER, p.answers ?? {})
    expect(s.asks.find((a) => a.id === d.id)?.answer?.choice).toBe('Your way: a small banner in the footer')
    expect(store.chat[p.id]?.slice(-1)[0]?.text).toBe('Going with your way: a small banner in the footer. Ask me to change it any time.')
  })
  it('the branch is deterministic, like a send-back', () => {
    const plan = simulatePlan(GOAL)
    const base = { goal: GOAL, ...plan, autonomy: AUTONOMY_PRESETS.often }
    const id = simulateRun(base).find((e) => e.type === 'ask' && e.reason === 'disagree')!
    const choices = { [(id as { id: string }).id]: `${OWN}a banner` }
    expect(JSON.stringify(simulateRun({ ...base, choices }))).toBe(JSON.stringify(simulateRun({ ...base, choices })))
    const doneOwn = simulateRun({ ...base, choices }).find((e) => e.type === 'done')
    const doneBase = simulateRun(base).find((e) => e.type === 'done')
    expect(doneOwn && doneBase && doneOwn.type === 'done' && doneBase.type === 'done' && doneOwn.usd > doneBase.usd).toBe(true)
  })
  it('a no still reads as a no, not a way of your own', () => {
    const { d } = atDisagreement()
    expect(store.answerInWords(d.id, "no, I'd rather not do either")).toMatchObject({ kind: 'none', why: 'no' })
    expect(store.answerInWords(d.id, 'not the designer’s way')).toEqual({ kind: 'confirm', choice: d.alternatives![0] })
  })
})
