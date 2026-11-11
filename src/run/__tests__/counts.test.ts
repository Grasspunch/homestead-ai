// Numbers that must agree wherever they're shown: minutes, the task count on Home and in the top bar, and the
// commits the merge question names against the pull request window's.
import { describe, expect, it } from 'vitest'
import { mins as screenMins } from '../../hud/bits'
import { mins as exportMins } from '../export'
import { taskCount } from '../done'
import { reduce } from '../reduce'
import { simulatePlan } from '../simPlan'
import { fitLimits, simulateRun } from '../simulate'
import { prOf } from '../files'
import { AUTONOMY_PRESETS, type RunState } from '../types'

describe('minutes', () => {
  for (const [name, mins] of [['on screen', screenMins], ['in exports', exportMins]] as const)
    it(`rounds first, then splits hours and minutes, ${name}`, () => {
      expect(mins(119.7)).toBe('2 h 0 min')
      expect(mins(59.6)).toBe('1 h 0 min')
      expect(mins(59.4)).toBe('59 min')
      expect(mins(99.2)).toBe('1 h 39 min')
      expect(mins(60)).toBe('1 h 0 min')
      expect(mins(0.3)).toBe('0 min')
    })
})

describe('task count', () => {
  const task = (id: string, status: RunState['tasks'][number]['status'], gate = false) => ({ id, status, gate }) as unknown as RunState['tasks'][number]
  it('counts every plot, the release included, done once its check passed', () => {
    const tasks = [task('a', 'accepted'), task('b', 'ripe'), task('c', 'growing'), task('ship', 'waiting', true)]
    expect(taskCount({ tasks })).toEqual({ done: 2, total: 4 })
  })
  it('says the same as the top bar on a real run, release included', () => {
    const goal = 'Build an AI support assistant that answers from our help docs'
    const plan = simulatePlan(goal)
    const ev = simulateRun({ goal, ...plan, autonomy: AUTONOMY_PRESETS.matters })
    const s = reduce(ev, 20 * 60_000)
    const c = taskCount(s)
    expect(c.total).toBe(s.tasks.length)
    expect(s.tasks.some((t) => t.gate)).toBe(true)
    expect(c.done).toBe(s.tasks.filter((t) => t.status === 'ripe' || t.status === 'accepted').length)
  })
})

describe('commits in the merge question', () => {
  for (const goal of [
    'Build an AI support assistant that answers customer questions from a shop’s help pages, and hands off to a person when it is not sure',
    'Add a checkout page with card payments',
    'Build a metrics dashboard for our API',
  ])
    it(`match the pull request window, refactor included: ${goal.slice(0, 32)}…`, () => {
      const plan = simulatePlan(goal)
      plan.farmers = fitLimits({ goal, ...plan })
      const ev = simulateRun({ goal, ...plan, autonomy: AUTONOMY_PRESETS.matters })
      const ship = ev.filter((e) => e.type === 'ask' && e.reason === 'irreversible').pop()
      if (!ship || ship.type !== 'ask') throw new Error('no merge question')
      const said = Number(ship.question.match(/(\d+) commits/)?.[1])
      const pr = prOf(reduce(ev, ship.t), goal)
      expect(pr.commits.some((c) => c.kind === 'refactor')).toBe(true)
      expect(said).toBe(pr.commits.length)
    })
})
