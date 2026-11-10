// The harvest review. Approving the crew's work and merging it are two decisions.
// At Plan, each task gets "Done when" gates; a crop ripens only when its gates pass.
// At the harvest, the gates run again on the whole app, and you tick only what needs your eyes.
// Everything story-specific lives in this file as data, so the scenario can be swapped
// without touching the mechanism in the engine or the panel.

export type GateId = 'shots' | 'unit' | 'integration' | 'e2e' | 'review'

export const GATE_ORDER: GateId[] = ['shots', 'unit', 'integration', 'e2e', 'review']

export const GATES: Record<GateId, { name: string; detail: string }> = {
  shots: { name: 'Screenshots', detail: 'Every booking screen, at phone size' },
  unit: { name: 'Unit tests', detail: 'Tests for the code it changes' },
  integration: { name: 'Integration tests', detail: 'Against staging services' },
  e2e: { name: 'End-to-end on staging', detail: 'Real browsers, start to finish' },
  review: { name: 'Agentic review', detail: 'An agent that wrote none of the code' },
}

// Which gates each task carries, proposed by the head farmer at Plan. You can change them.
export const TASK_GATES: Record<string, { gate: GateId; what: string }[]> = {
  frontend: [
    { gate: 'unit', what: 'BookingFlow.test.tsx' },
    { gate: 'shots', what: 'Every booking screen, at phone size' },
    { gate: 'review', what: 'Runs on the whole diff' },
  ],
  backend: [
    { gate: 'unit', what: 'availability.test.ts, bookings.test.ts' },
    { gate: 'integration', what: 'Bookings API and the staff schedule on staging' },
    { gate: 'e2e', what: 'booking.spec.ts: book a checkup on a phone' },
    { gate: 'review', what: 'Runs on the whole diff' },
  ],
  messaging: [
    { gate: 'unit', what: 'reminder.test.ts' },
    { gate: 'integration', what: 'A text to a staging phone' },
    { gate: 'review', what: 'Runs on the whole diff' },
  ],
}

export type GateState = 'wait' | 'run' | 'pass' | 'fail' | 'look'

// What each gate reports for the whole run at the harvest. `look` means it passed and needs your eyes.
export const RESULTS: Record<GateId, { state: GateState; text: string }> = {
  shots: { state: 'look', text: '5 screens at phone size' },
  unit: { state: 'pass', text: '41 passed' },
  integration: { state: 'pass', text: '14 passed' },
  e2e: { state: 'pass', text: '4 runs passed, two owners at once too' },
  review: { state: 'look', text: '0 blocking, 2 notes' },
}

// The parts only you can judge, each beside its evidence.
export interface Check {
  id: string
  gate: GateId
  text: string
  evidence: string
}

export const CHECKS: Check[] = [
  { id: 'shots:0', gate: 'shots', text: 'Each booking screen reads well on a phone', evidence: 'brand-style.md: one question per screen, big tap targets.' },
  { id: 'shots:1', gate: 'shots', text: 'The reminder text sounds like the clinic', evidence: 'Sent to a staging phone through Twilio.' },
  { id: 'review:0', gate: 'review', text: 'The 2 notes can ship as they are', evidence: 'Neither blocks the deploy. Both are saved as follow-ups.' },
]

// What goes out, and to whom. Merging changes nothing for owners: the deploy does.
export const OUTPUT = {
  pr: 57,
  title: 'Add online booking',
  why: 'Pet owners can book a checkup or a vaccination online, up to 8 weeks ahead, and get a text the day before. Today they can only book by phone while the front desk is open. Surgery still starts with a call.',
  branch: 'homestead/vet-booking',
  base: 'main',
  files: 23,
  added: 1_184,
  removed: 0,
  audience: 'Reaches pet owners when you deploy',
  ships: 'Ships when you approve the deploy',
  checkout: 'git fetch origin && git switch homestead/vet-booking',
  undo: 'After this, undoing it means a revert and another deploy.',
  caught: 'Saturday slots with no vet were caught before any owner could book one.',
  ready: 'Online booking is ready for your review.',
  failed: 'Not ready. Two owners booked the same slot.',
  running: 'The gates are running on the whole app.',
  rerun: 'Every gate is running again.',
  merged: 'Merged into main. Nothing reaches owners until you deploy.',
}

// One commit per task on the pull request.
export const COMMITS: Record<string, string> = {
  frontend: 'Add the booking pages: pet, reason, vet and time, confirm',
  backend: 'Add the availability search and the bookings API',
  messaging: 'Text owners a reminder the day before',
}

// The failed gate at the harvest: two owners book the same slot at the same moment.
// It reaches you as a Failure ask from the agent whose code failed it.
export const HARVEST_FAIL = {
  taskId: 'backend',
  gate: 'e2e' as GateId,
  text: '2 owners booked the same slot',
  short: '2 bookings, 1 slot',
  detail: 'Two owners booked the same 9:00 slot at the same moment, and both were confirmed.',
  question: 'Two owners booked the same 9:00 slot at the same moment, and both were confirmed. Hold a slot for 5 minutes while someone books, then rerun?',
  fix: 'Backend holds a slot for 5 minutes while someone books, then every gate runs again.',
  fixed: 'Added a 5-minute hold on the slot while someone books',
  refused: 'The second booking is refused at confirm',
}

// What each task's own gates report during Grow, when they pass.
export const TASK_RESULTS: Record<string, Partial<Record<GateId, string>>> = {
  frontend: { unit: '12 passed', shots: '5 screens at phone size' },
  backend: { unit: '18 passed', integration: '9 passed', e2e: '1 passed, one owner' },
  messaging: { unit: '6 passed', integration: '1 text delivered' },
}

// A failed gate the crew fixes alone: Frontend's first unit run misses one error state.
export const UNIT_FAIL = {
  taskId: 'frontend',
  text: '1 failed, 11 passed',
  pest: 'BookingFlow.test.tsx: no message when the slot was just taken',
  fix: 'Added “That time was just taken. Pick another.” under the time picker. All 12 pass.',
}

// Backend's integration run on staging, while it still reads the hours sheet: Saturday slots with no vet.
export const INTEGRATION_FAIL = { text: 'No vet for 16 Saturday slots', again: 'Running again' }

// Lines each task's commit adds and removes. A new project, so nothing is removed.
export const COMMIT_STATS: Record<string, string> = { frontend: '+512', backend: '+468', messaging: '+204' }

// What each gate's page shows: the suites it ran, and for the end-to-end run, the recording.
export const GATE_DETAIL: Partial<Record<GateId, { status: string; rows: [string, string, string][]; output?: string; steps?: string[] }>> = {
  unit: {
    status: 'npm test, 9 seconds.',
    rows: [
      ['BookingFlow.test.tsx', 'Frontend, 12 new', '12 passed'],
      ['availability.test.ts', 'Backend, 11 new', '11 passed'],
      ['bookings.test.ts', 'Backend, 7 new, 2 for the hold', '7 passed'],
      ['reminder.test.ts', 'Messaging, 6 new', '6 passed'],
      ['Existing suites', '2 files from the template', '5 passed'],
    ],
    output: 'Test Files  6 passed (6)\n     Tests  41 passed (41)\n  Duration  9.4s',
  },
  integration: {
    status: 'Against staging services.',
    rows: [
      ['Bookings API', 'Book, move and cancel on staging', '9 passed'],
      ['Staff schedule', 'No Saturday slots from 1 December', '4 passed'],
      ['Reminder text', 'Twilio, to a staging phone', '1 passed'],
    ],
  },
  e2e: {
    status: 'Run by the Tests agent in two browsers at once, with the Playwright MCP.',
    rows: [
      ['booking.spec.ts', 'One owner books a checkup on a phone', '3 passed'],
      ['same-slot.spec.ts', 'Two owners, one slot: failed once, passed with the hold', '1 passed'],
    ],
    steps: ['Open /book on a phone', 'Pick Biscuit, a dog', 'Reason: vaccination', 'Dogs and cats vet, Tuesday 9:00', 'Confirm: the slot is held for 5 minutes', 'A second owner sees “That time was just taken”'],
  },
}
