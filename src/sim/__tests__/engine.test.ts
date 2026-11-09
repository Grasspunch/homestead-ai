import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECKS, COMMITS, GATE_ORDER, HARVEST_FAIL } from '../review'
import { LESSON_HOLD } from '../scenario'
import { freshEngine, toGrow, until } from './helpers'
import type { Engine } from '../engine'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

// Finish every subtask of a task by hand.
function finishSteps(e: Engine, id: string) {
  for (const s of e.task(id).subtasks) {
    s.done = true
    s.progress = 1
  }
}

describe('Done-when gates', () => {
  it('a task with every step done is not ripe until its machine gates pass', () => {
    const e = freshEngine()
    finishSteps(e, 'backend')
    expect(e.taskRipe(e.task('backend'))).toBe(false)
    e.gates.backend = { unit: { state: 'pass', text: '18 of 18' }, e2e: { state: 'pass', text: '1 of 1' } }
    expect(e.taskRipe(e.task('backend'))).toBe(false) // integration still missing
    e.gates.backend.integration = { state: 'fail', text: 'x' }
    expect(e.taskRipe(e.task('backend'))).toBe(false)
    e.gates.backend.integration = { state: 'pass', text: '9 of 9' }
    expect(e.taskRipe(e.task('backend'))).toBe(true)
  })

  it('the review gate never blocks ripeness during Grow', () => {
    const e = freshEngine()
    expect(e.taskGates.messaging).toEqual(['unit', 'integration', 'review'])
    finishSteps(e, 'messaging')
    e.gates.messaging = { unit: { state: 'pass', text: '' }, integration: { state: 'pass', text: '' } }
    expect(e.taskRipe(e.task('messaging'))).toBe(true)
  })

  it('a task is not ripe while a step is left, even if its gates passed', () => {
    const e = freshEngine()
    e.gates.backend = { unit: { state: 'pass', text: '' }, integration: { state: 'pass', text: '' }, e2e: { state: 'pass', text: '' } }
    expect(e.taskRipe(e.task('backend'))).toBe(false)
  })

  it('toggleGate changes a task’s gates only during Plan, in gate order', () => {
    const e = freshEngine()
    e.toggleGate('messaging', 'unit')
    expect(e.taskGates.messaging).toEqual(['unit', 'integration', 'review']) // brief phase: no change
    e.phase = 'plan'
    e.toggleGate('messaging', 'unit')
    expect(e.taskGates.messaging).toEqual(['integration', 'review'])
    e.toggleGate('messaging', 'shots')
    expect(e.taskGates.messaging).toEqual(['shots', 'integration', 'review'])
    e.toggleGate('messaging', 'unit')
    expect(e.taskGates.messaging).toEqual(['shots', 'unit', 'integration', 'review'])
    // A new machine gate now blocks the Messaging crop.
    finishSteps(e, 'messaging')
    e.gates.messaging = { unit: { state: 'pass', text: '' }, integration: { state: 'pass', text: '' } }
    expect(e.taskRipe(e.task('messaging'))).toBe(false)
  })
})

describe('the harvest review', () => {
  // Jump straight to the review: the review call resolves with the recorded output, and the
  // end-to-end run on the whole app finishes with it.
  async function atReview() {
    const e = freshEngine()
    e.phase = 'harvest'
    e.harvestReady = true
    e.harvestStage = 'map'
    e.skipHarvestMap()
    expect(e.harvestStage).toBe('review')
    expect(e.harvestGates.review.state).toBe('run')
    expect(e.harvestGates.e2e.state).toBe('run')
    await until(e, () => !e.gatesRunning, 'review result')
    return e
  }

  it('two owners booking one slot fails the end-to-end gate, raises a Failure ask and locks approval', async () => {
    const e = await atReview()
    expect(e.harvestGates.e2e).toEqual({ state: 'fail', text: HARVEST_FAIL.text })
    expect(e.harvestGates.review.state).toBe('look')
    expect(e.gateFailed).toBe(true)
    expect(e.canApprove).toBe(false)
    const ask = e.activeAsk!
    expect(ask.id).toBe('hold')
    expect(ask.label).toBe('Failure')
    expect(ask.fromName).toBe('Backend')
    expect(ask.question).toBe(HARVEST_FAIL.question)
    expect(ask.options.map((o) => [o.value, !!o.recommended])).toEqual([
      ['hold', true],
      ['refuse', false],
    ])
    expect(e.gateFor('backend', 'e2e')).toEqual({ state: 'fail', text: HARVEST_FAIL.short })
    expect(e.taskStatus(e.task('backend')).text).toBe('End-to-end failed')
    // Screenshots passed and need your eyes: those can still be ticked.
    const shot = CHECKS.find((c) => c.gate === 'shots')!
    expect(e.canTick(shot)).toBe(true)
  })

  it('answering runs every gate again, then they all pass, a lesson is saved and approval unlocks after the ticks', async () => {
    const e = await atReview()
    e.answer('hold', 'hold')
    expect(e.fixSent).toBe(true)
    for (const g of GATE_ORDER) expect(e.harvestGates[g].state).toBe('run')
    expect(e.canTick(CHECKS[0])).toBe(false)
    expect(e.pendingSeeds.map((s) => s.file)).toContain(LESSON_HOLD.file)
    await until(e, () => !e.gatesRunning, 'rerun', 10)
    expect(e.gateFailed).toBe(false)
    for (const g of GATE_ORDER) expect(['pass', 'look']).toContain(e.harvestGates[g].state)
    expect(e.harvestGates.review.text).toBe('0 blocking, 2 notes')
    expect(e.log.some((l) => l.text === HARVEST_FAIL.fixed)).toBe(true)
    expect(e.canApprove).toBe(false)
    for (const c of CHECKS) e.toggleTick(c.id)
    expect(e.allTicked).toBe(true)
    expect(e.canApprove).toBe(true)
  })

  it('send back answers the ask with its recommended option', async () => {
    const e = await atReview()
    e.sendBack()
    expect(e.asks.find((a) => a.id === 'hold')?.answer).toBe('hold')
    expect(e.fixSent).toBe(true)
  })

  it('approving adds no “needed you” entry, and merging is a separate confirmed step', async () => {
    const e = await atReview()
    e.answer('hold', 'hold')
    await until(e, () => !e.gatesRunning, 'rerun', 10)
    for (const c of CHECKS) e.toggleTick(c.id)
    const humans = e.neededYou
    e.approveHarvest()
    expect(e.approved).toBe(true)
    expect(e.neededYou).toBe(humans)
    expect(e.sendState).toBe('none')
    e.send() // no confirm yet: nothing happens
    expect(e.sendState).toBe('none')
    e.startSend()
    expect(e.sendState).toBe('confirming')
    e.send()
    expect(e.sendState).toBe('sent')
    expect(e.neededYou).toBe(humans)
  })
})

describe('settings', () => {
  it('the mode switch flips Live AI and the setting together', () => {
    const e = freshEngine()
    expect(e.liveAI).toBe(false)
    e.setSetting('run', 'mode', 'live')
    expect(e.liveAI).toBe(true)
    expect(e.settings.run.mode).toBe('live')
    e.setSetting('run', 'mode', 'simulated')
    expect(e.liveAI).toBe(false)
    expect(e.settings.run.mode).toBe('simulated')
  })

  it('nested and top-level settings are written', () => {
    const e = freshEngine()
    e.setSetting('agents.backend', 'model', 'claude-haiku-5-5')
    expect(e.settings.agents.backend.model).toBe('claude-haiku-5-5')
    e.setSetting('', 'ci_checks', false)
    expect(e.settings.ci_checks).toBe(false)
    const t = e.settingsToml()
    expect(t).toContain('[agents.backend]')
    expect(t).toContain('model = "claude-haiku-5-5"')
    expect(t).toContain('[mcp.github]')
    expect(t).toContain('ci_checks = false')
    expect(t).toMatch(/\[agents\.backend\][^[]*mcp = \["github"\]/)
  })

  it('setAccess changes what agents may do with a tool, and the toml follows', () => {
    const e = freshEngine()
    const before = e.lib('GitHub').access!
    const mergeIdx = before.findIndex((a) => /merge/i.test(a.label))
    expect(before[mergeIdx].on).toBe(false)
    expect(e.settingsToml()).not.toContain('"merge a pull request"')
    e.setAccess('GitHub', mergeIdx, true)
    expect(e.lib('GitHub').access![mergeIdx].on).toBe(true)
    expect(e.library.find((x) => x.name === 'GitHub')!.access![mergeIdx].on).toBe(true)
    expect(e.settingsToml()).toContain('"merge a pull request"')
    // Engines don't share access state.
    expect(freshEngine().lib('GitHub').access![mergeIdx].on).toBe(false)
  })
})

describe('story setup', () => {
  it('starts from one line, asks four questions, then plans three tasks for three agents, the Reviewer taking no task', async () => {
    const e = freshEngine()
    expect(e.goal).toBe('Build a vet clinic website for Willow Lane Vets.')
    expect(e.crew).toBe('gstack')
    e.skipIntro()
    e.submitBrief()
    await until(e, () => e.questions.length > 0 && e.headThinking === 0, 'clarify questions')
    expect(e.questions.map((q) => q.id)).toEqual(['scope', 'visits', 'ahead', 'reminders'])
    expect(e.questions.map((q) => q.options[0])).toEqual(['Show the clinic and let owners book online', 'Checkups and vaccinations', 'Up to 8 weeks ahead', 'Text, the day before'])
    e.finishClarify()
    await until(e, () => e.planReady, 'plan ready')
    e.approvePlan()
    expect(e.tasks.map((t) => t.id)).toEqual(['frontend', 'backend', 'messaging'])
    expect(Object.keys(e.farmhands).sort()).toEqual(['backend', 'frontend', 'messaging', 'reviewer'])
    expect(e.tasks.some((t) => t.assignee === 'reviewer')).toBe(false)
    expect(e.fields.map((f) => f.name)).toEqual(['Frontend', 'Backend', 'Messaging'])
    expect(e.neededYou).toBe(1)
  })
})

describe('Grow rows and drafts', () => {
  it('sorts Needs you, then Working, then Done, keeping the plan order inside a group', async () => {
    const e = freshEngine()
    await toGrow(e)
    expect(e.growRows().map((r) => r.t.id)).toEqual(['frontend', 'backend', 'messaging'])
    // Messaging ripe, Backend asking: Backend moves up, Messaging moves down.
    finishSteps(e, 'messaging')
    e.gates.messaging = { unit: { state: 'pass', text: '' }, integration: { state: 'pass', text: '' } }
    await until(e, () => e.activeAsk?.id === 'crow', 'crow ask')
    const rows = e.growRows()
    expect(rows[0]).toMatchObject({ group: 'needs' })
    expect(rows[0].t.id).toBe('backend')
    expect(rows.map((r) => r.group)).toEqual([...rows.map((r) => r.group)].sort((a, b) => ['needs', 'working', 'done'].indexOf(a) - ['needs', 'working', 'done'].indexOf(b)))
    expect(rows[rows.length - 1].t.id).toBe('messaging')
    expect(rows[rows.length - 1].group).toBe('done')
    expect(e.growCounts).toMatch(/^1 needs you, \d working, \d done$/)
  })

  it('a task has a draft only once a step is done, and the draft opens its task', async () => {
    const e = freshEngine()
    finishSteps(e, 'backend')
    expect(e.draftFor('backend')).toBeNull() // still in the brief
    await toGrow(e)
    expect(e.draftFor('frontend')).toBeNull()
    expect(e.draftFor('backend')).toEqual({ label: COMMITS.backend, nav: [{ kind: 'task', id: 'backend' }] })
    e.openDraft('backend')
    expect(e.panelOpen).toBe(true)
    expect(e.nav[e.nav.length - 1]).toEqual({ kind: 'task', id: 'backend' })
  })

  it('the chime is on by default and stays silent in node', () => {
    const e = freshEngine()
    expect(e.settings.notify.chime).toBe(true)
    expect(() => e.chime()).not.toThrow()
    expect(e.settingsToml()).toContain('chime = true')
  })
})

describe('three steps', () => {
  it('maps the engine phases onto Plant, Grow and Harvest', async () => {
    const { stepOf, STEPS, STEP_LABEL } = await import('../steps')
    expect(STEPS.map((s) => STEP_LABEL[s])).toEqual(['Plant', 'Grow', 'Harvest'])
    expect((['brief', 'clarify', 'plan'] as const).map(stepOf)).toEqual(['plant', 'plant', 'plant'])
    expect(stepOf('grow')).toBe('grow')
    expect(stepOf('harvest')).toBe('harvest')
    expect(stepOf('ship')).toBe('harvest')
  })

  it('the agent tree lists the crew Needs you, then Working, then Done', async () => {
    const { crewOrder } = await import('../../panel/AgentTree')
    const e = freshEngine()
    await toGrow(e)
    await until(e, () => e.activeAsk?.id === 'crow', 'crow ask')
    e.farmhands.messaging.status = 'done'
    const order = crewOrder(Object.values(e.farmhands)).map((f) => f.status)
    expect(order[0]).toBe('asking')
    expect(['done', 'idle']).toContain(order[order.length - 1])
    expect(order.indexOf('done')).toBeGreaterThan(order.lastIndexOf('working') === -1 ? 0 : order.lastIndexOf('working'))
    expect(crewOrder(Object.values(e.farmhands))[0].id).toBe('backend')
  })
})
