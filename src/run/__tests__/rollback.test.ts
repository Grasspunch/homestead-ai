import { describe, expect, it } from 'vitest'
import { simulatePlan } from '../simPlan'
import { simulateRun } from '../simulate'
import { reduce } from '../reduce'
import { BY_YOU, LEAVE_IT, liveStage, rollBack } from '../rollback'
import type { RunEvent } from '../types'

const GOAL = 'Build an AI support assistant that answers from our help docs'
const ev = simulateRun({ goal: GOAL, ...simulatePlan(GOAL) })
const deploys = ev.filter((e): e is Extract<RunEvent, { type: 'deploy' }> => e.type === 'deploy')
const end = (x: RunEvent[]) => reduce(x, Number.MAX_SAFE_INTEGER)

describe('rolling back yourself', () => {
  it('does nothing when no release is live', () => {
    expect(liveStage(ev, deploys[0].t - 1)).toBeNull()
    expect(rollBack(ev, deploys[0].t - 1, 'ask-rb-1')).toBe(ev)
  })

  it('beats the automatic rollback on a release going bad, and the fix comes sooner', () => {
    const t0 = deploys[0].t + 30_000
    const out = rollBack(ev, t0, 'ask-rb-1')
    const rb = out.find((e) => e.type === 'deploy' && e.stage === 'rollback')
    expect(rb && rb.type === 'deploy' && rb.reason).toBe(BY_YOU)
    expect(rb!.t).toBe(t0)
    expect(out[out.length - 1].t).toBeLessThan(ev[ev.length - 1].t)
    expect(end(out).deploy.map((d) => d.stage)).toEqual(['10%', 'rollback', '10%', '100%'])
  })

  it('takes a healthy release down, then ships again or leaves it', () => {
    const live = deploys.find((d) => d.stage === '100%')!
    const t0 = live.t + 30_000
    const again = rollBack(ev, t0, 'ask-rb-1')
    expect(again.some((e) => e.type === 'ask' && e.id === 'ask-rb-1')).toBe(true)
    expect(end(again).deploy.map((d) => d.stage).slice(-3)).toEqual(['rollback', '10%', '100%'])
    const left = rollBack(ev, t0, 'ask-rb-1', LEAVE_IT)
    const s = end(left)
    expect(s.deploy[s.deploy.length - 1].stage).toBe('rollback')
    expect(s.done).toBeTruthy()
    expect(s.tasks.find((t) => t.gate)?.stopped).toBeTruthy()
  })
})
