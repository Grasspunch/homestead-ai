// The three live agent calls in the demo. Shared by the server route on Lovable (/api/agent)
// and the Vite dev server, so local and deployed runs use the same prompts.
// The caller passes in an Anthropic client, which keeps this file free of runtime-specific imports.

import { DOCS } from './docs'

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

// ---- Writer: draft the announcement from its signposts only --------------------

export interface DraftOut {
  headline: string
  paragraphs: string[]
  launch_date: string
  launch_date_source: string
  claims: { text: string; source: string | null }[]
}

export function writeDraft(client: ClaudeClient, input: { audience: string; signposts: string[] }) {
  const docs = input.signposts.filter((s) => DOCS[s]).map(doc).join('\n\n')
  return callJSON<DraftOut>(
    client,
    'You are the Writer on a product launch crew. You only know what is in the documents you are given. Write plainly and specifically, following any brand voice rules in the documents.',
    `Write the launch announcement for Relay v2, for ${input.audience}.
Use only these documents:

${docs}

Return a headline, 2 to 4 short paragraphs (one may be a customer quote, attributed by role), the launch date you used and the document it came from, and every factual claim you made with its source document (null when the documents don't back it).`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'paragraphs', 'launch_date', 'launch_date_source', 'claims'],
      properties: {
        headline: { type: 'string' },
        paragraphs: { type: 'array', items: { type: 'string' } },
        launch_date: { type: 'string', description: 'For example "March 12"' },
        launch_date_source: { type: 'string' },
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

export function findConflict(client: ClaudeClient, input: { draftDate: string; draftSource: string }) {
  return callJSON<ConflictOut>(
    client,
    'You are the head farmer coordinating crews across farms. Before anything leaves the company, you check that facts used by one crew agree with what other crews know.',
    `Our crew (farm "Q1 Launch") put this launch date in the announcement: ${input.draftDate} (source: ${input.draftSource}).

Documents from our farm:
${doc('customer-call-notes.md')}

Documents shared by the neighbouring farm "Auth SDK v2" (Priya's engineering crew):
${doc('eng-standup-notes/2026-02-03.md')}

Do these sources disagree about when Relay v2 ships? If they do, list each date with its farm, source document and the exact quote, recommend which date the announcement should use, and say why in one sentence.`,
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

export type AgentTask = 'draft' | 'claims' | 'conflict'

export async function runAgent(client: ClaudeClient, task: AgentTask, input: Record<string, unknown>) {
  switch (task) {
    case 'draft':
      return writeDraft(client, input as { audience: string; signposts: string[] })
    case 'claims':
      return checkClaims(client, input as { draft: string })
    case 'conflict':
      return findConflict(client, input as { draftDate: string; draftSource: string })
    default:
      throw new Error(`Unknown task: ${task}`)
  }
}
