// The three live agent calls in the demo. Shared by the server route on Lovable (/api/agent)
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
  researcher: 'Researcher: reads documents and the web, collects facts, numbers and quotes. Tools: Drive (read), web search.',
  writer: 'Writer: drafts documents, emails and announcements. Tools: Docs (write).',
  reviewer: 'Reviewer: checks facts against sources, tone and policy. Tools: Docs (comment).',
  scheduler: 'Scheduler: calendars, invite lists and outgoing email. Tools: Calendar, Email (send, asks first), CRM (read).',
} as const
export type Role = keyof typeof ROLES

// The farm has five plots, so a plan has five tasks, each in a fixed slot.
// The number of subtasks per slot matches the crops each plot can hold.
export const SLOTS = [
  { key: 'gather', subtasks: 3, hint: 'collect the facts and inputs the work needs' },
  { key: 'make', subtasks: 3, hint: 'produce the main deliverable' },
  { key: 'check', subtasks: 2, hint: 'check the deliverable against sources' },
  { key: 'polish', subtasks: 1, hint: 'a final pass on tone, policy or format' },
  { key: 'send', subtasks: 3, hint: 'prepare and carry out the one outward action that cannot be undone, such as sending email to people outside the company' },
] as const

export interface ClarifyOut {
  questions: { id: string; q: string; why: string; options: string[] }[]
}

export function clarify(client: ClaudeClient, input: { goal: string; attached: string[] }) {
  const docs = expandSignposts(input.attached).map(doc).join('\n\n')
  return callJSON<ClarifyOut>(
    client,
    'You are the head farmer: the orchestrator agent that turns an owner\'s goal into a plan for a small crew of agents. You ask the owner only what you cannot work out from the brief and its documents, and only when the answer would change the plan.',
    `The owner's goal:
<goal>
${input.goal}
</goal>

Documents the owner attached:
${docs || '(none)'}

Ask exactly 3 short questions whose answers would change the plan. For each, say in one sentence why you're asking (what in the brief or documents is ambiguous), and give 2 options, the most likely first. The owner may skip any question; you'll assume the first option.`,
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
  const docs = expandSignposts(input.attached).map(doc).join('\n\n')
  const answers = Object.entries(input.answers).map(([q, a]) => `- ${q}: ${a}`).join('\n')
  const task = (n: number) => ({
    type: 'object',
    additionalProperties: false,
    required: ['name', 'subtasks', 'assignee', 'budget', 'signposts', 'note'],
    properties: {
      name: { type: 'string', description: 'Imperative, 2 to 4 words' },
      subtasks: { type: 'array', items: { type: 'string' }, description: `Exactly ${n}, each 2 to 4 words` },
      assignee: { type: 'string', enum: Object.keys(ROLES) },
      budget: { type: 'integer', description: 'Tokens, between 5000 and 30000' },
      signposts: { type: 'array', items: input.attached.length ? { type: 'string', enum: input.attached } : { type: 'string' }, description: 'Attached documents this task may read. Least context that does the job.' },
      note: { type: ['string', 'null'], description: 'Only if the assignee is a non-obvious choice: why, in one short sentence' },
    },
  })
  return callJSON<PlanOut>(
    client,
    'You are the head farmer: the orchestrator agent that plans work for a crew of agent farmhands. Each farmhand only sees the documents you give its task (its signposts), so choose them deliberately. Plans are concrete and fit the budget.',
    `The owner's goal:
<goal>
${input.goal}
</goal>

The owner's answers to your questions:
${answers || '(none)'}

Energy budget: ${input.budget} tokens in total.

The crew:
${Object.values(ROLES).map((r) => `- ${r}`).join('\n')}

Documents attached to the brief:
${docs || '(none)'}

Plan exactly five tasks, one per slot, in this order:
${SLOTS.map((s) => `- ${s.key}: ${s.hint} (${s.subtasks} subtask${s.subtasks > 1 ? 's' : ''})`).join('\n')}

Also describe the one irreversible action in the send task: what it does, who it reaches and how many people.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['quest_title', 'tasks', 'irreversible'],
      properties: {
        quest_title: { type: 'string', description: 'Verb first, at most 4 words, for example "Launch Relay v2"' },
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
            action: { type: 'string', description: 'For example "Send the webinar invite"' },
            audience: { type: 'string', description: 'For example "people at 6 pilot customers"' },
            count: { type: 'integer' },
          },
        },
      },
    },
  )
}

// ---- Writer: draft the announcement from its signposts only --------------------

export interface DraftOut {
  headline: string
  paragraphs: string[]
  launch_date: string | null
  launch_date_source: string | null
  claims: { text: string; source: string | null }[]
}

export function writeDraft(client: ClaudeClient, input: { goal: string; task: string; answers: string; signposts: string[] }) {
  const docs = expandSignposts(input.signposts).map(doc).join('\n\n')
  return callJSON<DraftOut>(
    client,
    'You are the Writer on a crew of agents. You only know what is in the documents you are given. Write plainly and specifically, following any brand voice rules in the documents.',
    `The crew's goal: ${input.goal}
Your task: ${input.task}
What the owner told the head farmer:
${input.answers || '(nothing)'}

Use only these documents:

${docs || '(none)'}

Write the deliverable. Return a headline, 2 to 4 short paragraphs (one may be a quote, attributed by role), the key date it commits to (a launch, start or deadline) and the document that date came from (both null if there is none), and every factual claim you made with its source document (null when the documents don't back it).`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'paragraphs', 'launch_date', 'launch_date_source', 'claims'],
      properties: {
        headline: { type: 'string' },
        paragraphs: { type: 'array', items: { type: 'string' } },
        launch_date: { type: ['string', 'null'], description: 'For example "March 12"' },
        launch_date_source: { type: ['string', 'null'] },
        claims: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'source'],
            properties: { text: { type: 'string' }, source: { type: ['string', 'null'] } },
          },
        },
      },
    },
  )
}

// ---- Reviewer: check every claim against the sources -----------------------------

export interface ClaimsOut {
  checked: number
  issues: { claim: string; problem: string; fix: string; confidence: 'High' | 'Medium' | 'Low' }[]
}

export function checkClaims(client: ClaudeClient, input: { draft: string }) {
  return callJSON<ClaimsOut>(
    client,
    'You are the Reviewer on a launch crew. You check claims against sources and flag only real problems: a number or promise with no citation, or one the sources contradict.',
    `Check every factual claim in this draft announcement.

<draft>
${input.draft}
</draft>

Sources you can use:
${doc('benchmarks-q4.xlsx')}

${doc('customer-call-notes.md')}

${doc('brand-voice.md')}

Return how many claims you checked and the issues. For each issue give the claim, the problem in one sentence, the fix (name the exact source and row if one supports it), and your confidence.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['checked', 'issues'],
      properties: {
        checked: { type: 'integer' },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['claim', 'problem', 'fix', 'confidence'],
            properties: {
              claim: { type: 'string' },
              problem: { type: 'string' },
              fix: { type: 'string' },
              confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
            },
          },
        },
      },
    },
  )
}

// ---- Head farmer: cross-check dates with neighbouring farms -------------------------

export interface ConflictOut {
  conflict: boolean
  dates: { date: string; farm: string; source: string; quote: string }[]
  recommended_date: string
  why: string
  confidence: 'High' | 'Medium' | 'Low'
}

export function conflictDocs(ours: string[]) {
  const mine = expandSignposts(ours).filter((d) => !NEIGHBOUR_DOCS.includes(d))
  return { mine, theirs: NEIGHBOUR_DOCS }
}

export function findConflict(client: ClaudeClient, input: { draftDate: string; draftSource: string; ourDocs: string[] }) {
  const { mine, theirs } = conflictDocs(input.ourDocs)
  return callJSON<ConflictOut>(
    client,
    'You are the head farmer coordinating crews across farms. Before anything leaves the company, you check that facts one crew used agree with what other crews know. Only report a conflict the documents actually show; newer information from the team that owns the fact outranks older promises.',
    `Our crew (farm "Q1 Launch") committed to this date in its deliverable: ${input.draftDate} (source: ${input.draftSource}).

Documents from our farm:
${mine.map(doc).join('\n\n')}

Everything the neighbouring farm "Auth SDK v2" (Priya's engineering crew) shares with other farms:
${theirs.map(doc).join('\n\n')}

Do these sources disagree about that date? If they do, list each competing date with its farm, source document and the exact quote, recommend which date to use, and say why in one sentence. If they agree, return conflict false and list the date once.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['conflict', 'dates', 'recommended_date', 'why', 'confidence'],
      properties: {
        conflict: { type: 'boolean' },
        dates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'farm', 'source', 'quote'],
            properties: { date: { type: 'string' }, farm: { type: 'string' }, source: { type: 'string' }, quote: { type: 'string' } },
          },
        },
        recommended_date: { type: 'string' },
        why: { type: 'string' },
        confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
      },
    },
  )
}

export type AgentTask = 'clarify' | 'plan' | 'draft' | 'claims' | 'conflict'

export async function runAgent(client: ClaudeClient, task: AgentTask, input: Record<string, unknown>) {
  switch (task) {
    case 'clarify':
      return clarify(client, input as { goal: string; attached: string[] })
    case 'plan':
      return plan(client, input as { goal: string; answers: Record<string, string>; attached: string[]; budget: number })
    case 'draft':
      return writeDraft(client, input as { goal: string; task: string; answers: string; signposts: string[] })
    case 'claims':
      return checkClaims(client, input as { draft: string })
    case 'conflict':
      return findConflict(client, input as { draftDate: string; draftSource: string; ourDocs: string[] })
    default:
      throw new Error(`Unknown task: ${task}`)
  }
}
