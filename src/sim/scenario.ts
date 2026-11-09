// The demo story: the web team adds Google sign-in by Friday, while the Platform team's
// Session API v2 project retires the endpoint the web app calls. Each farm is named after its project.
// Every word an agent says in the demo lives here, so the script can be tuned in one place.

import type { CropKind, Farmhand, Flag, Rect, RoleId, Seed, Task } from './types'
import { AGENT_TEMPLATES, type FieldStyle, type TeamTemplate } from './templates'

export const TILE = 16

// Our valley is the project. A shared farmstead sits in the middle (the head farmer's house and the barn),
// with one fenced field per agent around it: see layoutFields below. The rect is sized for the biggest crew.
export const FARM = {
  name: 'Google sign-in',
  team: 'Web team',
  repo: 'web-app',
  branch: 'homestead/google-sign-in',
  rect: { x: 2, y: 2, w: 35, h: 32 } as Rect,
  house: { x: 15, y: 11.2, sprite: 'house_0' },
  headFarmer: { x: 18.6, y: 16.55 },
  // The farmhouse door.
  door: { x: 16.95, y: 15.3 },
  porch: [
    { x: 16.3, y: 15.9 },
    { x: 17.6, y: 15.9 },
  ],
  // The crew sleeps in the barn and goes back to it when its work is done.
  barn: { x: 20, y: 11.2, sprite: 'house_1', door: { x: 21.95, y: 15.35 } },
  seedLibrary: { x: 19.0, y: 14.0 },
  // Ripe crops are carried here at the harvest, in front of the barn.
  shipping: { x: 22.7, y: 16.0 },
  // Where the head farmer stands to lift files out of the chest.
  chestSpot: { x: 19.55, y: 15.6 },
  budget: 120_000,
}

// ---- The region: neighbouring valleys, one per project ---------------------------
// Each one is laid out from our valley's rect, so our valley can grow without the others overlapping it.
// A road two tiles wide runs between the valleys, east-west and north-south.
const ROAD_GAP = 4 // tiles from one valley's fence to the next
const EAST_X = FARM.rect.x + FARM.rect.w + ROAD_GAP
const SOUTH_Y = FARM.rect.y + FARM.rect.h + ROAD_GAP - 1
export const ROADS = {
  // The north-south road, its west edge in tiles.
  x: FARM.rect.x + FARM.rect.w + 1,
  // The east-west road, its north edge in tiles.
  y: FARM.rect.y + FARM.rect.h + 0.5,
  width: 2,
}

export const NEIGHBOUR = {
  name: 'Session API v2',
  team: 'Platform team',
  rect: { x: EAST_X, y: FARM.rect.y, w: 34, h: FARM.rect.h } as Rect,
  house: { x: EAST_X + 26, y: FARM.rect.y + 1, sprite: 'house_4' },
}

// A field in a neighbouring valley: one of its agents, with its crop. Tiles are relative to the valley.
export interface RegionField {
  x: number
  y: number
  w: number
  h: number
  crop: CropKind
  stage: number
}

// The other two valleys only show up in the region view.
export const OTHER_FARMS = [
  {
    name: 'Billing webhooks',
    team: 'Payments team',
    rect: { x: FARM.rect.x, y: SOUTH_Y, w: FARM.rect.w, h: 18 } as Rect,
    house: { x: FARM.rect.x + 2, y: SOUTH_Y + 1, sprite: 'house_5' },
    kind: 'garden' as const,
    fields: [
      { x: 4, y: 9, w: 5, h: 3, crop: 'carrot', stage: 3 },
      { x: 13, y: 9, w: 5, h: 3, crop: 'cabbage', stage: 3 },
      { x: 22, y: 9, w: 5, h: 3, crop: 'tulip', stage: 3 },
    ] as RegionField[],
  },
  {
    name: 'Mobile app 4.2',
    team: 'Mobile team',
    rect: { x: EAST_X, y: SOUTH_Y, w: 34, h: 18 } as Rect,
    house: { x: EAST_X + 26, y: SOUTH_Y + 1, sprite: 'house_2' },
    kind: 'orchard' as const,
    fields: [
      { x: 3, y: 8, w: 5, h: 3, crop: 'pumpkin', stage: 1 },
      { x: 12, y: 8, w: 5, h: 3, crop: 'wheat', stage: 2 },
    ] as RegionField[],
  },
]

// The whole region, with a two-tile margin of grass around the valleys.
export const WORLD = { w: NEIGHBOUR.rect.x + NEIGHBOUR.rect.w + 2, h: SOUTH_Y + OTHER_FARMS[0].rect.h + 2 }

// The crow lands on a fence post of the asking agent's field. The engine moves it when the valley is laid out.
export const CROW_SPOT = { x: 13.5, y: 18.15 }

// ---- The valley's fields ----------------------------------------------------------
// Three columns of fields with one-tile paths between them. The middle column is wider:
// it holds the farmstead, and the fields above and below it.
export const VALLEY_COLS = [
  { x: 7, w: 7 },
  { x: 15, w: 9 },
  { x: 25, w: 7 },
]
export const FIELD_H = 6
export const FIELD_PITCH = 7 // a field and the path below it
export const FARMSTEAD = { x: 15, y: 11, w: 9, h: 6 } as Rect

export interface FieldSlot {
  id: string // the agent template
  name: string
  roles: RoleId[] // the farmhands that work this field (none for an agent with no builder role)
  style: FieldStyle
  rect: Rect
}

// A team template is a valley layout: one field per agent, in member order, around the farmstead.
// Up to five fields fit in two rows; more add rows above and below.
export function layoutFields(team: TeamTemplate): FieldSlot[] {
  const ids: string[] = []
  for (const m of team.members) {
    const a = AGENT_TEMPLATES.find((x) => x.id === m.agent)
    if (a && !a.farmstead && !ids.includes(a.id)) ids.push(a.id)
  }
  for (const r of ROLE_ORDER) if (team.staffs[r] && !ids.includes(team.staffs[r])) ids.push(team.staffs[r])
  const rows = Math.max(2, Math.ceil((ids.length + 1) / 3))
  const above = Math.floor((rows - 1) / 2)
  const cells: { c: number; r: number }[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < 3; c++) if (!(r === above && c === 1)) cells.push({ c, r: r - above })
  return ids.map((id, i) => {
    const a = AGENT_TEMPLATES.find((x) => x.id === id)
    const cell = cells[i] ?? { c: i % 3, r: Math.floor(i / 3) + rows - above }
    const col = VALLEY_COLS[cell.c]
    return {
      id,
      name: a?.name ?? id,
      roles: ROLE_ORDER.filter((r) => team.staffs[r] === id),
      style: a?.style ?? { fence: '#a8774a', body: '#f3f2c0', shade: '#ddd5de', crop: 'wheat' },
      rect: { x: col.x, y: FARMSTEAD.y + cell.r * FIELD_PITCH, w: col.w, h: FIELD_H },
    }
  })
}

// ---- Things on the farm ---------------------------------------------------------
// Clicking one plays a short reaction. None of them change the work.

export type PropKind = 'tree' | 'pond' | 'well' | 'bush' | 'sunflower' | 'house' | 'chest' | 'flowers' | 'workstation' | 'basket'
export interface Prop {
  id: string
  kind: PropKind
  sprite: string
  x: number // tiles, top-left of the sprite
  y: number
  w: number // hit box in tiles
  h: number
}

export const PROPS: Prop[] = [
  { id: 'house', kind: 'house', sprite: FARM.house.sprite, x: FARM.house.x, y: FARM.house.y, w: 3.9, h: 3.9 },
  { id: 'chest', kind: 'chest', sprite: 'chest', x: FARM.seedLibrary.x, y: FARM.seedLibrary.y, w: 1.2, h: 1.1 },
  { id: 'workstation', kind: 'workstation', sprite: 'workstation', x: 15.1, y: 15.85, w: 1.9, h: 1.3 },
  // Decor sits at the valley's edges, outside the fields. It stays clickable when you pan.
  { id: 'well', kind: 'well', sprite: 'well', x: 3.2, y: 5, w: 2, h: 1.9 },
  { id: 'pond', kind: 'pond', sprite: '', x: 32.2, y: 4, w: 4.6, h: 3 },
  { id: 'apple-tree', kind: 'tree', sprite: 'tree_apple', x: 33.6, y: 13, w: 2, h: 2 },
  { id: 'nap-tree', kind: 'tree', sprite: 'tree', x: 3.0, y: 14, w: 2, h: 2 },
  { id: 'bush-a', kind: 'bush', sprite: 'bush_1', x: 5.4, y: 3.4, w: 1, h: 1 },
  { id: 'bush-b', kind: 'bush', sprite: 'bush_0', x: 35.2, y: 17.2, w: 1, h: 1 },
  { id: 'sunflower', kind: 'sunflower', sprite: 'sunflower', x: 3.6, y: 19, w: 1, h: 2 },
  { id: 'house-flowers', kind: 'flowers', sprite: 'flower_2', x: 5.4, y: 22.6, w: 1, h: 1 },
  { id: 'basket', kind: 'basket', sprite: 'basket', x: 33.4, y: 22.2, w: 1, h: 1 },
]

// Chickens wander inside this pen.
export const CHICKEN_PEN = { x: 32.6, y: 9.4, w: 3.4, h: 0.9 }

// What a farmhand does once its tasks are done, so it never just stands there.
// Each chore uses frames the sprite sheet already has.
export interface Chore {
  id: string
  label: string
  spot: { x: number; y: number }
  dir: 'down' | 'up' | 'left' | 'right'
  anim: 'idle' | 'water' | 'chop'
  emote?: 'sleep' | 'heart' | 'check'
  partner?: string // a chore done in pairs
}

export const CHORES: Chore[] = [
  // Near the farmstead.
  { id: 'chop', label: 'Chopping wood', spot: { x: 16.05, y: 17.6 }, dir: 'up', anim: 'chop' },
  { id: 'chat-a', label: 'Chatting', spot: { x: 19.4, y: 17.55 }, dir: 'right', anim: 'idle', partner: 'chat-b' },
  { id: 'chat-b', label: 'Chatting', spot: { x: 20.6, y: 17.55 }, dir: 'left', anim: 'idle', partner: 'chat-a' },
  // At the valley's edges.
  { id: 'feed', label: 'Feeding the chickens', spot: { x: 32.0, y: 10.3 }, dir: 'right', anim: 'water' },
  { id: 'flowers', label: 'Watering the flowers', spot: { x: 5.9, y: 24.2 }, dir: 'up', anim: 'water' },
  { id: 'fruit', label: 'Picking apples', spot: { x: 34.6, y: 15.6 }, dir: 'up', anim: 'idle', emote: 'check' },
  { id: 'nap', label: 'Napping under the tree', spot: { x: 4.0, y: 16.6 }, dir: 'down', anim: 'idle', emote: 'sleep' },
  { id: 'pond', label: 'Looking at the pond', spot: { x: 34.5, y: 7.6 }, dir: 'up', anim: 'idle' },
]

// A valley's overall state, shown in the region view by its head farmer, drawn big.
export type ValleyState = 'working' | 'idle' | 'needs' | 'done' | 'failed'

export const VALLEY_STATS: Record<string, { agents: number; energyWeek: number; pests: number; waiting: number; harvests: number; unattended?: string; state?: ValleyState; reason?: 'Cost' | 'Risk' | 'Irreversible' | 'Failure' | 'Anomaly'; doing?: string }> = {
  [FARM.name]: { agents: 6, energyWeek: 0, pests: 0, waiting: 0, harvests: 0 },
  [NEIGHBOUR.name]: { agents: 4, energyWeek: 412_000, pests: 3, waiting: 1, harvests: 2, state: 'needs', reason: 'Risk', doing: 'Retired /v1/session yesterday. Two clients still call it.' },
  'Billing webhooks': { agents: 3, energyWeek: 168_000, pests: 0, waiting: 0, harvests: 4, unattended: '1 sprinkler: nightly dependency updates', state: 'done', doing: 'Shipped retries for failed webhooks on Monday.' },
  'Mobile app 4.2': { agents: 2, energyWeek: 96_000, pests: 1, waiting: 0, harvests: 31, unattended: '1 beehive: flaky test triage', state: 'working', doing: 'Building the 4.2 release: offline mode and the new onboarding.' },
}

// ---- Opening -------------------------------------------------------------------
// Three camera beats with one caption each. The middle beat signs both farms.

export const BEATS = [
  { secs: 4.2, caption: 'Every project in this region is a valley with its own crew of agents.' },
  { secs: 4.8, caption: 'Your web app calls /v1/session. Next door, Session API v2 retired it yesterday.' },
  { secs: 4.2, caption: 'Your agents only read what you give them.' },
]
export const INTRO_SIGNS = { ours: 'Calls /v1/session', theirs: '/v1/session retired' }

// ---- Brief ----------------------------------------------------------------

// Short forms for the overview's one-line summaries.
export const BRIEF_SUMMARY = 'Add Google sign-in by Friday'
export const ANSWER_SHORT: Record<string, string> = {
  'Yes, keep both': 'Keep email login',
  'No, Google only': 'Google only',
  'Everyone, in Friday’s deploy': 'everyone at once',
  'Staff first, behind a flag': 'staff first',
}

export const BRIEF_GOAL = 'Add Google sign-in to the web app by Friday. Email and password login has to keep working.'

export interface Attachment {
  id: string
  name: string
  kind: 'file' | 'skill' | 'tool'
  note: string
  selected: boolean
}

export const ATTACHMENTS: Attachment[] = [
  { id: 'src', name: 'web-app/src/', kind: 'file', note: 'The web app source code', selected: true },
  { id: 'spec', name: 'auth-spec.md', kind: 'file', note: 'Design spec for Google sign-in', selected: true },
  { id: 'e2e', name: 'e2e-tests/', kind: 'file', note: 'End-to-end test suite', selected: true },
  { id: 'oauth', name: 'oauth-security.md', kind: 'skill', note: 'Security team skill', selected: true },
  { id: 'react', name: 'react-components.md', kind: 'skill', note: 'Web team skill', selected: true },
  { id: 'lesson', name: 'lesson-check-changelogs.md', kind: 'skill', note: 'Lesson saved from a past harvest', selected: true },
  { id: 'github', name: 'GitHub', kind: 'tool', note: 'MCP server', selected: true },
  { id: 'playwright', name: 'Playwright', kind: 'tool', note: 'MCP server', selected: true },
  { id: 'sentry', name: 'Sentry', kind: 'tool', note: 'MCP server, read only', selected: false },
  { id: 'changelog', name: 'session-api-v2/CHANGELOG.md', kind: 'file', note: 'From the Session API v2 project', selected: false },
]

export const SUGGESTED_BUDGET = 120_000

// ---- Clarify --------------------------------------------------------------

export interface ClarifyQ {
  id: string
  q: string
  why: string
  options: string[]
}

export const CLARIFY: ClarifyQ[] = [
  {
    id: 'email',
    q: 'Keep email and password login?',
    why: 'auth-spec.md shows both on one page, but doesn’t say whether email login stays.',
    options: ['Yes, keep both', 'No, Google only'],
  },
  {
    id: 'rollout',
    q: 'Who gets it first?',
    why: 'Friday’s deploy reaches every user unless it goes behind a flag.',
    options: ['Everyone, in Friday’s deploy', 'Staff first, behind a flag'],
  },
]

// ---- Crew -----------------------------------------------------------------

type CrewSeed = Pick<Farmhand, 'id' | 'role' | 'name' | 'color' | 'colorDark' | 'tools' | 'almanac' | 'seeds' | 'context'>

export const CREW: CrewSeed[] = [
  { id: 'backend', role: 'Backend', name: 'Backend', color: '#9fd8c5', colorDark: '#5fa894', tools: ['GitHub'], almanac: [], seeds: [], context: [] },
  { id: 'frontend', role: 'Frontend', name: 'Frontend', color: '#f2c6de', colorDark: '#c98bb0', tools: ['GitHub', 'Playwright'], almanac: [], seeds: [], context: [] },
  { id: 'tests', role: 'Tests', name: 'Tests', color: '#b9cdf5', colorDark: '#7d93c9', tools: ['Playwright'], almanac: [], seeds: [], context: [] },
  { id: 'docs', role: 'Docs', name: 'Docs', color: '#f6d58e', colorDark: '#c9a253', tools: ['GitHub'], almanac: [], seeds: [], context: [] },
  // Writes no code. It reviews the whole diff at the harvest.
  { id: 'reviewer', role: 'Reviewer', name: 'Reviewer', color: '#d9c2f0', colorDark: '#9d84bd', tools: ['GitHub'], almanac: ['oauth-security.md', 'react-components.md'], seeds: [], context: [] },
]

export const ROLE_ORDER: RoleId[] = ['backend', 'frontend', 'tests', 'docs', 'reviewer']
// The builders take tasks. The Reviewer only reviews.
export const BUILDERS: RoleId[] = ['backend', 'frontend', 'tests', 'docs']

// ---- Quest plan -------------------------------------------------------------

type TaskSeed = Omit<Task, 'used' | 'dry' | 'pests' | 'subtasks'> & {
  subtasks: Omit<Task['subtasks'][number], 'progress' | 'started' | 'done' | 'emitted'>[]
}

const plot = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

export const TASKS: TaskSeed[] = [
  {
    id: 'backend',
    name: 'OAuth callback route',
    crop: 'wheat',
    plot: plot(9, 13, 3, 2),
    budget: 24_000,
    assignee: 'backend',
    proposedAssignee: 'backend',
    signposts: ['web-app/src/', 'auth-spec.md', 'oauth-security.md', 'GitHub'],
    subtasks: [
      { id: 'b1', name: 'Read the auth module', secs: 3, energy: 5_000, actions: 14 },
      { id: 'b2', name: 'Add /auth/google/callback', secs: 4, energy: 8_000, actions: 22, sets: ['callbackReady'] },
      { id: 'b3', name: 'Create the session', secs: 3, energy: 4_500, actions: 12 },
    ],
  },
  {
    id: 'frontend',
    name: 'Sign-in button and page',
    crop: 'carrot',
    plot: plot(27, 13, 3, 2),
    budget: 30_000,
    assignee: 'frontend',
    proposedAssignee: 'frontend',
    signposts: ['web-app/src/', 'auth-spec.md', 'react-components.md', 'GitHub', 'Playwright'],
    subtasks: [
      { id: 'f1', name: 'Add the Google button', secs: 3, energy: 6_000, actions: 16, sets: ['buttonReady'] },
      { id: 'f2', name: 'Start the session', secs: 4, energy: 7_000, actions: 0, sets: ['sessionStarted'] },
      { id: 'f3', name: 'Error states', secs: 3, energy: 4_000, actions: 11 },
    ],
  },
  {
    id: 'tests',
    name: 'End-to-end sign-in tests',
    crop: 'cabbage',
    plot: plot(9, 20, 3, 2),
    budget: 18_000,
    assignee: 'tests',
    proposedAssignee: 'tests',
    proposalNote: 'Tests runs them in a real browser on staging, with the Playwright MCP.',
    signposts: ['e2e-tests/', 'Playwright'],
    subtasks: [
      { id: 't1', name: 'Write the Google sign-in test', secs: 3, energy: 4_000, actions: 12, sets: ['e2eWritten'] },
      { id: 't2', name: 'Run on staging', secs: 4, energy: 5_000, actions: 15, needs: ['sessionStarted', 'callbackReady'] },
    ],
  },
  {
    id: 'docs',
    name: 'Setup guide',
    crop: 'tulip',
    plot: plot(18, 20, 3, 2),
    budget: 8_000,
    assignee: 'docs',
    proposedAssignee: 'docs',
    signposts: ['auth-spec.md', 'GitHub'],
    subtasks: [{ id: 'd1', name: 'Write the setup guide', secs: 3, energy: 3_500, actions: 10, needs: ['callbackReady'] }],
  },
]

// The subtask the head farmer adds when you settle which session API to use.
export const REPLAN_SUBTASKS = {
  switch: { id: 'f4', name: 'Switch to /v2/session', secs: 3, energy: 3_000, actions: 9, sets: ['sessionV2'] as Flag[] },
}

// The file the trace finds missing, and the task that needed it.
export const MISSING = { taskId: 'frontend', file: 'session-api-v2/CHANGELOG.md' }

// The clash, in the words the map and the ask use.
export const CLASH = {
  ours: '/v1/session',
  theirs: '/v2/session',
  crow: 'Two teams disagree about the session API',
  failed: 'POST /v1/session returned 404 at 10:42.',
}

// Neighbour farm: drawn and animated, never simulated in depth.
export const NEIGHBOUR_PLOTS: { name: string; crop: CropKind; plot: Rect; stage: number; drought?: boolean }[] = [
  { name: 'Migrate clients to /v2', crop: 'cabbage', plot: plot(NEIGHBOUR.rect.x + 3, NEIGHBOUR.rect.y + 8, 5, 3), stage: 2 },
  { name: 'Retire /v1/session', crop: 'wheat', plot: plot(NEIGHBOUR.rect.x + 13, NEIGHBOUR.rect.y + 8, 4, 3), stage: 3, drought: true },
  { name: 'Load tests', crop: 'carrot', plot: plot(NEIGHBOUR.rect.x + 3, NEIGHBOUR.rect.y + 15, 4, 2), stage: 3 },
  { name: 'Changelog', crop: 'tulip', plot: plot(NEIGHBOUR.rect.x + 13, NEIGHBOUR.rect.y + 15, 4, 2), stage: 2 },
]

// ---- Seeds ------------------------------------------------------------------

export const START_SEEDS: Seed[] = [
  {
    file: 'lesson-check-changelogs.md',
    title: 'Read a project’s changelog before calling its API',
    body: 'Before a task calls another team’s API, attach that project’s changelog.',
    from: 'Harvest: Billing webhooks',
  },
]

export const LESSON_TRACE: Seed = {
  file: 'lesson-session-api-v2.md',
  title: 'The session API is /v2/session from Nov 12',
  body: 'Session API v2 retired /v1/session on staging Nov 8 and in production Nov 12. Any task that starts a session uses POST /v2/session and reads session-api-v2/CHANGELOG.md.',
  from: 'Harvest: Google sign-in (crow on Sign-in button and page)',
  isNew: true,
}

export const LESSON_STAGING: Seed = {
  file: 'lesson-staging-first.md',
  title: 'Run end-to-end tests on staging before review',
  body: 'The /v1/session break only showed up against staging. Run the end-to-end tests there before the agentic review, not after it.',
  from: 'Harvest: Google sign-in (cross on End-to-end sign-in tests)',
  isNew: true,
}
