// Calls the live agents at /api/agent (a server route on Lovable, or the Vite dev API locally).
// Calls are simulated by default (a recorded response to the same prompt), so testing spends no tokens.
// The Live AI switch in settings turns real calls on; a failed live call falls back to the simulated one.

import type { AgentTask, ClaimsOut, ClarifyOut, ConflictOut, DraftOut, PlanOut, PlanTask } from '../agent/agents'
import { CLARIFY, FARM, TASKS } from './scenario'

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

// Recorded outputs from a real run of the same prompts. Used only when live calls are unavailable.
const fromTask = (id: string): PlanTask => {
  const t = TASKS.find((x) => x.id === id)!
  return { name: t.name, subtasks: t.subtasks.map((s) => s.name), assignee: t.proposedAssignee, budget: t.budget, signposts: [...t.signposts], note: t.proposalNote ?? null }
}

export const RECORDED: {
  clarify: ClarifyOut
  plan: PlanOut
  draft: DraftOut
  draftWithEngNotes: DraftOut
  claims: ClaimsOut
  conflict: ConflictOut
  noConflict: ConflictOut
  tokens: Record<AgentTask, number>
} = {
  clarify: { questions: CLARIFY.map((q) => ({ ...q, options: [...q.options] })) },
  plan: {
    quest_title: FARM.name,
    tasks: { gather: fromTask('research'), make: fromTask('draft'), check: fromTask('factcheck'), polish: fromTask('brand'), send: fromTask('invites') },
    irreversible: { action: 'Send the webinar invite', audience: 'people at 6 pilot customers', count: 42 },
  },
  draft: {
    headline: 'Relay v2: sync that keeps up with your team',
    paragraphs: [
      'Relay v2 reaches pilot teams on March 12. Changes now sync up to 3x faster, so the doc you open is the doc your team just edited.',
      'Single sign-on through the new Auth SDK works with Okta, Google Workspace and Entra ID, which was the most requested change from our pilots.',
      '“We used to start every standup asking which version was current. That question is gone.” (Ops lead, Acme)',
    ],
    launch_date: 'March 12',
    launch_date_source: 'customer-call-notes.md',
    claims: [
      { text: 'Available March 12', source: 'customer-call-notes.md' },
      { text: 'Up to 3x faster sync', source: null },
      { text: 'SSO with Okta, Google Workspace and Entra ID', source: 'product-brief-relay-v2.pdf' },
    ],
  },
  get draftWithEngNotes() {
    const d = RECORDED.draft
    return {
      ...d,
      paragraphs: d.paragraphs.map((p) => p.replace('March 12', 'March 26')),
      launch_date: 'March 26',
      launch_date_source: 'eng-standup-notes/2026-02-03.md',
      claims: d.claims.map((c) => (c.text.includes('March 12') ? { text: 'Available March 26', source: 'eng-standup-notes/2026-02-03.md' } : c)),
    }
  },
  claims: {
    checked: 4,
    issues: [
      {
        claim: 'Changes now sync up to 3x faster',
        problem: 'The draft gives no source for the 3x figure.',
        fix: 'Cite benchmarks-q4.xlsx row 14: sync to peers p50 1.9s → 0.6s (3.2x).',
        confidence: 'High',
      },
    ],
  },
  conflict: {
    conflict: true,
    dates: [
      { date: 'March 12', farm: FARM.name, source: 'customer-call-notes.md (Jan 28)', quote: 'We told Acme they would have v2 by March 12.' },
      { date: 'March 26', farm: 'Auth SDK v2', source: 'eng-standup-notes/2026-02-03.md', quote: 'v2 release moves to March 26.' },
    ],
    recommended_date: 'March 26',
    why: 'The engineering note is newer and comes from the team that ships the release; March 12 was a promise made before the delay.',
    confidence: 'High',
  },
  noConflict: {
    conflict: false,
    dates: [{ date: 'March 26', farm: FARM.name, source: 'eng-standup-notes/2026-02-03.md', quote: 'v2 release moves to March 26.' }],
    recommended_date: 'March 26',
    why: 'The draft already uses the date from the newest engineering note.',
    confidence: 'High',
  },
  tokens: { clarify: 1_940, plan: 4_610, draft: 3_850, claims: 2_420, conflict: 4_180 },
}

// Simulated by default, so testing spends no tokens. The Live AI switch in settings turns real calls on.
let liveAI = false
export function setLiveAI(on: boolean) {
  liveAI = on
}

export async function callAgent<T>(task: AgentTask, input: Record<string, unknown>, recorded: T): Promise<Outcome<T>> {
  const t0 = performance.now()
  const replay = (error?: string): Outcome<T> => ({ data: recorded, tokens: RECORDED.tokens[task], provenance: 'replay', ms: performance.now() - t0, error })
  if (!liveAI || !(await probeLive())) {
    // A short pause so a simulated response paces like a real call.
    await new Promise((r) => setTimeout(r, 900))
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

export type { DraftOut, ClaimsOut, ConflictOut, ClarifyOut, PlanOut }
