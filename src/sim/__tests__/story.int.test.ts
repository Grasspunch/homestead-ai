// A whole run through the engine, the way the Playwright run drives the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECKS, GATE_ORDER, OUTPUT } from '../review'
import { LESSON_STAGING, LESSON_TRACE, MISSING } from '../scenario'
import { freshEngine, toGrow, until } from './helpers'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Google sign-in, end to end', () => {
  it('catches the retired endpoint, re-plans, fails the review once, then merges', async () => {
    const e = freshEngine()
    await toGrow(e)
    expect(e.phase).toBe('grow')

    // Frontend reuses /v1/session; the end-to-end run on staging fails before anyone asks you.
    await until(e, () => e.gates.tests?.e2e?.state === 'fail', 'e2e failure')
    expect(e.endpoint).toBe('/v1/session')
    expect(e.gates.tests!.e2e!.text).toBe('Failed, 404')
    expect(e.activeAsk).toBeNull()

    // The crow lands and Tests asks.
    await until(e, () => e.activeAsk?.id === 'crow', 'crow ask')
    const ask = e.activeAsk!
    expect(ask.fromName).toBe('Tests')
    expect(ask.options.map((o) => [o.value, o.label, !!o.recommended])).toEqual([
      ['v2', 'Switch to /v2/session', true],
      ['keep', 'Keep /v1 and tell that team', false],
    ])
    expect(e.gates.tests!.e2e!.state).toBe('fail')
    e.answer('crow', 'v2')
    expect(e.replan?.status).toBe('open')

    // The re-plan gives Frontend a new step and the changelog.
    e.applyReplan()
    const front = e.task(MISSING.taskId)
    expect(front.subtasks.map((s) => s.id)).toContain('f4')
    expect(front.signposts).toContain(MISSING.file)

    // Trace why, and save the lesson.
    e.openTrace('endpoint')
    e.saveSeed()
    expect(e.seeds[0].file).toBe(LESSON_TRACE.file)

    await until(e, () => e.harvestReady, 'harvest ready')
    expect(e.endpoint).toBe('/v2/session')
    for (const t of e.tasks) expect(e.taskRipe(t)).toBe(true)
    expect(e.gates.tests!.e2e).toEqual({ state: 'pass', text: '3 of 3 runs' })
    expect(e.flags.has('unitFixed')).toBe(true) // the frontend unit pest, fixed alone
    expect(e.pendingSeeds.map((s) => s.file)).toContain(LESSON_STAGING.file)
    expect(e.neededYou).toBe(2)

    // The harvest: the review fails first.
    e.openHarvest()
    expect(e.phase).toBe('harvest')
    e.skipHarvestMap()
    await until(e, () => !e.gatesRunning, 'review result', 20)
    expect(e.harvestGates.review.state).toBe('fail')
    expect(e.harvestHeadline).toBe(OUTPUT.failed)
    expect(e.taskStatus(e.task('backend')).text).toBe('Review failed')

    e.sendBack()
    await until(e, () => !e.gatesRunning, 'rerun', 20)
    expect(e.gateFailed).toBe(false)
    expect(e.harvestHeadline).toBe(OUTPUT.caught)
    for (const g of GATE_ORDER) expect(['pass', 'look']).toContain(e.harvestGates[g].state)

    for (const c of CHECKS) e.toggleTick(c.id)
    e.approveHarvest()
    e.startSend()
    e.send()
    expect(e.sendState).toBe('sent')
    expect(e.harvestHeadline).toBe(OUTPUT.merged)
    expect(e.neededYou).toBe(2)
    expect(e.decisions.map((d) => d.word)).toEqual(['Plan', 'Looks wrong', 'Failed', 'Review', 'Merge'])
  })

  it('with the changelog attached at Plan, Frontend calls /v2/session and no crow comes', async () => {
    const e = freshEngine()
    await toGrow(e, (e) => e.attach('frontend', MISSING.file))
    expect(e.task('frontend').signposts).toContain(MISSING.file)
    await until(e, () => e.harvestReady, 'harvest ready')
    expect(e.endpoint).toBe('/v2/session')
    expect(e.asks).toHaveLength(0)
    expect(e.crow.state).toBe('none')
    expect(e.gates.tests!.e2e).toEqual({ state: 'pass', text: '3 of 3 runs' })
    expect(e.log.some((l) => l.text === 'Sign-in failed on staging')).toBe(false)
    expect(e.neededYou).toBe(1)
    expect(e.pendingSeeds.map((s) => s.file)).not.toContain(LESSON_STAGING.file)
  })
})
