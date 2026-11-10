import { beforeAll, describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { simulateRun } from '../simulate'
import { reduce } from '../reduce'
import { changesFromLive, readChanges, reshapedOf, type Change, type Ctx } from '../reshape'
import { SAMPLE_GOAL, store, type Project } from '../store'
import type { RunEvent } from '../types'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const goal = SAMPLE_GOAL
const plan = simulatePlan(goal)
const ctx: Ctx = {
  tasks: [...plan.tasks, { id: `${plan.tasks[0].id}-rest`, name: 'Hard cases', farmer: 'builder' as const, gate: false }].map((t) => ({ id: t.id, name: t.name, farmer: t.farmer, gate: t.gate })),
  farmers: plan.farmers.map((f) => f.id),
}
const kinds = (text: string, c = ctx) => {
  const r = readChanges(text, c)
  return r.kind === 'changes' ? r.proposal.rows.map((x) => x.change) : r.kind
}
const has = (list: Change[] | string, kind: Change['kind'], extra?: Record<string, string>) =>
  Array.isArray(list) && list.some((c) => c.kind === kind && Object.entries(extra ?? {}).every(([k, v]) => (c as Record<string, unknown>)[k] === v))

describe('reading a request into changes', () => {
  it('incident mode: no review, no Deployer, straight to everyone, and the unnecessary tasks skipped', () => {
    const c = kinds("I'm in an incident, skip all unnecessary steps, skip the deployer and instantly push to main and deploy")
    expect(has(c, 'setAutonomy')).toBe(true)
    expect(has(c, 'removeFarmer', { farmer: 'deployer' })).toBe(true)
    expect(has(c, 'setRollout')).toBe(true)
    expect(has(c, 'removeTask', { task: 'e2e-check' })).toBe(true)
    expect(has(c, 'removeTask', { task: `${plan.tasks[0].id}-rest` })).toBe(true)
    const r = readChanges("I'm in an incident, skip all unnecessary steps", ctx)
    expect(r.kind === 'changes' && r.proposal.title).toBe('Incident mode')
    // Rows that remove a safety step say what you lose.
    expect(r.kind === 'changes' && r.proposal.rows.find((x) => x.change.kind === 'setRollout')?.loss).toBe('No 10% stage, so no automatic rollback')
  })
  it('close variants read the same way', () => {
    for (const t of ['we have an outage, ship it now', 'Emergency: skip review and push straight to main', 'sev1 hotfix, deploy to everyone immediately']) {
      const c = kinds(t)
      expect(Array.isArray(c) && c.length > 0).toBe(true)
    }
    expect(has(kinds('skip the end to end check'), 'removeTask', { task: 'e2e-check' })).toBe(true)
    expect(has(kinds('skip the hard cases'), 'removeTask', { task: `${plan.tasks[0].id}-rest` })).toBe(true)
  })
  it("negations keep things as they are: don't skip the tester", () => {
    const c = kinds("incident mode, but don't skip the tester")
    expect(has(c, 'removeTask', { task: 'e2e-check' })).toBe(false)
    expect(has(c, 'setRollout')).toBe(true)
    expect(has(kinds("I'm in an incident, keep the review"), 'setAutonomy')).toBe(false)
    expect(has(kinds("incident, but don't skip the deployer"), 'removeFarmer')).toBe(false)
    expect(has(kinds("incident, don't skip the 10% stage"), 'setRollout')).toBe(false)
    expect(has(kinds("we're in an incident, don't skip the hard cases"), 'removeTask', { task: `${plan.tasks[0].id}-rest` })).toBe(false)
  })
  it('synthetics: the release is done when synthetic tests pass, and they trigger the rollback', () => {
    for (const t of ['change the success criteria from monitors to passing synthetics tests in prod', 'use synthetic tests instead of monitors for the rollout']) {
      const c = kinds(t)
      expect(has(c, 'setRolloutCheck')).toBe(true)
      expect(has(c, 'setDoneWhen', { task: 'ship' }) || (Array.isArray(c) && c.some((x) => x.kind === 'setDoneWhen'))).toBe(true)
    }
    expect(kinds("don't use synthetic tests")).not.toContainEqual({ kind: 'setRolloutCheck', check: 'synthetics' })
  })
  it('notifications at each stage of the rollout', () => {
    for (const t of ['send me a desktop notification at each stage of the rollout', 'notify me at every rollout stage', 'ping me at each deploy step']) expect(has(kinds(t), 'notifyOn')).toBe(true)
  })
  it('anything else says plainly what it can change, and a note to the crew stays a note', () => {
    const r = readChanges('change the database to postgres', ctx)
    expect(r.kind).toBe('none')
    expect(r.kind === 'none' && r.reply).toBe('I can’t change that yet.')
    expect(r.kind === 'none' && r.chips.length).toBeLessThanOrEqual(3)
    expect(readChanges('make the widget friendlier', ctx).kind).toBe('not-a-change')
  })
  it('out of scope, it names the closest thing it can do and offers it first', () => {
    const r = readChanges('page the on-call when it rolls back', ctx)
    expect(r.kind).toBe('none')
    if (r.kind !== 'none') return
    expect(r.closest).toMatch(/^Closest I can do: a desktop notification/)
    expect(r.chips.map((c) => c.label)).toEqual(['Notify me at each stage', 'Incident mode', 'Judge by synthetic tests'])
    // Each chip is a request the Planner reads into a change card.
    for (const c of r.chips) expect(readChanges(c.request, ctx).kind).toBe('changes')
    const d = readChanges('change the deploy to blue-green', ctx)
    expect(d.kind === 'none' && d.closest).toMatch(/incident mode/)
    // Something already on is not offered.
    const on = readChanges('page the on-call when it rolls back', { ...ctx, active: [{ kind: 'notifyOn', on: 'stage' }] })
    expect(on.kind === 'none' && on.closest).toBeUndefined()
    expect(on.kind === 'none' && on.chips.map((c) => c.label)).not.toContain('Notify me at each stage')
  })
  it('changes already on are not offered again', () => {
    const r = readChanges('notify me at each stage of the rollout', { ...ctx, active: [{ kind: 'notifyOn', on: 'stage' }] })
    expect(r.kind).toBe('none')
  })
  it('the live answer is checked against the farm: unknown tasks and kinds are dropped', () => {
    const p = changesFromLive({ title: 'Incident mode', changes: [{ kind: 'removeTask', task: 'nope' }, { kind: 'removeTask', task: 'e2e-check' }, { kind: 'launchRockets' }, { kind: 'setRollout', stages: 'everyone' }] }, ctx)
    expect(p?.rows.map((r) => r.change.kind)).toEqual(['removeTask', 'setRollout'])
  })
})

const run = (changes: Change[], at = 0) => simulateRun({ goal, ...plan, reshape: reshapedOf([{ title: 'T', changes, at }]) })
const base = simulateRun({ goal, ...plan })
const end = (ev: RunEvent[]) => reduce(ev, Number.MAX_SAFE_INTEGER, {})

describe('each change changes the run', () => {
  it('removeTask: the task never runs and is gone from the farm', () => {
    const ev = run([{ kind: 'removeTask', task: 'e2e-check' }])
    expect(ev.some((e) => e.type === 'task_start' && e.task === 'e2e-check')).toBe(false)
    expect(end(ev).tasks.some((t) => t.id === 'e2e-check')).toBe(false)
    expect(end(ev).reshape?.skipped).toEqual(['Check it end to end'])
  })
  it('removeTask on the hard cases: the split keeps its first part and leaves them out', () => {
    const rest = `${plan.tasks[0].id}-rest`
    const ev = run([{ kind: 'removeTask', task: rest }])
    expect(ev.some((e) => e.type === 'task_start' && e.task === rest)).toBe(false)
    expect(end(ev).tasks.some((t) => t.id === rest)).toBe(false)
  })
  it('removeFarmer: no Deployer on the crew, and the Builder ships', () => {
    const ev = run([{ kind: 'removeFarmer', farmer: 'deployer' }])
    const s = end(ev)
    expect(s.farmers.deployer).toBeUndefined()
    expect(s.tasks.find((t) => t.gate)?.farmer).toBe('builder')
    expect(ev.some((e) => e.type === 'usage' && e.farmer === 'deployer')).toBe(false)
  })
  it('setAutonomy: no review ask; with the Deployer off, the Builder pushes straight to main', () => {
    const ev = run([{ kind: 'setAutonomy', moment: 'ship', value: 'auto' }, { kind: 'removeFarmer', farmer: 'deployer' }])
    expect(ev.some((e) => e.type === 'ask' && e.reason === 'irreversible')).toBe(false)
    expect(base.some((e) => e.type === 'ask' && e.reason === 'irreversible')).toBe(true)
    expect(ev.some((e) => e.type === 'tool' && /straight to main/.test(e.summary))).toBe(true)
  })
  it('setRollout: everyone at once, no 10% stage and no rollback', () => {
    const ev = run([{ kind: 'setRollout', stages: 'everyone' }, { kind: 'setAutonomy', moment: 'ship', value: 'auto' }])
    const stages = ev.filter((e) => e.type === 'deploy').map((e) => (e.type === 'deploy' ? e.stage : ''))
    expect(stages).toEqual(['100%', '100%'])
    expect(ev.some((e) => e.type === 'auto_fix' && /No 10% stage, so nothing rolled back/.test(e.what))).toBe(true)
  })
  it('setRolloutCheck: synthetic tests per stage, and a failing one rolls it back before errors pass 2%', () => {
    const ev = run([{ kind: 'setRolloutCheck', check: 'synthetics' }])
    const rb = ev.find((e) => e.type === 'deploy' && e.stage === 'rollback')
    expect(rb && rb.type === 'deploy' && rb.reason).toMatch(/synthetic test failed.*11 of 12 passing/)
    const monitors = ev.filter((e) => e.type === 'monitor')
    expect(monitors.every((e) => e.type === 'monitor' && e.metrics.synth?.total === 12)).toBe(true)
    // Sooner than the error rate would have: the base run rolls back later.
    const brb = base.find((e) => e.type === 'deploy' && e.stage === 'rollback')!
    expect(rb!.t).toBeLessThan(brb.t)
    const last = ev.filter((e) => e.type === 'check').slice(-1)[0]
    expect(last.type === 'check' && last.notes).toMatch(/12 of 12 synthetic tests passing/)
  })
  it('setDoneWhen: the task says its new done-when', () => {
    const ship = plan.tasks.find((t) => t.gate)!
    const ev = run([{ kind: 'setDoneWhen', task: ship.id, doneWhen: 'Synthetic tests pass in prod at every stage' }])
    expect(end(ev).tasks.find((t) => t.id === ship.id)?.doneWhen).toBe('Synthetic tests pass in prod at every stage')
  })
  it('notifyOn changes nothing in the simulation: alerts are the app’s', () => {
    const ev = run([{ kind: 'notifyOn', on: 'stage' }])
    expect(ev.filter((e) => e.type !== 'reshape')).toEqual(base)
  })
  it('is deterministic', () => {
    const c: Change[] = [{ kind: 'setRollout', stages: 'everyone' }, { kind: 'removeTask', task: 'e2e-check' }]
    expect(run(c)).toEqual(run(c))
  })
})

describe('applying from the card, mid-run, and Undo', () => {
  const setup = () => {
    const p = store.newProject(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    store.open(p.id)
    store.pause()
    // Past the first ask, mid-run.
    const a = p.events.find((e) => e.type === 'ask')!
    p.clock = a.t
    store.answer(a.id, a.type === 'ask' ? a.suggested : '')
    p.clock = p.clock! + 3 * 60_000
    return p
  }
  const spent = (p: Project) => +p.events.reduce((n, e) => n + (e.type === 'usage' && e.t <= p.clock! ? e.usd : 0), 0).toFixed(2)

  it('incident mode re-simulates from now, keeps the past, and Undo restores the exact earlier run', async () => {
    const p = setup()
    const before = structuredClone(p.events)
    const was = spent(p)
    expect(await store.proposeChanges(p.id, "I'm in an incident, skip all unnecessary steps, skip the deployer and instantly push to main and deploy")).toBe('card')
    const rows = store.pending!.proposal.rows
    expect(rows.length).toBeGreaterThanOrEqual(4)
    // Uncheck one: it stays as it is.
    const keep = rows.find((r) => r.change.kind === 'removeTask' && r.change.task === 'e2e-check')
    await store.applyChanges(rows.filter((r) => r !== keep).map((r) => r.id))
    expect(spent(p)).toBe(was)
    const s = store.state(p)!
    expect(s.reshape?.titles).toEqual(['Incident mode'])
    expect(p.events.some((e) => e.type === 'ask' && e.reason === 'irreversible' && e.t > p.clock!)).toBe(false)
    expect(p.events.filter((e) => e.type === 'deploy' && e.t > p.clock!).every((e) => e.type === 'deploy' && e.stage === '100%')).toBe(true)
    expect(s.tasks.some((t) => t.id === 'e2e-check')).toBe(true)
    // Undo: the run is exactly the one before.
    store.undoChanges(p.reshapes![0].id)
    expect(p.events).toEqual(before)
    expect(p.reshapes).toEqual([])
  })
  it('cancel changes nothing', async () => {
    const p = setup()
    const before = structuredClone(p.events)
    await store.proposeChanges(p.id, 'use synthetic tests for the rollout')
    store.cancelChanges()
    expect(p.events).toEqual(before)
    expect(store.pending).toBeNull()
  })
  it('a change lasts for the farm: Run again starts with it', async () => {
    const p = setup()
    await store.proposeChanges(p.id, 'use synthetic tests for the rollout')
    await store.applyChanges(store.pending!.proposal.rows.map((r) => r.id))
    store.runAgain()
    store.pause()
    expect(p.events.some((e) => e.type === 'monitor' && !!e.metrics.synth)).toBe(true)
    expect(p.reshapes![0].scope).toBe('farm')
  })
})

describe('Your flow: changes for every farm', () => {
  const mem = new Map<string, string>()
  beforeAll(() => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
  })
  const farm = () => {
    const p = store.newProject(goal)
    store.setPlan(p.id, plan.name, plan.farmers, plan.tasks, plan.estimate, plan.singleAgentEstimate)
    store.approve(p.id)
    store.open(p.id)
    store.pause()
    p.clock = 60_000
    return p
  }
  const apply = async (rowScopes?: (r: { change: Change }) => 'farm' | 'every') => {
    const rows = store.pending!.proposal.rows
    const scopes = rowScopes ? Object.fromEntries(rows.map((r) => [r.id, rowScopes(r)])) : {}
    await store.applyChanges(rows.map((r) => r.id), scopes)
    // No Notification here, so a stage-alert card says so first and applies on the second click.
    if (store.pending) await store.applyChanges(store.pending.proposal.rows.map((r) => r.id), scopes)
  }

  it('the Planner suggests this farm for safety steps and the success criteria, every farm for stage alerts', () => {
    const scopes = (t: string) => {
      const r = readChanges(t, ctx)
      return r.kind === 'changes' ? r.proposal.rows.map((x) => x.scope) : []
    }
    expect(new Set(scopes("I'm in an incident, skip the deployer and push to main"))).toEqual(new Set(['farm']))
    expect(scopes('change the success criteria to passing synthetics tests in prod')).toEqual(['farm', 'farm'])
    expect(scopes('send me a desktop notification at each stage of the rollout')).toEqual(['every'])
  })

  it('applying an every-farm change adds it to Your flow and saves it with the farms', async () => {
    store.flow = []
    const p = farm()
    await store.proposeChanges(p.id, 'send me a desktop notification at each stage of the rollout')
    await apply()
    expect(store.flow.map((f) => [f.short, f.on, f.notify])).toEqual([['stage alerts', true, 'toast']])
    // A this-farm change stays out of it.
    await store.proposeChanges(p.id, 'use synthetic tests for the rollout')
    await apply()
    expect(store.flow).toHaveLength(1)
    store.persist()
    const saved = JSON.parse(mem.get('homestead.v3.farms')!)
    expect(saved.flow.map((f: { short: string }) => f.short)).toEqual(['stage alerts'])
    // A reload reads it back.
    store.flow = []
    expect(store.restore()).toBe(true)
    expect(store.flow.map((f) => f.short)).toEqual(['stage alerts'])
  })

  it('a new farm starts with Your flow, named in the plan, and a flipped row joins it', async () => {
    store.flow = []
    const p = farm()
    await store.proposeChanges(p.id, 'change the success criteria to passing synthetics tests in prod')
    await apply(() => 'every')
    expect(store.flow.map((f) => f.short)).toEqual(['synthetic done-when', 'synthetic checks'])
    const q = farm()
    expect(q.reshapes?.map((r) => [r.title, r.flow])).toEqual([['Your flow', ['synthetic done-when', 'synthetic checks']]])
    const s = store.state(q)!
    expect(s.reshape?.synthetics).toBe(true)
    // The done-when lands on this plan's release task.
    const ship = plan.tasks.find((t) => t.gate)!
    expect(s.tasks.find((t) => t.id === ship.id)?.doneWhen).toBe('Synthetic tests pass in prod at every stage')
  })

  it('an item turned off or removed in Settings stays off new farms, and Undo takes back what it added', async () => {
    store.flow = []
    const p = farm()
    await store.proposeChanges(p.id, 'send me a desktop notification at each stage of the rollout')
    await apply()
    const id = store.flow[0].id
    store.setFlowOn(id, false)
    expect(farm().reshapes ?? []).toEqual([])
    expect(JSON.parse(mem.get('homestead.v3.farms')!).flow[0].on).toBe(false)
    store.setFlowOn(id, true)
    expect(farm().reshapes?.[0].title).toBe('Your flow')
    store.removeFlow(id)
    expect(store.flow).toEqual([])
    expect(JSON.parse(mem.get('homestead.v3.farms')!).flow).toEqual([])
    expect(farm().reshapes ?? []).toEqual([])
    // Undo of the request that added it takes it out of Your flow too.
    const r = farm()
    await store.proposeChanges(r.id, 'send me a desktop notification at each stage of the rollout')
    await apply()
    expect(store.flow).toHaveLength(1)
    store.undoChanges(r.reshapes!.at(-1)!.id)
    expect(store.flow).toEqual([])
  })
})

describe('the release with the Deployer off', () => {
  it('becomes the Builder pushing to main, and comes back on Undo', () => {
    const ship = plan.tasks.find((t) => t.gate)!
    const off = end(run([{ kind: 'removeFarmer', farmer: 'deployer' }]))
    const t = off.tasks.find((k) => k.id === ship.id)!
    expect([t.name, t.farmer, t.doneWhen]).toEqual(['Push to main', 'builder', 'Merged to main and live for everyone'])
    const on = end(simulateRun({ goal, ...plan })).tasks.find((k) => k.id === ship.id)!
    expect(on.name).toBe(ship.name)
    expect(on.farmer).toBe('deployer')
  })
})

