// Ship: after the merge, CI runs on main, then a canary deploy to production that rolls back by itself
// when a health check fails. Everything story-specific lives here as data, like review.ts.
import * as scenario from './scenario'

export type ShipStage = 'none' | 'ci' | 'deploy' | 'held' | 'canary' | 'rollback' | 'rolledback' | 'canary2' | 'rollout' | 'live' | 'cifailed'

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
    flaky: { test: 'email-login.spec.ts › remembers the session', why: 'A known flaky test: it failed 3 times in the last 50 runs on main, each time on a slow staging cookie.' },
  },
  { id: 'staging', name: 'Deploy to staging', time: '1m 30s', secs: 1.0, outcome: 'pass' },
]

export const RELEASE = {
  app: 'web-app',
  version: 'v4.18.0',
  previous: 'v4.17.3',
  env: 'production',
  users: '12,400',
  canary: '5% canary for 10 minutes, then everyone',
  rule: 'If a health check fails, roll back to v4.17.3 on its own',
  exposure: '5% of users for 6 minutes',
}

// Health checks the canary is held to. `bad` is what the first canary reads once the failure shows.
export interface HealthCheck {
  id: string
  name: string
  threshold: string
  good: number
  bad: number
  unit: '%' | 'ms'
  min?: number // passes at or above
  max?: number // passes at or below
}

export const HEALTH: HealthCheck[] = [
  { id: 'signin', name: 'Google sign-in success', threshold: 'At least 99%', good: 99.6, bad: 71, unit: '%', min: 99 },
  { id: '5xx', name: '5xx rate', threshold: 'Under 0.5%', good: 0.08, bad: 0.11, unit: '%', max: 0.5 },
  { id: 'p95', name: 'p95 latency', threshold: 'Under 800 ms', good: 412, bad: 431, unit: 'ms', max: 800 },
]

export function healthOk(h: HealthCheck, v: number) {
  if (h.min !== undefined && v < h.min) return false
  if (h.max !== undefined && v > h.max) return false
  return true
}

export function fmtHealth(h: HealthCheck, v: number) {
  if (h.unit === 'ms') return `${Math.round(v)} ms`
  return `${v < 1 ? v.toFixed(2) : v < 98 ? Math.round(v) : v.toFixed(1)}%`
}

// Demo seconds for each part of the deploy.
export const SHIP_TIMES = { canary: 4.2, breach: 2.4, rollback: 1.6, canary2: 3.0, rollout: 2.4 }

// The setup guide, as steps. The redirect URI step is the one nobody did for production.
export const GUIDE_STEPS: { id: string; text: string; who: string }[] = [
  { id: 'env', text: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for each environment.', who: 'Done by the deploy pipeline' },
  { id: 'staging-uri', text: 'Add https://staging.web-app.dev/auth/google/callback as a redirect URI in the Google console.', who: 'Done on Nov 9' },
  { id: 'redirect', text: 'Add https://app.example.com/auth/google/callback as a redirect URI in the Google console.', who: 'Needs a person with access to the Google console' },
  { id: 'consent', text: 'Check the consent screen shows the web app’s name and logo.', who: 'Done on Nov 9' },
]

export const SHIP_TEXT = {
  ciRunning: 'CI is running on main.',
  ciPassed: 'CI passed on main. Ready to deploy.',
  ciFailed: 'CI failed on main. Nothing was deployed.',
  held: 'Deploy held. Nothing reached production.',
  canary: 'The canary is live for 5% of users.',
  rollback: 'Rolling back to v4.17.3.',
  rolledback: 'Rolled back. Sign-in failed for 5% of users for 6 minutes.',
  canary2: 'The canary is live again for 5% of users.',
  rollout: 'Rolling out to everyone.',
  live: 'Live for 12,400 users. Two catches: the retired /v1 session before review, and the missing redirect URI after deploy, which hit 5% of users for 6 minutes.',
  cause: 'Google rejects the sign-in with redirect_uri_mismatch: the production redirect URI was never added in the Google console. Step 3 of the setup guide asks for it.',
  sentry: 'Sentry: 212 redirect_uri_mismatch errors on app.example.com/login since the canary started.',
}

export const LESSON_REDIRECT = {
  file: 'lesson-redirect-uri.md',
  title: 'Check the production redirect URI before an OAuth deploy',
  body: 'Before deploying a sign-in change, ask the owner to confirm every redirect URI in the provider console. An agent cannot reach the Google console.',
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
