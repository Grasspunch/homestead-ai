// The live agent calls: the Planner turns a goal into a crew and a plan, and routes the
// person's messages to the right farmer. Shared by the server route on Lovable (/api/agent)
// and the Vite dev server, so local and deployed runs use the same prompts.
// On Lovable every model, Claude or OpenAI, goes through Lovable's AI gateway with the LOVABLE_API_KEY secret, paid
// with the workspace's credits. Out of credits (402), a call falls back to the person's own key for that model's maker,
// ANTHROPIC_API_KEY or OPENAI_API_KEY, when the server has it. Local dev may call the makers directly without the
// gateway. No key reaches the browser.

import type { Estimate, FarmerId, FarmerSetup, PlanTask } from '../run/types'
import { reshapeSchema, type Ctx as ReshapeCtx } from '../run/reshape'
import type { Talk, TalkLine } from '../run/discuss'
import type { AskTalkIn, AskTalkOut, ChatAction, ChatIn, ChatOut } from '../run/talk'
import { MODELS, modelOf, providerOf } from '../run/kit'

export const MODEL = 'claude-opus-5-5'
// Routing a message is a quick pick from a short list, so it runs on the cheap model.
export const ROUTE_MODEL = 'claude-haiku-4-5'

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

// Lovable's AI gateway: the LOVABLE_API_KEY and, for tests, a stand-in for fetch.
export interface GatewayClient {
  key: string
  fetch?: typeof fetch
}
export const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions'

// An OpenAI key and, for tests, a stand-in for fetch.
export interface OpenAIClient {
  key: string
  fetch?: typeof fetch
}

// The clients a server has. With the gateway, every call goes through it first; out of credits, it falls back to the
// direct client for the model's maker, if there is one. Without the gateway, the direct client is used. Neither: the
// call throws MissingKey, which the server answers with 503 and the browser turns into a simulated answer with a note.
export interface Clients {
  gateway?: GatewayClient
  claude?: ClaudeClient
  openai?: OpenAIClient
}

// Who answered a call: Lovable AI, or the person's own key for that maker.
export type Source = 'lovable' | 'anthropic' | 'openai'

export class MissingKey extends Error {
  constructor(public provider: 'anthropic' | 'openai') {
    super(provider === 'openai' ? 'Neither LOVABLE_API_KEY nor OPENAI_API_KEY is set' : 'Neither LOVABLE_API_KEY nor ANTHROPIC_API_KEY is set')
  }
}

// The gateway said no: out of credits (402), rate limited (429), or it doesn't know the model id.
export class GatewayError extends Error {
  constructor(public code: 'credits' | 'rate' | 'model', message: string, public model?: string) {
    super(message)
  }
}

// What the server sends back for an error, so both servers (Lovable and Vite) answer the same way.
export function errorReply(e: unknown): { status: number; body: Record<string, unknown> } {
  if (e instanceof MissingKey) return { status: 503, body: { error: e.message, missing: e.provider } }
  if (e instanceof GatewayError) return { status: e.code === 'credits' ? 402 : e.code === 'rate' ? 429 : 502, body: { error: e.message, code: e.code, model: e.model } }
  return { status: 500, body: { error: e instanceof Error ? e.message : String(e) } }
}

// Which model a call runs on, by its picker name: the Planner's own model, picked in the plan. Routing and reading a
// change are quick, so they run on the cheap model from the same maker: GPT-6 Luna for OpenAI, Haiku 4.5 for Claude.
export function modelFor(task: AgentTask, plannerModel?: string): string {
  const quick = task === 'route' || task === 'reshape'
  const m = modelOf(plannerModel)
  // Chat with the Planner answers while you wait, so it runs on the everyday model from the same maker.
  if (task === 'chat') return providerOf(plannerModel) === 'openai' ? 'GPT-6.1 Sol' : 'Claude Sonnet 5'
  if (providerOf(plannerModel) === 'openai') return quick ? 'GPT-6 Luna' : m!.model
  return quick ? 'Claude Haiku 4.5' : m?.model ?? 'Claude Opus 5.5'
}

export interface AgentResult<T> {
  data: T
  tokens: number
  model: string
  source: Source
}

async function callJSON<T>(clients: Clients, system: string, user: string, schema: Record<string, unknown>, name = 'Claude Opus 5.5'): Promise<AgentResult<T>> {
  const m = modelOf(name) ?? modelOf('Claude Opus 5.5')!
  const direct = () => (m.provider === 'openai' ? callOpenAI<T>(clients.openai!, system, user, schema, m.api) : callClaude<T>(clients.claude!, system, user, schema, m.api))
  const hasDirect = m.provider === 'openai' ? !!clients.openai : !!clients.claude
  if (clients.gateway) {
    try {
      return await callGateway<T>(clients.gateway, system, user, schema, m.gateway)
    } catch (e) {
      // Out of Lovable credits: try the person's own key for this maker. Missing, or failing too, it stays out of credits.
      if (!(e instanceof GatewayError) || e.code !== 'credits' || !hasDirect) throw e
      try {
        return await direct()
      } catch (d) {
        throw new GatewayError('credits', `Out of Lovable credits, and your ${m.provider === 'openai' ? 'OpenAI' : 'Anthropic'} key failed too: ${d instanceof Error ? d.message : String(d)}`)
      }
    }
  }
  if (!hasDirect) throw new MissingKey(m.provider)
  return direct()
}

async function callClaude<T>(client: ClaudeClient, system: string, user: string, schema: Record<string, unknown>, api: string): Promise<AgentResult<T>> {
  const res = await client.beta.messages.create({
    model: api,
    max_tokens: 16000,
    // Opus falls back on the server when it declines; the smaller models have no server-side fallback.
    ...(api === MODEL ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.')
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off before it finished.')
  const text = res.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('No text in the response.')
  return { data: JSON.parse(text) as T, tokens: res.usage.input_tokens + res.usage.output_tokens, model: api, source: 'anthropic' }
}

// The OpenAI Responses API, with the schema as a strict json_schema format: the same contract as the other calls.
async function callOpenAI<T>(o: OpenAIClient, system: string, user: string, schema: Record<string, unknown>, model: string): Promise<AgentResult<T>> {
  const res = await (o.fetch ?? fetch)('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.key}` },
    body: JSON.stringify({
      model,
      instructions: system,
      input: user,
      max_output_tokens: 16000,
      text: { format: { type: 'json_schema', name: 'homestead_answer', schema, strict: true } },
    }),
  })
  type Body = {
    status?: string
    error?: { message?: string } | null
    output_text?: string
    output?: { content?: { type: string; text?: string; refusal?: string }[] }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const body = (await res.json().catch(() => ({}))) as Body
  if (!res.ok) throw new Error(body.error?.message ?? `OpenAI answered ${res.status}.`)
  const parts = (body.output ?? []).flatMap((x) => x.content ?? [])
  if (parts.some((c) => c.type === 'refusal')) throw new Error('The model declined this request.')
  if (body.status === 'incomplete') throw new Error('The answer was cut off before it finished.')
  const text = body.output_text ?? parts.find((c) => c.type === 'output_text')?.text
  if (!text) throw new Error('No text in the response.')
  return { data: JSON.parse(text) as T, tokens: (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0), model, source: 'openai' }
}

// Lovable's gateway speaks OpenAI's chat completions for every model. The schema goes as a strict json_schema
// response format, the system prompt also asks for bare JSON, and the answer is checked against the schema, since
// not every model behind the gateway enforces the format.
async function callGateway<T>(g: GatewayClient, system: string, user: string, schema: Record<string, unknown>, model: string): Promise<AgentResult<T>> {
  const res = await (g.fetch ?? fetch)(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${g.key}` },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      messages: [
        { role: 'system', content: `${system}\n\nAnswer with one JSON object that matches the schema, and nothing else: no prose, no code fences.` },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'homestead_answer', schema, strict: true } },
    }),
  })
  type Body = {
    error?: { message?: string; code?: string } | string | null
    choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const body = (await res.json().catch(() => ({}))) as Body
  const said = typeof body.error === 'string' ? body.error : body.error?.message ?? ''
  if (res.status === 402) throw new GatewayError('credits', 'Out of Lovable credits')
  if (res.status === 429) throw new GatewayError('rate', 'Lovable AI rate limit reached')
  if (!res.ok) {
    if (res.status === 404 || /model/i.test(said)) throw new GatewayError('model', `Lovable AI doesn't offer the model "${model}"`, model)
    throw new Error(said || `Lovable AI answered ${res.status}.`)
  }
  const c = body.choices?.[0]
  if (c?.message?.refusal) throw new Error('The model declined this request.')
  if (c?.finish_reason === 'length') throw new Error('The answer was cut off before it finished.')
  const text = c?.message?.content
  if (!text) throw new Error('No text in the response.')
  let data: unknown
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    throw new Error('The answer was not JSON.')
  }
  const bad = mismatch(schema, data)
  if (bad) throw new Error(`The answer didn't match the plan's shape (${bad}).`)
  return { data: data as T, tokens: (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0), model, source: 'lovable' }
}

// A small check of an answer against the JSON schema subset these calls use: type, enum, required, items, anyOf.
// Returns where it first goes wrong, or null.
export function mismatch(schema: Record<string, unknown>, v: unknown, at = 'answer'): string | null {
  const s = schema as { type?: string; enum?: unknown[]; required?: string[]; properties?: Record<string, Record<string, unknown>>; items?: Record<string, unknown>; anyOf?: Record<string, unknown>[] }
  if (s.anyOf) return s.anyOf.some((x) => !mismatch(x, v, at)) ? null : `${at} fits none of its options`
  if (s.enum && !s.enum.includes(v)) return `${at} is not one of ${s.enum.join(', ')}`
  switch (s.type) {
    case 'null':
      return v === null ? null : `${at} should be null`
    case 'string':
    case 'number':
    case 'boolean':
      return typeof v === s.type ? null : `${at} should be a ${s.type}`
    case 'array':
      if (!Array.isArray(v)) return `${at} should be a list`
      for (let i = 0; i < v.length; i++) {
        const bad = s.items && mismatch(s.items, v[i], `${at}[${i}]`)
        if (bad) return bad
      }
      return null
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return `${at} should be an object`
      const o = v as Record<string, unknown>
      for (const k of s.required ?? []) if (!(k in o)) return `${at}.${k} is missing`
      for (const [k, sub] of Object.entries(s.properties ?? {})) {
        if (!(k in o)) continue
        const bad = mismatch(sub, o[k], `${at}.${k}`)
        if (bad) return bad
      }
      return null
    }
  }
  return null
}

// ---- The crew ------------------------------------------------------------------------

export const FARMER_IDS: FarmerId[] = ['planner', 'builder', 'designer', 'tester', 'deployer']

// Which agent and model each farmer runs on in the product.
export const CREW: Record<FarmerId, { label: string; role: string; agent: string; model: string }> = {
  planner: { label: 'Planner', role: 'splits the goal into tasks, keeps the plan current, answers the person', agent: 'claude-code', model: 'Claude Opus 5.5' },
  builder: { label: 'Builder', role: 'writes and changes the code', agent: 'codex', model: 'GPT-6.1 Sol' },
  designer: { label: 'Designer', role: 'designs the screens, copy and flows people see', agent: 'claude-code', model: 'Claude Sonnet 5' },
  tester: { label: 'Tester', role: 'checks each task against its done-when and runs the tests', agent: 'codex', model: 'GPT-6 Luna' },
  deployer: { label: 'Deployer', role: 'ships to staging and production, watches the rollout', agent: 'codex', model: 'GPT-6 Luna' },
}

const STYLE = 'Write every string as one short plain line. No jargon, no em dashes, no "·" separators, no lists packed into one string.'

// ---- Plan ---------------------------------------------------------------------------

export interface PlanInput {
  goal: string
  crewSize?: number
}

export interface PlanOut {
  name: string
  farmers: FarmerSetup[]
  tasks: PlanTask[]
  estimate: Estimate
  singleAgentEstimate: Estimate
}

const limitsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['usd', 'minutes'],
  properties: {
    usd: { type: 'number', description: 'Dollars' },
    minutes: { type: 'number', description: 'Wall-clock minutes' },
  },
}

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'farmers', 'tasks', 'estimate', 'singleAgentEstimate'],
  properties: {
    name: { type: 'string', description: 'Project name, 2 to 4 words' },
    farmers: {
      type: 'array',
      description: 'The crew, one entry per farmer, each id at most once',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'agent', 'model', 'context', 'constraints', 'limits', 'why'],
        properties: {
          id: { type: 'string', enum: FARMER_IDS },
          label: { type: 'string', description: 'For example "Builder"' },
          agent: { type: 'string', enum: ['claude-code', 'codex'] },
          model: { type: 'string', enum: MODELS.map((m) => m.model) },
          context: { type: 'array', items: { type: 'string' }, description: 'The only paths and docs this farmer may read, 2 to 5 entries, for example "docs/pricing.md" or "src/checkout/"' },
          constraints: { type: 'array', items: { type: 'string' }, description: 'What it may and may not do, 2 to 4 entries, for example "May not deploy" or "Read only: src/"' },
          limits: limitsSchema,
          why: { type: 'string', description: 'One sentence, under 110 characters, on why this goal needs this farmer: name its part of this project. Never name the model or its price; the model picker shows those. For example "Payments cannot be half broken, so it ships to 10% of buyers first."' },
        },
      },
    },
    tasks: {
      type: 'array',
      description: 'As few tasks as the goal needs, in the order they run: 2 for a small change, up to 8 for a big one',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'farmer', 'doneWhen', 'gate'],
        properties: {
          id: { type: 'string', description: 'kebab-case, unique, for example "docs-index"' },
          name: { type: 'string', description: '2 to 6 words' },
          farmer: { type: 'string', enum: FARMER_IDS },
          doneWhen: { type: 'string', description: 'One short checkable sentence the Tester checks against' },
          gate: { type: 'boolean', description: 'True when it cannot be undone or reaches real users, so it waits for the person' },
        },
      },
    },
    estimate: { ...limitsSchema, description: 'This crew, with tasks running in parallel where they can' },
    singleAgentEstimate: { ...limitsSchema, description: 'One general agent doing every task alone, one after another' },
  },
}

export function crewInstruction(crewSize?: number): string {
  if (crewSize === undefined) {
    return [
      'Choose the team size from the goal. Add a farmer only when it has real work on this goal, and never add one just because it exists.',
      'A small change (a line of copy, a label, a colour, a typo, a config value) is the Builder alone: it makes the change, runs the existing tests, and ships it straight to everyone once the person merges. No Tester, no Planner, no staged rollout.',
      'Add the Designer only when the goal changes screens, flows or copy that need designing. Add the Planner only when there are several tasks to keep in step. Add the Deployer only when the release needs a staged rollout watched, as most new features with real users do.',
      'A new product or a big feature may need all five.',
    ].join(' ')
  }
  const n = Math.max(1, Math.min(5, Math.round(crewSize)))
  if (n === 1) {
    return 'Use exactly 1 farmer: one general agent with id "builder" and label "Builder" that does every task itself, including planning, testing and deploying. Every task has farmer "builder".'
  }
  return `Use exactly ${n} farmers, no more and no fewer. Always include the Builder and the Tester. Every task must belong to one of these ${n} farmers.`
}

export function planGoal(client: Clients, input: PlanInput, model = 'Claude Opus 5.5') {
  const crew = FARMER_IDS.map((id) => `- ${id} (${CREW[id].label}): ${CREW[id].role}. Runs on ${CREW[id].agent}, model ${CREW[id].model}.`).join('\n')
  return callJSON<PlanOut>(
    client,
    `You are the Planner for Homestead, where a crew of AI coding agents ("farmers") builds software from a goal written in plain words. You pick the crew, give each farmer the least context it needs and clear limits, and split the work into tasks the Tester can check. ${STYLE}`,
    `The person's goal:
<goal>
${input.goal}
</goal>

The farmers you can use:
${crew}

Model rules: the crew is mixed. The Planner uses agent "claude-code" with "Claude Opus 5.5" and the Designer "claude-code" with "Claude Sonnet 5". The Builder uses agent "codex" with "GPT-6.1 Sol". The Tester and Deployer use agent "codex" with "GPT-6 Luna", the cheapest model that does checks and shipping well. A single general agent uses agent "claude-code" with "Claude Opus 5.5".

Team size: ${crewInstruction(input.crewSize)}

For each farmer:
- context: the only paths and docs it may read, concrete and specific to this goal (for example "docs/pricing.md", "src/checkout/"), never "the codebase".
- constraints: concrete rules (for example "May not deploy", "Read only: src/", "No network calls to production").
- limits: a dollar and minute cap for its share of the work.
- why: why this project needs this farmer, in its own terms (its tasks, its risk), not a generic job description.

Tasks: as few as the goal needs, in run order, kebab-case ids. A small change is one task to make it and run the tests, then the release: 2 tasks. A big feature may need up to 8. Never pad the plan with steps the goal does not need. Each task has one farmer from the crew, a short done-when the Tester can check, and gate true only when it cannot be undone or reaches real users (deploys, sending messages, payments). The release belongs to the Deployer when it is on the crew, otherwise to the Builder.

Estimates, for real agent runs: reason from the number of tasks, how long each takes an agent (often 5 to 20 minutes), what each costs in tokens (often $0.50 to $4 per task), and which tasks can run at the same time.
- estimate: this crew. Minutes follow the longest chain of tasks that must wait on each other, since farmers work in parallel. Dollars add up, plus a little for handoffs and checks.
- singleAgentEstimate: one general agent doing all tasks alone, one after another, on Claude Sonnet 5. Slower, since nothing runs in parallel and it rereads one growing context. It also has nobody independent checking its work, so some problems surface late and get redone. Per token, Claude Sonnet 5 and GPT-6.1 Sol cost half of Opus 5.5 and GPT-6 Luna a fortieth, which usually pays for the crew's handoffs.
The farmers' limits should add up to roughly the crew estimate, with some headroom.`,
    PLAN_SCHEMA,
    model,
  )
}

// ---- Route --------------------------------------------------------------------------

export interface RouteInput {
  message: string
  farmers: { id: FarmerId; label: string }[]
  tasks: { id: string; name: string; farmer: FarmerId }[]
}

export interface RouteOut {
  to: FarmerId
  task?: string
  reply: string
}

export function routeSchema(input: RouteInput) {
  const ids = input.farmers.length ? input.farmers.map((f) => f.id) : FARMER_IDS
  const taskIds = input.tasks.map((t) => t.id)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['to', 'task', 'reply'],
    properties: {
      to: { type: 'string', enum: ids },
      task: taskIds.length
        ? { anyOf: [{ type: 'string', enum: taskIds }, { type: 'null' }], description: 'The task this is about, or null' }
        : { type: 'null' },
      reply: { type: 'string', description: 'One short sentence saying who it went to and why' },
    },
  }
}

export async function routeMessage(client: Clients, input: RouteInput, model = 'Claude Haiku 4.5'): Promise<AgentResult<RouteOut>> {
  const farmers = input.farmers.map((f) => `- ${f.id} (${f.label}): ${CREW[f.id]?.role ?? ''}`).join('\n')
  const tasks = input.tasks.map((t) => `- ${t.id}: ${t.name} (${t.farmer})`).join('\n')
  const out = await callJSON<{ to: FarmerId; task: string | null; reply: string }>(
    client,
    `You are the Planner for a crew of AI coding agents. The person sends a message while the crew works. Hand it to the one farmer best placed to act on it. Questions about the plan, cost or priorities stay with the Planner when it is on the crew. ${STYLE}`,
    `The crew:
${farmers || '(none listed)'}

The tasks:
${tasks || '(none yet)'}

The person's message:
<message>
${input.message}
</message>

Pick the farmer, the task it is about (or null), and write one short sentence to the person saying who you handed it to and why, for example "Handed to the Designer, since it is about the button colour."`,
    routeSchema(input),
    model,
  )
  const { task, ...rest } = out.data
  return { ...out, data: task ? { ...rest, task } : rest }
}

// ---- Changing the farm ----------------------------------------------------------------

export interface ReshapeOut {
  title: string
  reply: string
  changes: Record<string, unknown>[]
}

// A request to change how the farm runs ("I'm in an incident, skip the deployer"), as a list of typed changes.
// The schema only allows the changes the app can make, on this farm's own tasks; the app checks them again.
export async function reshapeFarm(client: Clients, input: { message: string; ctx: ReshapeCtx }, model = 'Claude Haiku 4.5'): Promise<AgentResult<ReshapeOut>> {
  const tasks = input.ctx.tasks.map((t) => `- ${t.id}: ${t.name} (${t.farmer}${t.gate ? ', the release' : ''}${t.status ? `, ${t.status}` : ''})`).join('\n')
  return callJSON<ReshapeOut>(
    client,
    `You are the Planner for a crew of AI coding agents. The person asks to change how their farm runs. Turn the request into the smallest list of typed changes that does what they asked, and nothing they didn't. Anything they say to keep (for example "don't skip the tester") stays out of the list. removeTask skips a task; removeFarmer turns the Deployer off so the Builder pushes to main; setAutonomy ship auto removes the pull request review; setRollout everyone ships to every user with no 10% stage; setRolloutCheck synthetics judges the rollout by synthetic tests in prod; setDoneWhen changes a task's done-when; notifyOn stage sends a desktop notification at each rollout stage; ui hides (show false) or brings back (show true) a part of the screen, such as the pull request button at the top, which is not the same as the pull request review; uiMove moves a top bar button (to start or end of the right-hand group, left beside home, or before or after another button named in of); uiSize makes a part bigger, smaller or its default size; uiLabel renames a top bar button, keeping its text short; uiColor recolours a top bar button with one of the listed colours only; uiReset puts a part back as it was. Each part allows only the kinds its enum lists. For a colour that isn't listed, return no changes and name the colours you can use. If nothing fits, return no changes and say in reply what you can change. ${STYLE}`,
    `The crew: ${input.ctx.farmers.join(', ')}

The tasks:
${tasks || '(none yet)'}

The person's request:
<message>
${input.message}
</message>`,
    reshapeSchema(input.ctx),
    model,
  )
}

// ---- Talking a disagreement through ---------------------------------------------------

// A question about two farmers' disagreement. The side it's about answers, or both, in one short line each, from
// what each side said. It never decides: you still pick, or suggest your own way.
export async function discussDisagreement(client: Clients, input: { question: string; talk: Talk }, model = 'Claude Sonnet 5'): Promise<AgentResult<{ lines: TalkLine[] }>> {
  const t = input.talk
  const sides = t.sides.map((s) => `- ${s.farmer} (${s.label}): ${s.position}. Option "${s.option}". Why: ${s.why}`).join('\n')
  return callJSON(
    client,
    `You are two farmers on a crew of AI coding agents who disagree, answering the person's question about it. Answer as the side the question is about, or as both when it's about both or neither. Answer what they actually asked, and don't restate your position: for pros and cons, give your way's real downside as well as its upside; for a vague question or a lone "?", name the one trade-off that decides it and what would make the other way the better pick. Up to two short sentences each, from what that side said and the costs given; never make up numbers, and never decide for the person. ${STYLE}`,
    `They disagree on ${t.topic}.
${t.impact ?? ''}

The sides:
${sides}

Either side's change costs about $${t.usd.toFixed(2)} and ${t.minutes} min. A way of the person's own costs about $${t.ownUsd.toFixed(2)} and ${t.ownMinutes} min, since it's reworked and checked again.

The person's question:
<question>
${input.question}
</question>`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['lines'],
      properties: {
        lines: {
          type: 'array',
          description: 'One or two lines, one per side that answers',
          items: { type: 'object', additionalProperties: false, required: ['from', 'text'], properties: { from: { type: 'string', enum: t.sides.map((s) => s.farmer) }, text: { type: 'string', description: 'Up to two short sentences' } } },
        },
      },
    },
    model,
  )
}

// ---- Talking an ask through ---------------------------------------------------------

const said = (h: { from: string; text: string }[]) => h.map((l) => `${l.from === 'you' ? 'Person' : l.from}: ${l.text}`).join('\n')

// The person typed into a question an agent asked them. The agent answers like a colleague: it answers what was
// asked, takes pushback seriously, and only reads a pick when the person clearly made one. It never decides for them.
export async function talkAsk(client: Clients, input: AskTalkIn, model = 'Claude Sonnet 5'): Promise<AgentResult<AskTalkOut>> {
  const a = input.ask
  const sides = a.sides?.length ? `\nTwo agents disagree:\n${a.sides.map((x) => `- ${x.label}: ${x.position}. Option "${x.option}". Why: ${x.why}`).join('\n')}` : ''
  return callJSON<AskTalkOut>(
    client,
    `You are the ${a.farmerLabel}, an AI agent on a small team building software for a person. You stopped to ask them a question, and they typed a reply. Talk it through with them like a trusted colleague. Answer what they actually asked, from the facts given; never make up numbers or claim you did something. If they push back, take it seriously: say what each option really trades off, and that they can wait or tell you what they'd rather do. If they ask for something the options don't offer (for example more review or more tests before merging), say plainly what you can do: on a pull request question you can send the work back with their words as the note. Set choice only when their words clearly and unconditionally pick one of the options; a question, a condition ("yes but"), a doubt or a counter-offer is not a pick, so leave choice null and answer. Set sendBack (the note, in their words) only on a pull request question when they ask for changes, more review or more tests before merging. Set hold only when they want to wait or think. Up to three short sentences, plain words: say agent, project and task, never farm or farmer. ${STYLE}`,
    `Your question to them: ${a.question}
${a.impact ? `What it means: ${a.impact}\n` : ''}${a.basis ? `How sure you are: ${a.confidence ?? 'unsure'}, because ${a.basis}\n` : ''}${a.task ? `The task: ${a.task}\n` : ''}Their options: ${a.options.map((o) => `"${o}"`).join(', ')} (you suggested "${a.suggested}")${a.canSendBack ? '. This is the pull request review, so work can also go back to an agent with a note.' : ''}${sides}

The talk so far:
${said(input.history) || '(nothing yet)'}

Their message:
<message>
${input.message}
</message>`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['reply', 'choice', 'sendBack', 'hold'],
      properties: {
        reply: { type: 'string', description: 'Your answer, up to three short sentences' },
        choice: { anyOf: [{ type: 'string', enum: a.options }, { type: 'null' }], description: 'The option their words clearly pick, or null' },
        sendBack: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'On a pull request question, the note to send the work back with, or null' },
        hold: { type: 'boolean', description: 'True when they want to wait or think first' },
      },
    },
    model,
  )
}

// ---- Chatting with the Planner -------------------------------------------------------

interface ChatRaw {
  reply: string
  kind: ChatAction['kind']
  to: FarmerId | null
  request: string | null
  id: string | null
  askId: string | null
  choice: string | null
  keep: string[] | null
  scope: 'farm' | 'every' | null
}

// A flat answer, as strict JSON schemas need, read into one action.
export function chatAction(r: ChatRaw): ChatAction {
  switch (r.kind) {
    case 'note':
      return r.to ? { kind: 'note', to: r.to } : { kind: 'none' }
    case 'change':
      return r.request ? { kind: 'change', request: r.request } : { kind: 'none' }
    case 'undo':
      return r.id ? { kind: 'undo', id: r.id } : { kind: 'none' }
    case 'reopen':
      return r.askId ? { kind: 'reopen', askId: r.askId, choice: r.choice } : { kind: 'none' }
    case 'adjust':
      return { kind: 'adjust', keep: r.keep, scope: r.scope }
    case 'cancel':
      return { kind: 'cancel' }
    default:
      return { kind: 'none' }
  }
}

// The person typed to the Planner. It answers questions from the run as it stands, and takes at most one action:
// pass a note to an agent, read a change to how the project runs, turn a change off, change an earlier answer,
// or adjust or drop a change card that's open. Nothing is ever final, and it says so when it matters.
export async function plannerChat(client: Clients, input: ChatIn, model = 'Claude Sonnet 5'): Promise<AgentResult<ChatOut>> {
  const st = input.status
  const ids = st.farmers.map((f) => f.id)
  const decided = st.decided.map((d) => `- ${d.id}: "${d.question}" They chose "${d.choice}". Options: ${d.options.map((o) => `"${o}"`).join(', ')}.${d.canChange ? '' : ` Can't change: ${d.why}`}`).join('\n')
  const out = await callJSON<ChatRaw>(
    client,
    `You are the Planner for a small team of AI agents building software for a person. They typed a message to you while the work runs. First, answer it like a trusted colleague, from the run as it stands below; never make up numbers or claim something happened that the run doesn't show. Then pick at most one action:
- none: the answer is all they need (questions, opinions, "hmm").
- note: something for one agent to act on in its work, such as feedback on the code or design. Say who you handed it to.
- change: they want to change how the project runs (skip a task, ship differently, turn the review off, hide or move a part of the screen, notifications). Put their request in request, in their words; they'll see a card to confirm it.
- undo: they want a change that's on turned off or put back. id is that change's id.
- reopen: they changed their mind about an earlier answer. askId is that question's id; choice is the new option when they named one, else null to ask it again. If it can't be changed, use none and say why and what you can do instead.
- adjust: only while a change card is open: keep only some rows (keep, by row id) or set how long it lasts (scope farm for this project, every for every new project).
- cancel: only while a change card is open, they want it dropped.
Never pick an action they didn't ask for. Up to three short sentences, plain words: say agent, project and task, never farm or farmer. ${STYLE}`,
    `The goal: ${st.goal}
${st.done ? 'The run is finished.' : `${st.minutes} min into the run.`} Spent so far: $${st.spent.toFixed(2)}${st.budget ? ` of $${st.budget}` : ''}. Release: ${st.deploy ?? 'not shipped'}. Pull requests ${st.merge === 'auto' ? 'merge by themselves when every check passes' : 'wait for them to review and merge'}.

The agents:
${st.farmers.map((f) => `- ${f.id} (${f.label}): ${CREW[f.id]?.role ?? ''}. ${f.state}${f.task ? ` on "${f.task}"` : ''}${f.model ? `, model ${f.model}` : ''}`).join('\n')}

The tasks:
${st.tasks.map((t) => `- ${t.id}: ${t.name} (${t.farmer}, ${t.status})`).join('\n') || '(none yet)'}
${st.openAsk ? `\nWaiting on them now: "${st.openAsk.question}" Options: ${st.openAsk.options.map((o) => `"${o}"`).join(', ')}\n` : ''}
What they decided so far:
${decided || '(nothing yet)'}

Changes they made that are on:
${st.changesOn.map((c) => `- ${c.id}: ${c.title} (they asked: "${c.request}")`).join('\n') || '(none)'}
${st.pending ? `\nA change card is open for "${st.pending.request}", with rows:\n${st.pending.rows.map((r) => `- ${r.id}: ${r.label}${r.loss ? ` (${r.loss})` : ''}`).join('\n')}\n` : ''}
The chat so far:
${said(input.history) || '(nothing yet)'}

Their message:
<message>
${input.message}
</message>`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['reply', 'kind', 'to', 'request', 'id', 'askId', 'choice', 'keep', 'scope'],
      properties: {
        reply: { type: 'string', description: 'Your answer, up to three short sentences' },
        kind: { type: 'string', enum: ['none', 'note', 'change', 'undo', 'reopen', 'adjust', 'cancel'] },
        to: ids.length ? { anyOf: [{ type: 'string', enum: ids }, { type: 'null' }] } : { type: 'null' },
        request: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'For change: the request in their words' },
        id: st.changesOn.length ? { anyOf: [{ type: 'string', enum: st.changesOn.map((c) => c.id) }, { type: 'null' }] } : { type: 'null' },
        askId: st.decided.length ? { anyOf: [{ type: 'string', enum: st.decided.map((d) => d.id) }, { type: 'null' }] } : { type: 'null' },
        choice: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'For reopen: the new option, word for word, or null' },
        keep: st.pending ? { anyOf: [{ type: 'array', items: { type: 'string', enum: st.pending.rows.map((r) => r.id) } }, { type: 'null' }] } : { type: 'null' },
        scope: { anyOf: [{ type: 'string', enum: ['farm', 'every'] }, { type: 'null' }] },
      },
    },
    model,
  )
  return { ...out, data: { reply: out.data.reply, action: chatAction(out.data) } }
}

// ---- Entry point used by /api/agent ---------------------------------------------------

export type AgentTask = 'plan' | 'route' | 'reshape' | 'discuss' | 'talk' | 'chat'

// An Anthropic client alone still works, for local dev without the gateway.
export async function runAgent(clients: Clients | ClaudeClient, task: AgentTask, input: Record<string, unknown>): Promise<AgentResult<unknown>> {
  const client: Clients = 'beta' in clients ? { claude: clients } : clients
  const model = modelFor(task, typeof input.model === 'string' ? input.model : undefined)
  switch (task) {
    case 'plan': {
      const goal = typeof input.goal === 'string' ? input.goal.trim() : ''
      if (!goal) throw new Error('A goal is needed to make a plan.')
      const crewSize = typeof input.crewSize === 'number' ? input.crewSize : undefined
      return planGoal(client, { goal, crewSize }, model)
    }
    case 'route': {
      const message = typeof input.message === 'string' ? input.message.trim() : ''
      if (!message) throw new Error('A message is needed to route.')
      return routeMessage(client, {
        message,
        farmers: Array.isArray(input.farmers) ? (input.farmers as RouteInput['farmers']) : [],
        tasks: Array.isArray(input.tasks) ? (input.tasks as RouteInput['tasks']) : [],
      }, model)
    }
    case 'reshape': {
      const message = typeof input.message === 'string' ? input.message.trim() : ''
      const ctx = input.ctx as ReshapeCtx | undefined
      if (!message || !ctx || !Array.isArray(ctx.tasks) || !Array.isArray(ctx.farmers)) throw new Error('A message and the farm are needed to change it.')
      return reshapeFarm(client, { message, ctx }, model)
    }
    case 'discuss': {
      // Runs on the model of the side asked, not the Planner's.
      const question = typeof input.question === 'string' ? input.question.trim() : ''
      const talk = input.talk as Talk | undefined
      if (!question || !talk || !Array.isArray(talk.sides)) throw new Error('A question and the disagreement are needed.')
      const own = typeof input.model === 'string' && modelOf(input.model) ? input.model : 'Claude Sonnet 5'
      return discussDisagreement(client, { question, talk }, own)
    }
    case 'talk': {
      // Runs on the model of the agent that asked.
      const inp = input as unknown as AskTalkIn
      if (typeof inp.message !== 'string' || !inp.message.trim() || !inp.ask || !Array.isArray(inp.ask.options)) throw new Error('A message and the question are needed.')
      const own = typeof input.model === 'string' && modelOf(input.model) ? input.model : 'Claude Sonnet 5'
      return talkAsk(client, { ask: inp.ask, history: Array.isArray(inp.history) ? inp.history.slice(-10) : [], message: inp.message.trim() }, own)
    }
    case 'chat': {
      const inp = input as unknown as ChatIn
      if (typeof inp.message !== 'string' || !inp.message.trim() || !inp.status) throw new Error('A message and the run are needed.')
      return plannerChat(client, { message: inp.message.trim(), history: Array.isArray(inp.history) ? inp.history.slice(-12) : [], status: inp.status }, model)
    }
    default:
      throw new Error(`Unknown task: ${String(task)}`)
  }
}
