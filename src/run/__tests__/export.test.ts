import { describe, expect, it } from 'vitest'
import { duration, reduce } from '../reduce'
import { simulatePlan } from '../simPlan'
import { store, SAMPLE_GOAL, type Project } from '../store'
import { prMarkdown, runReport, slug } from '../export'

// The store plays runs on animation frames; these tests move its clock by hand. Set before the describe body runs.
;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}

// The sample's goal, played to the end with every ask answered with its suggestion.
function finished(): { p: Project; s: ReturnType<typeof reduce> } {
  const p = store.newProject(SAMPLE_GOAL)
  const plan = simulatePlan(SAMPLE_GOAL)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.pause()
  for (let i = 0; i < 20; i++) {
    const ask = p.events.find((e) => e.type === 'ask' && !store.viewerAnswers[e.id])
    if (!ask || ask.type !== 'ask') break
    p.clock = ask.t
    store.answer(ask.id, ask.suggested)
  }
  p.clock = duration(p.events)
  return { p, s: reduce(p.events, p.clock, store.viewerAnswers) }
}

describe('exports', () => {
  const { p, s } = finished()
  const pr = prMarkdown(p, s)
  const report = runReport(p, s)

  it('the pull request has a title, summary, commits, checks, decisions and spend, in that order', () => {
    const heads = ['# ', '## Summary', '## Commits', '## Checks', '## Decisions', '## Spend'].map((h) => pr.indexOf(h))
    expect(heads.every((i) => i >= 0)).toBe(true)
    expect([...heads].sort((a, b) => a - b)).toEqual(heads)
    expect(pr.startsWith(`# ${p.name}\n`)).toBe(true)
  })

  it('says the run was simulated', () => {
    expect(pr).toMatch(/simulated/i)
    expect(report).toMatch(/simulated/i)
  })

  it('lists one commit per committed task, with its cost to the cent', () => {
    const accepted = s.tasks.filter((t) => !t.gate && t.status === 'accepted')
    expect(accepted.length).toBeGreaterThan(2)
    for (const t of accepted) expect(pr).toContain(`**${t.name}** ($${t.usd.toFixed(2)})`)
  })

  it('carries each check, failed ones included, and every answer you gave', () => {
    const fails = s.tasks.filter((t) => !t.gate).flatMap((t) => t.checks.filter((c) => !c.pass))
    expect(fails.length).toBeGreaterThan(0)
    expect((pr.match(/❌ Fail/g) ?? []).length).toBe(fails.length)
    const answered = s.asks.filter((x) => x.answer)
    expect(answered.length).toBeGreaterThan(0)
    for (const a of answered) expect(pr).toContain(a.answer!.choice)
  })

  it('spends what the run spent', () => {
    expect(pr).toContain(`In all: $${s.done!.usd.toFixed(2)}`)
    expect(report).toContain(`$${s.done!.usd.toFixed(2)} over`)
  })

  it('the report names what each farmer could see', () => {
    expect(report).toContain('## Crew')
    expect(report).toContain('docs/help/')
    expect(report).toContain('## Timeline')
  })

  it('a live plan says so, and a kept one gives its date', () => {
    expect(prMarkdown({ ...p, plannedLive: true, liveSource: 'Lovable AI' }, s)).toContain('live call to the Planner through Lovable AI')
    expect(runReport({ ...p, plannedLive: true, plannedEarlier: '2026-11-10T10:00:00Z' }, s)).toContain('on 2026-11-10')
  })

  it('makes file names from the farm name', () => {
    expect(slug('Support assistant 2')).toBe('support-assistant-2')
    expect(slug('!!!')).toBe('run')
  })
})
