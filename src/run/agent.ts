// The Planner the app talks to. Simulated by default, so trying it spends no tokens.
// Live mode (Settings) sends the same requests to the real Planner through /api/agent,
// which uses the deployment's ANTHROPIC_API_KEY for Claude models and OPENAI_API_KEY for the Codex models.
// A failed live call, or one whose provider has no key, falls back to the simulation and says why.

import type { PlanOut, RouteInput, RouteOut } from '../agent/agents'
import type { FarmerId } from './types'
import { KeyMissing, planGoal as livePlan, probeKeys, reshapeLive, routeMessage as liveRoute } from './live'
import { providerOf } from './kit'
import { changesFromLive, type Ctx as ReshapeCtx, type Proposal } from './reshape'
import { simulatePlan, simulateRoute } from './simPlan'

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
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// What a live call couldn't do: no key for its provider, so it was simulated.
export const NO_KEY = { anthropic: 'Anthropic key not set, simulated', openai: 'OpenAI key not set, simulated' }

// `model` is the Planner's model: a Claude Planner needs the Anthropic key, a Codex one the OpenAI key.
async function run<T>(liveCall: () => Promise<T>, sim: () => T, paceMs: number, model?: string): Promise<AgentAnswer<T>> {
  const provider = providerOf(model)
  if (live && (await probeKeys())[provider]) {
    try {
      return { data: await liveCall(), live: true }
    } catch (e) {
      return { data: sim(), live: false, error: e instanceof KeyMissing ? NO_KEY[e.provider] : e instanceof Error ? e.message : String(e) }
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
    return { proposal: proposal && { ...proposal, note: 'Read by the live Planner' } }
  } catch (e) {
    if (e instanceof KeyMissing) return { proposal: null, note: NO_KEY[e.provider] }
    return { proposal: null, note: `The live Planner failed (${e instanceof Error ? e.message : String(e)}), so I read this myself.` }
  }
}
