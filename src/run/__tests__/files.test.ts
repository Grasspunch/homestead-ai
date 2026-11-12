import { describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { simulateRun } from '../simulate'
import { reduce } from '../reduce'
import { FILES } from '../diffs'
import { parse, prOf } from '../files'

const GOALS = [
  'Build an AI support assistant that answers customer questions from our help docs',
  'Add a checkout with Stripe payments',
  'Build a metrics dashboard for our KPIs',
  'Make a recipe sharing app',
]

describe('the pull request as code', () => {
  for (const goal of GOALS) {
    const ev = simulateRun({ goal, ...simulatePlan(goal) })
    const end = ev[ev.length - 1].t
    it(`grows while the crew works, and ends with every commit: ${goal}`, () => {
      let last = 0
      for (const f of [0.1, 0.3, 0.5, 0.7, 1]) {
        const pr = prOf(reduce(ev, end * f), goal)
        const lines = pr.add + pr.del
        expect(lines).toBeGreaterThanOrEqual(last)
        last = lines
        // Only a farmer at work is writing a file, and only one file at a time.
        const writers = pr.live.map((l) => l.farmer)
        expect(new Set(writers).size).toBe(writers.length)
      }
      const done = prOf(reduce(ev, end), goal)
      expect(done.live).toEqual([])
      expect(done.files.every((f) => f.committed)).toBe(true)
      expect(done.commits.length).toBeGreaterThanOrEqual(reduce(ev, end).tasks.filter((t) => !t.gate && t.status === 'accepted').length)
    })
  }

  it('reads every written diff with line numbers that add up', () => {
    for (const [key, specs] of Object.entries(FILES))
      for (const f of specs) {
        const p = parse(f.diff)
        expect(p.add + p.del, `${key} ${f.path}`).toBeGreaterThan(0)
        for (const r of p.rows) if (r.k !== '@') expect(r.a ?? r.b, `${key} ${f.path}`).toBeGreaterThan(0)
      }
  })
})
