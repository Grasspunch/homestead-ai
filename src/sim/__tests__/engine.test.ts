import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECKS, GATE_ORDER } from '../review'
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
    e.gates.backend = { unit: { state: 'pass', text: '9 of 9' } }
    expect(e.taskRipe(e.task('backend'))).toBe(false) // integration still missing
    e.gates.backend.integration = { state: 'fail', text: 'x' }
    expect(e.taskRipe(e.task('backend'))).toBe(false)
    e.gates.backend.integration = { state: 'pass', text: '4 of 4' }
    expect(e.taskRipe(e.task('backend'))).toBe(true)
  })

  it('the review gate never blocks ripeness during Grow', () => {
    const e = freshEngine()
    expect(e.taskGates.docs).toEqual(['review'])
    finishSteps(e, 'docs')
    expect(e.taskRipe(e.task('docs'))).toBe(true)
  })

  it('a task is not ripe while a step is left, even if its gates passed', () => {
    const e = freshEngine()
    e.gates.backend = { unit: { state: 'pass', text: '' }, integration: { state: 'pass', text: '' } }
    expect(e.taskRipe(e.task('backend'))).toBe(false)
  })

  it('toggleGate changes a task’s gates only during Plan, in gate order', () => {
    const e = freshEngine()
    e.toggleGate('docs', 'unit')
    expect(e.taskGates.docs).toEqual(['review']) // brief phase: no change
    e.phase = 'plan'
    e.toggleGate('docs', 'unit')
    expect(e.taskGates.docs).toEqual(['unit', 'review'])
    e.toggleGate('docs', 'shots')
    expect(e.taskGates.docs).toEqual(['shots', 'unit', 'review'])
    e.toggleGate('docs', 'unit')
    expect(e.taskGates.docs).toEqual(['shots', 'review'])
    // A new machine gate now blocks the docs crop.
    finishSteps(e, 'docs')
    expect(e.taskRipe(e.task('docs'))).toBe(false)
  })
})

describe('the harvest review', () => {
  // Jump straight to the review: the review call resolves with the recorded output.
  async function atReview() {
    const e = freshEngine()
    e.phase = 'harvest'
    e.harvestReady = true
    e.harvestStage = 'map'
    e.skipHarvestMap()
    expect(e.harvestStage).toBe('review')
    expect(e.harvestGates.review.state).toBe('run')
    await until(e, () => !e.gatesRunning, 'review result')
    return e
  }

  it('the recorded review fails, which locks approval and the ticks on that gate', async () => {
    const e = await atReview()
    expect(e.harvestGates.review.state).toBe('fail')
    expect(e.gateFailed).toBe(true)
    expect(e.canApprove).toBe(false)
    const reviewCheck = CHECKS.find((c) => c.gate === 'review')!
    expect(e.canTick(reviewCheck)).toBe(false)
    e.toggleTick(reviewCheck.id)
    expect(e.ticked.has(reviewCheck.id)).toBe(false)
    // Screenshots passed and need your eyes: those can be ticked.
    const shot = CHECKS.find((c) => c.gate === 'shots')!
    expect(e.canTick(shot)).toBe(true)
  })

  it('send back runs every gate again, then they all pass and approval unlocks after the ticks', async () => {
    const e = await atReview()
    e.sendBack()
    expect(e.reviewFixed).toBe(true)
    for (const g of GATE_ORDER) expect(e.harvestGates[g].state).toBe('run')
    expect(e.canTick(CHECKS[0])).toBe(false)
    await until(e, () => !e.gatesRunning, 'rerun', 10)
    expect(e.gateFailed).toBe(false)
    for (const g of GATE_ORDER) expect(['pass', 'look']).toContain(e.harvestGates[g].state)
    expect(e.harvestGates.review.text).toBe('0 blocking, 2 notes')
    expect(e.canApprove).toBe(false)
    for (const c of CHECKS) e.toggleTick(c.id)
    expect(e.allTicked).toBe(true)
    expect(e.canApprove).toBe(true)
  })

  it('approving adds no “needed you” entry, and merging is a separate confirmed step', async () => {
    const e = await atReview()
    e.sendBack()
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
  it('starts with four tasks and five agents, the Reviewer taking no task', async () => {
    const e = freshEngine()
    await toGrow(e)
    expect(e.tasks.map((t) => t.id)).toEqual(['backend', 'frontend', 'tests', 'docs'])
    expect(Object.keys(e.farmhands).sort()).toEqual(['backend', 'docs', 'frontend', 'reviewer', 'tests'])
    expect(e.tasks.some((t) => t.assignee === 'reviewer')).toBe(false)
    expect(e.neededYou).toBe(1)
  })
})
