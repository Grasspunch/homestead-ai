// The rollback rule: a failing health check on the canary rolls back on its own when the
// Settings switch is on, and asks you first when it is off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELEASE } from '../ship'
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
    const auto = e.autoDecided.find((l) => l.text.startsWith(`Rolled back to ${RELEASE.previous}`))
    expect(auto?.text).toContain('71%')
    expect(auto?.text).toContain('5% of users for 6 minutes')
    // The only thing it asks is what an agent can't do: the redirect URI.
    expect(e.activeAsk?.id).toBe('redirect')
    expect(e.activeAsk?.label).toBe('Anomaly')
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
    expect(e.activeAsk?.id).toBe('redirect')
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
