// The live agent calls in the demo: the head farmer's clarify, plan and cross-team check,
// Backend's read of the opening hours and the Reviewer's review of the whole diff. Shared by the server route on Lovable (/api/agent)
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
  frontend: 'Frontend: the pages owners see, on a phone first. Tools: GitHub, Playwright.',
  backend: 'Backend: the availability search and the bookings API, with its data. Tools: GitHub.',
  messaging: 'Messaging: reminder texts and emails to owners. Tools: Twilio (staging phones only), GitHub.',
} as const
export type Role = keyof typeof ROLES

// The valley has one field per agent, so a plan has three tasks, each in a fixed slot.
// The number of subtasks per slot matches the crops each field holds.
export const SLOTS = [
  { key: 'frontend', subtasks: 3, hint: 'the booking pages: pet, reason, vet and time, confirm' },
  { key: 'backend', subtasks: 4, hint: 'the availability search and the bookings API' },
  { key: 'messaging', subtasks: 2, hint: 'the reminder the owner asked for' },
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

Ask exactly 4 short questions whose answers would change the plan. For each, say in one sentence why you're asking (what in the brief or documents is ambiguous), and give 2 options, the most likely first. The owner may skip any question; you'll assume the first option.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          description: 'Exactly 4',
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

Plan exactly three tasks, one per slot, in this order:
${SLOTS.map((s) => `- ${s.key}: ${s.hint} (${s.subtasks} subtask${s.subtasks > 1 ? 's' : ''})`).join('\n')}

Also describe the one step that reaches people outside the crew and can't be taken back. Say what it does, who it reaches and how many people.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['quest_title', 'tasks', 'irreversible'],
      properties: {
        quest_title: { type: 'string', description: 'At most 4 words, for example "Vet booking"' },
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
            action: { type: 'string', description: 'For example "Text every pet owner that booking is open"' },
            audience: { type: 'string', description: 'For example "pet owners on the clinic\'s list"' },
            count: { type: 'integer' },
          },
        },
      },
    },
  )
}

// ---- Backend: read the opening hours the availability search will offer, from its signposts only ------

export interface HoursOut {
  weekdays: string
  saturday: string
  source: string
  summary: string
}

export function readHours(client: ClaudeClient, input: { goal: string; task: string; answers: string; signposts: string[] }) {
  const docs = expandSignposts(input.signposts).filter((d) => DOCS[d]).map(doc).join('\n\n')
  return callJSON<HoursOut>(
    client,
    'You are the Backend agent on a crew of coding agents. You only know what is in the files and skills you are given. Say where each fact comes from.',
    `The crew's goal: ${input.goal}
Your task: ${input.task}
What the owner told the head farmer:
${input.answers || '(nothing)'}

Use only these files:

${docs || '(none)'}

The availability search offers appointments only when the clinic is open. Work out the opening hours it should use. Return the weekday hours, the Saturday hours (or "closed"), the file that told you, and a one-sentence summary.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['weekdays', 'saturday', 'source', 'summary'],
      properties: {
        weekdays: { type: 'string', description: 'For example "8:00 to 19:00"' },
        saturday: { type: 'string', description: 'For example "9:00 to 13:00" or "closed"' },
        source: { type: 'string' },
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

export const PR_DIFF = `diff --git a/src/api/availability.ts b/src/api/availability.ts
+export async function availability(vetId: string, from: Date, to: Date) {
+  const hours = await schedule.hours(from, to)                // the staff schedule, from your answer
+  const taken = await db.bookings.between(vetId, from, to)
+  return slots(hours, 15).filter((s) => !taken.has(s.start))
+}

diff --git a/src/api/bookings.ts b/src/api/bookings.ts
+export async function book(req: Request) {
+  const { slotId, petId, reason } = await req.json()      // line 12, no rate limit
+  const slot = await db.slots.find(slotId)
+  if (slot.taken) return conflict()
+  await db.bookings.insert({ slotId, petId, reason, owner: req.owner.id })
+  await db.slots.update(slotId, { taken: true })
+  return created()
+}

diff --git a/src/messaging/reminder.ts b/src/messaging/reminder.ts
+const text = \`Hi \${owner.first}, \${pet.name} sees \${vet.name} tomorrow at \${time}. Reply C to cancel.\`   // line 9
+await twilio.send({ to: owner.phone, from: "WillowVets", text })`

export function reviewDiff(client: ClaudeClient, input: { diff: string }) {
  return callJSON<ReviewOut>(
    client,
    'You are the Reviewer on a crew of coding agents. You wrote none of this code. You flag only real problems: a blocking issue breaks one of the team\'s skills or would hurt users; everything else is a note.',
    `Review this pull request diff.

<diff>
${input.diff}
</diff>

The team's skills:
${doc('owner-data.md')}

${doc('brand-style.md')}

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
  claims: { claim: string; farm: string; source: string; quote: string }[]
  recommended: string
  why: string
  confidence: 'High' | 'Medium' | 'Low'
}

export function conflictDocs(ours: string[]) {
  const mine = expandSignposts(ours).filter((d) => DOCS[d] && !NEIGHBOUR_DOCS.includes(d))
  return { mine, theirs: NEIGHBOUR_DOCS }
}

export function findConflict(client: ClaudeClient, input: { claim: string; source: string; failure: string; ourDocs: string[] }) {
  const { mine, theirs } = conflictDocs(input.ourDocs)
  return callJSON<ConflictOut>(
    client,
    'You are the head farmer coordinating crews across projects. When a check fails on staging, you check whether another team\'s project explains it. Only report a conflict the documents actually show; the team that owns the facts outranks an older copy of them.',
    `Our crew (farm "Vet booking", at Willow Lane Vets) takes its opening hours from ${input.source}: ${input.claim}. On staging: ${input.failure}

Files from our farm:
${mine.map(doc).join('\n\n')}

Everything the neighbouring farm "Staff schedule" (the Practice team's crew) shares with other farms:
${theirs.map(doc).join('\n\n')}

Do these sources disagree about when the clinic is open? If they do, list each claim with its farm, source document and the exact quote, recommend which source to use ("the staff schedule" or "the hours sheet"), and say why in one sentence. If they agree, return conflict false and list the claim once.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['conflict', 'claims', 'recommended', 'why', 'confidence'],
      properties: {
        conflict: { type: 'boolean' },
        claims: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['claim', 'farm', 'source', 'quote'],
            properties: { claim: { type: 'string' }, farm: { type: 'string' }, source: { type: 'string' }, quote: { type: 'string' } },
          },
        },
        recommended: { type: 'string' },
        why: { type: 'string' },
        confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
      },
    },
  )
}

export type AgentTask = 'clarify' | 'plan' | 'hours' | 'review' | 'conflict'

export async function runAgent(client: ClaudeClient, task: AgentTask, input: Record<string, unknown>) {
  switch (task) {
    case 'clarify':
      return clarify(client, input as { goal: string; attached: string[] })
    case 'plan':
      return plan(client, input as { goal: string; answers: Record<string, string>; attached: string[]; budget: number })
    case 'hours':
      return readHours(client, input as { goal: string; task: string; answers: string; signposts: string[] })
    case 'review':
      return reviewDiff(client, input as { diff: string })
    case 'conflict':
      return findConflict(client, input as { claim: string; source: string; failure: string; ourDocs: string[] })
    default:
      throw new Error(`Unknown task: ${task}`)
  }
}
