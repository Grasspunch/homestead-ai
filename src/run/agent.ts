// The Planner the app talks to. Simulated by default, so trying it spends no tokens.
// Live mode (Settings) sends the same requests to the real Planner through /api/agent,
// which uses the deployment's ANTHROPIC_API_KEY. A failed live call falls back to the simulation.

import type { PlanOut, RouteInput, RouteOut } from '../agent/agents'
import { planGoal as livePlan, probeLive, routeMessage as liveRoute } from './live'
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

async function run<T>(liveCall: () => Promise<T>, sim: () => T, paceMs: number): Promise<AgentAnswer<T>> {
  if (live && (await probeLive())) {
    try {
      return { data: await liveCall(), live: true }
    } catch (e) {
      return { data: sim(), live: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  // A short pause so the simulated Planner paces like a real one.
  await pause(paceMs)
  return { data: sim(), live: false, error: live ? 'Live mode is on, but the server has no API key.' : undefined }
}

export function plan(goal: string, crewSize?: number) {
  return run<PlanOut>(() => livePlan(goal, crewSize), () => simulatePlan(goal, crewSize), 1800)
}

export function route(input: RouteInput) {
  return run<RouteOut>(() => liveRoute(input.message, input.farmers, input.tasks), () => simulateRoute(input), 700)
}
