// Checkpoint 18: a change mid-run (a model, a limit) never rewrites what already happened.
// A sweep over goals, moments and changes, each checked against the run as it was watched.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { pendingAsk } from '../reduce'
import { MODELS } from '../kit'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { FARMER_ORDER, type FarmerId, type RunEvent } from '../types'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const GOALS = [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A dashboard of weekly signups', 'A tool that drafts replies to app store reviews']
const head = (e: RunEvent) => e.type === 'goal' || e.type === 'plan' || e.type === 'farmer' || e.type === 'reshape' || e.type === 'done'
const pastOf = (p: Project) => JSON.stringify(p.events.filter((e) => e.t <= p.clock! && !head(e)))
const spentBy = (p: Project, f: FarmerId, t = Infinity) => p.events.reduce((n, e) => n + (e.type === 'usage' && e.farmer === f && e.t <= t ? e.usd : 0), 0)

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

// Plays to the k-th ask and leaves it open, or stops a minute before it.
function playTo(p: Project, k: number, between: boolean) {
  for (let i = 0; i <= k; i++) {
    const a = nextAsk(p)
    if (!a) return false
    if (i === k) {
      p.clock = between ? Math.max(p.clock!, a.t - 60_000) : Math.max(p.clock!, a.t)
      return true
    }
    p.clock = Math.max(p.clock!, a.t)
    store.answer(a.id, a.suggested)
  }
  return false
}

// Answers every ask with its suggestion, to the end.
function finish(p: Project) {
  for (let i = 0; i < 30; i++) {
    const a = nextAsk(p)
    if (!a) break
    p.clock = Math.max(p.clock!, a.t)
    store.answer(a.id, a.suggested)
  }
  p.clock = p.events[p.events.length - 1].t
}

// The limit a farmer ended on: the plan's or yours, then every raise you approved or the lead made.
function limitAtEnd(p: Project, f: FarmerId) {
  const s = store.state(p)!
  let lim = s.farmers[f]!.limits.usd
  for (const e of p.events) {
    if (e.type === 'answer') {
      const a = p.events.find((x) => x.type === 'ask' && x.id === e.id)
      const m = a && a.type === 'ask' && a.limitFor === f ? /\$(\d+(\.\d+)?)/.exec(e.choice) : null
      if (m) lim = Number(m[1])
    }
    if (e.type === 'auto_fix') {
      const m = /^The (\w+) reached its .* raised it to \$(\d+)/.exec(e.what)
      if (m && m[1] === s.farmers[f]!.label) lim = Number(m[2])
    }
  }
  return lim
}

type Change = { name: string; apply: (p: Project) => void }
const changes: Change[] = []
for (const farmer of ['builder', 'planner', 'designer'] as FarmerId[]) {
  for (const m of MODELS) changes.push({ name: `${farmer} to ${m.model}`, apply: (p) => store.editKit(p.id, farmer, (e) => void (e.model = m.model)) })
  for (const usd of [5, 15]) changes.push({ name: `${farmer} limit to $${usd}`, apply: (p) => store.editKit(p.id, farmer, (e) => void (e.limits = { minutes: 999, usd })) })
}

describe('checkpoint 18: a change mid-run keeps the past', () => {
  for (const goal of GOALS) {
    it(`${goal.slice(0, 32)}: every model or limit change, at every moment`, () => {
      const fails: string[] = []
      let n = 0
      for (let k = 0; k < 4; k++) {
        for (const between of [false, true]) {
          for (const c of changes) {
            const p = farm(goal)
            if (!playTo(p, k, between)) {
              store.projects = store.projects.filter((x) => x.id !== p.id)
              continue
            }
            n++
            const where = `${c.name} at ${between ? 'a minute before ' : ''}ask ${k + 1}`
            const before = pastOf(p)
            const spentThen = Object.fromEntries(FARMER_ORDER.map((f) => [f, spentBy(p, f, p.clock!)]))
            const open = pendingAsk(p.events, p.clock!, p.answers ?? {})
            const words = (id: string) => (p.events.find((e) => e.type === 'ask' && e.id === id) as { question: string } | undefined)?.question
            const q = open && words(open)
            c.apply(p)
            // Critical: the ask on screen stays on screen, with its words.
            if (open && pendingAsk(p.events, p.clock!, p.answers ?? {}) !== open) fails.push(`${where}: the open ask vanished`)
            if (open && words(open) !== q) fails.push(`${where}: the open ask changed its words`)
            // High 2: money spent, and everything else up to now, is as it was.
            if (pastOf(p) !== before) fails.push(`${where}: the past changed`)
            finish(p)
            // High 3, and the Critical's end: no farmer spends past a limit it wasn't asked about. (A limit you set
            // below what a farmer had already spent, with nothing more for it to do, is only the past.)
            const s = store.state(p)!
            for (const f of FARMER_ORDER) {
              if (!s.farmers[f] || s.tasks.some((t) => t.farmer === f && t.stopped)) continue
              const over = spentBy(p, f) - limitAtEnd(p, f)
              if (over > 0.5 && spentBy(p, f) - spentThen[f] > 0.01) fails.push(`${where}: ${f} ends $${over.toFixed(2)} over its limit`)
            }
            const d = p.events.find((e) => e.type === 'done')
            const sum = p.events.reduce((m, e) => m + (e.type === 'usage' ? e.usd : 0), 0)
            if (!d || d.type !== 'done' || Math.abs(d.usd - sum) > 0.02) fails.push(`${where}: Done is not what Spend adds up to`)
            store.projects = store.projects.filter((x) => x.id !== p.id)
          }
        }
      }
      expect(n).toBeGreaterThan(50)
      expect(fails.slice(0, 15)).toEqual([])
    })
  }
})

describe('checkpoint 18, step by step', () => {
  // Stripe with the Builder on a $25 limit, answered with the suggestion until its limit ask is open.
  const toLimitAsk = () => {
    const p = farm('Stripe checkout for our pricing page')
    store.editKit(p.id, 'builder', (e) => void (e.limits = { minutes: 999, usd: 25 }))
    store.startRun(p)
    store.pause()
    for (let i = 0; i < 12; i++) {
      const a = nextAsk(p)
      if (!a) break
      p.clock = Math.max(p.clock!, a.t)
      if (a.limitFor === 'builder') return { p, a }
      store.answer(a.id, a.suggested)
    }
    throw new Error('no limit ask')
  }

  it('Critical: Builder to Opus with its limit ask open keeps the ask, and the Builder never ends over a limit unasked', () => {
    const { p, a } = toLimitAsk()
    store.editKit(p.id, 'builder', (e) => void (e.model = 'Claude Opus 5.5'))
    expect(pendingAsk(p.events, p.clock!, p.answers ?? {})).toBe(a.id)
    store.answer(a.id, a.suggested)
    finish(p)
    expect(spentBy(p, 'builder')).toBeLessThanOrEqual(limitAtEnd(p, 'builder') + 0.5)
  })

  it('High 2: a model change never reprices money already spent', () => {
    const { p } = toLimitAsk()
    const before = FARMER_ORDER.map((f) => spentBy(p, f, p.clock!).toFixed(3))
    store.editKit(p.id, 'builder', (e) => void (e.model = 'Claude Fable 5.1'))
    store.editKit(p.id, 'planner', (e) => void (e.model = 'Claude Fable 5.1'))
    expect(FARMER_ORDER.map((f) => spentBy(p, f, p.clock!).toFixed(3))).toEqual(before)
  })

  it('a task raise lifts its farmer’s limit, and a model change later keeps that lift', () => {
    const p = farm(SAMPLE_GOAL)
    const a = nextAsk(p)!
    p.clock = a.t
    const raise = a.alternatives!.find((o) => /^raise/i.test(o))!
    store.answer(a.id, raise)
    const lift = p.events.find((e) => e.type === 'auto_fix' && /limit went up/.test(e.what))
    expect(lift).toBeDefined()
    p.clock = lift!.t + 60_000
    const before = pastOf(p)
    store.editKit(p.id, 'designer', (e) => void (e.model = 'Claude Sonnet 5'))
    expect(pastOf(p)).toBe(before)
    finish(p)
    expect(p.events.some((e) => e.type === 'ask' && e.limitFor === 'builder')).toBe(false)
    expect(spentBy(p, 'builder')).toBeLessThanOrEqual(store.state(p)!.farmers.builder!.limits.usd + 0.01)
  })

  it('High 3: an approved raise is never rewritten, and passing it asks again', () => {
    const { p, a } = toLimitAsk()
    store.answer(a.id, a.suggested)
    const raised = a.limitTo
    // A model at two and a half times the price: the Builder passes the raise you approved.
    store.editKit(p.id, 'builder', (e) => void (e.model = 'Claude Fable 5.1'))
    const first = p.events.find((e) => e.type === 'ask' && e.id === a.id)
    expect(first && first.type === 'ask' && first.limitTo).toBe(raised)
    const again = p.events.find((e) => e.type === 'ask' && e.limitFor === 'builder' && e.id !== a.id)
    expect(again && again.type === 'ask' && again.question).toContain(`$${raised}`)
  })
})
