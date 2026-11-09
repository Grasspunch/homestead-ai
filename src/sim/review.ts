// The harvest review. Approving the crew's work and sending it are two decisions.
// At Plan, each task gets "Done when" checks; at the harvest each check sits beside its evidence.
// Everything story-specific lives in this file as data, so the scenario can be swapped
// without touching the mechanism in the engine or the panel.

export type OutputId = 'announcement' | 'invite' | 'recipients'

export interface OutputSeed {
  id: OutputId
  title: string
  file: string
}

// What leaves the company, grouped by what goes out (not by task or farmhand).
export const OUTPUTS: OutputSeed[] = [
  { id: 'announcement', title: 'Announcement', file: 'announcement.md' },
  { id: 'invite', title: 'Webinar invite', file: 'webinar.ics' },
  { id: 'recipients', title: 'Recipient list', file: 'recipients.csv' },
]

// The facts a check is judged on, read from the finished run.
export interface RunFacts {
  launchDate: string
  engDate: string
  webinarDate: string
  expectedWebinar: string
  sourceFixed: boolean
  quote?: string // the owner's answer to the quote ask
  brandChecked: boolean
  recipients: number
  companies: number
}

export type CheckState = 'pass' | 'fail' | 'blocked' | 'manual'

export interface CheckResult {
  state: CheckState
  evidence: string
}

export interface CheckSeed {
  id: string
  taskId: string
  output: OutputId
  text: string
  judge: (f: RunFacts) => CheckResult
  // What the crew does when you send a failed check back.
  fix?: string
}

const pass = (evidence: string): CheckResult => ({ state: 'pass', evidence })

// Proposed by the head farmer at Plan. You can remove them or add your own.
export const DONE_WHEN: CheckSeed[] = [
  {
    id: 'c-facts',
    taskId: 'research',
    output: 'announcement',
    text: 'Every date and number has a source file',
    judge: () => pass('9 dates and 6 numbers, each with the file it came from.'),
  },
  {
    id: 'c-date',
    taskId: 'draft',
    output: 'announcement',
    text: 'The launch date matches engineering’s latest note',
    judge: (f) =>
      f.launchDate === f.engDate
        ? pass(`eng-standup-notes/2026-02-03.md: “v2 release moves to ${f.engDate}.”`)
        : { state: 'fail', evidence: `The announcement says ${f.launchDate}. eng-standup-notes/2026-02-03.md says ${f.engDate}.` },
    fix: 'The Writer changes the date and the invite follows it.',
  },
  {
    id: 'c-sources',
    taskId: 'factcheck',
    output: 'announcement',
    text: 'Every number cites a source',
    judge: (f) =>
      f.sourceFixed
        ? pass('3.2x comes from benchmarks-q4.xlsx row 14: sync to peers p50 1.9s to 0.6s.')
        : { state: 'fail', evidence: '“Up to 3x faster” has no source.' },
    fix: 'The Writer cites the benchmark.',
  },
  {
    id: 'c-quote',
    taskId: 'factcheck',
    output: 'announcement',
    text: 'The Acme quote is attributed by role',
    judge: (f) =>
      f.quote === 'paraphrase'
        ? pass('Paraphrased, with no quote and no name.')
        : f.quote === 'keep'
          ? pass('customer-call-notes.md (Jan 28): “OK to quote the ops lead by role.”')
          : { state: 'blocked', evidence: 'Waiting for your answer on the quote.' },
  },
  {
    id: 'c-voice',
    taskId: 'brand',
    output: 'announcement',
    text: 'No words that brand-voice.md bans',
    judge: (f) => (f.brandChecked ? pass('brand-voice.md bans “revolutionary”. It was taken out of the headline options.') : { state: 'blocked', evidence: 'The tone check has not run.' }),
  },
  {
    id: 'c-webinar',
    taskId: 'invites',
    output: 'invite',
    text: 'The webinar date follows the launch date',
    judge: (f) =>
      f.webinarDate === f.expectedWebinar
        ? pass(`${f.webinarDate} at 10:00 PT, before the ${f.launchDate} launch, as you asked.`)
        : { state: 'fail', evidence: `The invite says ${f.webinarDate}. With launch on ${f.launchDate} it should be ${f.expectedWebinar}.` },
    fix: 'The Scheduler moves the webinar.',
  },
  {
    id: 'c-list',
    taskId: 'invites',
    output: 'recipients',
    text: 'The list matches pilot-customers.csv',
    judge: (f) => pass(`${f.recipients} people at ${f.companies} companies, the same rows as pilot-customers.csv.`),
  },
]

// Which output a check you add to a task belongs to.
export const TASK_OUTPUT: Record<string, OutputId> = {
  research: 'announcement',
  draft: 'announcement',
  factcheck: 'announcement',
  brand: 'announcement',
  invites: 'invite',
}
