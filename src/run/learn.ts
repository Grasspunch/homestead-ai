// Learning across runs of the same farm: a task that ran over in one run is planned in two from the start in
// the next. Every number here comes from the runs' own events.
import type { RunEvent } from './types'

const MIN = 60_000

export interface Lesson {
  task: string // the task that ran over
  name: string
  usd: number // what it cost in that run, with its hard cases and the Planner's reads around it
  run: number // which run of the farm it came from
}

// What a task cost in a run: its own steps, its hard cases, its checks, and the Planner's reads on it (the
// ask about it, and the re-plan when it was split).
export function taskCost(events: RunEvent[], task: string): number {
  const mine = new Set([task, `${task}-rest`])
  const replans = events.filter((e) => e.type === 'replan').map((e) => e.t - 0.02 * MIN)
  let usd = 0
  for (const e of events) {
    if (e.type !== 'usage' || e.t <= 0.05 * MIN) continue
    if ((e.task && mine.has(e.task)) || (!e.task && replans.some((t) => Math.abs(e.t - t) <= 2))) usd += e.usd
  }
  return +usd.toFixed(2)
}

// From a finished run: the task that ran over and was split or raised mid-run. A task you stopped teaches nothing.
export function lessonFrom(events: RunEvent[], run: number): Lesson | null {
  const ask = events.find((e) => e.type === 'ask' && e.reason === 'cost' && !e.limitFor && e.task)
  const auto = events.find((e) => e.type === 'auto_fix' && / was heading to /.test(e.what) && e.task)
  const task = ask?.type === 'ask' ? ask.task : auto?.type === 'auto_fix' ? auto.task : undefined
  if (!task) return null
  if (ask?.type === 'ask') {
    const a = events.find((e) => e.type === 'answer' && e.id === ask.id)
    if (!a || a.type !== 'answer' || /^stop/i.test(a.choice)) return null
  }
  const plan = events.find((e) => e.type === 'plan')
  const name = plan?.type === 'plan' ? plan.tasks.find((t) => t.id === task)?.name : undefined
  if (!name) return null
  return { task, name, usd: taskCost(events, task), run }
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`

// What the lesson saved in this run, against the run it came from.
export function savedBy(lesson: Lesson, events: RunEvent[]) {
  return +(lesson.usd - taskCost(events, lesson.task)).toFixed(2)
}

// The Planner's line, on the plan as the run starts and on Done.
export function lessonLine(lesson: Lesson, events: RunEvent[], done = false) {
  const saved = savedBy(lesson, events)
  const less = saved >= 0.01 ? `${done ? '' : 'about '}${usd(saved)} less, and no ask` : 'no ask this time'
  return done
    ? `Learned from run ${lesson.run}: “${lesson.name}” split from the start, ${less}.`
    : `Last time “${lesson.name}” ran over, so I split it from the start: ${less}.`
}
