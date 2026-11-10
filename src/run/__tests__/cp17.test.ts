import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { pendingAsk } from '../reduce'
import { readAnswerWhy, store, type Project } from '../store'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

describe('checkpoint 17: a model change mid-run', () => {
  it('Stripe, Builder to Opus at the disagreement ask, then answer: the limit ask shows before any overspend', () => {
    const goal = 'Stripe checkout for our pricing page'
    const p = store.newProject(goal)
    const plan = simulatePlan(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    store.open(p.id)
    store.pause()
    let dis = null as null | { id: string; suggested: string; t: number }
    for (let i = 0; i < 10; i++) {
      const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
      if (!a || a.type !== 'ask') break
      p.clock = a.t
      if (a.reason === 'disagree') {
        dis = a
        break
      }
      store.answer(a.id, a.suggested)
    }
    expect(dis).not.toBeNull()
    store.editKit(p.id, 'builder', (e) => {
      e.model = 'Claude Opus 5.5'
    })
    const d = p.events.find((e) => e.type === 'ask' && e.reason === 'disagree')!
    if (d.type !== 'ask') throw new Error()
    store.answer(d.id, d.suggested)
    // Every ask before the clock has been answered, or is the one open now.
    const open = pendingAsk(p.events, p.clock!, p.answers ?? {})
    const skipped = p.events.filter((e) => e.type === 'ask' && e.t < p.clock! && !(p.answers ?? {})[e.id] && e.id !== open)
    expect(skipped).toEqual([])
    // Played to the end with the suggestion each time, no farmer ends over a limit without an ask.
    for (let i = 0; i < 20; i++) {
      const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
      if (!a || a.type !== 'ask') break
      p.clock = Math.max(p.clock!, a.t)
      store.answer(a.id, a.suggested)
    }
    const s = store.state(p)!
    const lim = p.events.filter((e) => e.type === 'ask' && e.limitFor === 'builder')
    const builder = s.farmers.builder!
    const limitUsd = p.events.find((e) => e.type === 'farmer' && e.id === 'builder')
    if (limitUsd?.type === 'farmer' && limitUsd.limits?.usd && builder.usd > limitUsd.limits.usd) expect(lim.length).toBeGreaterThan(0)
    for (const a of lim) if (a.type === 'ask') expect((p.answers ?? {})[a.id]).toBeDefined()
  })
})

describe('checkpoint 17: free text', () => {
  const cost = ['Split it in two', 'Raise its limit to $29', 'Stop it here']
  const why = (t: string, opts = cost, sides: Record<string, string> = {}) => readAnswerWhy(t, opts[0], opts, sides)
  it('every apostrophe-like character reads as a no', () => {
    for (const t of ['don´t split it', 'don`t split it', 'don’t split it', 'donʼt split it', 'shan’t split it', "shan't", 'dosnt need a split'])
      expect(why(t)).toEqual({ none: 'no' })
  })
  it('avoid, reject and a bad idea are a no', () => {
    for (const t of ['avoid splitting', 'reject the split', 'splitting is a bad idea']) expect(why(t)).toEqual({ none: 'no' })
  })
  it('an amount that is one option’s amount picks it', () => {
    expect(why('$29 is fine')).toEqual({ choice: 'Raise its limit to $29' })
  })
  it('go with the builder picks the Builder’s way', () => {
    const opts = ['Keep the card layout', 'Use a plain list']
    const sides = { designer: opts[0], builder: opts[1] }
    expect(why('go with the builder', opts, sides)).toEqual({ choice: 'Use a plain list' })
    expect(why('go with the designer', opts, sides)).toEqual({ choice: 'Keep the card layout' })
  })
  it('an option’s own words pick it, and short yeses are not questions', () => {
    expect(why('Fix it', ['Fix it', 'Show me the failures', 'Stop this task'])).toEqual({ choice: 'Fix it' })
    expect(why('Leave it rolled back', ['Fix it', 'Leave it rolled back'])).toEqual({ choice: 'Leave it rolled back' })
    expect(why('no refactor', ['Go ahead, test everything', 'Keep it small, no refactor'])).toEqual({ choice: 'Keep it small, no refactor' })
    for (const t of ['do it', 'Can do', 'Is fine']) expect(why(t)).toEqual({ choice: 'Split it in two' })
    expect(why("don't stop it")).toEqual({ none: 'no' })
  })
  it('any pick that isn’t the suggestion is confirmed first', () => {
    const goal = 'Stripe checkout for our pricing page'
    const p = store.newProject(goal)
    const plan = simulatePlan(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    store.open(p.id)
    store.pause()
    const d = p.events.find((e) => e.type === 'ask' && e.reason === 'disagree')
    if (!d || d.type !== 'ask') throw new Error()
    p.clock = d.t
    const r = store.answerInWords(d.id, 'go with the builder')
    expect(r).toEqual({ kind: 'confirm', choice: d.alternatives![0] })
    expect((p.answers ?? {})[d.id]).toBeUndefined()
  })
})

describe('checkpoint 17: every run is its own', () => {
  it('a second run of the sample shows its rollback again', () => {
    store.loadSample()
    const p = store.projects.find((x) => x.kind === 'sample')!
    store.open(p.id)
    store.pause()
    const rb = p.events.find((e) => e.type === 'deploy' && e.stage === 'rollback')!
    store.seen.add(`${p.id}:${rb.t}`)
    store.runAgain()
    store.pause()
    p.clock = rb.t + 10
    expect(store.openRollback(p)).toBe(true)
  })
  it('after a model change mid-run, Done adds up to what Spend shows, and the limit ask counts the same money', () => {
    const goal = 'Stripe checkout for our pricing page'
    const p = store.newProject(goal)
    const plan = simulatePlan(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    store.open(p.id)
    store.pause()
    const first = p.events.find((e) => e.type === 'ask')!
    p.clock = first.t
    store.answer(first.id, first.type === 'ask' ? first.suggested : '')
    p.clock = p.clock! + 4 * 60_000
    store.editKit(p.id, 'builder', (e) => {
      e.model = 'Claude Opus 5.5'
    })
    for (let i = 0; i < 20; i++) {
      const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
      if (!a || a.type !== 'ask') break
      p.clock = Math.max(p.clock!, a.t)
      if (a.limitFor === 'builder') {
        const s = store.state(p)!
        const m = a.question.match(/with \$(\d+(\.\d+)?) spent/)
        if (m) expect(Math.abs(Number(m[1]) - s.farmers.builder!.usd)).toBeLessThan(1.5)
      }
      store.answer(a.id, a.suggested)
    }
    const s = store.state(p)!
    const d = p.events.find((e) => e.type === 'done')!
    const sum = p.events.reduce((n, e) => n + (e.type === 'usage' ? e.usd : 0), 0)
    expect(d.type === 'done' && Math.abs(d.usd - sum)).toBeLessThan(0.02)
    expect(s.usage.usd).toBeGreaterThan(0)
  })
})

describe('checkpoint 18: what already happened stays', () => {
  const setup = () => {
    const goal = 'Stripe checkout for our pricing page'
    const p = store.newProject(goal)
    const plan = simulatePlan(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    store.open(p.id)
    store.pause()
    return p
  }
  // Plays to the next unanswered ask, the way the clock does.
  const next = (p: Project) => {
    const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
    if (a && a.type === 'ask') p.clock = Math.max(p.clock!, a.t)
    return a && a.type === 'ask' ? a : null
  }
  const spentAt = (p: Project, t: number) => +p.events.reduce((n, e) => n + (e.type === 'usage' && e.t <= t ? e.usd : 0), 0).toFixed(2)
  const lowerLimit = (p: Project) => {
    // A limit low enough that the Builder asks mid-run.
    store.editKit(p.id, 'builder', (e) => {
      e.limits = { minutes: 999, ...e.limits, usd: 25 }
    })
  }

  it('Builder to Opus while its limit ask is open: the ask stays, spend so far stays, and a raise is never rewritten', () => {
    const p = setup()
    lowerLimit(p)
    store.startRun(p)
    store.pause()
    let lim = null as ReturnType<typeof next>
    for (let i = 0; i < 12; i++) {
      const a = next(p)
      if (!a) break
      if (a.limitFor === 'builder') {
        lim = a
        break
      }
      store.answer(a.id, a.suggested)
    }
    expect(lim).not.toBeNull()
    const before = spentAt(p, p.clock!)
    const q = lim!.question
    store.editKit(p.id, 'builder', (e) => {
      e.model = 'Claude Opus 5.5'
    })
    // Still open, with the same words, and the money so far is what it was.
    expect(pendingAsk(p.events, p.clock!, p.answers ?? {})).toBe(lim!.id)
    expect((p.events.find((e) => e.type === 'ask' && e.id === lim!.id) as { question: string }).question).toBe(q)
    expect(spentAt(p, p.clock!)).toBe(before)
    store.answer(lim!.id, lim!.suggested)
    const approved = Number(/\$(\d+)/.exec(lim!.suggested)![1])
    // Played out: the Builder never ends over a limit it wasn't asked about.
    for (let i = 0; i < 20; i++) {
      const a = next(p)
      if (!a) break
      store.answer(a.id, a.suggested)
    }
    const s = store.state(p)!
    const b = s.farmers.builder!
    const raises = s.asks.filter((a) => a.limitFor === 'builder' && a.answer && /^raise/i.test(a.answer.choice))
    const top = Math.max(approved, ...raises.map((a) => Number(/\$(\d+)/.exec(a.answer!.choice)![1])))
    expect(b.usd).toBeLessThanOrEqual(top + 0.5)
    expect(raises[0].limitTo).toBe(approved)
  })

  it('a lower limit mid-run asks now, and never reprices the money spent', () => {
    const p = setup()
    const a = next(p)!
    store.answer(a.id, a.suggested)
    p.clock = p.clock! + 6 * 60_000
    const before = spentAt(p, p.clock!)
    store.editKit(p.id, 'builder', (e) => {
      e.limits = { minutes: 999, ...e.limits, usd: 5 }
    })
    expect(spentAt(p, p.clock!)).toBe(before)
    const open = p.events.find((e) => e.type === 'ask' && e.limitFor === 'builder' && !(p.answers ?? {})[e.id])
    expect(open && open.t).toBeGreaterThanOrEqual(p.clock!)
  })
})

describe('checkpoint 18: free text', () => {
  const cost = ['Split it in two', 'Raise its limit to $29', 'Stop it here']
  const why = (t: string, opts = cost, sides: Record<string, string> = {}) => readAnswerWhy(t, opts[0], opts, sides)
  it('refusal verbs are a no', () => {
    for (const v of ['skip', 'drop', 'forget', 'decline', 'veto', 'scrap', 'nix', 'ditch', 'pass on']) expect(why(`${v} the split`)).toEqual({ none: 'no' })
  })
  it('a number of parts no option has asks again', () => {
    expect(why('split it in three')).toEqual({ none: 'unclear' })
    expect(why('split it in two')).toEqual({ choice: 'Split it in two' })
  })
  it('naming who is wrong takes the other side', () => {
    const opts = ['Ask before checkout', 'Slim strip on top']
    const sides = { designer: opts[0], builder: opts[1] }
    for (const t of ['the designer is wrong', 'overrule the designer', 'not the designer']) expect(why(t, opts, sides)).toEqual({ choice: 'Slim strip on top' })
    expect(why('the builder is wrong', opts, sides)).toEqual({ choice: 'Ask before checkout' })
  })
  it("can't agree is a no, not a question", () => {
    expect(why("can't agree")).toEqual({ none: 'no' })
  })
  it('every free-text pick is confirmed, the suggestion too', () => {
    const goal = 'A dashboard of weekly signups'
    const p = store.newProject(goal)
    const plan = simulatePlan(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    store.open(p.id)
    store.pause()
    const a = p.events.find((e) => e.type === 'ask')!
    if (a.type !== 'ask') throw new Error()
    p.clock = a.t
    expect(store.answerInWords(a.id, 'yes')).toEqual({ kind: 'confirm', choice: a.suggested })
    expect((p.answers ?? {})[a.id]).toBeUndefined()
  })
})
