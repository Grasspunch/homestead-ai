// Browser client for the live agents at /api/agent (a server route on Lovable, or the Vite dev API locally).
// There is no recorded fallback for 'plan': a recorded plan can't match an arbitrary goal,
// so a failed call throws and the caller shows the error.

import type { AgentTask, PlanOut, ReshapeOut, RouteInput, RouteOut } from '../agent/agents'
import type { Ctx as ReshapeCtx } from './reshape'

export type { PlanOut, RouteInput, RouteOut } from '../agent/agents'

export type LiveResult<T> = T & { tokens: number; model?: string }

const ENDPOINT = '/api/agent'
const HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

// Which models the server can run live, by maker, and whether it goes through Lovable AI. Yes or no, never a key.
export interface Keys {
  anthropic: boolean
  openai: boolean
  gateway: boolean
}
let keysAvailable: Promise<Keys> | null = null

// Cached for the page's life; a failed probe means no keys.
export function probeKeys(): Promise<Keys> {
  keysAvailable ??= fetch(ENDPOINT, { headers: HEADERS })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j: { live?: boolean; gateway?: boolean; keys?: Partial<Keys> }) => ({ anthropic: !!(j.keys?.anthropic ?? j.live), openai: !!j.keys?.openai, gateway: !!j.gateway }))
    .catch(() => ({ anthropic: false, openai: false, gateway: false }))
  return keysAvailable
}

// Whether the server has an Anthropic key, which the default Claude Planner needs.
export function probeLive(): Promise<boolean> {
  return probeKeys().then((k) => k.anthropic)
}

// For tests.
export function resetLiveProbe() {
  keysAvailable = null
}

// The server can't run the model this call needed.
export class KeyMissing extends Error {
  constructor(public provider: 'anthropic' | 'openai') {
    super(provider === 'openai' ? 'Lovable AI not set up, simulated' : 'Anthropic key not set, simulated')
  }
}

// Lovable's gateway said no: out of credits, rate limited, or it doesn't know the model id. The call is simulated.
export class GatewayRefused extends Error {
  constructor(public code: 'credits' | 'rate' | 'model', model?: string) {
    super(
      code === 'credits'
        ? 'Out of Lovable credits, simulated instead'
        : code === 'rate'
          ? 'Lovable AI rate limit reached, simulated instead'
          : `Lovable AI doesn't offer the model "${model ?? '?'}", simulated instead. Check its id in src/run/kit.ts.`,
    )
  }
}

async function call<T>(task: AgentTask, input: Record<string, unknown>): Promise<LiveResult<T>> {
  let res: Response
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify({ task, input }) })
  } catch {
    throw new Error('Could not reach the agent server.')
  }
  let body: { data?: T; tokens?: number; model?: string; error?: string; missing?: 'anthropic' | 'openai'; code?: 'credits' | 'rate' | 'model' } | null = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (res.status === 503 && body?.missing) throw new KeyMissing(body.missing)
  if (res.status === 402) throw new GatewayRefused('credits')
  if (res.status === 429) throw new GatewayRefused('rate')
  if (body?.code === 'model') throw new GatewayRefused('model', (body as { model?: string }).model)
  if (!res.ok || !body || body.data === undefined) {
    const why = body?.error ?? (res.ok ? 'The agent sent back no answer.' : `The agent server answered ${res.status}.`)
    throw new Error(task === 'plan' ? `Couldn't make a plan: ${why}` : task === 'reshape' ? `Couldn't read the change: ${why}` : `Couldn't route the message: ${why}`)
  }
  return { ...body.data, tokens: body.tokens ?? 0, model: body.model }
}

// `model` is the Planner's model, by its picker name: the server picks the provider and model id from it.
export function planGoal(goal: string, crewSize?: number | string[], model?: string): Promise<LiveResult<PlanOut>> {
  if (Array.isArray(crewSize)) return call<PlanOut>('plan', { goal: `${goal}\n\nUse exactly this crew: ${crewSize.join(', ')}.`, crewSize: crewSize.length, model })
  return call<PlanOut>('plan', crewSize === undefined ? { goal, model } : { goal, crewSize, model })
}

export function routeMessage(message: string, farmers: RouteInput['farmers'], tasks: RouteInput['tasks'], model?: string): Promise<LiveResult<RouteOut>> {
  return call<RouteOut>('route', { message, farmers, tasks, model })
}

export function reshapeLive(message: string, ctx: ReshapeCtx, model?: string): Promise<LiveResult<ReshapeOut>> {
  return call<ReshapeOut>('reshape', { message, ctx, model })
}
