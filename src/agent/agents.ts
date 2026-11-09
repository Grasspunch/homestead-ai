// The live agent calls in the demo: the head farmer's clarify, plan and cross-team check,
// Frontend's session call and the Reviewer's review of the whole diff. Shared by the server route on Lovable (/api/agent)
// and the Vite dev server, so local and deployed runs use the same prompts.
// The caller passes in an Anthropic client, which keeps this file free of runtime-specific imports.

import { DOCS, NEIGHBOUR_DOCS, expandSignposts } from './docs'

export const MODEL = 'claude-opus-5-5'

// Minimal shape of the SDK client we use, so this file works on any runtime.
export interface ClaudeClient {
  beta: {
    messages: {
      create(params: Record<string, unknown>): Promise<{
        stop_reason: string | null
        content: { type: string; text?: string }[]
        usage: { input_tokens: number; output_tokens: number }
      }>
    }
  }
}

export interface AgentResult<T> {
  data: T
  tokens: number
  model: string
}

async function callJSON<T>(client: ClaudeClient, system: string, user: string, schema: Record<string, unknown>): Promise<AgentResult<T>> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.')
  const text = res.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('No text in the response.')
  return { data: JSON.parse(text) as T, tokens: res.usage.input_tokens + res.usage.output_tokens, model: MODEL }
}

const doc = (name: string) => `<document name="${name}">\n${DOCS[name]}\n</document>`

// ---- Head farmer: read the brief, ask what it can't work out, then plan ---------------

export const ROLES = {
  backend: 'Backend: server code, routes and sessions. Tools: GitHub.',
  frontend: 'Frontend: UI code, pages and components. Tools: GitHub, Playwright.',
  tests: 'Tests: writes and runs unit, integration and end-to-end tests on staging. Tools: Playwright.',
  docs: 'Docs: setup guides and changelogs. Tools: GitHub.',
} as const
export type Role = keyof typeof ROLES

// The farm has four plots, so a plan has four tasks, each in a fixed slot.
// The number of subtasks per slot matches the crops each plot can hold.
export const SLOTS = [
  { key: 'backend', subtasks: 3, hint: 'the server side of the change' },
  { key: 'frontend', subtasks: 3, hint: 'the UI side of the change' },
  { key: 'tests', subtasks: 2, hint: 'end-to-end tests, run on staging' },
  { key: 'docs', subtasks: 1, hint: 'the guide other engineers will follow' },
] as const

export interface ClarifyOut {
  questions: { id: string; q: string; why: string; options: string[] }[]
}

export function clarify(client: ClaudeClient, input: { goal: string; attached: string[] }) {
  const docs = expandSignposts(input.attached).filter((d) => DOCS[d]).map(doc).join('\n\n')
  return callJSON<ClarifyOut>(
    client,
    'You are the head farmer: the orchestrator agent that turns an engineer\'s goal into a plan for a small crew of coding agents. You ask the owner only what you cannot work out from the brief and its documents, and only when the answer would change the plan.',
    `The owner's goal:
<goal>
${input.goal}
</goal>

Documents the owner attached:
${docs || '(none)'}

Ask exactly 2 short questions whose answers would change the plan. For each, say in one sentence why you're asking (what in the brief or documents is ambiguous), and give 2 options, the most likely first. The owner may skip any question; you'll assume the first option.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'q', 'why', 'options'],
            properties: {
              id: { type: 'string', description: 'snake_case' },
              q: { type: 'string' },
              why: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  )
}

export interface PlanTask {
  name: string
  subtasks: string[]
  assignee: Role
  budget: number
  signposts: string[]
  note: string | null
}

export interface PlanOut {
  quest_title: string
  tasks: Record<(typeof SLOTS)[number]['key'], PlanTask>
  irreversible: { action: string; audience: string; count: number }
}

export function plan(client: ClaudeClient, input: { goal: string; answers: Record<string, string>; attached: string[]; budget: number }) {
  const docs = expandSignposts(input.attached).filter((d) => DOCS[d]).map(doc).join('\n\n')
  const answers = Object.entries(input.answers).map(([q, a]) => `- ${q}: ${a}`).join('\n')
  const task = (n: number) => ({
    type: 'object',
    additionalProperties: false,
    required: ['name', 'subtasks', 'assignee', 'budget', 'signposts', 'note'],
    properties: {
      name: { type: 'string', description: '2 to 5 words' },
      subtasks: { type: 'array', items: { type: 'string' }, description: `Exactly ${n}, each 2 to 5 words` },
      assignee: { type: 'string', enum: Object.keys(ROLES) },
      budget: { type: 'integer', description: 'Tokens, between 5000 and 30000' },
      signposts: { type: 'array', items: input.attached.length ? { type: 'string', enum: input.attached } : { type: 'string' }, description: 'Attached files, skills and MCP tools this task may use. Least context that does the job.' },
      note: { type: ['string', 'null'], description: 'Only if the assignee is a non-obvious choice: why, in one short sentence' },
    },
  })
  return callJSON<PlanOut>(
    client,
    'You are the head farmer: the orchestrator agent that plans work for a crew of coding agents. Each agent only sees the files, skills and tools you give its task (its signposts), so choose them deliberately. Plans are concrete and fit the budget.',
    `The owner's goal:
<goal>
${input.goal}
</goal>

The owner's answers to your questions:
${answers || '(none)'}

Energy budget: ${input.budget} tokens in total.

The crew:
${Object.values(ROLES).map((r) => `- ${r}`).join('\n')}

Attached to the brief: ${input.attached.join(', ') || '(nothing)'}
${docs}

Plan exactly four tasks, one per slot, in this order:
${SLOTS.map((s) => `- ${s.key}: ${s.hint} (${s.subtasks} subtask${s.subtasks > 1 ? 's' : ''})`).join('\n')}

Also describe the one step that reaches people outside the crew: merging the pull request. Say what it does, who it reaches and how many people.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['quest_title', 'tasks', 'irreversible'],
      properties: {
        quest_title: { type: 'string', description: 'At most 4 words, for example "Google sign-in"' },
        tasks: {
          type: 'object',
          additionalProperties: false,
          required: SLOTS.map((s) => s.key),
          properties: Object.fromEntries(SLOTS.map((s) => [s.key, task(s.subtasks)])),
        },
        irreversible: {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'audience', 'count'],
          properties: {
            action: { type: 'string', description: 'For example "Merge the pull request"' },
            audience: { type: 'string', description: 'For example "users in Friday\'s deploy"' },
            count: { type: 'integer' },
          },
        },
      },
    },
  )
}

// ---- Frontend: start the session after Google sign-in, from its signposts only ------

export interface SessionOut {
  endpoint: string
  source: string
  code: string
  summary: string
}

export function writeSession(client: ClaudeClient, input: { goal: string; task: string; answers: string; signposts: string[] }) {
  const docs = expandSignposts(input.signposts).filter((d) => DOCS[d]).map(doc).join('\n\n')
  return callJSON<SessionOut>(
    client,
    'You are the Frontend agent on a crew of coding agents. You only know what is in the files and skills you are given. Follow the team\'s component patterns and reuse existing code where you can.',
    `The crew's goal: ${input.goal}
Your task: ${input.task}
What the owner told the head farmer:
${input.answers || '(nothing)'}

Use only these files:

${docs || '(none)'}

After Google returns, the page has to start a signed-in session with the token. Write that call. Return the session endpoint you call, the file that told you to use it, the code (at most 6 lines) and a one-sentence summary.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['endpoint', 'source', 'code', 'summary'],
      properties: {
        endpoint: { type: 'string', description: 'For example "/v1/session"' },
        source: { type: 'string' },
        code: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  )
}

// ---- Reviewer: review the whole diff against the team's skills ---------------------------

export interface ReviewOut {
  blocking: { file: string; line: number; problem: string; code: string; rule: string }[]
  notes: { title: string; where: string }[]
}

export const PR_DIFF = `diff --git a/src/api/session.ts b/src/api/session.ts
-    post("/v1/session", { token })
+    post("/v2/session", { token })

diff --git a/src/auth/google.ts b/src/auth/google.ts
+export async function googleCallback(req: Request) {
+  const { code, state } = parse(req.url)           // line 18
+  if (state !== req.session.oauthState) throw new BadState()
+  const tokens = await exchange(code, req.session.pkceVerifier)   // line 22, no rate limit
+  ...
+  } catch (err) {
+    logger.error("google callback failed", { idToken })           // line 48
+    throw err
+  }

diff --git a/docs/auth/google.md b/docs/auth/google.md
+Add https://app.example.com/auth/google/callback as a redirect URI.   // line 6`

export function reviewDiff(client: ClaudeClient, input: { diff: string }) {
  return callJSON<ReviewOut>(
    client,
    'You are the Reviewer on a crew of coding agents. You wrote none of this code. You flag only real problems: a blocking issue breaks one of the team\'s skills or would hurt users; everything else is a note.',
    `Review this pull request diff.

<diff>
${input.diff}
</diff>

The team's skills:
${doc('oauth-security.md')}

${doc('react-components.md')}

Return the blocking issues (file, line, the problem in one sentence, the offending code, and the rule it breaks) and the notes (a short title and where).`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['blocking', 'notes'],
      properties: {
        blocking: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['file', 'line', 'problem', 'code', 'rule'],
            properties: { file: { type: 'string' }, line: { type: 'integer' }, problem: { type: 'string' }, code: { type: 'string' }, rule: { type: 'string' } },
          },
        },
        notes: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['title', 'where'], properties: { title: { type: 'string' }, where: { type: 'string' } } },
        },
      },
    },
  )
}

// ---- Head farmer: check what a failing call depends on across teams -------------------------

export interface ConflictOut {
  conflict: boolean
  endpoints: { endpoint: string; farm: string; source: string; quote: string }[]
  recommended: string
  why: string
  confidence: 'High' | 'Medium' | 'Low'
}

export function conflictDocs(ours: string[]) {
  const mine = expandSignposts(ours).filter((d) => DOCS[d] && !NEIGHBOUR_DOCS.includes(d))
  return { mine, theirs: NEIGHBOUR_DOCS }
}

export function findConflict(client: ClaudeClient, input: { endpoint: string; source: string; failure: string; ourDocs: string[] }) {
  const { mine, theirs } = conflictDocs(input.ourDocs)
  return callJSON<ConflictOut>(
    client,
    'You are the head farmer coordinating crews across projects. When a test fails on staging, you check whether another team\'s project explains it. Only report a conflict the documents actually show; the team that owns an API outranks old code that calls it.',
    `Our crew (farm "Google sign-in", the Web team) calls ${input.endpoint} (from ${input.source}). On staging: ${input.failure}

Files from our farm:
${mine.map(doc).join('\n\n')}

Everything the neighbouring farm "Session API v2" (the Platform team's crew) shares with other farms:
${theirs.map(doc).join('\n\n')}

Do these sources disagree about which session endpoint to call? If they do, list each endpoint with its farm, source document and the exact quote, recommend which one to use, and say why in one sentence. If they agree, return conflict false and list the endpoint once.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['conflict', 'endpoints', 'recommended', 'why', 'confidence'],
      properties: {
        conflict: { type: 'boolean' },
        endpoints: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['endpoint', 'farm', 'source', 'quote'],
            properties: { endpoint: { type: 'string' }, farm: { type: 'string' }, source: { type: 'string' }, quote: { type: 'string' } },
          },
        },
        recommended: { type: 'string' },
        why: { type: 'string' },
        confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
      },
    },
  )
}

export type AgentTask = 'clarify' | 'plan' | 'session' | 'review' | 'conflict'

export async function runAgent(client: ClaudeClient, task: AgentTask, input: Record<string, unknown>) {
  switch (task) {
    case 'clarify':
      return clarify(client, input as { goal: string; attached: string[] })
    case 'plan':
      return plan(client, input as { goal: string; answers: Record<string, string>; attached: string[]; budget: number })
    case 'session':
      return writeSession(client, input as { goal: string; task: string; answers: string; signposts: string[] })
    case 'review':
      return reviewDiff(client, input as { diff: string })
    case 'conflict':
      return findConflict(client, input as { endpoint: string; source: string; failure: string; ourDocs: string[] })
    default:
      throw new Error(`Unknown task: ${task}`)
  }
}
