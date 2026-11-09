// Calls the live agents at /api/agent (a server route on Lovable, or the Vite dev API locally).
// If no key is configured or a call fails, the demo uses a recorded run of the same call
// and labels it "Replay" on screen, so nothing canned passes as live.

import type { AgentTask, ClaimsOut, ConflictOut, DraftOut } from '../agent/agents'

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
export const RECORDED: { draft: DraftOut; claims: ClaimsOut; conflict: ConflictOut; tokens: Record<AgentTask, number> } = {
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
      { date: 'March 12', farm: 'Q1 Launch', source: 'customer-call-notes.md (Jan 28)', quote: 'We told Acme they would have v2 by March 12.' },
      { date: 'March 26', farm: 'Auth SDK v2', source: 'eng-standup-notes/2026-02-03.md', quote: 'v2 release moves to March 26.' },
    ],
    recommended_date: 'March 26',
    why: 'The engineering note is newer and comes from the team that ships the release; March 12 was a promise made before the delay.',
    confidence: 'High',
  },
  tokens: { draft: 3_850, claims: 2_420, conflict: 1_960 },
}

export async function callAgent<T>(task: AgentTask, input: Record<string, unknown>, recorded: T): Promise<Outcome<T>> {
  const t0 = performance.now()
  const replay = (error?: string): Outcome<T> => ({ data: recorded, tokens: RECORDED.tokens[task], provenance: 'replay', ms: performance.now() - t0, error })
  if (!(await probeLive())) {
    // A short pause so the replay paces like a real call.
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

export type { DraftOut, ClaimsOut, ConflictOut }
