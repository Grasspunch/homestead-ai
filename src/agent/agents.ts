// The live agent calls. Shared by the server route on Lovable (/api/agent) and the Vite dev
// server, so local and deployed runs use the same prompts.
// The caller passes in an Anthropic client, which keeps this file free of runtime-specific imports.

export const MODEL = 'claude-opus-5-5'
// Dollars per million tokens for MODEL, used to show what each farmer has spent.
const PRICE_IN = 4
const PRICE_OUT = 20

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
  cost: number
  model: string
}

type Usage = { input_tokens: number; output_tokens: number }
const price = (u: Usage) => (u.input_tokens * PRICE_IN + u.output_tokens * PRICE_OUT) / 1_000_000

async function callJSON<T>(client: ClaudeClient, system: string, user: string, schema: Record<string, unknown>): Promise<AgentResult<T>> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.')
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off before it finished.')
  const text = res.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('No text in the response.')
  return { data: JSON.parse(text) as T, tokens: res.usage.input_tokens + res.usage.output_tokens, cost: price(res.usage), model: MODEL }
}

// A plain-text call that may search the web. Web search runs on Anthropic's side, so the
// answer comes back in the same response; a paused turn is resumed until it ends.
async function callWithSearch(client: ClaudeClient, system: string, user: string): Promise<AgentResult<string>> {
  const messages: Record<string, unknown>[] = [{ role: 'user', content: user }]
  let tokens = 0
  let cost = 0
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
      system,
      messages,
    })
    tokens += res.usage.input_tokens + res.usage.output_tokens
    cost += price(res.usage)
    if (res.stop_reason === 'refusal') throw new Error('The model declined this request.')
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content })
      continue
    }
    const text = res.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('')
      .trim()
    if (!text) throw new Error('No text in the response.')
    return { data: text, tokens, cost, model: MODEL }
  }
  throw new Error('The search did not finish.')
}

// ---- Shared shapes ---------------------------------------------------------------------

export type Kind = 'research' | 'writing' | 'review' | 'scheduling' | 'other'

export interface PlanTask {
  id: string
  name: string
  brief: string
  kind: Kind
  /** Template id of the farmer who should do it. */
  farmer: string
  needs: string[]
  steps: string[]
  irreversible: { action: string; audience: string } | null
  costly: string | null
  reviews: string | null
}

export interface PlanOut {
  title: string
  question: { q: string; why: string; options: string[] } | null
  tasks: PlanTask[]
  recurring: { name: string; brief: string; every_minutes: number; farmer: string }[]
  estimate: string
}

export interface FileIn {
  name: string
  text: string
}

export interface TemplateIn {
  id: string
  name: string
  does: string
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })
const str = { type: 'string' }

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'brief', 'kind', 'farmer', 'needs', 'steps', 'irreversible', 'costly', 'reviews'],
  properties: {
    id: { type: 'string', description: 'short snake_case id, unique in this plan' },
    name: { type: 'string', description: 'the task in 2 to 5 plain words, starting with a verb' },
    brief: { type: 'string', description: 'what to do and what done looks like, in one or two sentences' },
    kind: { type: 'string', enum: ['research', 'writing', 'review', 'scheduling', 'other'] },
    farmer: { type: 'string', description: 'id of the agent template that should do it' },
    needs: { type: 'array', items: str, description: 'ids of tasks whose finished work this one starts from' },
    steps: { type: 'array', items: str, description: '2 or 3 short step names, in order' },
    irreversible: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['action', 'audience'],
      properties: {
        action: { type: 'string', description: 'the outward action, e.g. "post the announcement to the company blog"' },
        audience: { type: 'string', description: 'who would see it' },
      },
    }),
    costly: nullable({ type: 'string', description: 'one sentence on why this task will cost much more than the others' }),
    reviews: nullable({ type: 'string', description: 'for review tasks: the id of the task whose work is checked' }),
  },
}

const files = (list: FileIn[]) =>
  list.length ? list.map((f) => `<document name="${f.name}">\n${f.text}\n</document>`).join('\n\n') : '(none)'

const HEAD_FARMER =
  'You are the head farmer of a Homestead AI farm: the planning agent that turns the owner\'s goal into a small set of tasks for a crew of AI agents. The owner sees the plan as plots on a farm, so every name and sentence you write is read by a person at a glance. Write in plain, concrete words. Never use filler, never use farm metaphors in your text, and never invent facts about the owner\'s project.'

// ---- Head farmer: plan ------------------------------------------------------------------

export function plan(
  client: ClaudeClient,
  input: { goal: string; files: FileIn[]; templates: TemplateIn[]; answer: string | null; note: string | null; existing: string | null },
) {
  const crew = input.templates.map((t) => `- ${t.id}: ${t.name}. ${t.does}`).join('\n')
  return callJSON<PlanOut>(
    client,
    HEAD_FARMER,
    `The owner's goal:
<goal>
${input.goal}
</goal>

Files the owner attached:
${files(input.files)}
${input.existing ? `\nOpen work that already exists in this project:\n<existing>\n${input.existing}\n</existing>\n` : ''}
Agent templates you can hire from:
${crew}

${input.answer ? `You asked the owner a question earlier and they answered: "${input.answer}". Do not ask another question.` : 'If the goal is too vague to plan well, ask ONE short question in `question`, with a one-sentence reason and 2 or 3 likely answers, the most likely first. Still return your best plan. If the goal is clear enough, set `question` to null.'}
${input.note ? `\nThe owner looked at your last plan and said: "${input.note}". Change the plan to fit.` : ''}

Plan the work:
- 3 to 6 tasks. Fewer is better. Each task is one real piece of the work, not a step of another task.
- Give each task to the template that fits it best. Use each template's id exactly.
- Use \`needs\` only when a task truly starts from another task's finished work.
- If a task ends with something that cannot be undone or that people outside will see (sending, posting, publishing, deleting, paying), describe it in \`irreversible\`. The agent will prepare everything and then stop to ask the owner before doing it.
- Set \`costly\` only for a task you expect to cost several times more than the others, and say why in one sentence. Otherwise null.
- A review task checks one other task's work: set \`reviews\` to that task's id and list it in \`needs\`.
- Put work that repeats on a timer (such as watching an inbox) in \`recurring\`, not in \`tasks\`. Leave it empty if nothing repeats.
- \`title\` names the project in 2 to 5 words.
- \`estimate\` is a short phrase for the total cost, such as "about $2".`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'question', 'tasks', 'recurring', 'estimate'],
      properties: {
        title: str,
        question: nullable({
          type: 'object',
          additionalProperties: false,
          required: ['q', 'why', 'options'],
          properties: { q: str, why: str, options: { type: 'array', items: str } },
        }),
        tasks: { type: 'array', items: TASK_SCHEMA },
        recurring: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'brief', 'every_minutes', 'farmer'],
            properties: { name: str, brief: str, every_minutes: { type: 'integer' }, farmer: str },
          },
        },
        estimate: str,
      },
    },
  )
}

// ---- Head farmer: the owner types something while the farm is running ------------------------

export interface TalkOut {
  reply: string
  tasks: PlanTask[]
}

export function talk(
  client: ClaudeClient,
  input: { goal: string; message: string; tasks: { id: string; name: string; status: string; farmer: string }[]; templates: TemplateIn[] },
) {
  const crew = input.templates.map((t) => `- ${t.id}: ${t.name}. ${t.does}`).join('\n')
  const now = input.tasks.map((t) => `- ${t.id}: ${t.name} (${t.status}, ${t.farmer})`).join('\n') || '(none)'
  return callJSON<TalkOut>(
    client,
    HEAD_FARMER,
    `The project's goal:
<goal>
${input.goal}
</goal>

Tasks on the farm right now:
${now}

Agent templates you can hire from:
${crew}

The owner just wrote:
<message>
${input.message}
</message>

If the owner is asking for new work, add it as one or more tasks in \`tasks\`, following the same rules as a plan (ids must not clash with the ones above; \`needs\` may point at existing ids). If they are asking a question or making a comment, answer it and leave \`tasks\` empty. \`reply\` is one or two short sentences to the owner saying what you did or answering them.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['reply', 'tasks'],
      properties: { reply: str, tasks: { type: 'array', items: TASK_SCHEMA } },
    },
  )
}

// ---- A farmer does one step of its task -----------------------------------------------------------

export interface StepIn {
  goal: string
  farmer: { name: string; instructions: string; rules: string[] }
  task: { name: string; brief: string; kind: Kind; irreversible: string | null }
  step: string
  stepIndex: number
  stepCount: number
  /** What this farmer produced in earlier steps of the same task. */
  earlier: { step: string; content: string }[]
  /** Accepted work from the tasks this one needs. */
  inputs: { name: string; by: string; content: string }[]
  files: FileIn[]
  /** Notes from the owner, newest last, including any "send back" reasons. */
  notes: string[]
  web: boolean
}

export interface StepOut {
  summary: string
  content: string
  concern: string | null
}

const farmerSystem = (f: StepIn['farmer']) =>
  `You are the ${f.name}, one of several AI agents working on the same project. ${f.instructions}

${f.rules.length ? `Rules the owner set for you:\n${f.rules.map((r) => `- ${r}`).join('\n')}\n\n` : ''}Do the work itself, not a description of it. Write for the owner, in plain words, as Markdown. Use only facts from the goal, the files, the other agents' work and (if you can search) what you find; when something is missing, say what is missing instead of inventing it.`

function stepPrompt(i: StepIn) {
  const last = i.stepIndex === i.stepCount - 1
  return `The project's goal:
<goal>
${i.goal}
</goal>

Your task: ${i.task.name}
${i.task.brief}

Files you can see:
${files(i.files)}

${i.inputs.length ? `Finished work from other agents that you start from:\n${i.inputs.map((x) => `<work name="${x.name}" by="${x.by}">\n${x.content}\n</work>`).join('\n\n')}\n\n` : ''}${i.earlier.length ? `What you produced in earlier steps:\n${i.earlier.map((e) => `<step name="${e.step}">\n${e.content}\n</step>`).join('\n\n')}\n\n` : ''}${i.notes.length ? `Notes from the owner (the newest is last, and it wins):\n${i.notes.map((n) => `- ${n}`).join('\n')}\n\n` : ''}You are on step ${i.stepIndex + 1} of ${i.stepCount}: "${i.step}".
${last ? `This is the last step, so produce the finished piece of work for the whole task, complete and ready to use.${i.task.irreversible ? ` The task ends with an action that cannot be undone (${i.task.irreversible}). Prepare everything for it, but do NOT say you have done it: the owner is asked first.` : ''}` : 'Produce only what this step needs. Later steps build on it.'}`
}

export async function step(client: ClaudeClient, input: StepIn): Promise<AgentResult<StepOut>> {
  if (input.web) {
    // Searching and a fixed answer shape don't mix in one call, so a searching step answers
    // in text with its one-line summary first.
    const r = await callWithSearch(
      client,
      farmerSystem(input.farmer),
      `${stepPrompt(input)}

Search the web where it helps, and name your sources with links. Start your answer with one line that begins "SUMMARY:" and says in under 20 words what you did. Then a blank line, then the work.`,
    )
    const m = r.data.match(/^\s*SUMMARY:\s*(.+)\n([\s\S]*)$/)
    return { ...r, data: { summary: m ? m[1].trim() : input.step, content: (m ? m[2] : r.data).trim(), concern: null } }
  }
  return callJSON<StepOut>(
    client,
    farmerSystem(input.farmer),
    `${stepPrompt(input)}

Answer with:
- \`summary\`: one line, under 20 words, on what you did in this step.
- \`content\`: the work itself, as Markdown.
- \`concern\`: null, unless something is wrong enough that the owner should stop and look (the task can't be done with what you have, two sources contradict each other, or it asks for something outside your rules). Then one sentence saying what.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'content', 'concern'],
      properties: { summary: str, content: str, concern: nullable(str) },
    },
  )
}

// ---- A reviewer checks another farmer's work ---------------------------------------------------

export interface ReviewIn {
  goal: string
  farmer: { name: string; instructions: string; rules: string[] }
  task: { name: string; brief: string }
  work: { name: string; by: string; content: string }
  inputs: { name: string; by: string; content: string }[]
  files: FileIn[]
}

export interface ReviewOut {
  verdict: 'approve' | 'changes'
  summary: string
  issues: { quote: string; problem: string; fix: string }[]
  report: string
}

export function review(client: ClaudeClient, input: ReviewIn) {
  return callJSON<ReviewOut>(
    client,
    farmerSystem(input.farmer),
    `The project's goal:
<goal>
${input.goal}
</goal>

Your task: ${input.task.name}
${input.task.brief}

Files you can see:
${files(input.files)}

${input.inputs.length ? `Other finished work you can check against:\n${input.inputs.map((x) => `<work name="${x.name}" by="${x.by}">\n${x.content}\n</work>`).join('\n\n')}\n\n` : ''}The work to check, by the ${input.work.by}:
<work name="${input.work.name}">
${input.work.content}
</work>

Check it against the goal, the files and the other work. Look for claims with no source, facts that contradict a source, things the goal asked for that are missing, and anything that would embarrass the owner if it went out.
- \`verdict\`: "approve" if it can go out as it is, "changes" if it should not.
- \`summary\`: one line, under 20 words.
- \`issues\`: only real problems, at most 5. For each: the exact words from the work, what is wrong, and the fix.
- \`report\`: your full review as Markdown, for the owner to read.`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'summary', 'issues', 'report'],
      properties: {
        verdict: { type: 'string', enum: ['approve', 'changes'] },
        summary: str,
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['quote', 'problem', 'fix'],
            properties: { quote: str, problem: str, fix: str },
          },
        },
        report: str,
      },
    },
  )
}

// ---- Dispatch ---------------------------------------------------------------------------------

export type AgentTask = 'plan' | 'talk' | 'step' | 'review'

export async function runAgent(client: ClaudeClient, task: AgentTask, input: Record<string, unknown>) {
  switch (task) {
    case 'plan':
      return plan(client, input as unknown as Parameters<typeof plan>[1])
    case 'talk':
      return talk(client, input as unknown as Parameters<typeof talk>[1])
    case 'step':
      return step(client, input as unknown as StepIn)
    case 'review':
      return review(client, input as unknown as ReviewIn)
    default:
      throw new Error(`Unknown agent task: ${String(task)}`)
  }
}
