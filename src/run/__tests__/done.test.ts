// Done's first line counts what the farm shows: every plot, the release and the split-off hard cases included.
import { beforeAll, describe, expect, it } from 'vitest'
import { doneLead } from '../done'
import { duration, reduce } from '../reduce'
import { store } from '../store'
import type { RunState, TaskState } from '../types'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const task = (id: string, extra: Partial<TaskState> = {}) => ({ id, status: 'accepted', ...extra }) as TaskState
const st = (tasks: TaskState[], stage?: string) => ({ tasks, deploy: stage ? [{ stage }] : [] }) as unknown as Pick<RunState, 'tasks' | 'deploy'>

describe('doneLead', () => {
  it('counts the release plot with the work', () => {
    expect(doneLead(st([task('a'), task('b'), task('ship', { gate: true } as Partial<TaskState>)], '100%'))).toBe('All 3 tasks are in and live for everyone.')
  })
  it('says how many of all the plots are done when some are not', () => {
    expect(doneLead(st([task('a'), task('b'), task('ship', { status: 'growing' })], 'rollback'))).toBe('2 of 3 tasks done, rolled back, so nothing is live.')
  })
  it('names tasks you cut short', () => {
    expect(doneLead(st([task('a', { stopped: 'you' }), task('b')], '100%'))).toBe('All 2 tasks are in, 1 of them cut short by you, and live for everyone.')
  })
  it('on the sample, matches the number of plots after the split', () => {
    store.loadSample()
    const p = store.projects.find((x) => x.id === 'sample')!
    store.open('sample')
    store.pause()
    for (let i = 0; i < 30; i++) {
      const a = p.events.find((e) => e.type === 'ask' && !(p.answers ?? {})[e.id])
      if (!a || a.type !== 'ask') break
      p.clock = Math.max(p.clock ?? 0, a.t)
      store.answer(a.id, a.suggested)
    }
    const s = reduce(p.events, duration(p.events), p.answers ?? {})
    const n = s.tasks.length
    expect(s.tasks.some((t) => /hard cases/i.test(t.name))).toBe(true)
    expect(doneLead(s)).toMatch(new RegExp(`^(All ${n} tasks are in|\\d+ of ${n} tasks done)`))
  })
})
