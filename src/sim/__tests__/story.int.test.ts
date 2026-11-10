// A whole run through the engine, the way the Playwright run drives the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECKS, GATE_ORDER, HARVEST_FAIL, INTEGRATION_FAIL, OUTPUT } from '../review'
import { ANNOUNCE, CI_JOBS, LESSON_QUERY, RELEASE, SHIP_TEXT } from '../ship'
import { CLASH, LESSON_HOLD, LESSON_TRACE, MISSING } from '../scenario'
import { stepOf } from '../steps'
import { freshEngine, toGrow, until } from './helpers'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Vet booking, end to end', () => {
  it('catches the out-of-date hours, re-plans, fails the double booking once, merges, rolls back once, then goes live', async () => {
    const e = freshEngine()
    expect(stepOf(e.phase)).toBe('plant')
    await toGrow(e)
    expect(e.phase).toBe('grow')
    expect(stepOf(e.phase)).toBe('grow')

    // Backend reads the hours sheet; the availability run on staging finds Saturday slots with no vet before anyone asks you.
    await until(e, () => e.gates.backend?.integration?.state === 'fail', 'integration failure')
    expect(e.hoursFrom).toBe('front-desk-hours.csv')
    expect(e.gates.backend!.integration!.text).toBe(INTEGRATION_FAIL.text)
    expect(e.activeAsk).toBeNull()

    // The crow lands and Backend asks.
    await until(e, () => e.activeAsk?.id === 'crow', 'crow ask')
    const ask = e.activeAsk!
    expect(ask.fromName).toBe('Backend')
    expect(ask.label).toBe('Anomaly')
    expect(ask.question).toBe(CLASH.question)
    expect(ask.options.map((o) => [o.value, o.label, !!o.recommended])).toEqual([
      ['rota', 'Use the schedule’s hours', true],
      ['sheet', 'Keep the hours sheet and ask', false],
    ])
    e.answer('crow', 'rota')
    expect(e.replan?.status).toBe('open')

    // The re-plan drops Saturday slots from 1 December, and Backend reads the schedule from now on.
    e.applyReplan()
    const back = e.task(MISSING.taskId)
    expect(back.subtasks.map((s) => s.id)).toContain('b5')
    expect(back.signposts).toContain(MISSING.file)
    expect(e.farmhands.backend.context).toContain(MISSING.file)
    expect(e.hoursFrom).toBe(MISSING.file)

    // Trace why, and save the lesson.
    e.openTrace('endpoint')
    e.saveSeed()
    expect(e.seeds[0].file).toBe(LESSON_TRACE.file)

    await until(e, () => e.harvestReady, 'harvest ready')
    for (const t of e.tasks) expect(e.taskRipe(t)).toBe(true)
    expect(e.gates.backend!.integration).toEqual({ state: 'pass', text: '9 passed' })
    expect(e.flags.has('unitFixed')).toBe(true) // the frontend unit pest, fixed alone
    expect(e.neededYou).toBe(2)

    // The harvest: two owners book the same slot, and Backend asks how to fix it.
    e.openHarvest()
    expect(e.phase).toBe('harvest')
    expect(stepOf(e.phase)).toBe('harvest')
    e.skipHarvestMap()
    await until(e, () => e.activeAsk?.id === 'hold', 'hold ask', 20)
    expect(e.harvestGates.e2e.state).toBe('fail')
    expect(e.harvestHeadline).toBe(OUTPUT.failed)
    expect(e.taskStatus(e.task('backend')).text).toBe('End-to-end failed')
    expect(e.activeAsk!.question).toBe('Two owners booked the same 9:00 slot at the same moment, and both were confirmed. Hold a slot for 5 minutes while someone books, then rerun?')
    expect(e.activeAsk!.question).toBe(HARVEST_FAIL.question)

    e.answer('hold', 'hold')
    await until(e, () => !e.gatesRunning, 'rerun', 20)
    expect(e.gateFailed).toBe(false)
    expect(e.harvestHeadline).toBe(OUTPUT.caught)
    for (const g of GATE_ORDER) expect(['pass', 'look']).toContain(e.harvestGates[g].state)
    expect(e.pendingSeeds.map((s) => s.file)).toContain(LESSON_HOLD.file)
    expect(e.neededYou).toBe(3)

    for (const c of CHECKS) e.toggleTick(c.id)
    e.approveHarvest()
    // Merging is an ordinary step now: one click, no confirm.
    e.merge()
    expect(e.sendState).toBe('sent')
    expect(e.phase).toBe('ship')
    expect(stepOf(e.phase)).toBe('harvest') // CI, deploy and the canary are the end of Harvest
    expect(e.neededYou).toBe(3)
    expect(e.decisions.map((d) => d.word)).toEqual(['Plan', 'Looks wrong', 'Failed', 'Review', 'Merge'])

    // CI on main: the known flaky test retries once on its own, then the deploy asks you.
    const merged = { needed: e.neededYou, words: e.decisions.map((d) => d.word) }
    await until(e, () => e.activeAsk?.id === 'deploy', 'deploy ask', 30)
    expect(CI_JOBS.every((j) => e.ci[j.id].state === 'pass')).toBe(true)
    expect(e.autoDecided.some((l) => l.text.startsWith('Retried a known flaky test'))).toBe(true)
    const deploy = e.activeAsk!
    expect(deploy.label).toBe('Irreversible')
    e.answer('deploy', 'approve')
    expect(deploy.status).toBe('confirming')
    expect(deploy.confirmList).toEqual([`Production: ${RELEASE.site}`, `Rollout: ${RELEASE.canary}`, 'Roll back: if a health check fails, put the “Call us to book” page back on its own'])
    e.answer('deploy', 'approve')

    // Availability search slows on the canary, and Homestead puts the old page back without asking.
    await until(e, () => e.activeAsk?.id === 'fix', 'fix ask', 30)
    expect(e.rolledBack).toBe(true)
    const auto = e.autoDecided.find((l) => l.text.startsWith('Put the “Call us to book” page back'))
    expect(auto?.text).toContain('rose to 4.2 s on the canary (limit 1 s)')
    expect(auto?.text).toContain('5% of visitors for 6 minutes')
    expect(e.activeAsk!.label).toBe('Failure')
    expect(e.activeAsk!.question).toBe(SHIP_TEXT.fix)
    expect(e.pendingSeeds.map((s) => s.file)).toContain(LESSON_QUERY.file)

    // The agent loads all 8 weeks in one query; the redeploy asks again with the same confirm.
    e.answer('fix', 'fix')
    await until(e, () => e.activeAsk?.id === 'redeploy', 'redeploy ask', 30)
    expect(e.activeAsk!.confirmList).toEqual(deploy.confirmList)
    e.answer('redeploy', 'approve')
    e.answer('redeploy', 'approve')
    await until(e, () => e.shipStage === 'live', 'live', 30)
    expect(e.rollout).toBe(100)
    expect(e.shipHeadline).toBe(SHIP_TEXT.live)

    // Then the text to every pet owner: it can't be taken back and it costs money.
    const text = e.activeAsk!
    expect(text.id).toBe('announce')
    expect(text.confirmList).toEqual([`To: ${ANNOUNCE.audience}`, `Message: “${ANNOUNCE.message}”`, 'Cost: about £95'])
    e.answer('announce', 'approve')
    expect(text.status).toBe('confirming')
    e.answer('announce', 'approve')
    expect(e.shipStage).toBe('announced')
    expect(e.shipHeadline).toBe('Saturday bookings at a closed clinic were caught before they reached 3,000 pet owners.')
    expect(e.neededYou).toBe(merged.needed + 4)
    expect(e.decisions.map((d) => d.word)).toEqual([...merged.words, 'Deploy', 'Failed', 'Deploy', 'Send'])
  })

  it('with the staff schedule attached at Plan, Backend reads its hours and no crow comes', async () => {
    const e = freshEngine()
    await toGrow(e, (e) => e.attach('backend', MISSING.file))
    expect(e.task('backend').signposts).toContain(MISSING.file)
    await until(e, () => e.harvestReady, 'harvest ready')
    expect(e.hoursFrom).toBe(MISSING.file)
    expect(e.out.hours?.data.saturday).toBe('closed from 1 December')
    expect(e.asks).toHaveLength(0)
    expect(e.crow.state).toBe('none')
    expect(e.gates.backend!.integration).toEqual({ state: 'pass', text: '9 passed' })
    expect(e.log.some((l) => l.text === 'Found Saturday slots with no vet on staging')).toBe(false)
    expect(e.neededYou).toBe(1)
  })
})
