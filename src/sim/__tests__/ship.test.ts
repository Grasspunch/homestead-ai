// The rollback rule: a failing health check on the canary rolls back on its own when the
// Settings switch is on, and asks you first when it is off. Then the fix, the redeploy and the text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANNOUNCE, SHIP_TEXT } from '../ship'
import { freshEngine, until } from './helpers'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the rollback rule', () => {
  it('rolls back without asking when the switch is on', async () => {
    const e = freshEngine()
    expect(e.settings.deploy.auto_rollback).toBe(true)
    e.startCanary()
    await until(e, () => e.shipStage === 'rolledback', 'rolled back', 30)
    expect(e.rolledBack).toBe(true)
    expect(e.asks.some((a) => a.id === 'rollback')).toBe(false)
    const auto = e.autoDecided.find((l) => l.text.startsWith('Put the “Call us to book” page back'))
    expect(auto?.text).toContain('Availability search p95 rose to 4.2 s on the canary (limit 1 s)')
    expect(auto?.text).toContain('5% of visitors for 6 minutes')
    // What it asks next is the fix.
    expect(e.activeAsk?.id).toBe('fix')
    expect(e.activeAsk?.label).toBe('Failure')
    expect(e.activeAsk?.question).toBe(SHIP_TEXT.fix)
    expect(e.cart.state === 'back' || e.cart.state === 'gate').toBe(true)
  })

  it('asks before rolling back when the switch is off', async () => {
    const e = freshEngine()
    e.setSetting('deploy', 'auto_rollback', false)
    e.startCanary()
    await until(e, () => e.activeAsk?.id === 'rollback', 'rollback ask', 30)
    expect(e.activeAsk?.label).toBe('Failure')
    expect(e.rolledBack).toBe(false)
    expect(e.autoDecided.some((l) => l.text.startsWith('Rolled back'))).toBe(false)
    e.answer('rollback', 'rollback')
    await until(e, () => e.shipStage === 'rolledback', 'rolled back after the answer', 30)
    expect(e.activeAsk?.id).toBe('fix')
  })

  it('keeps a failing canary on 5% when you say so, and rolls back from there', async () => {
    const e = freshEngine()
    e.setSetting('deploy', 'auto_rollback', false)
    e.startCanary()
    await until(e, () => e.activeAsk?.id === 'rollback', 'rollback ask', 30)
    e.answer('rollback', 'keep')
    expect(e.canaryKept).toBe(true)
    expect(e.shipHeadline).toContain('still on 5%')
    // Deploying again is not on offer: the only way on is putting the old page back.
    e.requestDeploy()
    await until(e, () => e.shipStage === 'rolledback', 'rolled back from the kept canary', 30)
    expect(e.canaryKept).toBe(false)
    expect(e.activeAsk?.id).toBe('fix')
  })

  it('asks for the redeploy again, not the fix, after Not now', async () => {
    const e = freshEngine()
    e.startCanary()
    await until(e, () => e.activeAsk?.id === 'fix', 'fix ask', 30)
    e.answer('fix', 'fix')
    await until(e, () => e.activeAsk?.id === 'redeploy', 'redeploy ask', 30)
    e.answer('redeploy', 'hold')
    expect(e.shipStage).toBe('held')
    expect(e.queryFixed).toBe(true)
    expect(e.shipHeadline).toContain('redeploy waits')
    e.requestDeploy()
    expect(e.activeAsk?.id).toBe('redeploy')
    expect(e.asks.filter((a) => a.id === 'fix' && a.status !== 'resolved')).toHaveLength(0)
  })

  it('fixes the search, redeploys with the same confirm, then texts pet owners', async () => {
    const e = freshEngine()
    e.startCanary()
    await until(e, () => e.activeAsk?.id === 'fix', 'fix ask', 30)
    e.answer('fix', 'fix')
    expect(e.shipStage).toBe('fixing')
    await until(e, () => e.activeAsk?.id === 'redeploy', 'redeploy ask', 30)
    const re = e.activeAsk!
    expect(re.label).toBe('Irreversible')
    expect(re.confirmList).toEqual(['Production: willowlanevets.co.uk/book', 'Rollout: 5% canary for 10 minutes, then everyone', 'Roll back: if a health check fails, put the “Call us to book” page back on its own'])
    e.answer('redeploy', 'approve')
    expect(re.status).toBe('confirming')
    e.answer('redeploy', 'approve')
    expect(e.shipStage).toBe('canary2')
    await until(e, () => e.shipStage === 'live', 'live', 30)
    const a = e.activeAsk!
    expect(a.id).toBe('announce')
    expect(a.label).toBe('Irreversible')
    expect(a.impact[0]).toBe('3,000 pet owners by text')
    expect(a.confirmList).toEqual(['To: 3,000 pet owners', 'Message: “You can now book online.”', 'Cost: about £95'])
    e.answer('announce', 'approve')
    e.answer('announce', 'approve')
    expect(e.shipStage).toBe('announced')
    expect(e.shipHeadline).toBe('Saturday bookings at a closed clinic were caught before they reached 3,000 pet owners.')
    expect(e.decisions.slice(-1)[0]).toMatchObject({ word: 'Send', text: `Texted ${ANNOUNCE.audience}` })
  })

  it('retries a known flaky CI test once without asking, and a red run asks', async () => {
    const e = freshEngine()
    e.phase = 'ship'
    e.shipStage = 'ci'
    await until(e, () => e.shipStage === 'deploy', 'CI passes', 30)
    expect(e.ci.e2e.text).toContain('passed on retry')
    expect(e.autoDecided.some((l) => l.text.startsWith('Retried a known flaky test'))).toBe(true)
    expect(e.activeAsk?.id).toBe('deploy')

    const f = freshEngine()
    f.ciOutcomes.integration = 'fail'
    f.phase = 'ship'
    f.shipStage = 'ci'
    await until(f, () => f.shipStage === 'cifailed', 'CI fails', 30)
    expect(f.activeAsk?.id).toBe('ci-integration')
    expect(f.activeAsk?.label).toBe('Failure')
  })
})
