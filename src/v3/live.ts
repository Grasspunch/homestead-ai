// Calls the live agents at /api/agent (a server route on Lovable, or the Vite dev API locally).
// When no key is configured the farm runs in practice mode: a built-in stand-in answers, and
// everything it writes is labelled as practice text so nothing canned passes as live.

import type { AgentTask, PlanOut, ReviewIn, ReviewOut, StepIn, StepOut, TalkOut } from '../agent/agents'
import { practicePlan, practiceReview, practiceStep, practiceTalk } from './practice'

export interface Outcome<T> {
  data: T
  tokens: number
  cost: number
  ms: number
  practice: boolean
}

const ENDPOINT = '/api/agent'
const HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

const forcePractice = typeof location !== 'undefined' && new URLSearchParams(location.search).has('practice')
/** `?fast` shortens the practice pauses, for tests and screenshots. */
const fast = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fast')

let liveAvailable: Promise<boolean> | null = null
export function probeLive(): Promise<boolean> {
  if (forcePractice || typeof fetch === 'undefined' || typeof location === 'undefined') return Promise.resolve(false)
  liveAvailable ??= fetch(ENDPOINT, { headers: HEADERS })
    .then((r) => (r.ok ? r.json() : { live: false }))
    .then((j: { live?: boolean }) => !!j.live)
    .catch(() => false)
  return liveAvailable
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, fast ? Math.min(ms, 250) : ms))

export type Caller = <T>(task: AgentTask, input: Record<string, unknown>) => Promise<Outcome<T>>

/** The real caller. Tests swap in their own with `setCaller`. */
const liveCaller: Caller = async <T,>(task: AgentTask, input: Record<string, unknown>): Promise<Outcome<T>> => {
  const t0 = Date.now()
  if (!(await probeLive())) {
    let data: unknown
    if (task === 'plan') {
      await wait(1600)
      data = practicePlan(input as unknown as Parameters<typeof practicePlan>[0]) satisfies PlanOut
    } else if (task === 'talk') {
      await wait(900)
      data = practiceTalk(input as unknown as Parameters<typeof practiceTalk>[0]) satisfies TalkOut
    } else if (task === 'review') {
      await wait(3200)
      data = practiceReview(input as unknown as ReviewIn) satisfies ReviewOut
    } else {
      await wait(2600 + Math.random() * 1800)
      data = practiceStep(input as unknown as StepIn) satisfies StepOut
    }
    return { data: data as T, tokens: 0, cost: 0, ms: Date.now() - t0, practice: true }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120_000)
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify({ task, input }), signal: ctrl.signal })
    const body = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }))
    if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`)
    return { data: body.data as T, tokens: body.tokens ?? 0, cost: body.cost ?? 0, ms: Date.now() - t0, practice: false }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('The agent took longer than two minutes and was stopped.')
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}

let caller: Caller = liveCaller
export const callAgent: Caller = (task, input) => caller(task, input)
export function setCaller(c: Caller | null) {
  caller = c ?? liveCaller
}
