import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GATEWAY_URL, MODEL, MissingKey, errorReply, mismatch, modelFor, runAgent, type ClaudeClient } from '../../agent/agents'
import { NO_KEY, isFallbackNote, plan, reshapeRead, setLiveMode } from '../agent'
import { MODELS, agentName, providerOf } from '../kit'
import { resetLiveProbe } from '../live'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store } from '../store'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const rate = (name: string) => MODELS.find((m) => m.model === name)!.rate

describe('the models, from Lovable AI’s list', () => {
  it('offers only Lovable’s models, grouped by maker, each with a gateway id', () => {
    expect(MODELS.map((m) => m.model)).toEqual([
      'Claude Opus 5.5', 'Claude Opus 5', 'Claude Sonnet 5', 'Claude Haiku 4.5', 'Claude Fable 5.1',
      'GPT-6.1 Sol', 'GPT-6.1 Terra', 'GPT-6 Luna', 'GPT-6 Astra',
    ])
    for (const m of MODELS) expect(m.gateway).toBe(`${m.provider}/${m.api}`)
    expect(MODELS.find((m) => m.model === 'GPT-6.1 Sol')!.gateway).toBe('openai/gpt-6.1-sol')
    expect(MODELS.find((m) => m.model === 'Claude Sonnet 5')!.gateway).toBe('anthropic/claude-sonnet-5')
  })
  it('prices every model per token against Opus 5.5 ($4 in, $20 out), from list prices', () => {
    expect(rate('Claude Opus 5.5')).toBe(1)
    expect(rate('Claude Opus 5')).toBe(5 / 4)
    expect(rate('Claude Sonnet 5')).toBe(2 / 4)
    expect(rate('Claude Haiku 4.5')).toBe(1 / 4)
    expect(rate('Claude Fable 5.1')).toBe(10 / 4)
    expect(rate('GPT-6 Astra')).toBe(10 / 4)
    expect(rate('GPT-6.1 Sol')).toBe(2 / 4)
    expect(rate('GPT-6.1 Terra')).toBe(1 / 4)
    expect(rate('GPT-6 Luna')).toBe(0.1 / 4)
  })
  it('the default crew: Planner on Opus 5.5, Designer on Sonnet 5, Builder on Sol, checks and shipping on the cheaper of Haiku 4.5 and Luna', () => {
    const f = Object.fromEntries(simulatePlan(SAMPLE_GOAL).farmers.map((x) => [x.id, x]))
    expect([f.planner.model, f.planner.agent]).toEqual(['Claude Opus 5.5', 'claude-code'])
    expect([f.designer.model, f.designer.agent]).toEqual(['Claude Sonnet 5', 'claude-code'])
    expect([f.builder.model, f.builder.agent]).toEqual(['GPT-6.1 Sol', 'codex'])
    const cheaper = rate('GPT-6 Luna') < rate('Claude Haiku 4.5') ? 'GPT-6 Luna' : 'Claude Haiku 4.5'
    expect(f.tester.model).toBe(cheaper)
    expect(f.deployer.model).toBe(cheaper)
    const g = Object.fromEntries(simulatePlan('Add a dark mode to the settings page').farmers.map((x) => [x.id, x]))
    expect(g.tester.why).toMatch(/GPT-6 Luna, a tenth of Haiku’s price/)
    expect(agentName(f.builder.agent)).toBe('Codex')
    expect(agentName(f.planner.agent)).toBe('Claude Code')
  })
  it('swapping the Builder’s model re-prices the run', () => {
    const p = store.newProject(SAMPLE_GOAL)
    const d = simulatePlan(SAMPLE_GOAL)
    store.setPlan(p.id, d.name, d.farmers, d.tasks, d.estimate, d.singleAgentEstimate)
    const at = (model?: string) => {
      store.editKit(p.id, 'builder', (k) => {
        k.model = model
        k.agent = model ? MODELS.find((m) => m.model === model)!.agent : undefined
      })
      return store.forecast(p)!.crew.usd
    }
    const sol = at(undefined)
    expect(at('Claude Sonnet 5')).toBeCloseTo(sol, 2)
    expect(at('GPT-6 Astra')).toBeGreaterThan(sol * 2)
    expect(at('GPT-6 Luna')).toBeLessThan(sol)
  })
})

// A stand-in for Lovable's gateway: records each call and answers like OpenAI's chat completions.
const gateway = (answer: unknown, status = 200) => {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization })
    const body = status === 200 ? { choices: [{ finish_reason: 'stop', message: { content: typeof answer === 'string' ? answer : JSON.stringify(answer) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } : answer
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof globalThis.fetch
  return { calls, client: { key: 'lovable-test', fetch } }
}
const ROUTE_IN = { message: 'make it friendlier', farmers: [{ id: 'builder', label: 'Builder' }], tasks: [] }
const OK = { to: 'builder', task: null, reply: 'Passed to the Builder.' }

describe('live calls go through Lovable AI', () => {
  it('picks the model by the Planner’s: plans on it, routes on the cheap one from the same maker', () => {
    expect(modelFor('plan', 'Claude Opus 5.5')).toBe('Claude Opus 5.5')
    expect(modelFor('route', undefined)).toBe('Claude Haiku 4.5')
    expect(modelFor('plan', 'GPT-6.1 Sol')).toBe('GPT-6.1 Sol')
    expect(modelFor('route', 'GPT-6 Astra')).toBe('GPT-6 Luna')
    expect(providerOf('GPT-6.1 Terra')).toBe('openai')
  })
  it('an OpenAI Planner calls the gateway with its id and a strict JSON schema', async () => {
    const g = gateway(OK)
    const claude = { beta: { messages: { create: vi.fn() } } } as unknown as ClaudeClient
    const r = await runAgent({ gateway: g.client, claude }, 'route', { model: 'GPT-6.1 Sol', ...ROUTE_IN })
    expect(g.calls[0].url).toBe(GATEWAY_URL)
    expect(GATEWAY_URL).toBe('https://ai.gateway.lovable.dev/v1/chat/completions')
    expect(g.calls[0].auth).toBe('Bearer lovable-test')
    expect(g.calls[0].body.model).toBe('openai/gpt-6-luna')
    expect(g.calls[0].body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } })
    expect(r).toMatchObject({ data: { to: 'builder', reply: 'Passed to the Builder.' }, tokens: 15, model: 'openai/gpt-6-luna' })
    expect((claude.beta.messages.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
  it('a Claude Planner goes through the gateway too, on its anthropic/ id', async () => {
    const g = gateway(OK)
    await runAgent({ gateway: g.client }, 'route', { model: 'Claude Opus 5.5', ...ROUTE_IN })
    await runAgent({ gateway: g.client }, 'plan', { model: 'Claude Opus 5.5', goal: 'x' }).catch(() => {})
    expect(g.calls.map((c) => c.body.model)).toEqual(['anthropic/claude-haiku-4-5', 'anthropic/claude-opus-5-5'])
  })
  it('checks the answer against the schema, and takes JSON wrapped in a code fence', async () => {
    await expect(runAgent({ gateway: gateway({ to: 'nobody', task: null, reply: 'x' }).client }, 'route', ROUTE_IN)).rejects.toThrow(/answer.to is not one of builder/)
    await expect(runAgent({ gateway: gateway('Sure! Here it is.').client }, 'route', ROUTE_IN)).rejects.toThrow('The answer was not JSON.')
    const r = await runAgent({ gateway: gateway('```json\n' + JSON.stringify(OK) + '\n```').client }, 'route', ROUTE_IN)
    expect(r.data).toMatchObject({ to: 'builder' })
    expect(mismatch({ type: 'object', required: ['a'], properties: { a: { type: 'number' } } }, { a: 'x' })).toBe('answer.a should be a number')
  })
  it('402, 429 and an unknown model id become typed errors the server answers with', async () => {
    const at = async (status: number, body: unknown) => errorReply(await runAgent({ gateway: gateway(body, status).client }, 'route', { model: 'GPT-6.1 Sol', ...ROUTE_IN }).catch((e) => e))
    expect(await at(402, { error: { message: 'Payment required' } })).toMatchObject({ status: 402, body: { code: 'credits' } })
    expect(await at(429, { error: { message: 'Too many requests' } })).toMatchObject({ status: 429, body: { code: 'rate' } })
    expect(await at(400, { error: { message: 'Unknown model: openai/gpt-6-luna' } })).toMatchObject({ status: 502, body: { code: 'model', model: 'openai/gpt-6-luna' } })
  })
  it('without the gateway, Claude calls Anthropic directly and OpenAI models throw MissingKey', async () => {
    const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ to: 'tester', task: null, reply: 'ok' }) }], usage: { input_tokens: 1, output_tokens: 1 } }))
    await runAgent({ claude: { beta: { messages: { create } } } }, 'plan', { model: 'Claude Opus 5.5', goal: 'x' })
    expect((create.mock.calls[0] as unknown as [{ model: string }])[0].model).toBe(MODEL)
    await expect(runAgent({}, 'route', { model: 'GPT-6 Luna', message: 'hi' })).rejects.toBeInstanceOf(MissingKey)
    expect(errorReply(new MissingKey('openai'))).toMatchObject({ status: 503, body: { missing: 'openai' } })
  })
})

describe('when Lovable AI can’t answer, the call is simulated and says so', () => {
  const real = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = real
    setLiveMode(false)
    resetLiveProbe()
  })
  const server = (on: { gateway: boolean; anthropic?: boolean }, post?: () => Response) => {
    const seen: string[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.method ?? 'GET')
      if (!init?.method) return new Response(JSON.stringify({ live: on.gateway || !!on.anthropic, gateway: on.gateway, keys: { anthropic: on.gateway || !!on.anthropic, openai: on.gateway } }))
      return post ? post() : new Response('{}', { status: 500 })
    }) as unknown as typeof fetch
    return seen
  }
  it('not set up: no call is made, the plan is simulated with the note', async () => {
    const seen = server({ gateway: false, anthropic: true })
    setLiveMode(true)
    const r = await plan(SAMPLE_GOAL, undefined, 'GPT-6.1 Sol')
    expect([r.live, r.error]).toEqual([false, NO_KEY.openai])
    expect(r.error).toBe('Lovable AI not set up, simulated')
    expect(r.data.farmers.length).toBeGreaterThan(0)
    expect(seen).not.toContain('POST')
  }, 10_000)
  it('out of credits (402): simulated instead, with a plain note', async () => {
    server({ gateway: true }, () => new Response(JSON.stringify({ error: 'Out of Lovable credits', code: 'credits' }), { status: 402 }))
    setLiveMode(true)
    const r = await plan(SAMPLE_GOAL)
    expect([r.live, r.error]).toEqual([false, 'Out of Lovable credits, simulated instead'])
    expect(r.data.farmers.length).toBeGreaterThan(0)
    expect(isFallbackNote(r.error)).toBe(true)
  })
  it('rate limited (429): simulated instead, with a plain note', async () => {
    server({ gateway: true }, () => new Response(JSON.stringify({ error: 'Lovable AI rate limit reached', code: 'rate' }), { status: 429 }))
    setLiveMode(true)
    const r = await plan(SAMPLE_GOAL, undefined, 'GPT-6.1 Sol')
    expect([r.live, r.error]).toEqual([false, 'Lovable AI rate limit reached, simulated instead'])
  })
  it('a wrong model id: simulated, and the note names the id to check', async () => {
    server({ gateway: true }, () => new Response(JSON.stringify({ error: 'x', code: 'model', model: 'openai/gpt-6.1-sol' }), { status: 502 }))
    setLiveMode(true)
    const r = await plan(SAMPLE_GOAL, undefined, 'GPT-6.1 Sol')
    expect(r.live).toBe(false)
    expect(r.error).toMatch(/doesn't offer the model "openai\/gpt-6.1-sol", simulated instead/)
    expect(isFallbackNote(r.error)).toBe(false)
  })
  it('reading a change falls back to the app’s own reader with the same note', async () => {
    server({ gateway: true }, () => new Response('{"code":"credits"}', { status: 402 }))
    setLiveMode(true)
    const r = await reshapeRead('skip the deployer', { farmers: ['builder', 'tester', 'deployer'], tasks: [] } as never)
    expect(r).toEqual({ proposal: null, note: 'Out of Lovable credits, simulated instead' })
  })
})
