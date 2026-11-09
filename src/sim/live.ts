// Calls the live agents at /api/agent (a server route on Lovable, or the Vite dev API locally).
// Calls are simulated by default (a recorded response to the same prompt), so testing spends no tokens.
// The Live AI switch in settings turns real calls on; a failed live call falls back to the simulated one.

import type { AgentTask, ClarifyOut, ConflictOut, PlanOut, PlanTask, ReviewOut, SessionOut } from '../agent/agents'
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
  session: SessionOut
  sessionV2: SessionOut
  review: ReviewOut
  conflict: ConflictOut
  noConflict: ConflictOut
  tokens: Record<AgentTask, number>
} = {
  clarify: { questions: CLARIFY.map((q) => ({ ...q, options: [...q.options] })) },
  plan: {
    quest_title: FARM.name,
    tasks: { backend: fromTask('backend'), frontend: fromTask('frontend'), tests: fromTask('tests'), docs: fromTask('docs') },
    irreversible: { action: 'Merge PR #482', audience: 'users in Friday’s deploy', count: 12_400 },
  },
  session: {
    endpoint: '/v1/session',
    source: 'web-app/src/api/session.ts',
    code: 'const { token } = await google.signIn()\nawait startSession(token) // post("/v1/session")',
    summary: 'Reuses startSession from src/api/session.ts, the same call email login makes.',
  },
  sessionV2: {
    endpoint: '/v2/session',
    source: 'session-api-v2/CHANGELOG.md',
    code: 'const { token } = await google.signIn()\nawait post("/v2/session", { token })',
    summary: 'Calls POST /v2/session, since the changelog retires /v1/session on Nov 12.',
  },
  review: {
    blocking: [
      {
        file: 'src/auth/google.ts',
        line: 48,
        problem: 'The callback logs the id_token when Google returns an error.',
        code: 'logger.error("google callback failed", { idToken })',
        rule: 'oauth-security.md: never log access_token or id_token.',
      },
    ],
    notes: [
      { title: 'Rate-limit /auth/google/callback', where: 'src/auth/google.ts, line 22' },
      { title: 'The guide uses app.example.com', where: 'docs/auth/google.md, line 6' },
    ],
  },
  conflict: {
    conflict: true,
    endpoints: [
      { endpoint: '/v1/session', farm: FARM.name, source: 'web-app/src/api/session.ts', quote: 'post("/v1/session", { token })' },
      { endpoint: '/v2/session', farm: NEIGHBOUR.name, source: 'session-api-v2/CHANGELOG.md (Nov 8)', quote: '/v1/session removed from staging. Removed from production Nov 12. Use POST /v2/session.' },
    ],
    recommended: '/v2/session',
    why: 'The Platform team owns the session API and retired /v1 on staging yesterday; production follows on Nov 12, the day before your deploy.',
    confidence: 'High',
  },
  noConflict: {
    conflict: false,
    endpoints: [{ endpoint: '/v2/session', farm: FARM.name, source: 'session-api-v2/CHANGELOG.md', quote: 'Use POST /v2/session.' }],
    recommended: '/v2/session',
    why: 'Frontend already calls the endpoint the changelog names.',
    confidence: 'High',
  },
  tokens: { clarify: 1_940, plan: 4_610, session: 3_850, review: 5_420, conflict: 4_180 },
}

const PACE: Record<AgentTask, number> = { clarify: 2_600, plan: 3_000, session: 1_400, review: 2_200, conflict: 1_600 }

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

export type { SessionOut, ReviewOut, ConflictOut, ClarifyOut, PlanOut }
