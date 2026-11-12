// Browser client for the live agents at /api/agent (a server route on Lovable, or the Vite dev API locally).
// A failed call throws and the caller shows the error. For the demo goals only, a live plan kept from an earlier
// call stands in (see recorded.ts): a recorded plan can't match an arbitrary goal.

import type { AgentTask, PlanOut, ReshapeOut, RouteInput, RouteOut, ShipIn, ShipOut, Source } from '../agent/agents'
import type { Ctx as ReshapeCtx } from './reshape'
import type { Talk, TalkLine } from './discuss'
import type { AskTalkIn, AskTalkOut, ChatIn, ChatOut } from './talk'

export type { PlanOut, RouteInput, RouteOut, ShipOut } from '../agent/agents'

export type LiveResult<T> = T & { tokens: number; usd: number; model?: string; source?: Source }

// What each live call cost, at list prices, for whoever keeps the tally (the open farm).
const costWatchers = new Set<(usd: number, task: AgentTask) => void>()
export function onLiveCost(fn: (usd: number, task: AgentTask) => void) {
  costWatchers.add(fn)
  return () => {
    costWatchers.delete(fn)
  }
}

// Who answered a live call, as the screen says it.
export const SOURCE: Record<Source, string> = { lovable: 'Lovable AI', anthropic: 'your Anthropic key', openai: 'your OpenAI key' }

const ENDPOINT = '/api/agent'
const HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

// Which models the server can run live, by maker, and whether it goes through Lovable AI. Yes or no, never a key.
export interface Keys {
  anthropic: boolean
  openai: boolean
  gateway: boolean
  own: { anthropic: boolean; openai: boolean } // the person's own keys, used when Lovable AI is out of credits
  github: string | null // the repository a real pull request goes to, when the server has one
}
let keysAvailable: Promise<Keys> | null = null

// Cached for the page's life; a failed probe means no keys.
export function probeKeys(): Promise<Keys> {
  keysAvailable ??= fetch(ENDPOINT, { headers: HEADERS })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j: { live?: boolean; gateway?: boolean; keys?: Partial<Keys>; own?: Partial<Keys['own']>; github?: string | null }) => ({
      anthropic: !!(j.keys?.anthropic ?? j.live),
      openai: !!j.keys?.openai,
      gateway: !!j.gateway,
      own: { anthropic: !!j.own?.anthropic, openai: !!j.own?.openai },
      github: typeof j.github === 'string' && j.github ? j.github : null,
    }))
    .catch(() => ({ anthropic: false, openai: false, gateway: false, own: { anthropic: false, openai: false }, github: null }))
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

// Lovable's gateway said no: out of credits, rate limited, or it doesn't know the model id. Or this visitor used up
// its share of live calls for now. The call is simulated.
export class GatewayRefused extends Error {
  constructor(public code: 'credits' | 'rate' | 'model' | 'visitor', model?: string) {
    super(
      code === 'credits'
        ? 'Simulated (out of credits)'
        : code === 'visitor'
          ? 'Live AI limit for this visitor reached for a few minutes, simulated instead'
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
  let body: { data?: T; tokens?: number; usd?: number; model?: string; source?: Source; error?: string; missing?: 'anthropic' | 'openai'; code?: 'credits' | 'rate' | 'model' | 'visitor' } | null = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (res.status === 503 && body?.missing) throw new KeyMissing(body.missing)
  if (res.status === 402) throw new GatewayRefused('credits')
  // A real pull request says why in its own words, since nothing stands in for it.
  if (res.status === 429 && task === 'ship' && body?.error) throw new Error(body.error)
  if (res.status === 429) throw new GatewayRefused(body?.code === 'visitor' ? 'visitor' : 'rate')
  if (body?.code === 'model') throw new GatewayRefused('model', (body as { model?: string }).model)
  if (!res.ok || !body || body.data === undefined) {
    const why = body?.error ?? (res.ok ? 'The agent sent back no answer.' : `The agent server answered ${res.status}.`)
    throw new Error(task === 'ship' ? `Couldn't open the pull request: ${why}` : task === 'plan' ? `Couldn't make a plan: ${why}` : task === 'reshape' ? `Couldn't read the change: ${why}` : task === 'discuss' || task === 'talk' || task === 'chat' ? `Couldn't answer that: ${why}` : `Couldn't route the message: ${why}`)
  }
  const usd = typeof body.usd === 'number' && Number.isFinite(body.usd) ? body.usd : 0
  for (const fn of costWatchers) fn(usd, task)
  return { ...body.data, tokens: body.tokens ?? 0, usd, model: body.model, source: body.source }
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

// A question about a disagreement, answered on the model of the side it's about.
export function discussLive(question: string, talk: Talk, model?: string): Promise<LiveResult<{ lines: TalkLine[] }>> {
  return call<{ lines: TalkLine[] }>('discuss', { question, talk, model })
}

// Talking an ask through, on the asking agent's model.
export function askTalkLive(inp: AskTalkIn, model?: string): Promise<LiveResult<AskTalkOut>> {
  return call<AskTalkOut>('talk', { ...inp, model })
}

// A message to the Planner, answered from the run as it stands.
export function chatLive(inp: ChatIn, model?: string): Promise<LiveResult<ChatOut>> {
  return call<ChatOut>('chat', { ...inp, model })
}

// The one real step of a run: the Builder writes the change into the server's demo repository and opens a pull
// request there. Nothing stands in for it: a failure says why.
export function shipLive(inp: ShipIn, model?: string): Promise<LiveResult<ShipOut>> {
  return call<ShipOut>('ship', { ...inp, model })
}
