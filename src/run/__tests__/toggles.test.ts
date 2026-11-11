import { beforeAll, describe, expect, it } from 'vitest'
import { reduce } from '../reduce'
import { simulatePlan } from '../simPlan'
import { needAsk, simulateRun } from '../simulate'
import { SAMPLE_GOAL, store, type Project } from '../store'
import { SKILLS, applyEdit, emptyEdit, lockedPath, lockedSkill, type KitEdit } from '../kit'
import type { FarmerId, RunEvent } from '../types'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const GOALS = [SAMPLE_GOAL, 'Card checkout for an online shop', 'A dashboard of new sign-ups each week', 'A recipe app with a new page for saved recipes']

function run(goal: string, kit: Partial<Record<FarmerId, KitEdit>> = {}) {
  const plan = simulatePlan(goal)
  const farmers = plan.farmers.map((f) => applyEdit(f, kit[f.id]))
  return simulateRun({ goal, farmers, tasks: plan.tasks, estimate: plan.estimate, singleAgentEstimate: plan.singleAgentEstimate })
}
const edit = (fn: (e: KitEdit) => void) => {
  const e = emptyEdit()
  fn(e)
  return e
}
const done = (ev: RunEvent[]) => ev.find((e) => e.type === 'done') as Extract<RunEvent, { type: 'done' }>

// Every switch on each farmer's page that isn't locked: its context paths and its skills (House style is the brand guide).
function toggles(goal: string) {
  const out: { farmer: FarmerId; path?: string; skill?: string }[] = []
  for (const f of simulatePlan(goal).farmers) {
    for (const path of f.context) if (!lockedPath(f.id, path, f.context)) out.push({ farmer: f.id, path })
    for (const i of SKILLS[f.id]) if (i.id !== 'style' && !lockedSkill(f.id, i.id, f.context)) out.push({ farmer: f.id, skill: i.id })
  }
  return out
}
const turnOff = (t: { path?: string; skill?: string }) => edit((e) => (t.path ? (e.contextOff = [t.path]) : (e.off = [t.skill!])))

describe('every context and skill switch changes the run, or is locked', () => {
  it('the default run is unchanged: an empty edit, or one turned off and on again, runs the same', () => {
    for (const g of GOALS) {
      const base = run(g)
      expect(JSON.stringify(run(g, { builder: emptyEdit(), designer: emptyEdit(), tester: emptyEdit(), planner: emptyEdit(), deployer: emptyEdit() }))).toBe(JSON.stringify(base))
    }
  })

  it('the sample’s default run keeps its numbers and its asks', () => {
    const ev = run(SAMPLE_GOAL)
    const d = done(ev)
    expect({ usd: d.usd, minutes: d.minutes, asks: d.asks }).toEqual({ usd: 54.14, minutes: 99, asks: 4 })
    expect(ev.filter((e) => e.type === 'ask').map((e) => (e.type === 'ask' ? e.id : ''))).toEqual(['ask-1', 'ask-brand', 'ask-limit-designer', 'ask-3', 'ask-2', 'ask-limit-builder', 'ask-4'])
    expect(ev.some((e) => e.type === 'ask' && e.need)).toBe(false)
  })

  for (const g of GOALS)
    it(`each switch on “${g.slice(0, 32)}…” fails a check and asks for it back`, () => {
      const base = JSON.stringify(run(g))
      const all = toggles(g)
      expect(all.length).toBeGreaterThan(0)
      for (const t of all) {
        const ev = run(g, { [t.farmer]: turnOff(t) })
        expect(JSON.stringify(ev), `${t.farmer} ${t.path ?? t.skill}`).not.toBe(base)
        const ask = ev.find((e) => e.type === 'ask' && e.id === needAsk(t))
        expect(ask, `${t.farmer} ${t.path ?? t.skill}`).toBeTruthy()
        if (!ask || ask.type !== 'ask') continue
        expect(ask.need).toEqual(t.path ? { farmer: t.farmer, path: t.path } : { farmer: t.farmer, skill: t.skill })
        const fail = ev.find((e) => e.type === 'check' && !e.pass && e.task === ask.task && e.t < ask.t && e.t >= ask.t - 6000)
        expect(fail && fail.type === 'check' && fail.notes).toBeTruthy()
        // Fixing it costs more than the plan's own run.
        expect(done(ev).usd).toBeGreaterThan(done(JSON.parse(base)).usd)
      }
    })

  it('on the sample, the help docs, the eval set and four skills each matter', () => {
    const keys = toggles(SAMPLE_GOAL).map((t) => `${t.farmer}:${t.path ?? t.skill}`)
    expect(keys).toEqual(expect.arrayContaining(['builder:docs/help/', 'builder:eval/questions.jsonl', 'designer:docs/help/', 'tester:eval/questions.jsonl', 'builder:tests', 'builder:search', 'designer:shots', 'designer:a11y', 'tester:browser', 'tester:evals']))
  })

  it('the Builder without the help docs fails "Index the help docs" and names its context', () => {
    const ev = run(SAMPLE_GOAL, { builder: edit((e) => (e.contextOff = ['docs/help/'])) })
    const fail = ev.find((e) => e.type === 'check' && !e.pass && e.task === 'docs-index')
    expect(fail && fail.type === 'check' && fail.notes).toMatch(/docs\/help\/.*Builder’s context/)
    const ask = ev.find((e) => e.type === 'ask' && e.id === needAsk({ farmer: 'builder', path: 'docs/help/' }))
    expect(ask && ask.type === 'ask' && ask.suggested).toBe('Add the help docs')
  })

  it('the Tester without the eval set can’t check the answers', () => {
    const ev = run(SAMPLE_GOAL, { tester: edit((e) => (e.contextOff = ['eval/questions.jsonl'])) })
    const fail = ev.find((e) => e.type === 'check' && !e.pass && e.task === 'answer-api' && /Can’t check/.test(e.notes))
    expect(fail && fail.type === 'check' && fail.by).toBe('tester')
  })

  it('locks what can’t change the run, with a reason', () => {
    const plan = simulatePlan(SAMPLE_GOAL).farmers
    const ctx = (id: FarmerId) => plan.find((f) => f.id === id)!.context
    expect(lockedPath('builder', 'src/', ctx('builder'))).toBeTruthy()
    expect(lockedPath('tester', 'tests/', ctx('tester'))).toBeTruthy()
    for (const c of ctx('planner')) expect(lockedPath('planner', c, ctx('planner'))).toBeTruthy()
    for (const c of ctx('deployer')) expect(lockedPath('deployer', c, ctx('deployer'))).toBeTruthy()
    expect(lockedPath('builder', 'docs/help/', ctx('builder'))).toBeUndefined()
    // A path you added is yours to switch.
    expect(lockedPath('planner', 'docs/extra.md', ctx('planner'))).toBeUndefined()
    // Answer evals needs the eval set to work from.
    expect(lockedSkill('tester', 'evals', ['tests/'])).toEqual({ why: expect.any(String), on: false })
    expect(lockedSkill('tester', 'evals', ctx('tester'))).toBeUndefined()
  })

  it('a path turned off and on again comes back, even after the run was rebuilt without it', () => {
    const f = simulatePlan(SAMPLE_GOAL).farmers.find((x) => x.id === 'builder')!
    const without = applyEdit(f, edit((e) => (e.contextOff = ['docs/help/'])))
    expect(without.context).not.toContain('docs/help/')
    expect(without.planContext).toEqual(f.context)
    expect(applyEdit(without, emptyEdit())).toEqual(f)
  })
})

// A farm for the sample's goal, with an edit made before you approve it.
function farm(farmer: FarmerId, fn: (e: KitEdit) => void): Project {
  const p = store.newProject(SAMPLE_GOAL)
  const plan = simulatePlan(SAMPLE_GOAL)
  store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
  store.editKit(p.id, farmer, fn)
  store.approve(p.id)
  store.pause()
  return p
}
const HELP = needAsk({ farmer: 'builder', path: 'docs/help/' })
function toAsk(p: Project, id: string) {
  const ask = p.events.find((e) => e.type === 'ask' && e.id === id)!
  for (const e of p.events) if (e.type === 'ask' && e.t < ask.t) store.answer(e.id, e.suggested)
  p.clock = ask.t
  store.clock = ask.t
  return ask as Extract<RunEvent, { type: 'ask' }>
}

describe('a file asked for back, in the store', () => {
  it('the forecast prices the run without it', () => {
    const p = store.newProject(SAMPLE_GOAL)
    const plan = simulatePlan(SAMPLE_GOAL)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    const before = store.forecast(p)!.crew.usd
    store.editKit(p.id, 'builder', (e) => (e.contextOff = ['docs/help/']))
    expect(store.forecast(p)!.crew.usd).toBeGreaterThan(before)
  })

  it('“Add the help docs” puts them back in the Builder’s context, and the task passes after its failure', () => {
    const p = farm('builder', (e) => (e.contextOff = ['docs/help/']))
    const ask = toAsk(p, HELP)
    store.answer(HELP, ask.suggested)
    expect(store.kit[p.id]?.builder?.contextOff).not.toContain('docs/help/')
    expect(p.events.some((e) => e.type === 'check' && !e.pass && e.task === 'docs-index')).toBe(true)
    expect(p.events.some((e) => e.type === 'tool' && e.summary === 'Read docs/help/ and indexed every page')).toBe(true)
    expect(reduce(p.events, Infinity).tasks.find((t) => t.id === 'docs-index')!.status).toBe('accepted')
  })

  it('switching the help docs back on while the Builder asks answers the ask', () => {
    const p = farm('builder', (e) => (e.contextOff = ['docs/help/']))
    toAsk(p, HELP)
    store.editKit(p.id, 'builder', (e) => (e.contextOff = []))
    expect(store.viewerAnswers[HELP]).toBe('Add the help docs')
    expect(p.events.some((e) => e.type === 'check' && !e.pass && e.task === 'docs-index')).toBe(true)
  })

  it('“Stop this task” leaves it out of the pull request', () => {
    const p = farm('builder', (e) => (e.contextOff = ['docs/help/']))
    toAsk(p, HELP)
    store.answer(HELP, 'Stop this task')
    expect(p.events.some((e) => e.type === 'stop' && e.task === 'docs-index')).toBe(true)
  })
})
