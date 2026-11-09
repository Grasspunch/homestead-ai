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
  'web-app/src/': {
    kind: 'file',
    what: 'The web app source code',
    owner: 'Web team',
    updated: 'today',
    tokens: 18_600,
    preview: 'src/api/session.ts\n  export const startSession = (token) =>\n    post("/v1/session", { token })',
  },
  'auth-spec.md': {
    kind: 'file',
    what: 'Design spec for Google sign-in',
    owner: 'Design team',
    updated: 'Nov 4',
    tokens: 2_100,
    preview: 'Frame 2: "Continue with Google" sits above the email field, full width. Errors show under the button.',
  },
  'e2e-tests/': {
    kind: 'file',
    what: 'End-to-end test suite',
    owner: 'QA team',
    updated: 'Nov 6',
    tokens: 5_400,
    preview: 'email-login.spec.ts\nsignup.spec.ts\nreset-password.spec.ts',
  },
  'session-api-v2/CHANGELOG.md': {
    kind: 'file',
    what: 'Changelog from the Session API v2 project',
    owner: 'Platform team',
    updated: 'yesterday',
    tokens: 800,
    preview: 'Nov 8: /v1/session removed from staging. Removed from production Nov 12. Use POST /v2/session.',
  },
  'oauth-security.md': {
    kind: 'skill',
    what: 'How we do OAuth safely: state, PKCE, no tokens in logs',
    owner: 'Security team',
    updated: 'Oct 2',
    tokens: 1_100,
    preview: 'Always send a state parameter. Use PKCE. Never log access_token or id_token.',
  },
  'react-components.md': {
    kind: 'skill',
    what: 'Our component patterns for buttons, forms and errors',
    owner: 'Web team, used in 11 past runs',
    updated: 'Oct 20',
    tokens: 1_400,
    preview: 'Use <Button variant="provider"> for third-party sign-in. Errors go in <FieldError> under the control.',
  },
  'lesson-check-changelogs.md': {
    kind: 'skill',
    what: 'Read a project’s changelog before calling its API',
    owner: 'Saved from your last harvest',
    updated: 'Nov 2',
    tokens: 300,
    preview: 'Before a task calls another team’s API, attach that project’s changelog.',
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
      { label: 'Open a pull request on web-app', kind: 'write', on: true },
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
      { label: 'Open staging.web-app.dev', kind: 'read', on: true },
      { label: 'Click, type and take screenshots', kind: 'write', on: true },
      { label: 'Open any other site', kind: 'write', on: false },
    ],
  },
  Sentry: {
    kind: 'tool',
    what: 'Read errors the web app hits in production',
    owner: 'MCP server, read only',
    updated: '',
    tokens: 1_200,
    preview: 'search_issues\nget_issue_details\nresolve_issue',
    access: [
      { label: 'Read issues and stack traces', kind: 'read', on: true },
      { label: 'Resolve or mute issues', kind: 'write', on: false },
    ],
  },
}

export const KIND_MARK: Record<LibKind, string> = { file: 'F', skill: 'S', tool: 'T' }
export const KIND_NAME: Record<LibKind, string> = { file: 'File', skill: 'Skill', tool: 'MCP tool' }

// What each task reads, uses and can call, as the head farmer proposes it at Plan
// (files, then skills, then tools).
export const TASK_CONTEXT: Record<string, string[]> = {
  backend: ['web-app/src/', 'auth-spec.md', 'oauth-security.md', 'GitHub'],
  frontend: ['web-app/src/', 'auth-spec.md', 'react-components.md', 'GitHub', 'Playwright'],
  tests: ['e2e-tests/', 'Playwright'],
  docs: ['auth-spec.md', 'GitHub'],
}

// The head farmer points out a file a task is missing, and says why.
export const SUGGESTIONS: { taskIds: string[]; name: string; why: string }[] = [
  { taskIds: ['frontend', 'backend'], name: 'session-api-v2/CHANGELOG.md', why: 'It changes the session endpoint this task calls, and it was updated yesterday.' },
]

export function libItem(name: string, seeds: { file: string; title: string; from: string }[] = []): LibItem {
  const hit = LIBRARY[name]
  if (hit) return hit
  const seed = seeds.find((s) => s.file === name)
  if (seed) return { kind: 'skill', what: seed.title, owner: seed.from, updated: 'Today', tokens: 300, preview: seed.title }
  return { kind: name.endsWith('.md') && name.startsWith('lesson-') ? 'skill' : 'file', what: name, owner: 'Unknown', updated: '', tokens: 1_000, preview: '' }
}
