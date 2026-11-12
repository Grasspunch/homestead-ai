// Live plans kept for the demo goals, so a live demo with no network still shows a real plan, labelled with when it
// was made. Two places hold them: src/run/recorded-plans.json, filled by `node scripts/record-plans.mjs` from a
// real live call and committed, and this browser, which keeps every live plan it gets for a demo goal.
// Nothing here is ever made up: an entry exists only because a live call returned it.

import type { PlanOut } from '../agent/agents'
import data from './recorded-plans.json'

export interface Recorded {
  plan: PlanOut
  at: string // ISO date of the live call
  source?: string // who answered, as the screen says it: "Lovable AI", "your Anthropic key"
  model?: string
}

// The goals worth keeping a live answer for: the sample's goal, the agent dashboard run and the starters on Home.
export const DEMO_GOALS: string[] = data.goals
// The agent dashboard run isn't a starter: you type it.
export const EXAMPLE_GOALS = DEMO_GOALS.slice(2)

const KEY = 'homestead.recorded-plans'
const norm = (g: string) => g.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]+$/, '')
export const isDemoGoal = (goal: string) => DEMO_GOALS.some((g) => norm(g) === norm(goal))

const committed = data.plans as Record<string, Recorded>

function local(): Record<string, Recorded> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

// The newest live plan for this goal, from this browser or the committed file.
export function recordedPlan(goal: string): Recorded | undefined {
  const k = norm(goal)
  const all = [local(), committed].flatMap((m) => Object.entries(m).filter(([g]) => norm(g) === k).map(([, r]) => r))
  return all.sort((a, b) => b.at.localeCompare(a.at))[0]
}

// Keep a live plan for a demo goal in this browser.
export function remember(goal: string, plan: PlanOut, source?: string, model?: string, at = new Date().toISOString()) {
  if (!isDemoGoal(goal)) return
  try {
    const m = local()
    m[goal.trim()] = { plan, at, source, model }
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    // Private windows: nothing kept.
  }
}

// "11 Nov", for the tag.
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
