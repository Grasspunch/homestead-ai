// Calls the live agents at /api/agent (a server route on Lovable, or the Vite dev API locally).
// Calls are simulated by default (a recorded response to the same prompt), so testing spends no tokens.
// The Live AI switch in settings turns real calls on; a failed live call falls back to the simulated one.

import type { AgentTask, ClarifyOut, ConflictOut, HoursOut, PlanOut, PlanTask, ReviewOut } from '../agent/agents'
import { CLARIFY, FARM, NEIGHBOUR, TASKS } from './scenario'

export type Provenance = 'live' | 'replay'

export interface Outcome<T> {
  data: T
  tokens: number
  provenance: Provenance
  ms: number
  error?: string
}

const ENDPOINT = '/api/agent'
const HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

const forceReplay = typeof location !== 'undefined' && new URLSearchParams(location.search).has('replay')

let liveAvailable: Promise<boolean> | null = null
export function probeLive(): Promise<boolean> {
  if (forceReplay) return Promise.resolve(false)
  liveAvailable ??= fetch(ENDPOINT, { headers: HEADERS })
    .then((r) => (r.ok ? r.json() : { live: false }))
    .then((j: { live?: boolean }) => !!j.live)
    .catch(() => false)
  return liveAvailable
}

// Recorded outputs from a real run of the same prompts. Used when Live AI is off or a live call fails.
const fromTask = (id: string): PlanTask => {
  const t = TASKS.find((x) => x.id === id)!
  return { name: t.name, subtasks: t.subtasks.map((s) => s.name), assignee: t.proposedAssignee as PlanTask['assignee'], budget: t.budget, signposts: [...t.signposts], note: t.proposalNote ?? null }
}

export const RECORDED: {
  clarify: ClarifyOut
  plan: PlanOut
  hours: HoursOut
  hoursRota: HoursOut
  review: ReviewOut
  conflict: ConflictOut
  noConflict: ConflictOut
  tokens: Record<AgentTask, number>
} = {
  clarify: { questions: CLARIFY.map((q) => ({ ...q, options: [...q.options] })) },
  plan: {
    quest_title: FARM.name,
    tasks: { frontend: fromTask('frontend'), backend: fromTask('backend'), messaging: fromTask('messaging') },
    irreversible: { action: 'Text every pet owner that booking is open', audience: 'pet owners on the clinic’s list', count: 3_000 },
  },
  hours: {
    weekdays: '8:00 to 19:00',
    saturday: '9:00 to 13:00',
    source: 'front-desk-hours.csv',
    summary: 'Offers 15-minute slots Monday to Friday 8:00 to 19:00 and Saturday 9:00 to 13:00, from the front desk’s hours sheet.',
  },
  hoursRota: {
    weekdays: '8:00 to 19:00',
    saturday: 'closed from 1 December',
    source: 'staff-schedule/schedule.md',
    summary: 'Offers weekday slots only from 1 December, since the staff schedule has no vet on Saturdays from then.',
  },
  review: {
    blocking: [],
    notes: [
      { title: 'Rate-limit POST /bookings', where: 'src/api/bookings.ts, line 12' },
      { title: 'Put the clinic’s phone number in the reminder', where: 'src/messaging/reminder.ts, line 9' },
    ],
  },
  conflict: {
    conflict: true,
    claims: [
      { claim: 'Saturdays 9:00 to 13:00', farm: FARM.name, source: 'front-desk-hours.csv (Aug 14)', quote: 'Saturday,9:00,13:00' },
      { claim: 'Closed on Saturdays from 1 December', farm: NEIGHBOUR.name, source: 'staff-schedule/schedule.md (Nov 3)', quote: 'No vet works Saturdays from 1 December. The clinic is closed on Saturdays from that date.' },
    ],
    recommended: 'the staff schedule',
    why: 'The Practice team owns the schedule and changed it last week; the hours sheet was last edited in August.',
    confidence: 'High',
  },
  noConflict: {
    conflict: false,
    claims: [{ claim: 'Closed on Saturdays from 1 December', farm: FARM.name, source: 'staff-schedule/schedule.md', quote: 'No vet works Saturdays from 1 December.' }],
    recommended: 'the staff schedule',
    why: 'Backend already reads its hours from the staff schedule.',
    confidence: 'High',
  },
  tokens: { clarify: 2_380, plan: 4_610, hours: 3_120, review: 5_420, conflict: 4_180 },
}

const PACE: Record<AgentTask, number> = { clarify: 2_600, plan: 3_000, hours: 1_400, review: 2_200, conflict: 1_600 }

// Simulated by default, so testing spends no tokens. The Live AI switch in settings turns real calls on.
let liveAI = false
export function setLiveAI(on: boolean) {
  liveAI = on
}

export async function callAgent<T>(task: AgentTask, input: Record<string, unknown>, recorded: T): Promise<Outcome<T>> {
  const t0 = performance.now()
  const replay = (error?: string): Outcome<T> => ({ data: recorded, tokens: RECORDED.tokens[task], provenance: 'replay', ms: performance.now() - t0, error })
  if (!liveAI || !(await probeLive())) {
    // A pause so a simulated response paces like a real call, long enough to watch the head farmer work.
    await new Promise((r) => setTimeout(r, PACE[task]))
    return replay()
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 45_000)
    const res = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify({ task, input }), signal: ctrl.signal })
    clearTimeout(timer)
    const body = await res.json()
    if (!res.ok) return replay(body.error ?? `HTTP ${res.status}`)
    return { data: body.data as T, tokens: body.tokens, provenance: 'live', ms: performance.now() - t0 }
  } catch (e) {
    return replay(e instanceof Error ? e.message : String(e))
  }
}

export type { HoursOut, ReviewOut, ConflictOut, ClarifyOut, PlanOut }
