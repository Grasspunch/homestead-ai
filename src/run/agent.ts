// The Planner the app talks to. Simulated by default, so trying it spends no tokens.
// Live mode (Settings) sends the same requests to the real Planner through /api/agent, which on Lovable calls
// every model through Lovable AI, paid with workspace credits.
// A failed live call, one the server can't run, or one Lovable AI refuses (credits, rate limit) falls back to the
// simulation and says why.

import type { PlanOut, RouteInput, RouteOut } from '../agent/agents'
import type { FarmerId } from './types'
import { GatewayRefused, KeyMissing, SOURCE, discussLive, planGoal as livePlan, probeKeys, reshapeLive, routeMessage as liveRoute } from './live'
import { providerOf } from './kit'
import { changesFromLive, type Ctx as ReshapeCtx, type Proposal } from './reshape'
import { simulatePlan, simulateRoute } from './simPlan'
import { discussSim, type Talk, type TalkLine } from './discuss'

const KEY = 'homestead.live'

export function getLiveMode(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setLiveMode(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // Private windows: the switch lasts for this page only.
  }
  live = on
}

let live = getLiveMode()

export interface AgentAnswer<T> {
  data: T
  live: boolean
  error?: string // why a live call fell back
  source?: string // who answered a live call: "Lovable AI", "your Anthropic key" or "your OpenAI key"
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// What a live call couldn't do: the server can't run its model, so it was simulated.
export const NO_KEY = { anthropic: 'Anthropic key not set, simulated', openai: 'Lovable AI not set up, simulated' }

// Notes that say a call was simulated for an expected reason, not because it broke.
export const isFallbackNote = (note?: string) =>
  !!note && (Object.values(NO_KEY).includes(note) || note === new GatewayRefused('credits').message || note === new GatewayRefused('rate').message)

const noteOf = (e: unknown) => (e instanceof KeyMissing ? NO_KEY[e.provider] : e instanceof Error ? e.message : String(e))

// `model` is the Planner's model. On Lovable both makers run through Lovable AI; in local dev without it, only Claude.
async function run<T>(liveCall: () => Promise<T>, sim: () => T, paceMs: number, model?: string): Promise<AgentAnswer<T>> {
  const provider = providerOf(model)
  if (live && (await probeKeys())[provider]) {
    try {
      const data = await liveCall()
      const src = (data as { source?: keyof typeof SOURCE }).source
      return { data, live: true, source: src && SOURCE[src] }
    } catch (e) {
      return { data: sim(), live: false, error: noteOf(e) }
    }
  }
  // A short pause so the simulated Planner paces like a real one.
  await pause(paceMs)
  return { data: sim(), live: false, error: live ? NO_KEY[provider] : undefined }
}

export function plan(goal: string, crewSize?: number | FarmerId[], model?: string) {
  return run<PlanOut>(() => livePlan(goal, crewSize, model), () => simulatePlan(goal, crewSize), 1800, model)
}

export function route(input: RouteInput, model?: string) {
  return run<RouteOut>(() => liveRoute(input.message, input.farmers, input.tasks, model), () => simulateRoute(input), 700, model)
}

// A change to the farm, read by the live Planner when Live mode is on. Off, or when the call fails, the app reads it
// with its own scripted parser, and a failed call says so on the card.
export async function reshapeRead(message: string, ctx: ReshapeCtx, model?: string): Promise<{ proposal: Proposal | null; note?: string }> {
  if (!live) return { proposal: null }
  const provider = providerOf(model)
  if (!(await probeKeys())[provider]) return { proposal: null, note: NO_KEY[provider] }
  try {
    const out = await reshapeLive(message, ctx, model)
    const proposal = changesFromLive(out, ctx)
    return { proposal: proposal && { ...proposal, note: `Read by the live Planner, through ${out.source ? SOURCE[out.source] : 'Lovable AI'}` } }
  } catch (e) {
    if (e instanceof KeyMissing || e instanceof GatewayRefused) return { proposal: null, note: noteOf(e) }
    return { proposal: null, note: `The live Planner failed (${e instanceof Error ? e.message : String(e)}), so I read this myself.` }
  }
}

// A question about a disagreement. Live, it runs on the model of the side it names, or the Designer's; simulated,
// the sides answer from what they said. Either way the ask stays open.
export async function discuss(question: string, talk: Talk, modelOf: (f: string) => string | undefined): Promise<AgentAnswer<TalkLine[]>> {
  const lower = question.toLowerCase()
  const side = talk.sides.find((s) => lower.includes(s.label.toLowerCase())) ?? talk.sides[0]
  const model = modelOf(side.farmer)
  const r = await run<{ lines: TalkLine[] }>(() => discussLive(question, talk, model), () => ({ lines: discussSim(question, talk) }), 500, model)
  const lines = r.data.lines.filter((l) => talk.sides.some((s) => s.farmer === l.from)).slice(0, 2)
  return { ...r, data: lines.length ? lines : discussSim(question, talk) }
}
