// The library: files are facts an agent reads; skills are how to do the job;
// tools (MCP servers) are what it can act on.
// Story-specific data, kept apart from the engine so the scenario can be swapped.

export type LibKind = 'file' | 'skill' | 'tool'

export interface Access {
  label: string
  kind: 'read' | 'write'
  on: boolean
}

export interface LibItem {
  kind: LibKind
  what: string // one line: what it is
  owner: string
  updated: string
  tokens: number // a file or skill: cost each time an agent reads it; a tool: its tool definitions per agent
  preview: string // a skill: what it teaches; a tool: the tools it exposes
  access?: Access[] // a tool: what agents may do with it
}

export const LIBRARY: Record<string, LibItem> = {
  'front-desk-hours.csv': {
    kind: 'file',
    what: 'Opening hours, kept by the front desk',
    owner: 'Front desk',
    updated: 'Aug 14',
    tokens: 400,
    preview: 'Monday to Friday, 8:00 to 19:00\nSaturday, 9:00 to 13:00\nSunday, closed',
  },
  'vets.md': {
    kind: 'file',
    what: 'The vets, what each one sees, and how long visits take',
    owner: 'Practice team',
    updated: 'Oct 6',
    tokens: 900,
    preview: 'Dogs and cats vet, small pets vet, dental vet.\nA checkup or a vaccination takes 15 minutes.',
  },
  'staff-rota/rota.md': {
    kind: 'file',
    what: 'Which vet works when, from the Staff rota project',
    owner: 'Practice team',
    updated: 'Nov 3',
    tokens: 700,
    preview: 'No vet works Saturdays from 1 December. The clinic is closed on Saturdays from that date.',
  },
  'brand-style.md': {
    kind: 'skill',
    what: 'How Willow Lane Vets looks and sounds',
    owner: 'Design, used in 4 past runs',
    updated: 'Sep 12',
    tokens: 1_000,
    preview: 'Warm green for actions, cream behind pages. Plain words. One question per screen on a phone.',
  },
  'owner-data.md': {
    kind: 'skill',
    what: 'How we handle owners’ phone numbers and pets’ records',
    owner: 'Practice team',
    updated: 'Oct 2',
    tokens: 800,
    preview: 'Never log a phone number. Texts go out between 9:00 and 20:00 and say how to cancel.',
  },
  'lesson-phone-first.md': {
    kind: 'skill',
    what: 'Design booking pages for phones first',
    owner: 'Saved from your last harvest',
    updated: 'Nov 2',
    tokens: 300,
    preview: 'Most owners book from a phone. Check every page at phone width before the review.',
  },
  GitHub: {
    kind: 'tool',
    what: 'Read the repo and open a pull request',
    owner: 'MCP server, signed in as homestead-bot',
    updated: '',
    tokens: 2_400,
    preview: 'get_file_contents\nlist_pull_requests\ncreate_pull_request\nmerge_pull_request',
    access: [
      { label: 'Read code, issues and pull requests', kind: 'read', on: true },
      { label: 'Open a pull request on willow-lane-booking', kind: 'write', on: true },
      { label: 'Merge a pull request', kind: 'write', on: false },
    ],
  },
  Playwright: {
    kind: 'tool',
    what: 'Drive a browser on staging: click, type, screenshot',
    owner: 'MCP server, runs in the sandbox',
    updated: '',
    tokens: 1_900,
    preview: 'browser_navigate\nbrowser_click\nbrowser_type\nbrowser_take_screenshot',
    access: [
      { label: 'Open staging.willowlanevets.co.uk', kind: 'read', on: true },
      { label: 'Click, type and take screenshots', kind: 'write', on: true },
      { label: 'Open any other site', kind: 'write', on: false },
    ],
  },
  Sentry: {
    kind: 'tool',
    what: 'Read errors and health checks for online booking in production',
    owner: 'MCP server, read only',
    updated: '',
    tokens: 1_200,
    preview: 'search_issues\nget_issue_details\nresolve_issue',
    access: [
      { label: 'Read issues and stack traces', kind: 'read', on: true },
      { label: 'Resolve or mute issues', kind: 'write', on: false },
    ],
  },
  Twilio: {
    kind: 'tool',
    what: 'Send text messages to pet owners from WillowVets',
    owner: 'MCP server, signed in as Willow Lane Vets',
    updated: '',
    tokens: 700,
    preview: 'send_message\nsend_bulk\nget_delivery_status',
    access: [
      { label: 'Read delivery status', kind: 'read', on: true },
      { label: 'Text one pet owner', kind: 'write', on: true },
      { label: 'Text every pet owner, after you approve', kind: 'write', on: true },
    ],
  },
  'GitHub Actions': {
    kind: 'tool',
    what: 'Read workflow runs and logs on main',
    owner: 'MCP server, read only',
    updated: '',
    tokens: 900,
    preview: 'list_workflow_runs\nget_workflow_run\nget_job_logs',
    access: [
      { label: 'Read workflow runs and job logs', kind: 'read', on: true },
      { label: 'Re-run or cancel a workflow', kind: 'write', on: false },
    ],
  },
}

export const KIND_MARK: Record<LibKind, string> = { file: 'F', skill: 'S', tool: 'T' }
export const KIND_NAME: Record<LibKind, string> = { file: 'File', skill: 'Skill', tool: 'MCP tool' }

// What each task reads, uses and can call, as the head farmer proposes it at Plan
// (files, then skills, then tools).
export const TASK_CONTEXT: Record<string, string[]> = {
  frontend: ['vets.md', 'brand-style.md', 'GitHub', 'Playwright'],
  backend: ['front-desk-hours.csv', 'vets.md', 'owner-data.md', 'GitHub'],
  messaging: ['owner-data.md', 'Twilio', 'GitHub'],
}

// The head farmer points out a file a task is missing, and says why.
export const SUGGESTIONS: { taskIds: string[]; name: string; why: string }[] = [
  { taskIds: ['backend'], name: 'staff-rota/rota.md', why: 'It says which vets work when, and it changed last week. The hours sheet was last edited in August.' },
]

export function libItem(name: string, seeds: { file: string; title: string; from: string }[] = []): LibItem {
  const hit = LIBRARY[name]
  if (hit) return hit
  const seed = seeds.find((s) => s.file === name)
  if (seed) return { kind: 'skill', what: seed.title, owner: seed.from, updated: 'Today', tokens: 300, preview: seed.title }
  return { kind: name.endsWith('.md') && name.startsWith('lesson-') ? 'skill' : 'file', what: name, owner: 'Unknown', updated: '', tokens: 1_000, preview: '' }
}
