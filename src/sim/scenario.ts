// The demo story: a product team launches Relay v2. Each farm is named after its project.
// Every word an agent says in the demo lives here, so the script can be tuned in one place.

import type { CropKind, Farmhand, Rect, RoleId, Seed, Task } from './types'

export const TILE = 16
export const WORLD = { w: 76, h: 46 }

export const FARM = {
  name: 'Relay v2 launch',
  team: 'Product team',
  rect: { x: 2, y: 2, w: 34, h: 21 } as Rect,
  house: { x: 4, y: 3, sprite: 'house_0' },
  headFarmer: { x: 7.5, y: 8.4 },
  // The farmhouse door: farmhands wait for you on the porch.
  door: { x: 5.95, y: 7.1 },
  porch: [
    { x: 5.3, y: 7.7 },
    { x: 6.6, y: 7.7 },
  ],
  // The crew sleeps in the barn and goes back inside when its work is done.
  barn: { x: 20, y: 3, sprite: 'house_1', door: { x: 21.95, y: 7.15 } },
  seedLibrary: { x: 12, y: 6 },
  // Ripe crops are carried here at the harvest.
  shipping: { x: 15.5, y: 9.1 },
  // Where the head farmer stands to lift files out of the chest.
  chestSpot: { x: 12.5, y: 7.9 },
  budget: 120_000,
}

export const NEIGHBOUR = {
  name: 'Auth SDK v2',
  team: 'Platform team',
  rect: { x: 40, y: 2, w: 34, h: 21 } as Rect,
  house: { x: 66, y: 3, sprite: 'house_4' },
}

// The two farms in the valley that only show up in the valley view.
export const OTHER_FARMS = [
  {
    name: 'Brand refresh',
    team: 'Design team',
    rect: { x: 2, y: 26, w: 34, h: 18 } as Rect,
    house: { x: 4, y: 27, sprite: 'house_5' },
    kind: 'garden' as const,
  },
  {
    name: 'Invoices',
    team: 'Finance team',
    rect: { x: 40, y: 26, w: 34, h: 18 } as Rect,
    house: { x: 66, y: 27, sprite: 'house_2' },
    kind: 'orchard' as const,
  },
]

export const CROW_SPOT = { x: 38, y: 12.2 }

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
  { id: 'chest', kind: 'chest', sprite: 'chest', x: FARM.seedLibrary.x, y: FARM.seedLibrary.y, w: 1.5, h: 1.2 },
  { id: 'well', kind: 'well', sprite: 'well', x: 17, y: 4, w: 2, h: 1.9 },
  { id: 'pond', kind: 'pond', sprite: '', x: 28, y: 4, w: 5, h: 3 },
  { id: 'apple-tree', kind: 'tree', sprite: 'tree_apple', x: 32, y: 14, w: 2, h: 2 },
  { id: 'nap-tree', kind: 'tree', sprite: 'tree', x: 11.5, y: 17.6, w: 2, h: 2 },
  { id: 'bush-a', kind: 'bush', sprite: 'bush_1', x: 26, y: 4, w: 1, h: 1 },
  { id: 'bush-b', kind: 'bush', sprite: 'bush_0', x: 34, y: 10.5, w: 1, h: 1 },
  { id: 'sunflower', kind: 'sunflower', sprite: 'sunflower', x: 34, y: 17, w: 1, h: 2 },
  { id: 'house-flowers', kind: 'flowers', sprite: 'flower_2', x: 3, y: 7.2, w: 1, h: 1 },
  { id: 'workstation', kind: 'workstation', sprite: 'workstation', x: 9.2, y: 4.8, w: 1.9, h: 1.3 },
  { id: 'basket', kind: 'basket', sprite: 'basket', x: 30.6, y: 15.6, w: 1, h: 1 },
]

// Chickens wander inside this pen.
export const CHICKEN_PEN = { x: 27.6, y: 8.3, w: 4.6, h: 1.4 }

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
  { id: 'feed', label: 'Feeding the chickens', spot: { x: 27.0, y: 9.2 }, dir: 'right', anim: 'water' },
  { id: 'flowers', label: 'Watering the flowers', spot: { x: 3.5, y: 9.0 }, dir: 'up', anim: 'water' },
  { id: 'chop', label: 'Chopping wood', spot: { x: 10.1, y: 7.2 }, dir: 'up', anim: 'chop' },
  { id: 'fruit', label: 'Picking apples', spot: { x: 33.0, y: 16.6 }, dir: 'up', anim: 'idle', emote: 'check' },
  { id: 'nap', label: 'Napping under the tree', spot: { x: 12.5, y: 20.1 }, dir: 'down', anim: 'idle', emote: 'sleep' },
  { id: 'pond', label: 'Looking at the pond', spot: { x: 30.5, y: 7.7 }, dir: 'up', anim: 'idle' },
  { id: 'chat-a', label: 'Chatting', spot: { x: 16.4, y: 7.3 }, dir: 'right', anim: 'idle', partner: 'chat-b' },
  { id: 'chat-b', label: 'Chatting', spot: { x: 17.7, y: 7.3 }, dir: 'left', anim: 'idle', partner: 'chat-a' },
]

export const VALLEY_STATS: Record<string, { agents: number; energyWeek: number; pests: number; waiting: number; harvests: number; unattended?: string }> = {
  [FARM.name]: { agents: 5, energyWeek: 0, pests: 0, waiting: 0, harvests: 0 },
  [NEIGHBOUR.name]: { agents: 4, energyWeek: 412_000, pests: 3, waiting: 1, harvests: 2 },
  'Brand refresh': { agents: 3, energyWeek: 168_000, pests: 0, waiting: 0, harvests: 4, unattended: '1 sprinkler: nightly asset export' },
  Invoices: { agents: 2, energyWeek: 96_000, pests: 1, waiting: 0, harvests: 31, unattended: '1 beehive: invoice extraction' },
}

// ---- Brief ----------------------------------------------------------------

export const BRIEF_GOAL =
  'Announce Relay v2 to our pilot customers and run a launch webinar. The announcement has to match what we promised Acme and the other pilots.'

export interface Attachment {
  id: string
  name: string
  kind: 'file' | 'doc' | 'folder' | 'sheet' | 'skill'
  note: string
  selected: boolean
}

export const ATTACHMENTS: Attachment[] = [
  { id: 'brief', name: 'product-brief-relay-v2.pdf', kind: 'file', note: 'Product brief', selected: true },
  { id: 'calls', name: 'customer-call-notes.md', kind: 'doc', note: 'Pilot customer calls', selected: true },
  { id: 'pilots', name: 'pilot-customers.csv', kind: 'sheet', note: '6 companies, 42 contacts', selected: true },
  { id: 'bench', name: 'benchmarks-q4.xlsx', kind: 'sheet', note: 'Sync benchmarks', selected: true },
  { id: 'voice', name: 'brand-voice.md', kind: 'skill', note: 'Skill from the brand team', selected: true },
  { id: 'post', name: 'write-launch-post.md', kind: 'skill', note: 'Skill from the marketing team', selected: true },
  { id: 'tz', name: 'lesson-webinar-timezones.md', kind: 'skill', note: 'Lesson saved from a past harvest', selected: true },
  { id: 'quote', name: 'lesson-quote-approval.md', kind: 'skill', note: 'Lesson saved from a past harvest', selected: true },
  { id: 'standup', name: 'eng-standup-notes/', kind: 'folder', note: 'Engineering standups', selected: false },
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
    id: 'audience',
    q: 'Who is the announcement for?',
    why: 'The brief says pilots, but the product brief reads like a public launch.',
    options: ['The 6 pilot customers', 'All customers'],
  },
  {
    id: 'channel',
    q: 'Who should the invites come from?',
    why: 'Sending from a person usually gets more replies from pilots.',
    options: ['Your email', 'The marketing mailing tool'],
  },
  {
    id: 'webinar',
    q: 'When should the webinar run?',
    why: 'I can schedule it relative to the launch date.',
    options: ['Two days before launch', 'On launch day'],
  },
]

// ---- Crew -----------------------------------------------------------------

type CrewSeed = Pick<Farmhand, 'id' | 'role' | 'name' | 'color' | 'colorDark' | 'tools' | 'almanac' | 'seeds' | 'context'>

export const CREW: CrewSeed[] = [
  {
    id: 'researcher',
    role: 'Researcher',
    name: 'Fern',
    color: '#9fd8c5',
    colorDark: '#5fa894',
    tools: ['Drive (read)', 'Web search'],
    almanac: [],
    seeds: [],
    context: ['product-brief-relay-v2.pdf', 'customer-call-notes.md', 'benchmarks-q4.xlsx'],
  },
  {
    id: 'writer',
    role: 'Writer',
    name: 'Basil',
    color: '#f2c6de',
    colorDark: '#c98bb0',
    tools: ['Docs (write)'],
    almanac: ['brand-voice.md'],
    seeds: [],
    context: ['product-brief-relay-v2.pdf', 'customer-call-notes.md', 'Facts from the Researcher'],
  },
  {
    id: 'reviewer',
    role: 'Reviewer',
    name: 'Sorrel',
    color: '#f6d58e',
    colorDark: '#c9a253',
    tools: ['Docs (comment)'],
    almanac: ['brand-voice.md'],
    seeds: ['lesson-quote-approval.md'],
    context: ['The draft', 'benchmarks-q4.xlsx'],
  },
  {
    id: 'scheduler',
    role: 'Scheduler',
    name: 'Thyme',
    color: '#b9cdf5',
    colorDark: '#7d93c9',
    tools: ['Calendar', 'Email (send, asks first)', 'CRM (read)'],
    almanac: [],
    seeds: ['lesson-webinar-timezones.md'],
    context: ['pilot-customers.csv'],
  },
]

export const ROLE_ORDER: RoleId[] = ['researcher', 'writer', 'reviewer', 'scheduler']

// ---- Quest plan -------------------------------------------------------------

type TaskSeed = Omit<Task, 'used' | 'dry' | 'pests' | 'subtasks'> & {
  subtasks: Omit<Task['subtasks'][number], 'progress' | 'started' | 'done' | 'emitted'>[]
}

const plot = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

export const TASKS: TaskSeed[] = [
  {
    id: 'research',
    name: 'Gather launch facts',
    crop: 'wheat',
    plot: plot(5, 12, 4, 3),
    budget: 18_000,
    assignee: 'researcher',
    proposedAssignee: 'researcher',
    signposts: ['product-brief-relay-v2.pdf', 'customer-call-notes.md', 'benchmarks-q4.xlsx'],
    subtasks: [
      { id: 'r1', name: 'Read the product brief', secs: 4, energy: 6_000, actions: 14 },
      { id: 'r2', name: 'Pull pilot quotes', secs: 4, energy: 7_500, actions: 18 },
      { id: 'r3', name: 'Collect dates and numbers', secs: 3, energy: 3_000, actions: 12, sets: ['factsReady'] },
    ],
  },
  {
    id: 'draft',
    name: 'Draft the announcement',
    crop: 'carrot',
    plot: plot(12, 12, 6, 4),
    budget: 30_000,
    assignee: 'writer',
    proposedAssignee: 'writer',
    signposts: ['product-brief-relay-v2.pdf', 'customer-call-notes.md', 'write-launch-post.md'],
    subtasks: [
      { id: 'd1', name: 'Outline', secs: 3, energy: 4_000, actions: 9, sets: ['outlineDone'] },
      { id: 'd2', name: 'Write the draft', secs: 6, energy: 12_000, actions: 26, needs: ['factsReady'], sets: ['draftWritten', 'dateUsed'] },
      { id: 'd3', name: 'Headline options', secs: 3, energy: 4_000, actions: 8, needs: ['draftWritten'] },
    ],
  },
  {
    id: 'factcheck',
    name: 'Fact-check claims',
    crop: 'cabbage',
    plot: plot(21, 12, 3, 3),
    budget: 10_000,
    assignee: 'writer',
    proposedAssignee: 'writer',
    proposalNote: 'The Writer knows the draft best. Saves about 4k energy.',
    signposts: ['benchmarks-q4.xlsx', 'customer-call-notes.md', 'lesson-quote-approval.md'],
    subtasks: [
      { id: 'f1', name: 'Check numbers', secs: 4, energy: 4_000, actions: 16, needs: ['draftWritten'] },
      { id: 'f2', name: 'Check quotes', secs: 3, energy: 3_000, actions: 11, sets: ['factcheckDone'] },
    ],
  },
  {
    id: 'brand',
    name: 'Brand voice pass',
    crop: 'tulip',
    plot: plot(27, 12, 3, 2),
    budget: 6_000,
    assignee: 'reviewer',
    proposedAssignee: 'reviewer',
    signposts: ['brand-voice.md'],
    subtasks: [{ id: 'b1', name: 'Tone check', secs: 3, energy: 3_500, actions: 10, needs: ['dateResolved'] }],
  },
  {
    id: 'invites',
    name: 'Webinar and invites',
    crop: 'pumpkin',
    plot: plot(21, 17, 5, 3),
    budget: 20_000,
    assignee: 'scheduler',
    proposedAssignee: 'scheduler',
    signposts: ['pilot-customers.csv', 'lesson-webinar-timezones.md'],
    subtasks: [
      { id: 'i1', name: 'Pick a webinar slot', secs: 3, energy: 3_000, actions: 10 },
      { id: 'i2', name: 'Build the invite list', secs: 4, energy: 5_000, actions: 21 },
      { id: 'i3', name: 'Queue the invites', secs: 3, energy: 1_500, actions: 9, needs: ['replanApplied'], sets: ['invitesQueued'] },
    ],
  },
]

// Extra subtasks the head farmer adds when the date conflict is resolved.
export const REPLAN_SUBTASKS = {
  writer: { id: 'd4', name: 'Update the launch date', secs: 2, energy: 2_000, actions: 7 },
  acme: { id: 'd5', name: 'Tell Acme the new date', secs: 3, energy: 2_500, actions: 8 },
}

// Neighbour farm: drawn and animated, never simulated in depth.
export const NEIGHBOUR_PLOTS: { name: string; crop: CropKind; plot: Rect; stage: number; drought?: boolean }[] = [
  { name: 'Auth SDK migration', crop: 'cabbage', plot: plot(44, 12, 5, 3), stage: 2 },
  { name: 'Release v2.0', crop: 'wheat', plot: plot(52, 12, 4, 3), stage: 1, drought: true },
  { name: 'Load tests', crop: 'carrot', plot: plot(59, 12, 4, 3), stage: 3 },
  { name: 'Docs update', crop: 'tulip', plot: plot(52, 17, 4, 2), stage: 2 },
]

// ---- Seeds ------------------------------------------------------------------

export const START_SEEDS: Seed[] = [
  {
    file: 'lesson-webinar-timezones.md',
    title: 'Show webinar times in each recipient’s time zone',
    body: 'Pilot customers span 4 time zones. Invites that showed only PT got 30% fewer sign-ups. Put the time in the recipient’s own zone, and PT in brackets.',
    from: 'Harvest: Q4 Webinar',
  },
  {
    file: 'lesson-quote-approval.md',
    title: 'Customer quotes need the customer’s OK',
    body: 'Before a customer quote goes outside the company, check the call notes for an explicit OK to quote. If none, paraphrase without the name.',
    from: 'Harvest: Case studies',
  },
]

export const LESSON_DATES: Seed = {
  file: 'lesson-launch-dates.md',
  title: 'Launch dates come from engineering',
  body: 'When a task sets or repeats a launch date, attach the engineering release tracker or standup notes as a signpost. Customer call notes record promises, not the schedule.',
  from: 'Harvest: Relay v2 launch (crow on Draft the announcement)',
  isNew: true,
}

export const LESSON_SOURCES: Seed = {
  file: 'lesson-cite-benchmarks.md',
  title: 'Every performance claim cites its benchmark',
  body: 'Claims like “3x faster” need the benchmark file and row next to them in the draft, or the Reviewer will flag them.',
  from: 'Harvest: Relay v2 launch (beetle on Draft the announcement)',
  isNew: true,
}

// ---- Harvest ----------------------------------------------------------------

export const INVITE_LIST = [
  { company: 'Acme', contacts: 12 },
  { company: 'Northwind', contacts: 9 },
  { company: 'Globex', contacts: 7 },
  { company: 'Initech', contacts: 6 },
  { company: 'Umbrella Health', contacts: 5 },
  { company: 'Hooli', contacts: 3 },
]

