// Checkpoint 19: the Raise path with a late model change reaches Done, and nothing reads as a stop you never made.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store, type Project } from '../store'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const GOALS = [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A dashboard of weekly signups', 'A tool that drafts replies to app store reviews']

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
const doneT = (p: Project) => p.events.find((e) => e.type === 'done')?.t
const lastT = (p: Project) => Math.max(...p.events.filter((e) => e.type !== 'done').map((e) => e.t))

describe('checkpoint 19: Raise, then a late model change', () => {
  for (const goal of GOALS)
    for (const frac of [0.9, 0.95, 0.99])
      it(`${goal.slice(0, 24)}: Raise, Builder to Opus at ${frac * 100}%, still reaches Done with no phantom stop`, () => {
        const p = farm(goal)
        // Answer the first ask with Raise when it offers one, the rest with their suggestion.
        let raised = false
        for (let i = 0; i < 30; i++) {
          const a = nextAsk(p)
          if (!a) break
          p.clock = Math.max(p.clock!, a.t)
          const r = !raised ? a.alternatives?.find((o) => /^raise/i.test(o)) ?? (/^raise/i.test(a.suggested) ? a.suggested : undefined) : undefined
          if (r) raised = true
          store.answer(a.id, r ?? a.suggested)
        }
        const end = doneT(p)!
        p.clock = Math.round(end * frac)
        store.editKit(p.id, 'builder', (e) => void (e.model = 'Claude Opus 5.5'))
        for (let i = 0; i < 30; i++) {
          const a = nextAsk(p)
          if (!a) break
          p.clock = Math.max(p.clock!, a.t)
          store.answer(a.id, a.suggested)
        }
        expect(doneT(p)).toBeDefined()
        expect(doneT(p)!).toBeGreaterThan(lastT(p))
        expect(p.events.some((e) => e.type === 'stop')).toBe(false)
      })
})

describe('checkpoint 19: Run again never stacks tasks', () => {
  it('runs 1 to 5 of the sample keep the same number of plots', () => {
    const p = farm(SAMPLE_GOAL)
    const counts: number[] = []
    for (let run = 0; run < 5; run++) {
      if (run > 0) {
        store.open(p.id)
        store.runAgain()
        store.pause()
      }
      for (let i = 0; i < 30; i++) {
        const a = nextAsk(p)
        if (!a) break
        p.clock = Math.max(p.clock!, a.t)
        store.answer(a.id, a.suggested)
      }
      p.clock = doneT(p)!
      ;(store as unknown as { finishRun(p: Project): void }).finishRun(p)
      counts.push(store.state(p)!.tasks.length)
      expect(store.state(p)!.tasks.filter((t) => t.name === 'Hard cases').length).toBeLessThanOrEqual(1)
    }
    expect(new Set(counts.slice(1)).size).toBe(1)
    expect(counts[0]).toBe(counts[1])
  })
})

describe('checkpoint 20: an approved raise keeps its amount', () => {
  it('Builder to Opus at the cost ask, then Raise to $23: the limit goes up by what you approved, and passing it asks again', () => {
    const p = farm(SAMPLE_GOAL)
    const a = nextAsk(p)!
    p.clock = a.t
    const raise = a.alternatives!.find((o) => /^Raise its limit/.test(o))!
    store.editKit(p.id, 'builder', (e) => void (e.model = 'Claude Opus 5.5'))
    store.answer(a.id, raise)
    const lift = p.events.find((e) => e.type === 'auto_fix' && /limit went up/.test(e.what))
    const plain = farm(SAMPLE_GOAL)
    const b = nextAsk(plain)!
    plain.clock = b.t
    store.answer(b.id, raise)
    const plainLift = plain.events.find((e) => e.type === 'auto_fix' && /limit went up/.test(e.what))
    expect(lift).toBeDefined()
    expect(plainLift).toBeDefined()
    // The answer on record is the one you gave, at the price you approved.
    expect(p.events.find((e) => e.type === 'answer' && e.id === a.id && e.type === 'answer' && e.choice === raise)).toBeDefined()
    expect(p.events.some((e) => e.type === 'tool' && e.summary === `Kept going under a ${raise.replace('Raise its limit to ', '')} limit`)).toBe(true)
    expect(p.events.some((e) => e.type === 'ask' && e.limitFor === 'builder')).toBe(true)
  })
})

describe('checkpoint 20: taking a file away never fails a task that already passed', () => {
  it('help docs off after "Index the help docs" passed: no failed check, no ask, the task stays in', () => {
    const p = farm(SAMPLE_GOAL)
    // Past the cost ask and every check of the first task.
    for (let i = 0; i < 30; i++) {
      const a = nextAsk(p)
      if (!a) break
      p.clock = Math.max(p.clock!, a.t)
      store.answer(a.id, a.suggested)
      const ok = p.events.find((e) => e.type === 'check' && e.task === 'docs-index' && e.pass)
      if (ok && ok.t < p.clock!) break
    }
    const ok = p.events.find((e) => e.type === 'check' && e.task === 'docs-index' && e.pass)!
    p.clock = Math.max(p.clock!, ok.t + 60_000)
    store.editKit(p.id, 'builder', (e) => void (e.contextOff = [...(e.contextOff ?? []), 'docs/help/']))
    expect(p.events.some((e) => e.type === 'check' && e.task === 'docs-index' && !e.pass && e.t > ok.t)).toBe(false)
    expect(p.events.some((e) => e.type === 'ask' && e.need?.path === 'docs/help/')).toBe(false)
    expect(p.events.some((e) => e.type === 'stop' && e.task === 'docs-index')).toBe(false)
  })
})

describe('checkpoint 20: a check you stopped never holds the release', () => {
  it('Tester without Drive a browser, Stop this task, then Merge: it ships, and your stop isn’t a caught problem', () => {
    const p = store.newProject(SAMPLE_GOAL)
    const plan = simulatePlan(SAMPLE_GOAL)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.editKit(p.id, 'tester', (e) => void (e.off = [...e.off, 'browser']))
    store.approve(p.id)
    store.pause()
    let stopped = false
    for (let i = 0; i < 30; i++) {
      const a = nextAsk(p)
      if (!a) break
      p.clock = Math.max(p.clock!, a.t)
      if (a.need) stopped = true
      store.answer(a.id, a.need ? 'Stop this task' : a.suggested)
    }
    p.clock = doneT(p)!
    const s = store.state(p)!
    expect(stopped).toBe(true)
    expect(s.deploy.some((d) => d.stage === '10%')).toBe(true)
    expect(s.tasks.flatMap((t) => t.checks).some((c) => c.yours)).toBe(true)
  })
})

describe('checkpoint 21: a file turned off, on and off again never leaves a task stuck', () => {
  for (const gap of [0, 30_000, 120_000, 300_000, 600_000])
    it(`Builder's eval questions off at the cost ask, Turn on, off again ${gap / 1000}s later: every task resolves and the run reaches Done`, () => {
      const p = farm(SAMPLE_GOAL)
      const path = 'eval/questions.jsonl'
      const cost = p.events.find((e) => e.type === 'ask' && e.reason === 'cost')!
      p.clock = cost.t
      store.editKit(p.id, 'builder', (e) => void (e.contextOff = [...(e.contextOff ?? []), path]))
      let flipped = false
      for (let i = 0; i < 40; i++) {
        const a = nextAsk(p)
        if (!a) break
        p.clock = Math.max(p.clock!, a.t)
        store.answer(a.id, a.suggested)
        if (!flipped && a.need?.path === path) {
          flipped = true
          p.clock = a.t + gap
          store.editKit(p.id, 'builder', (e) => void (e.contextOff = [...(e.contextOff ?? []), path]))
        }
      }
      expect(flipped).toBe(true)
      const end = doneT(p)
      expect(end).toBeDefined()
      p.clock = end!
      const s = store.state(p)!
      for (const t of s.tasks) expect(t.status === 'accepted' || !!t.gate || (t as { stopped?: boolean }).stopped === true, `${t.name}: ${t.status}`).toBe(true)
      expect(end!).toBeGreaterThanOrEqual(lastT(p))
    })
})

describe('checkpoint 21: one count of caught problems everywhere', () => {
  it('a check you caused by turning a skill off is left out of Done, the pull request, the report and the projection alike', async () => {
    const { caughtLine } = await import('../../hud/Side')
    const { prMarkdown, runReport } = await import('../export')
    const { caughtCounts, scaleLine, PACE } = await import('../scale')
    const p = store.newProject(SAMPLE_GOAL)
    const plan = simulatePlan(SAMPLE_GOAL)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.editKit(p.id, 'tester', (e) => void (e.off = [...e.off, 'browser']))
    store.approve(p.id)
    store.pause()
    for (let i = 0; i < 30; i++) {
      const a = nextAsk(p)
      if (!a) break
      p.clock = Math.max(p.clock!, a.t)
      store.answer(a.id, a.suggested)
    }
    p.clock = doneT(p)!
    const s = store.state(p)!
    expect(s.tasks.flatMap((t) => t.checks).some((c) => c.yours && !c.pass)).toBe(true)
    const n = caughtCounts(s).checks
    expect(caughtLine(s)).toMatch(new RegExp(`^${n} problems? caught before merge`))
    expect(prMarkdown(p, s)).toContain(`- ${n} problem${n === 1 ? '' : 's'} caught by a check before merge`)
    expect(runReport(p, s)).toContain(`- ${n} problem${n === 1 ? '' : 's'} caught before merge`)
    expect(scaleLine(s)).toContain(`${n * PACE.perWeek * PACE.weeks} problems caught before merge`)
  })
})

describe('checkpoint 22: one Raise says so once, and the limit shown is the one you approved', () => {
  for (const goal of GOALS)
    for (const frac of [0.2, 0.5, 0.8])
      for (const model of ['Claude Opus 5.5', 'GPT-6 Luna'])
        it(`${goal.slice(0, 24)}: Raise, then the Builder to ${model} at ${frac * 100}%`, () => {
          const p = farm(goal)
          const end0 = doneT(p)!
          let raised = false
          let changed = false
          for (let i = 0; i < 40; i++) {
            const a = nextAsk(p)
            if (!changed && raised && (!a || a.t > end0 * frac)) {
              p.clock = Math.max(p.clock!, end0 * frac)
              changed = true
              store.editKit(p.id, 'builder', (e) => void (e.model = model))
              continue
            }
            if (!a) break
            p.clock = Math.max(p.clock!, a.t)
            const r = !raised ? [a.suggested, ...(a.alternatives ?? [])].find((o) => /^raise/i.test(o)) : undefined
            if (r) raised = true
            store.answer(a.id, r ?? a.suggested)
          }
          p.clock = doneT(p)!
          const s = store.state(p)!
          expect(s.autoFixes.filter((f) => /limit went up by/.test(f.what)).length).toBe(1)
          const b = s.farmers.builder!
          expect(b.usd).toBeLessThanOrEqual(b.limits.usd + 0.01)
          // The limit shown is the last one said: the raise's note, or the limit you approved after it.
          const lastAsk = [...p.events].reverse().find((e) => e.type === 'ask' && e.limitFor === 'builder')
          const said = lastAsk && lastAsk.type === 'ask' ? Number(/\$(\d+)/.exec(p.answers![lastAsk.id])![1]) : Number(/to \$(\d+)\./.exec(s.autoFixes.find((f) => /limit went up/.test(f.what))!.what)![1])
          expect(b.limits.usd).toBe(said)
        })
})

describe('checkpoint 23: the one-agent comparison prices each step at the model it was paid at', () => {
  for (const goal of [SAMPLE_GOAL, 'Stripe checkout for our pricing page', 'A habit tracker app'])
    for (const model of ['GPT-6 Luna', 'Claude Opus 5.5', 'GPT-6 Astra'])
      for (const at of ['cost', 'big', 'irreversible'])
        it(`${goal.slice(0, 24)}: Builder to ${model} at the ${at} ask, one agent alone costs about the same`, () => {
          const play = (change: boolean) => {
            const p = farm(goal)
            let changed = !change
            for (let i = 0; i < 40; i++) {
              const a = nextAsk(p)
              if (!a) break
              p.clock = Math.max(p.clock!, a.t)
              if (!changed && a.reason === at) {
                changed = true
                store.editKit(p.id, 'builder', (e) => void (e.model = model))
                continue
              }
              store.answer(a.id, a.suggested)
            }
            p.clock = doneT(p)!
            return store.state(p)!.soloActual!.usd
          }
          const base = play(false)
          // One agent does the same work whatever model the crew's Builder was moved to.
          expect(Math.abs(play(true) - base)).toBeLessThan(base * 0.06)
        })
})
