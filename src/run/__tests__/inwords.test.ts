// Answers in your own words: a refusal is never read as a yes, and every pick is said back before it applies.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, readAnswerWhy, store } from '../store'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const cost = ['Split it in two', 'Raise its limit to $29', 'Stop it here']
const why = (t: string, opts = cost, sides: Record<string, string> = {}) => readAnswerWhy(t, opts[0], opts, sides)
const VERBS = ['skip', 'drop', 'forget', 'decline', 'veto', 'scrap', 'nix', 'ditch', 'overrule']

describe('refusals', () => {
  it('every refusal verb is a no, never the option it names', () => {
    for (const v of VERBS) {
      expect(why(`${v} the split`)).toEqual({ none: 'no' })
      expect(why(`${v.charAt(0).toUpperCase()}${v.slice(1)} it.`)).toEqual({ none: 'no' })
      expect(why(`let's ${v} the raise`)).toEqual({ none: 'no' })
    }
  })
  it('"is wrong" is a no', () => {
    expect(why('the split is wrong')).toEqual({ none: 'no' })
    expect(why('raising it is wrong')).toEqual({ none: 'no' })
    expect(why('both options are wrong')).toEqual({ none: 'no' })
  })
  it('a refusal holds where the ask can hold', () => {
    const ship = ['Merge and ship to 10%', 'Ship to everyone', 'Not yet']
    for (const v of VERBS) expect(why(`${v} the merge`, ship)).toEqual({ choice: 'Not yet' })
  })
  it('naming who is wrong, or who to overrule, takes the other side', () => {
    const opts = ['Ask before checkout', 'Slim strip on top']
    const sides = { designer: opts[0], builder: opts[1] }
    expect(why('the designer is wrong', opts, sides)).toEqual({ choice: 'Slim strip on top' })
    expect(why('overrule the builder', opts, sides)).toEqual({ choice: 'Ask before checkout' })
    expect(why('veto the designer', opts, sides)).toEqual({ choice: 'Slim strip on top' })
  })
  it('plain yeses still read as the suggestion', () => {
    for (const t of ['yes', 'go ahead', 'sounds good', 'split it']) expect(why(t)).toEqual({ choice: 'Split it in two' })
  })
})

describe('every free-text pick is confirmed', () => {
  it('on every ask of the sample, the suggestion and each option typed out are said back, and nothing applies until Yes', () => {
    const p = store.newProject(SAMPLE_GOAL)
    const plan = simulatePlan(SAMPLE_GOAL)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    store.pause()
    let asks = 0
    for (let i = 0; i < 12; i++) {
      const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
      if (!a || a.type !== 'ask') break
      p.clock = Math.max(p.clock!, a.t)
      asks++
      for (const text of ['yes', a.suggested]) {
        const r = store.answerInWords(a.id, text)
        expect(r.kind === 'confirm' || r.kind === 'discuss').toBe(true)
        if (r.kind === 'confirm') expect(r.choice).toBe(a.suggested)
      }
      for (const alt of (a.alternatives ?? []).filter((o) => !/^not yet|^show me|^send back/i.test(o))) {
        const r = store.answerInWords(a.id, alt)
        expect(r).toMatchObject({ kind: 'confirm', choice: alt })
      }
      expect((p.answers ?? {})[a.id]).toBeUndefined()
      store.confirmInWords(a.id, 'yes', a.suggested)
      expect((p.answers ?? {})[a.id]).toBe(a.suggested)
    }
    expect(asks).toBeGreaterThan(2)
  })
})
