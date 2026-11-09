// The library: files are facts an agent reads; skills are how to do the job.
// Story-specific data, kept apart from the engine so the scenario can be swapped.

export interface LibItem {
  kind: 'file' | 'skill'
  what: string // one line: what it is
  owner: string
  updated: string
  tokens: number // cost each time an agent reads it
  preview: string // for a skill: what it teaches
}

export const LIBRARY: Record<string, LibItem> = {
  'product-brief-relay-v2.pdf': {
    kind: 'file',
    what: 'Product brief for Relay v2',
    owner: 'Product team',
    updated: 'Jan 20',
    tokens: 4_100,
    preview: 'Relay v2 ships faster sync, single sign-on through the new Auth SDK, and audit log export. Pilot customers first.',
  },
  'customer-call-notes.md': {
    kind: 'file',
    what: 'Notes from the pilot customer calls',
    owner: 'You',
    updated: 'Jan 28',
    tokens: 6_300,
    preview: 'Jan 28, Acme: “We told Acme they would have v2 by March 12.” OK to quote the ops lead by role, not by name.',
  },
  'pilot-customers.csv': {
    kind: 'file',
    what: 'The 6 pilot customers and their 42 contacts',
    owner: 'Sales team',
    updated: 'Jan 15',
    tokens: 1_200,
    preview: 'company, contacts\nAcme, 12\nNorthwind, 9\nGlobex, 7 …',
  },
  'benchmarks-q4.xlsx': {
    kind: 'file',
    what: 'Q4 sync benchmarks',
    owner: 'Platform team',
    updated: 'Dec 18',
    tokens: 2_800,
    preview: 'Row 14: sync to peers, p50 1.9s (v1) to 0.6s (v2), 3.2x.',
  },
  'eng-standup-notes/': {
    kind: 'file',
    what: 'Engineering standup notes',
    owner: 'Engineering team',
    updated: 'Feb 3',
    tokens: 9_400,
    preview: 'Feb 3: “v2 release moves to March 26.” Auth SDK review slipped a week.',
  },
  'brand-voice.md': {
    kind: 'skill',
    what: 'How we write for customers: tone and banned words',
    owner: 'Brand team',
    updated: 'Jan 9',
    tokens: 900,
    preview: 'Plain, specific, warm. Never “revolutionary”, “seamless” or “game-changing”.',
  },
  'write-launch-post.md': {
    kind: 'skill',
    what: 'How to structure a launch announcement',
    owner: 'Marketing team',
    updated: 'Nov 30',
    tokens: 700,
    preview: 'Lead with the date and the one change customers will notice. One quote. One link.',
  },
  'lesson-webinar-timezones.md': {
    kind: 'skill',
    what: 'Show webinar times in each recipient’s time zone',
    owner: 'Saved from the Q4 Webinar harvest',
    updated: 'Dec 12',
    tokens: 300,
    preview: 'Put the time in the recipient’s own zone, and PT in brackets.',
  },
  'lesson-quote-approval.md': {
    kind: 'skill',
    what: 'Ask before quoting a customer by name',
    owner: 'Saved from the Q3 Case study harvest',
    updated: 'Oct 2',
    tokens: 300,
    preview: 'Quote a customer only with an explicit OK on file. A verbal OK means: attribute by role.',
  },
}

// The head farmer points out a file a task is missing, and says why.
export const SUGGESTIONS: { taskIds: string[]; name: string; why: string }[] = [
  { taskIds: ['draft', 'research'], name: 'eng-standup-notes/', why: 'It mentions Relay v2 dates and was updated after the call notes.' },
]

export function libItem(name: string, seeds: { file: string; title: string; from: string }[] = []): LibItem {
  const hit = LIBRARY[name]
  if (hit) return hit
  const seed = seeds.find((s) => s.file === name)
  if (seed) return { kind: 'skill', what: seed.title, owner: seed.from, updated: 'Today', tokens: 300, preview: seed.title }
  return { kind: name.endsWith('.md') && name.startsWith('lesson-') ? 'skill' : 'file', what: name, owner: 'Unknown', updated: '', tokens: 1_000, preview: '' }
}
