import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MODEL, MissingKey, ROUTE_MODEL, modelFor, runAgent, type ClaudeClient } from '../../agent/agents'
import { NO_KEY, plan, setLiveMode } from '../agent'
import { MODELS, agentName, providerOf } from '../kit'
import { resetLiveProbe } from '../live'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store } from '../store'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const rate = (name: string) => MODELS.find((m) => m.model === name)!.rate

describe('pricing', () => {
  it('prices every model per token against Opus ($4 in, $20 out), from list prices', () => {
    // Input and output scale together for every model, so one ratio per model.
    expect(rate('Claude Opus 5.5')).toBe(1)
    expect(rate('GPT-6 Astra')).toBe(10 / 4)
    expect(rate('GPT-6.1 Sol')).toBe(2 / 4)
    expect(rate('GPT-6.1 Terra')).toBe(1 / 4)
    expect(rate('GPT-6 Luna')).toBe(0.1 / 4)
    // Luna costs what Haiku costs, so the Tester and Deployer stay on Haiku.
    expect(rate('GPT-6 Luna')).toBe(rate('Claude Haiku 5.5'))
  })
  it('the default crew is mixed: the Builder on Codex, everyone else on Claude', () => {
    const f = Object.fromEntries(simulatePlan(SAMPLE_GOAL).farmers.map((x) => [x.id, x]))
    expect([f.builder.model, f.builder.agent]).toEqual(['GPT-6.1 Sol', 'codex'])
    expect([f.planner.model, f.planner.agent]).toEqual(['Claude Opus 5.5', 'claude-code'])
    expect(f.tester.model).toBe('Claude Haiku 5.5')
    expect(f.builder.why).toMatch(/GPT-6.1 Sol on Codex/)
    expect(agentName(f.builder.agent)).toBe('Codex')
    expect(agentName(f.tester.agent)).toBe('Claude Code')
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
    expect(at('Claude Sonnet 5.5')).toBeCloseTo(sol, 2)
    expect(at('GPT-6 Astra')).toBeGreaterThan(sol * 2)
    expect(at('GPT-6 Luna')).toBeLessThan(sol)
  })
})

describe('routing live calls by the Planner’s model', () => {
  const schemaOf = (body: string) => JSON.parse(body).text.format
  it('picks the model: Claude as before, Codex on its own model, routing on the cheap one', () => {
    expect(modelFor('plan', 'Claude Opus 5.5')).toBe(MODEL)
    expect(modelFor('route', undefined)).toBe(ROUTE_MODEL)
    expect(modelFor('plan', 'GPT-6.1 Sol')).toBe('gpt-6.1-sol')
    expect(modelFor('route', 'GPT-6 Astra')).toBe('gpt-6-luna')
    expect(providerOf('GPT-6.1 Terra')).toBe('openai')
  })
  it('a Codex Planner calls the OpenAI Responses API with the same JSON schema', async () => {
    const calls: { url: string; body: string; auth: string }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).Authorization })
      const out = { to: 'builder', task: null, reply: 'Passed to the Builder.' }
      return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(out) }] }], usage: { input_tokens: 10, output_tokens: 5 } }))
    }) as unknown as typeof fetch
    const claude = { beta: { messages: { create: vi.fn() } } } as unknown as ClaudeClient
    const r = await runAgent({ claude, openai: { key: 'sk-test', fetch: fake } }, 'route', { model: 'GPT-6.1 Sol', message: 'make it friendlier', farmers: [{ id: 'builder', label: 'Builder' }], tasks: [] })
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses')
    expect(calls[0].auth).toBe('Bearer sk-test')
    expect(JSON.parse(calls[0].body).model).toBe('gpt-6-luna')
    expect(schemaOf(calls[0].body)).toMatchObject({ type: 'json_schema', strict: true })
    expect(r).toMatchObject({ data: { to: 'builder', reply: 'Passed to the Builder.' }, tokens: 15, model: 'gpt-6-luna' })
    expect((claude.beta.messages.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
  it('a Claude Planner calls Anthropic, even when an OpenAI key is there', async () => {
    const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ to: 'tester', task: null, reply: 'ok' }) }], usage: { input_tokens: 1, output_tokens: 1 } }))
    const openai = { key: 'sk-test', fetch: vi.fn() as unknown as typeof fetch }
    await runAgent({ claude: { beta: { messages: { create } } }, openai }, 'route', { model: 'Claude Opus 5.5', message: 'check it', farmers: [{ id: 'tester', label: 'Tester' }], tasks: [] })
    expect((create.mock.calls[0] as unknown as [{ model: string }])[0].model).toBe(ROUTE_MODEL)
    expect(openai.fetch).not.toHaveBeenCalled()
  })
  it('a provider with no key throws MissingKey, which the server answers with 503', async () => {
    await expect(runAgent({}, 'route', { model: 'GPT-6 Luna', message: 'hi' })).rejects.toBeInstanceOf(MissingKey)
    await expect(runAgent({}, 'route', { model: 'GPT-6 Luna', message: 'hi' })).rejects.toMatchObject({ provider: 'openai' })
  })
})

describe('without the OpenAI key, a Codex Planner is simulated and says so', () => {
  const real = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = real
    setLiveMode(false)
    resetLiveProbe()
  })
  const server = (keys: { anthropic: boolean; openai: boolean }, post?: () => Response) => {
    const seen: string[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.method ?? 'GET')
      if (!init?.method) return new Response(JSON.stringify({ live: keys.anthropic, keys }))
      return post ? post() : new Response('{}', { status: 500 })
    }) as unknown as typeof fetch
    return seen
  }
  it('no key: no call is made, the plan is simulated with the note', async () => {
    const seen = server({ anthropic: true, openai: false })
    setLiveMode(true)
    const r = await plan(SAMPLE_GOAL, undefined, 'GPT-6.1 Sol')
    expect(r.live).toBe(false)
    expect(r.error).toBe(NO_KEY.openai)
    expect(r.error).toBe('OpenAI key not set, simulated')
    expect(r.data.farmers.length).toBeGreaterThan(0)
    expect(seen).not.toContain('POST')
  }, 10_000)
  it('the server says the key is missing: the same note', async () => {
    server({ anthropic: true, openai: true }, () => new Response(JSON.stringify({ error: 'OPENAI_API_KEY is not set', missing: 'openai' }), { status: 503 }))
    setLiveMode(true)
    const r = await plan(SAMPLE_GOAL, undefined, 'GPT-6.1 Sol')
    expect([r.live, r.error]).toEqual([false, 'OpenAI key not set, simulated'])
  })
})
