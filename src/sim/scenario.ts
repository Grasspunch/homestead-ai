// The demo story: Willow Lane Vets builds online booking from scratch, while its Staff rota project
// changed last week: no vet works Saturdays from 1 December. Each farm is named after its project.
// Every word an agent says in the demo lives here, so the script can be tuned in one place.

import type { CropKind, Farmhand, Flag, Rect, RoleId, Seed, Task } from './types'
import { AGENT_TEMPLATES, type FieldStyle, type TeamTemplate } from './templates'

export const TILE = 16

// Our valley is the project. A shared farmstead sits in the middle (the head farmer's house and the barn),
// with one fenced field per agent around it: see layoutFields below. The rect is sized for the biggest crew.
export const FARM = {
  name: 'Vet booking',
  team: 'Willow Lane Vets',
  repo: 'willow-lane-booking',
  branch: 'homestead/vet-booking',
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
  name: 'Staff rota',
  team: 'Practice team',
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
    name: 'Pharmacy stock',
    team: 'Pharmacy team',
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
    name: 'Lab results',
    team: 'Nursing team',
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
// The head farmer is the only one that works from the farmstead itself.
// Up to five fields fit in two rows; more add rows above and below.
export function layoutFields(team: TeamTemplate): FieldSlot[] {
  const ids: string[] = []
  for (const m of team.members) {
    const a = AGENT_TEMPLATES.find((x) => x.id === m.agent)
    if (a && a.id !== 'head-farmer' && !ids.includes(a.id)) ids.push(a.id)
  }
  // Every agent in the crew gets a field, and so does any agent the crew staffs a role with.
  for (const r of ROLE_ORDER) {
    const id = team.staffs[r]
    if (id && id !== 'head-farmer' && !ids.includes(id)) ids.push(id)
  }
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
  [NEIGHBOUR.name]: { agents: 3, energyWeek: 214_000, pests: 0, waiting: 0, harvests: 6, unattended: '1 sprinkler: weekly rota emails', state: 'done', doing: 'Shipped the winter rota last week. No vet works Saturdays from 1 December.' },
  'Pharmacy stock': { agents: 2, energyWeek: 96_000, pests: 1, waiting: 0, harvests: 12, unattended: '1 beehive: nightly stock count', state: 'working', doing: 'Reordering flea and worm treatments before they run out.' },
  'Lab results': { agents: 3, energyWeek: 168_000, pests: 0, waiting: 1, harvests: 4, state: 'needs', reason: 'Risk', doing: 'Waiting for a vet to approve how results are worded for owners.' },
}

// ---- Opening -------------------------------------------------------------------
// Three camera beats with one caption each. The middle beat signs both farms.

export const BEATS = [
  { secs: 4.2, caption: 'Every project at Willow Lane Vets is a valley with its own crew of agents.' },
  { secs: 4.8, caption: 'The front desk’s hours sheet says the clinic opens on Saturdays. Next door, the staff rota changed last week.' },
  { secs: 4.2, caption: 'Your agents only read what you give them.' },
]
export const INTRO_SIGNS = { ours: 'Hours sheet: open Saturdays', theirs: 'No Saturday vets from December' }

// ---- Brief ----------------------------------------------------------------

// Short forms for the overview's one-line summaries.
export const BRIEF_SUMMARY = 'Build the Willow Lane Vets website'
export const ANSWER_SHORT: Record<string, string> = {
  'Show the clinic and let owners book online': 'online booking',
  'Show the clinic only': 'no booking',
  'Checkups and vaccinations': 'checkups and vaccinations',
  'Every kind of visit, surgery too': 'every visit',
  'Up to 8 weeks ahead': '8 weeks ahead',
  'Up to 6 months ahead': '6 months ahead',
  'Text, the day before': 'text reminders',
  'Email, the day before': 'email reminders',
}

// The demo starts from one line. The head farmer's questions turn it into a booking site.
export const BRIEF_GOAL = 'Build a vet clinic website for Willow Lane Vets.'

export interface Attachment {
  id: string
  name: string
  kind: 'file' | 'skill' | 'tool'
  note: string
  selected: boolean
}

export const ATTACHMENTS: Attachment[] = [
  { id: 'hours', name: 'front-desk-hours.csv', kind: 'file', note: 'Opening hours from the front desk, last edited in August', selected: true },
  { id: 'vets', name: 'vets.md', kind: 'file', note: 'The vets, what each one sees, and how long visits take', selected: true },
  { id: 'brand', name: 'brand-style.md', kind: 'skill', note: 'How Willow Lane Vets looks and sounds', selected: true },
  { id: 'data', name: 'owner-data.md', kind: 'skill', note: 'How we handle owners’ phone numbers and pets’ records', selected: true },
  { id: 'lesson', name: 'lesson-phone-first.md', kind: 'skill', note: 'Lesson saved from a past harvest', selected: true },
  { id: 'github', name: 'GitHub', kind: 'tool', note: 'MCP server', selected: true },
  { id: 'playwright', name: 'Playwright', kind: 'tool', note: 'MCP server', selected: true },
  { id: 'sms', name: 'Twilio', kind: 'tool', note: 'MCP server for texts, staging phones only', selected: true },
  { id: 'sentry', name: 'Sentry', kind: 'tool', note: 'MCP server, read only', selected: false },
  { id: 'rota', name: 'staff-rota/rota.md', kind: 'file', note: 'From the Staff rota project', selected: false },
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
    id: 'scope',
    q: 'What must the site do?',
    why: 'The goal says a website, but not whether owners can do anything on it.',
    options: ['Show the clinic and let owners book online', 'Show the clinic only'],
  },
  {
    id: 'visits',
    q: 'Which visits can owners book online?',
    why: 'vets.md lists surgery, and surgery needs a call with a vet first.',
    options: ['Checkups and vaccinations', 'Every kind of visit, surgery too'],
  },
  {
    id: 'ahead',
    q: 'How far ahead can they book?',
    why: 'The front desk books up to 8 weeks ahead by phone. The site could go further.',
    options: ['Up to 8 weeks ahead', 'Up to 6 months ahead'],
  },
  {
    id: 'reminders',
    q: 'Remind owners by text or email?',
    why: 'Twilio is attached for texts, and a text costs about 3p.',
    options: ['Text, the day before', 'Email, the day before'],
  },
]

// ---- Crew -----------------------------------------------------------------

type CrewSeed = Pick<Farmhand, 'id' | 'role' | 'name' | 'color' | 'colorDark' | 'tools' | 'almanac' | 'seeds' | 'context'>

export const CREW: CrewSeed[] = [
  { id: 'frontend', role: 'Frontend', name: 'Frontend', color: '#f2c6de', colorDark: '#c98bb0', tools: ['GitHub', 'Playwright'], almanac: [], seeds: [], context: [] },
  { id: 'backend', role: 'Backend', name: 'Backend', color: '#9fd8c5', colorDark: '#5fa894', tools: ['GitHub'], almanac: [], seeds: [], context: [] },
  { id: 'messaging', role: 'Messaging', name: 'Messaging', color: '#d3e8b6', colorDark: '#98b679', tools: ['Twilio', 'GitHub'], almanac: [], seeds: [], context: [] },
  // Writes no code. It reviews the whole diff at the harvest.
  { id: 'reviewer', role: 'Reviewer', name: 'Reviewer', color: '#d9c2f0', colorDark: '#9d84bd', tools: ['GitHub'], almanac: ['owner-data.md', 'brand-style.md'], seeds: [], context: [] },
]

export const ROLE_ORDER: RoleId[] = ['frontend', 'backend', 'messaging', 'reviewer']
// The builders take tasks. The Reviewer only reviews.
export const BUILDERS: RoleId[] = ['frontend', 'backend', 'messaging']

// ---- Quest plan -------------------------------------------------------------

type TaskSeed = Omit<Task, 'used' | 'dry' | 'pests' | 'subtasks'> & {
  subtasks: Omit<Task['subtasks'][number], 'progress' | 'started' | 'done' | 'emitted'>[]
}

const plot = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

// Three fields, one per agent: the booking pages, the availability and bookings API, and the reminder texts.
// Plots are laid out again inside each agent's field when the valley is drawn.
export const TASKS: TaskSeed[] = [
  {
    id: 'frontend',
    name: 'Booking pages',
    crop: 'carrot',
    plot: plot(8, 13, 3, 2),
    budget: 30_000,
    assignee: 'frontend',
    proposedAssignee: 'frontend',
    signposts: ['vets.md', 'brand-style.md', 'GitHub', 'Playwright'],
    subtasks: [
      { id: 'f1', name: 'Pet and reason pages', secs: 3, energy: 6_000, actions: 16, sets: ['pagesReady'] },
      { id: 'f2', name: 'Vet and time picker', secs: 4, energy: 7_000, actions: 18, needs: ['slotsReady'] },
      { id: 'f3', name: 'Confirm page', secs: 3, energy: 4_000, actions: 11 },
    ],
  },
  {
    id: 'backend',
    name: 'Availability and bookings API',
    crop: 'wheat',
    plot: plot(17, 6, 3, 2),
    budget: 32_000,
    assignee: 'backend',
    proposedAssignee: 'backend',
    signposts: ['front-desk-hours.csv', 'vets.md', 'owner-data.md', 'GitHub'],
    subtasks: [
      { id: 'b1', name: 'Bookings data model', secs: 3, energy: 5_000, actions: 14 },
      { id: 'b2', name: 'Read the opening hours', secs: 3, energy: 6_000, actions: 0, sets: ['hoursRead'] },
      { id: 'b3', name: 'Availability search', secs: 4, energy: 8_000, actions: 22, sets: ['slotsReady'] },
      { id: 'b4', name: 'Book a slot', secs: 3, energy: 4_500, actions: 12, sets: ['bookingsReady'] },
    ],
  },
  {
    id: 'messaging',
    name: 'Reminder texts',
    crop: 'tulip',
    plot: plot(26, 13, 3, 2),
    budget: 14_000,
    assignee: 'messaging',
    proposedAssignee: 'messaging',
    proposalNote: 'Messaging texts staging phones only, through the Twilio MCP.',
    signposts: ['owner-data.md', 'Twilio', 'GitHub'],
    subtasks: [
      { id: 'm1', name: 'Reminder text', secs: 3, energy: 3_500, actions: 10 },
      { id: 'm2', name: 'Send the day before', secs: 3, energy: 4_500, actions: 12, needs: ['bookingsReady'] },
    ],
  },
]

// The subtask the head farmer adds when you settle where the opening hours come from.
export const REPLAN_SUBTASKS = {
  switch: { id: 'b5', name: 'Drop Saturday slots from 1 December', secs: 3, energy: 3_000, actions: 9, sets: [] as Flag[] },
}

// The file the trace finds missing, and the task that needed it.
export const MISSING = { taskId: 'backend', file: 'staff-rota/rota.md' }

// The clash, in the words the map and the ask use.
export const CLASH = {
  ours: 'the hours sheet',
  theirs: 'the staff rota',
  sheet: 'Saturdays 9:00 to 13:00',
  change: 'No vet works Saturdays from 1 December',
  crow: 'The hours sheet and the staff rota disagree about Saturdays',
  question: 'The hours sheet is out of date. Use the rota’s hours?',
  failed: 'Saturday 5 December, 9:00 to 13:00: 16 slots, and no vet on the rota.',
}

// Neighbour farm: drawn and animated, never simulated in depth.
export const NEIGHBOUR_PLOTS: { name: string; crop: CropKind; plot: Rect; stage: number; drought?: boolean }[] = [
  { name: 'Holiday requests', crop: 'cabbage', plot: plot(NEIGHBOUR.rect.x + 3, NEIGHBOUR.rect.y + 8, 5, 3), stage: 2 },
  { name: 'Winter rota', crop: 'wheat', plot: plot(NEIGHBOUR.rect.x + 13, NEIGHBOUR.rect.y + 8, 4, 3), stage: 3, drought: true },
  { name: 'On-call nights', crop: 'carrot', plot: plot(NEIGHBOUR.rect.x + 3, NEIGHBOUR.rect.y + 15, 4, 2), stage: 3 },
  { name: 'Rota emails', crop: 'tulip', plot: plot(NEIGHBOUR.rect.x + 13, NEIGHBOUR.rect.y + 15, 4, 2), stage: 2 },
]

// ---- Seeds ------------------------------------------------------------------

export const START_SEEDS: Seed[] = [
  {
    file: 'lesson-phone-first.md',
    title: 'Design booking pages for phones first',
    body: 'Most owners book from a phone. Check every page at phone width before the review.',
    from: 'Harvest: Pharmacy stock',
  },
]

export const LESSON_TRACE: Seed = {
  file: 'lesson-hours-from-rota.md',
  title: 'Read opening hours from the staff rota',
  body: 'The front desk hours sheet was last edited in August. The Staff rota project changes every week, and from 1 December no vet works Saturdays. Any task that offers appointments reads staff-rota/rota.md, not the hours sheet.',
  from: 'Harvest: Vet booking (crow on Availability and bookings API)',
  isNew: true,
}

export const LESSON_HOLD: Seed = {
  file: 'lesson-test-double-booking.md',
  title: 'Test two people booking the same slot',
  body: 'Two owners booked the same 9:00 slot at the same moment, and both were confirmed. Every booking flow gets an end-to-end test that books one slot from two browsers at once, and a slot is held for 5 minutes while someone books.',
  from: 'Harvest: Vet booking (failed end-to-end run)',
  isNew: true,
}
