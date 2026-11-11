// Checkpoint 20's leftovers: a teammate's farm is view only and says whose it is, the exports count tasks the way
// Done does and carry the learned line and "assuming", and a failed test never leads with a raw TypeError.
import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { duration, reduce } from '../reduce'
import { doneLead } from '../done'
import { prMarkdown, runReport, soloLine } from '../export'
import { BUDGET, buildTeam, clampBudget, spentOf } from '../team'
import { simulateRun } from '../simulate'
import { prOf } from '../files'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { plainFail } from '../../hud/Proof'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

function farm(goal: string) {
  const p = store.newProject(goal)
  const plan = simulatePlan(goal)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.approve(p.id)
  store.pause()
  return p
}

function playOut(p: Project) {
  for (let i = 0; i < 30; i++) {
    const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
    if (!a || a.type !== 'ask') break
    p.clock = Math.max(p.clock!, a.t)
    store.answer(a.id, a.suggested)
  }
  p.clock = duration(p.events)
  ;(store as unknown as { finishRun: (p: Project) => void }).finishRun(p)
}

const stateOf = (p: Project) => reduce(p.events, p.clock ?? duration(p.events), p.answers ?? {})

describe('exports match Done', () => {
  it('count every plot, the release included, in the same words as Done', () => {
    const p = farm(SAMPLE_GOAL)
    playOut(p)
    const s = stateOf(p)
    const lead = doneLead(s)
    expect(lead).toMatch(new RegExp(`^All ${s.tasks.length} tasks`))
    const pr = prMarkdown(p, s)
    const report = runReport(p, s)
    expect(pr).toContain(lead)
    expect(report).toContain(lead)
    const work = s.tasks.filter((t) => !t.gate).length
    expect(pr).not.toContain(`${work} of ${work}`)
    expect(report).not.toContain(`${work} of ${work}`)
    // The report's task table has a row per plot, the release too.
    const rows = report.split('## Spend')[1].split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Task') && !l.startsWith('| ---') && !l.startsWith('| Farmer'))
    expect(rows.filter((r) => s.tasks.some((t) => r.startsWith(`| ${t.name} |`))).length).toBe(s.tasks.length)
  })

  it('lists the same commits the pull request window counts', () => {
    const p = farm(SAMPLE_GOAL)
    playOut(p)
    const s = stateOf(p)
    const n = prOf(s, p.goal).commits.length
    const pr = prMarkdown(p, s)
    expect(pr).toContain(` ${n} commits.`)
    expect(pr.split('## Commits')[1].split('## ')[0].match(/^\d+\. \*\*/gm)?.length).toBe(n)
  })

  it('run 2 carries the "Learned from run 1" line', () => {
    const p = farm(SAMPLE_GOAL)
    playOut(p)
    expect(prMarkdown(p, stateOf(p))).not.toContain('Learned from run')
    store.runAgain()
    store.pause()
    playOut(p)
    const s = stateOf(p)
    expect(p.run?.lesson).toBeTruthy()
    expect(prMarkdown(p, s)).toMatch(/- Learned from run 1: “.*” split from the start/)
    expect(runReport(p, s)).toMatch(/- Learned from run 1: “.*” split from the start/)
  })

  it('the one-agent comparison says what it assumes, on the pull request and in the files', () => {
    const p = farm(SAMPLE_GOAL)
    playOut(p)
    const s = stateOf(p)
    expect(s.soloActual).toBeTruthy()
    expect(soloLine(s)).toMatch(/^One Claude Sonnet 5 agent alone, estimated from this run: about \$\d+ over .+, assuming one agent runs a third slower\.$/)
    expect(prMarkdown(p, s)).toContain('assuming one agent runs a third slower')
    expect(soloLine(s, true)).toMatch(/^One agent alone: about \$\d+ in .+, assuming it runs a third slower\.$/)
    expect(soloLine({})).toBe('')
  })

  it('the downloaded files still say the plan was simulated', () => {
    const p = farm(SAMPLE_GOAL)
    playOut(p)
    expect(prMarkdown(p, stateOf(p))).toContain('The plan was simulated.')
  })
})

describe('team budgets and money', () => {
  it('clamps a budget to $1 to $1,000', () => {
    expect(clampBudget(99999999)).toBe(BUDGET.max)
    expect(clampBudget(0.2)).toBe(BUDGET.min)
    expect(clampBudget(42.6)).toBe(43)
    store.setBudget('help', 99999999)
    expect(store.budgets.help).toBe(1000)
    store.setBudget('help', -5)
    expect(store.budgets.help).toBe(1000)
    store.setBudget('help', 60)
  })

  it('formats spent and limit alike', () => {
    expect(spentOf(13.2, 5)).toEqual({ spent: '$13', limit: '$5', over: '$8' })
    expect(spentOf(3.456, 5)).toEqual({ spent: '$3.46', limit: '$5.00', over: '$0.00' })
    expect(spentOf(41.4, 60).limit).toBe('$60')
  })

  it('an over-limit spike says the overrun in the same format', () => {
    const plan = simulatePlan(SAMPLE_GOAL)
    const events = simulateRun({ goal: SAMPLE_GOAL, ...plan })
    const t = buildTeam([{ id: 'mine', name: 'Mine', goal: SAMPLE_GOAL, events, approved: true, clock: duration(events), spendLimit: 5 }], { help: 60, checkout: 60, insights: 50 })
    const spike = t.outliers.find((o) => o.kind === 'spike')!
    expect(spike.text).toMatch(/^Over its limit by \$\d+\.$/)
  })

  it('the same-work-twice outlier names both projects in the pair', () => {
    const plan = simulatePlan(SAMPLE_GOAL)
    const events = simulateRun({ goal: SAMPLE_GOAL, ...plan })
    const t = buildTeam([{ id: 'mine', name: 'Mine', goal: SAMPLE_GOAL, events, approved: true }], { help: 60, checkout: 60, insights: 50 })
    const twice = t.outliers.find((o) => o.kind === 'twice')
    expect(twice && twice.kind === 'twice' && [twice.farm.mine, twice.other.mine]).toEqual([false, true])
  })
})

describe('a failed test in plain words', () => {
  it('leads with what broke, and keeps the trace for the disclosure', () => {
    const plan = simulatePlan(SAMPLE_GOAL)
    const events = simulateRun({ goal: SAMPLE_GOAL, ...plan })
    const fails = events.flatMap((e) => (e.type === 'check' && !e.pass && e.proof?.tests ? e.proof.tests.filter((x) => !x.pass) : []))
    expect(fails.length).toBeGreaterThan(0)
    const trace = fails.find((x) => /TypeError/.test(x.error ?? ''))!
    expect(plainFail(trace)).toBe('Empty input crashes the handler')
    for (const f of fails) expect(plainFail(f)).not.toMatch(/TypeError|Cannot read/)
    expect(plainFail({ name: 'x', pass: false, ms: 1, error: 'RangeError: bad' })).toBe('The code crashed on this test')
    expect(plainFail({ name: 'x', pass: false, ms: 1, error: 'Expected 1, got 2' })).toBe('Expected 1, got 2')
  })
})
