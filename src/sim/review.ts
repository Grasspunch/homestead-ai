// The harvest review. Approving the crew's work and merging it are two decisions.
// At Plan, each task gets "Done when" gates; a crop ripens only when its gates pass.
// At the harvest, machine gates pass on their own and you tick only what needs your eyes.
// Everything story-specific lives in this file as data, so the scenario can be swapped
// without touching the mechanism in the engine or the panel.

export type GateId = 'shots' | 'unit' | 'integration' | 'e2e' | 'review'

export const GATE_ORDER: GateId[] = ['shots', 'unit', 'integration', 'e2e', 'review']

export const GATES: Record<GateId, { name: string; detail: string }> = {
  shots: { name: 'Screenshots', detail: 'Pages it changes, before and after' },
  unit: { name: 'Unit tests', detail: 'Tests for the code it changes' },
  integration: { name: 'Integration tests', detail: 'Against staging services' },
  e2e: { name: 'End-to-end on staging', detail: 'A real browser, start to finish' },
  review: { name: 'Agentic review', detail: 'An agent that wrote none of the code' },
}

// Which gates each task carries, proposed by the head farmer at Plan. You can change them.
export const TASK_GATES: Record<string, { gate: GateId; what: string }[]> = {
  backend: [
    { gate: 'unit', what: 'auth/google.test.ts' },
    { gate: 'integration', what: 'Callback route on staging' },
    { gate: 'review', what: 'Runs on the whole diff' },
  ],
  frontend: [
    { gate: 'unit', what: 'SignInButton.test.tsx' },
    { gate: 'shots', what: 'Sign-in page' },
    { gate: 'review', what: 'Runs on the whole diff' },
  ],
  tests: [
    { gate: 'e2e', what: 'google-signin.spec.ts, email-login.spec.ts' },
    { gate: 'review', what: 'Runs on the whole diff' },
  ],
  docs: [{ gate: 'review', what: 'Guide matches the callback route' }],
}

export type GateState = 'wait' | 'run' | 'pass' | 'fail' | 'look'

// What each gate reports for the whole run at the harvest. `look` means it passed and needs your eyes.
export const RESULTS: Record<GateId, { state: GateState; text: string }> = {
  shots: { state: 'look', text: '2 pages, before and after' },
  unit: { state: 'pass', text: '48 of 48 pass' },
  integration: { state: 'pass', text: '12 of 12 pass' },
  e2e: { state: 'pass', text: '3 of 3 runs, plus email login' },
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
  { id: 'shots:0', gate: 'shots', text: 'The Google button matches the design spec', evidence: 'auth-spec.md, frame 2: above the email field, full width.' },
  { id: 'shots:1', gate: 'shots', text: 'The error reads well under the button', evidence: 'Captured after cancelling the Google prompt.' },
  { id: 'review:0', gate: 'review', text: 'The 2 notes can ship as they are', evidence: 'Neither blocks the deploy. Both are saved as follow-ups.' },
]

// What goes out, and to whom. Merging is the one step that reaches outside people.
export const OUTPUT = {
  pr: 482,
  title: 'Add Google sign-in',
  branch: 'homestead/google-sign-in',
  base: 'main',
  files: 14,
  added: 312,
  removed: 41,
  audience: 'Ships to 12,400 users in Friday’s deploy',
  ships: 'Ships Friday, Nov 13, 10:00 PT',
  checkout: 'git fetch origin && git switch homestead/google-sign-in',
  undo: 'After this, undoing it means a revert and another deploy.',
  caught: 'A broken sign-in was caught before it reached 12,400 users.',
  ready: 'Google sign-in is ready for your review.',
  failed: 'Not ready. The review found a token written to the logs.',
  running: 'The Reviewer is reading the whole diff.',
  rerun: 'Every gate is running again.',
  merged: 'Merged into main. It ships to 12,400 users with Friday’s deploy. Simulated.',
  guide: { title: 'Setup guide', file: 'docs/auth/google.md' },
}

// One commit per task on the pull request.
export const COMMITS: Record<string, string> = {
  backend: 'Add /auth/google/callback with state and PKCE',
  frontend: 'Add the Continue with Google button and error states',
  tests: 'Add Google sign-in end-to-end tests',
  docs: 'Add the Google sign-in setup guide',
}

// A failed gate the demo can show: the reviewer finds a token in the logs.
export const REVIEW_FAIL = {
  taskId: 'backend',
  text: '1 blocking issue in Backend’s code',
  detail: 'src/auth/google.ts line 48 logs the id_token. oauth-security.md says never log tokens.',
  fix: 'Backend removes the log line, then every gate runs again.',
}

// What each task's own gates report during Grow, when they pass.
export const TASK_RESULTS: Record<string, Partial<Record<GateId, string>>> = {
  backend: { unit: '9 of 9', integration: '4 of 4' },
  frontend: { unit: '6 of 6', shots: 'Sign-in page, before and after' },
  tests: { e2e: '3 of 3 runs' },
  docs: {},
}

// A failed gate the crew fixes alone: Frontend's first unit run misses one error state.
export const UNIT_FAIL = {
  taskId: 'frontend',
  text: '5 of 6 pass',
  pest: 'SignInButton.test.tsx: the error has no role="alert"',
  fix: 'Wrapped the error in <FieldError>, which react-components.md says to use. 6 of 6 pass.',
}

// Tests' end-to-end run against the retired endpoint.
export const E2E_FAIL = { text: 'Failed, 404', again: 'Running again' }

// Lines each task's commit adds and removes.
export const COMMIT_STATS: Record<string, string> = { backend: '+128 −6', frontend: '+96 −31', tests: '+64', docs: '+24 −4' }

// What each gate's page shows: the suites it ran, and for the end-to-end run, the recording.
export const GATE_DETAIL: Partial<Record<GateId, { status: string; rows: [string, string, string][]; output?: string; steps?: string[] }>> = {
  unit: {
    status: 'npm test, 11 seconds.',
    rows: [
      ['auth/google.test.ts', 'Backend, 9 new', '9 of 9'],
      ['SignInButton.test.tsx', 'Frontend, 6 new', '6 of 6'],
      ['api/session.test.ts', 'Frontend, 5 changed for /v2', '5 of 5'],
      ['Existing suites', '9 files, unchanged', '28 of 28'],
    ],
    output: 'Test Files  12 passed (12)\n     Tests  48 passed (48)\n  Duration  11.2s',
  },
  integration: {
    status: 'Against staging services.',
    rows: [
      ['Callback route', 'A Google test account, a real redirect', '4 of 4'],
      ['Session API v2', 'POST /v2/session on staging', '5 of 5'],
      ['Email login', 'Unchanged code, tested again', '3 of 3'],
    ],
  },
  e2e: {
    status: 'Run by Tests, with the Playwright MCP.',
    rows: [
      ['google-signin.spec.ts', 'Failed on /v1/session, passed after your answer', '3 of 3'],
      ['email-login.spec.ts', 'Still works', '3 of 3'],
    ],
    steps: ['Open /login', 'Click “Continue with Google”', 'Google consent screen', 'Redirect to /auth/google/callback', 'POST /v2/session returns 201', 'Lands on /home, signed in'],
  },
}

export const GUIDE = 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then add https://app.example.com/auth/google/callback as a redirect URI in the Google console.'
