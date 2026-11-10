// Browser client for the live agents at /api/agent (a server route on Lovable, or the Vite dev API locally).
// There is no recorded fallback for 'plan': a recorded plan can't match an arbitrary goal,
// so a failed call throws and the caller shows the error.

import type { AgentTask, PlanOut, RouteInput, RouteOut } from '../agent/agents'

export type { PlanOut, RouteInput, RouteOut } from '../agent/agents'

export type LiveResult<T> = T & { tokens: number; model?: string }

const ENDPOINT = '/api/agent'
const HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

let liveAvailable: Promise<boolean> | null = null

// Whether the server has an API key. Cached for the page's life; a failed probe means not live.
export function probeLive(): Promise<boolean> {
  liveAvailable ??= fetch(ENDPOINT, { headers: HEADERS })
    .then((r) => (r.ok ? r.json() : { live: false }))
    .then((j: { live?: boolean }) => !!j.live)
    .catch(() => false)
  return liveAvailable
}

// For tests.
export function resetLiveProbe() {
  liveAvailable = null
}

async function call<T>(task: AgentTask, input: Record<string, unknown>): Promise<LiveResult<T>> {
  let res: Response
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify({ task, input }) })
  } catch {
    throw new Error('Could not reach the agent server.')
  }
  let body: { data?: T; tokens?: number; model?: string; error?: string } | null = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok || !body || body.data === undefined) {
    const why = body?.error ?? (res.ok ? 'The agent sent back no answer.' : `The agent server answered ${res.status}.`)
    throw new Error(task === 'plan' ? `Couldn't make a plan: ${why}` : `Couldn't route the message: ${why}`)
  }
  return { ...body.data, tokens: body.tokens ?? 0, model: body.model }
}

export function planGoal(goal: string, crewSize?: number | string[]): Promise<LiveResult<PlanOut>> {
  if (Array.isArray(crewSize)) return call<PlanOut>('plan', { goal: `${goal}\n\nUse exactly this crew: ${crewSize.join(', ')}.`, crewSize: crewSize.length })
  return call<PlanOut>('plan', crewSize === undefined ? { goal } : { goal, crewSize })
}

export function routeMessage(message: string, farmers: RouteInput['farmers'], tasks: RouteInput['tasks']): Promise<LiveResult<RouteOut>> {
  return call<RouteOut>('route', { message, farmers, tasks })
}
