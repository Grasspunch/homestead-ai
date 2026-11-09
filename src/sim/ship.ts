// Ship: after the merge, CI runs on main, then a canary deploy to production that rolls back by itself
// when a health check fails, a fix and a redeploy, and the text that tells pet owners they can book.
// Everything story-specific lives here as data, like review.ts.
import * as scenario from './scenario'

export type ShipStage = 'none' | 'ci' | 'deploy' | 'held' | 'canary' | 'rollback' | 'rolledback' | 'fixing' | 'canary2' | 'rollout' | 'live' | 'announced' | 'cifailed'

export type CiState = 'wait' | 'run' | 'retry' | 'pass' | 'fail'

// What a CI job does in this run. A known flaky test fails once, retries alone and passes.
export type CiOutcome = 'pass' | 'flaky' | 'fail'

export interface CiJob {
  id: string
  name: string
  time: string // how long it took on the real runner
  secs: number // demo seconds
  outcome: CiOutcome
  flaky?: { test: string; why: string }
}

export const PIPELINE = { provider: 'GitHub Actions', workflow: '.github/workflows/main.yml', branch: 'main' }

export const CI_JOBS: CiJob[] = [
  { id: 'build', name: 'Build', time: '1m 12s', secs: 1.0, outcome: 'pass' },
  { id: 'unit', name: 'Unit tests', time: '48s', secs: 0.9, outcome: 'pass' },
  { id: 'integration', name: 'Integration tests', time: '2m 05s', secs: 1.0, outcome: 'pass' },
  {
    id: 'e2e',
    name: 'End-to-end',
    time: '3m 40s',
    secs: 1.3,
    outcome: 'flaky',
    flaky: { test: 'booking.spec.ts › picks a pet on a slow phone', why: 'A known flaky test: it failed 3 times in the last 50 runs on main, each time waiting for the staging date picker.' },
  },
  { id: 'staging', name: 'Deploy to staging', time: '1m 30s', secs: 1.0, outcome: 'pass' },
]

// What goes out, and what comes back if it fails. A brand-new feature has no older version to return to,
// so a rollback puts the old "Call us to book" page back.
export const RELEASE = {
  app: 'Online booking',
  clinic: 'Willow Lane Vets',
  site: 'willowlanevets.co.uk/book',
  env: 'production',
  canary: '5% canary for 10 minutes, then everyone',
  previous: 'the “Call us to book” page',
  rule: 'If a health check fails, put the “Call us to book” page back on its own',
  exposure: '5% of visitors for 6 minutes',
}

// The text that tells pet owners. Irreversible, and it costs money: about 3p a text.
export const ANNOUNCE = {
  audience: '3,000 pet owners',
  message: 'You can now book online.',
  cost: 'About £95',
  provider: 'Twilio',
  from: 'WillowVets',
}

// Health checks the canary is held to. `bad` is what the first canary reads once the failure shows.
export interface HealthCheck {
  id: string
  name: string
  threshold: string
  good: number
  bad: number
  unit: '%' | 's'
  min?: number // passes at or above
  max?: number // passes at or below
}

export const HEALTH: HealthCheck[] = [
  { id: 'booking', name: 'Booking success', threshold: 'At least 98%', good: 99.4, bad: 99.1, unit: '%', min: 98 },
  { id: '5xx', name: '5xx rate', threshold: 'Under 0.5%', good: 0.08, bad: 0.12, unit: '%', max: 0.5 },
  { id: 'search', name: 'Availability search p95', threshold: 'Under 1 s', good: 0.3, bad: 4.2, unit: 's', max: 1 },
]

// The check that breaks on the first canary.
export const BREACH = 'search'

export function healthOk(h: HealthCheck, v: number) {
  if (h.min !== undefined && v < h.min) return false
  if (h.max !== undefined && v > h.max) return false
  return true
}

export function fmtHealth(h: HealthCheck, v: number) {
  if (h.unit === 's') return `${v.toFixed(1)} s`
  return `${v < 1 ? v.toFixed(2) : v < 98 ? Math.round(v) : v.toFixed(1)}%`
}

// What a failing reading says, e.g. "Availability search p95 rose to 4.2 s on the canary (limit 1 s)".
export function breachText(h: HealthCheck, v: number) {
  const limit = h.max !== undefined ? `limit ${fmtHealth(h, h.max).replace(/\.0 s$/, ' s')}` : `needs ${h.min}%`
  return `${h.name} ${h.max !== undefined ? 'rose' : 'fell'} to ${fmtHealth(h, v)} on the canary (${limit})`
}

// Demo seconds for each part of the deploy.
export const SHIP_TIMES = { canary: 4.2, breach: 2.4, rollback: 1.6, fix: 2.2, canary2: 3.0, rollout: 2.4 }

export const SHIP_TEXT = {
  ciRunning: 'CI is running on main.',
  ciPassed: 'CI passed on main. Ready to deploy.',
  ciFailed: 'CI failed on main. Nothing was deployed.',
  held: 'Deploy held. Nothing reached production.',
  canary: 'Online booking is live for 5% of visitors.',
  rollback: 'Putting the “Call us to book” page back.',
  rolledback: 'Rolled back. Availability search was slow for 5% of visitors for 6 minutes.',
  fixing: 'The Backend agent is loading all 8 weeks of diaries in one query.',
  canary2: 'Online booking is live again for 5% of visitors.',
  rollout: 'Rolling out to everyone.',
  live: 'Online booking is live for everyone.',
  announced: 'Saturday bookings at a closed clinic were caught before they reached 3,000 pet owners.',
  notSent: 'Online booking is live. The text to pet owners wasn’t sent.',
  cause: 'Availability search reads each vet’s diary one day at a time: 3 vets and 8 weeks is 168 reads for every search. With real visitors its p95 went from 0.3 s to 4.2 s.',
  fix: 'Load all 8 weeks of diaries in one query, then redeploy?',
  sentry: 'Sentry: GET /api/availability p95 4.2 s on the canary, 168 diary queries per request.',
}

export const LESSON_QUERY = {
  file: 'lesson-one-query-per-search.md',
  title: 'Load a date range in one query',
  body: 'When a search covers many days, read the whole range in one query, and time it on staging with full-size diaries before deploying.',
  from: 'Saved from this ship',
  isNew: true,
}

// The cart on the map, in tiles. At the harvest the crates go to the barn; after the merge the cart
// leaves from the barn door, goes out through the valley's gate and along the road to the region.
// On a rollback it comes back to the gate. Positions are read when used, because the map can move:
// FARM.barn.door, FARM.gate when the scenario defines it, and VALLEY_ROAD (points from the gate outward)
// when the region roads define it. Until they do, a road straight down from the gate is used.
type Pt = { x: number; y: number }
const S = scenario as unknown as { FARM: { barn: { door: Pt }; gate?: Pt; rect: { x: number; y: number; w: number; h: number } }; VALLEY_ROAD?: Pt[] }

export function cartBarn(): Pt {
  const d = S.FARM.barn.door
  return { x: d.x, y: d.y + 0.9 }
}

export function cartGate(): Pt {
  const r = S.FARM.rect
  return S.FARM.gate ?? { x: r.x + r.w / 2, y: r.y + r.h - 0.6 }
}

function cartRoad(): Pt[] {
  const g = cartGate()
  return S.VALLEY_ROAD?.length ? S.VALLEY_ROAD : [{ x: g.x, y: g.y + 3 }, { x: g.x, y: g.y + 40 }]
}

function along(pts: Pt[], k: number) {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
  let d = Math.max(0, Math.min(1, k)) * lens.reduce((a, b) => a + b, 0)
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? Math.min(1, d / lens[i]) : 0
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }
    }
    d -= lens[i]
  }
  return pts[0]
}

// Out: from the barn, through the gate, along the road. Back: from the road's end to the gate.
export function cartOut(k: number) {
  return along([cartBarn(), cartGate(), ...cartRoad()], k)
}

export function cartBack(k: number) {
  const road = cartRoad()
  return along([road[road.length - 1], ...road.slice(0, -1).reverse(), cartGate()], k)
}
