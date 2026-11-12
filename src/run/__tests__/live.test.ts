import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL, PLAN_SCHEMA, runAgent, type ClaudeClient } from '../../agent/agents'
import { openShipLive, planGoal, probeLive, resetLiveProbe, routeMessage, writeShipLive } from '../live'

function fakeClient(out: unknown) {
  const calls: Record<string, unknown>[] = []
  const client: ClaudeClient = {
    beta: {
      messages: {
        async create(params) {
          calls.push(params)
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 100, output_tokens: 50 } }
        },
      },
    },
  }
  return { client, calls }
}

const PLAN = {
  name: 'Docs support bot',
  farmers: [
    { id: 'builder', label: 'Builder', agent: 'claude-code', model: 'Claude Sonnet 5', context: ['docs/'], constraints: ['May not deploy'], limits: { usd: 3, minutes: 30 } },
    { id: 'tester', label: 'Tester', agent: 'codex', model: 'GPT-6 Luna', context: ['tests/'], constraints: ['Read only: src/'], limits: { usd: 1, minutes: 15 } },
  ],
  tasks: [{ id: 'docs-index', name: 'Index the docs', farmer: 'builder', doneWhen: 'Search returns a doc', gate: false }],
  estimate: { usd: 4, minutes: 30 },
  singleAgentEstimate: { usd: 3.5, minutes: 45 },
}

const userText = (p: Record<string, unknown>) => (p.messages as { content: string }[])[0].content

describe('runAgent', () => {
  it('plan sends the model, fallbacks and schema, and parses the output', async () => {
    const { client, calls } = fakeClient(PLAN)
    const out = await runAgent(client, 'plan', { goal: 'Build a support bot' })
    expect(out).toEqual({ data: PLAN, tokens: 150, model: MODEL, source: 'anthropic', usd: expect.closeTo(0.0014) })
    const p = calls[0]
    expect(p.model).toBe('claude-opus-5-5')
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(p.fallbacks).toBe('default')
    expect(p.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA } })
    expect(userText(p)).toContain('Build a support bot')
    expect(userText(p)).toContain('Choose the team size from the goal')
  })

  it('plan honours crewSize', async () => {
    const { client, calls } = fakeClient(PLAN)
    await runAgent(client, 'plan', { goal: 'x', crewSize: 3 })
    await runAgent(client, 'plan', { goal: 'x', crewSize: 1 })
    expect(userText(calls[0])).toContain('Use exactly 3 farmers')
    expect(userText(calls[1])).toContain('Use exactly 1 farmer')
    expect(userText(calls[1])).toContain('"builder"')
  })

  it('route limits the enum to the crew and drops a null task', async () => {
    const { client, calls } = fakeClient({ to: 'tester', task: null, reply: 'Handed to the Tester, since it is a test.' })
    const out = await runAgent(client, 'route', {
      message: 'Is the search tested?',
      farmers: [{ id: 'builder', label: 'Builder' }, { id: 'tester', label: 'Tester' }],
      tasks: [{ id: 'docs-index', name: 'Index the docs', farmer: 'builder' }],
    })
    expect(out.data).toEqual({ to: 'tester', reply: 'Handed to the Tester, since it is a test.' })
    const schema = (calls[0].output_config as { format: { schema: { properties: { to: { enum: string[] } } } } }).format.schema
    expect(schema.properties.to.enum).toEqual(['builder', 'tester'])
  })

  it('throws on a refusal and on unknown tasks', async () => {
    const client: ClaudeClient = {
      beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }) } },
    }
    await expect(runAgent(client, 'plan', { goal: 'x' })).rejects.toThrow('declined')
    await expect(runAgent(client, 'nope' as never, {})).rejects.toThrow('Unknown task')
    await expect(runAgent(client, 'plan', {})).rejects.toThrow('goal')
  })
})

describe('live client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetLiveProbe()
  })

  it('probeLive reads {live}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ live: true }))))
    expect(await probeLive()).toBe(true)
  })

  it('planGoal posts the task and returns data plus tokens', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: PLAN, tokens: 150, model: MODEL })))
    vi.stubGlobal('fetch', fetchMock)
    const out = await planGoal('Build a support bot', 2)
    expect(out.name).toBe('Docs support bot')
    expect(out.tokens).toBe(150)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ task: 'plan', input: { goal: 'Build a support bot', crewSize: 2 } })
  })

  it('throws a readable error when the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set' }), { status: 503 })))
    await expect(planGoal('x')).rejects.toThrow("Couldn't make a plan: ANTHROPIC_API_KEY is not set")
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(routeMessage('hi', [], [])).rejects.toThrow('Could not reach the agent server.')
  })

  it('reads a kept-alive answer: spaces first, the status in the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('   {"error":"GitHub answered 403","status":500}', { status: 200 })))
    await expect(writeShipLive({ goal: 'x', tasks: [] })).rejects.toThrow("Couldn't open the pull request: GitHub answered 403")
    vi.stubGlobal('fetch', vi.fn(async () => new Response('  {"error":"That\'s 3 real pull requests this hour","code":"visitor","status":429}', { status: 200 })))
    await expect(writeShipLive({ goal: 'x', tasks: [] })).rejects.toThrow("That's 3 real pull requests this hour")
    const fetchMock = vi.fn(async () => new Response('  {"data":{"url":"u","number":7,"title":"t","repo":"me/demo","branch":"b","files":[]},"tokens":0,"usd":0}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const draft = { id: 'i', repo: 'me/demo', base: 'main', parent: 'c1', tree: 't1', title: 't', summary: '', goal: 'x', plan: '', files: [], model: 'GPT-6.1 Sol', source: 'lovable' as const, usd: 0.01 }
    await expect(openShipLive({ draft, sig: 's' })).resolves.toMatchObject({ url: 'u', number: 7 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ task: 'ship', input: { step: 'open', sig: 's' } })
  })
})
