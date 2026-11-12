import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { simulatePlan } from '../simPlan'
import { store } from '../store'
import { SEND_BACK } from '../simulate'
import { askTalkSim, ownWayIn, plainPick, sidesCanAnswer, taskFor } from '../askTalk'
import { setLiveMode, talkAsk } from '../agent'
import { resetLiveProbe } from '../live'
import type { AskTalkIn } from '../talk'
import type { AskReason } from '../types'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetLiveProbe()
})

const GOAL = 'Stripe checkout for our pricing page'

// Every ask the sample project meets, as the ask card hands it to the talk.
function asks() {
  const p = store.newProject(GOAL)
  const plan = simulatePlan(GOAL)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.open(p.id)
  store.pause()
  const out: Partial<Record<AskReason, AskTalkIn['ask']>> = {}
  for (const e of p.events) {
    if (e.type !== 'ask' || out[e.reason]) continue
    const alts = e.alternatives ?? []
    out[e.reason] = {
      id: e.id,
      farmer: e.farmer,
      farmerLabel: e.farmer,
      reason: e.reason,
      question: e.question,
      impact: e.impact,
      basis: e.basis,
      confidence: e.confidence,
      suggested: e.suggested,
      options: [e.suggested, ...alts].filter((o) => !/^show me/i.test(o) && o !== SEND_BACK),
      canSendBack: alts.includes(SEND_BACK),
      ...(e.talk ? { sides: e.talk.sides } : {}),
    }
  }
  return { p, pr: out.irreversible!, cost: out.cost!, big: out.big!, dis: out.disagree! }
}
const say = (ask: AskTalkIn['ask'], message: string) => askTalkSim({ ask, history: [], message })
const CANNED = /sounds like a question|isn’t one of these options|Which of these instead/

describe('talking an ask through, without a model', () => {
  it('the adversarial review on the pull request is sent back with your words, not refused as a question', () => {
    const { pr } = asks()
    const r = say(pr, 'can we put it through an adversarial agentic review')
    expect(r.sendBack).toMatch(/adversarial agentic review/i)
    expect(r.choice).toBeNull()
    expect(r.reply).not.toMatch(CANNED)
  })
  it('more tests first, or a fix the review found, goes back too', () => {
    const { pr } = asks()
    expect(say(pr, 'can we run more tests first?').sendBack).toMatch(/run more tests first/i)
    expect(say(pr, 'yes but run the tests again first').sendBack).toMatch(/run the tests again/i)
    expect(say(pr, 'send it back to the builder, the button colour is wrong').sendBack).toMatch(/button colour/)
  })
  it('elsewhere a review can’t be added, and it says so without picking', () => {
    const { cost, dis } = asks()
    for (const a of [cost, dis]) {
      const r = say(a, 'can we put it through an adversarial agentic review')
      expect(r.choice).toBeNull()
      expect(r.sendBack).toBeNull()
      expect(r.reply).toMatch(/Planner/)
    }
  })
  it('answers why it needs more money from the ask itself', () => {
    const { cost } = asks()
    const r = say(cost, 'why do you need more money?')
    expect(r.choice).toBeNull()
    expect(r.reply).toContain(cost.question.split(/(?<=\.)\s/)[0])
    expect(r.reply).not.toMatch(CANNED)
  })
  it('a yes with a condition is never picked as the plain option', () => {
    const { cost, pr } = asks()
    const r = say(cost, 'yes but cap it at $20')
    expect(r.choice).toBeNull()
    expect(r.reply).toContain('$20')
    const m = say(pr, 'merge it but only to staging')
    expect(m.choice).toBeNull()
    expect(m.reply).toMatch(/staging/)
  })
  it('an amount no option has is not rounded to one', () => {
    const { cost } = asks()
    expect(say(cost, 'raise it to $30').choice).toBeNull()
    expect(say(cost, 'split it in three').choice).toBeNull()
  })
  it('waiting holds, whatever the ask', () => {
    const { pr, cost, big, dis } = asks()
    for (const a of [pr, cost, big, dis]) expect(say(a, 'not yet, let me think')).toMatchObject({ hold: true, choice: null, sendBack: null })
    expect(say(cost, 'let’s wait until monday').hold).toBe(true)
  })
  it('a question about an option is answered, not read as a pick', () => {
    const { big } = asks()
    const r = say(big, 'tell me more about the refactor')
    expect(r.choice).toBeNull()
    expect(r.hold).toBe(false)
    expect(r.reply.length).toBeGreaterThan(20)
  })
  it('go ahead but don’t refactor reads the refusing option, not a hold', () => {
    const { big } = asks()
    const r = say(big, "go ahead but don't refactor billing")
    expect(r.hold).toBe(false)
    expect(r.choice).toBe('Keep it small, no refactor')
  })
  it('rejecting every option says what each does and leaves the way open', () => {
    const { cost } = asks()
    const r = say(cost, 'I don’t like either')
    expect(r).toMatchObject({ choice: null, sendBack: null, hold: false })
    expect(r.reply).toMatch(/hold this|what you want/)
    expect(say(cost, 'dont stop it').reply).toMatch(/not “Stop it here”/)
  })
  it('skipping the review on the pull request ships nothing by itself', () => {
    const { pr } = asks()
    const r = say(pr, 'skip the review, just ship')
    expect(r).toMatchObject({ choice: null, sendBack: null, hold: false })
  })
  it('a disagreement answers from both sides and doesn’t repeat itself on “I changed my mind”', () => {
    const { dis } = asks()
    expect(say(dis, 'is that safe?').reply).toMatch(/Designer|Builder/)
    expect(say(dis, 'I changed my mind').reply).toMatch(/nothing is decided/)
    expect(say(dis, 'not the designer’s way').choice).toBe(dis.sides![1].option)
  })
  it('replies stay short and use the new words', () => {
    const { pr, cost, big, dis } = asks()
    for (const a of [pr, cost, big, dis])
      for (const m of ['why?', 'what does it cost?', 'whats the risk', 'I don’t like either', 'ok go with the cheaper model', 'hmm']) {
        const r = say(a, m)
        expect(r.reply.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3)
        expect(r.reply).not.toMatch(/\b(farm|farmer|crew)\b/i)
      }
  })
})

describe('the fast path only takes a plain pick', () => {
  const cost = ['Split it in two', 'Raise its limit to $29', 'Stop it here']
  const pr = ['Merge and ship to 10%', 'Ship to everyone', 'Not yet']
  const big = ['Go ahead, test everything', 'Keep it small, no refactor']
  it('takes an option’s words, a plain yes, or a naming', () => {
    expect(plainPick('yes', cost)).toBe(true)
    expect(plainPick('stop it', cost)).toBe(true)
    expect(plainPick('raise it to $29', cost)).toBe(true)
    expect(plainPick('Not yet', pr)).toBe(true)
    expect(plainPick('keep it small, no refactor', big)).toBe(true)
    expect(plainPick('go with the builder', ['Ask before checkout', 'Slim strip on top'], ['Designer', 'Builder'])).toBe(true)
  })
  it('sends conditions, questions, refusals and anything extra to the talk', () => {
    for (const t of ['yes but run the tests again first', 'go ahead but don’t refactor billing', 'yes but cap it at $20', 'can we run more tests first?', 'why do you need more money?', 'ok go with the cheaper model', 'dont stop it', 'no', 'not yet, let me think', 'I don’t like either'])
      expect(plainPick(t, cost.includes(t) ? cost : [...cost, ...big])).toBe(false)
    expect(plainPick('merge it but only to staging', pr)).toBe(false)
    expect(plainPick('skip the review, just ship', pr)).toBe(false)
  })
})

describe('disagreements', () => {
  const sides = [
    { farmer: 'designer' as const, label: 'Designer', position: 'Ask before checkout', why: 'It covers the pay button.', option: 'Ask before checkout' },
    { farmer: 'builder' as const, label: 'Builder', position: 'A slim strip on top', why: 'Consent shows where the card is entered.', option: 'Slim strip on top' },
  ]
  it('a way of your own past a no is still your way; a review is not a way', () => {
    expect(ownWayIn('no, put it in the footer', { sides })).toMatch(/footer/)
    expect(ownWayIn('can we put it through an adversarial agentic review', { sides })).toBeNull()
    expect(ownWayIn('let’s run more tests first', { sides })).toBeNull()
  })
  it('only plain questions the sides can answer go to them', () => {
    expect(sidesCanAnswer('why does the builder want a strip?')).toBe(true)
    expect(sidesCanAnswer('is that safe?')).toBe(false)
    expect(sidesCanAnswer('which is cheaper, but only if we ship today?')).toBe(false)
  })
})

describe('sending back to the right task', () => {
  const tasks = [
    { id: 'a', name: 'Pricing page layout', farmer: 'designer', label: 'Designer' },
    { id: 'b', name: 'Checkout button', farmer: 'builder', label: 'Builder' },
    { id: 'c', name: 'Payment webhooks', farmer: 'builder', label: 'Builder' },
  ]
  it('the task the note names, else the agent it names, else the ask’s task', () => {
    expect(taskFor('the checkout button colour is wrong', tasks)).toBe('b')
    expect(taskFor('send it back to the designer', tasks)).toBe('a')
    expect(taskFor('run more tests first', tasks, 'c')).toBe('c')
    expect(taskFor('run more tests first', tasks)).toBe('a')
  })
})

describe('talkAsk', () => {
  it('falls back to the script when no model can answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const { pr } = asks()
    const inp = { ask: pr, history: [], message: 'can we put it through an adversarial agentic review' }
    const r = await talkAsk(inp)
    expect(r.live).toBe(false)
    expect(r.data).toEqual(askTalkSim(inp))
  })
  it('a model’s reply is checked: no made-up option, no send-back where work can’t go back', async () => {
    setLiveMode(true)
    onTestFinished(() => setLiveMode(false))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ data: { reply: 'Sure.', choice: 'Ship it to Mars', sendBack: 'redo it', hold: false }, tokens: 10 }))
          : new Response(JSON.stringify({ live: true, keys: { anthropic: true, openai: true } })),
      ),
    )
    const { cost } = asks()
    const r = await talkAsk({ ask: cost, history: [], message: 'ship it to mars' })
    expect(r.live).toBe(true)
    expect(r.data).toMatchObject({ reply: 'Sure.', choice: null, sendBack: null })
  })
})
