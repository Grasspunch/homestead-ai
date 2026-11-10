// The live agent calls: the Planner turns a goal into a crew and a plan, and routes the
// person's messages to the right farmer. Shared by the server route on Lovable (/api/agent)
// and the Vite dev server, so local and deployed runs use the same prompts.
// On Lovable every model, Claude or OpenAI, goes through Lovable's AI gateway with the LOVABLE_API_KEY secret, paid
// with the workspace's credits. Local dev may call Claude directly with an Anthropic key instead. No key reaches the browser.

import type { Estimate, FarmerId, FarmerSetup, PlanTask } from '../run/types'
import { reshapeSchema, type Ctx as ReshapeCtx } from '../run/reshape'
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

// The clients a server has. With the gateway, every call goes through it. Without it, Claude models need a direct
// Anthropic client and OpenAI models can't run: the call throws MissingKey, which the server answers with 503 and the
// browser turns into a simulated answer with a note.
export interface Clients {
  gateway?: GatewayClient
  claude?: ClaudeClient
}

export class MissingKey extends Error {
  constructor(public provider: 'anthropic' | 'openai') {
    super(provider === 'openai' ? 'LOVABLE_API_KEY is not set' : 'ANTHROPIC_API_KEY is not set')
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
  if (providerOf(plannerModel) === 'openai') return quick ? 'GPT-6 Luna' : m!.model
  return quick ? 'Claude Haiku 4.5' : m?.model ?? 'Claude Opus 5.5'
}

export interface AgentResult<T> {
  data: T
  tokens: number
  model: string
}

async function callJSON<T>(clients: Clients, system: string, user: string, schema: Record<string, unknown>, name = 'Claude Opus 5.5'): Promise<AgentResult<T>> {
  const m = modelOf(name) ?? modelOf('Claude Opus 5.5')!
  if (clients.gateway) return callGateway<T>(clients.gateway, system, user, schema, m.gateway)
  if (m.provider === 'openai') throw new MissingKey('openai')
  const client = clients.claude
  if (!client) throw new MissingKey('anthropic')
  const res = await client.beta.messages.create({
    model: m.api,
    max_tokens: 16000,
    // Opus falls back on the server when it declines; the smaller models have no server-side fallback.
    ...(m.api === MODEL ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.')
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off before it finished.')
  const text = res.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('No text in the response.')
  return { data: JSON.parse(text) as T, tokens: res.usage.input_tokens + res.usage.output_tokens, model: m.api }
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
  return { data: data as T, tokens: (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0), model }
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
          why: { type: 'string', description: 'One sentence, under 110 characters, on why this goal needs this farmer: name its part of this project, and why its model fits. For example "Payments cannot be half broken, so it ships to 10% of buyers first."' },
        },
      },
    },
    tasks: {
      type: 'array',
      description: '3 to 8 tasks in the order they run',
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
    return 'Choose the team size from the goal. A tiny job may need only Builder and Tester. A big one may need all five. Add a farmer only when it has real work.'
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

Tasks: 3 to 8, in run order, kebab-case ids. Each has one farmer from the crew, a short done-when the Tester can check, and gate true only when it cannot be undone or reaches real users (deploys, sending messages, payments).

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
    `You are the Planner for a crew of AI coding agents. The person asks to change how their farm runs. Turn the request into the smallest list of typed changes that does what they asked, and nothing they didn't. Anything they say to keep (for example "don't skip the tester") stays out of the list. removeTask skips a task; removeFarmer turns the Deployer off so the Builder pushes to main; setAutonomy ship auto removes the pull request review; setRollout everyone ships to every user with no 10% stage; setRolloutCheck synthetics judges the rollout by synthetic tests in prod; setDoneWhen changes a task's done-when; notifyOn stage sends a desktop notification at each rollout stage. If nothing fits, return no changes and say in reply what you can change. ${STYLE}`,
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

// ---- Entry point used by /api/agent ---------------------------------------------------

export type AgentTask = 'plan' | 'route' | 'reshape'

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
    default:
      throw new Error(`Unknown task: ${String(task)}`)
  }
}
