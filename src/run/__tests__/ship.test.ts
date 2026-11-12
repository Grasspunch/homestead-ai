import { beforeEach, describe, expect, it } from 'vitest'
import { LIMITS, checkVisitor, errorReply, keepAlive, pickContext, priceOf, resetVisitors, runAgent, safeFiles, type ShipOut, type ShipWritten } from '../../agent/agents'

// A stand-in for Lovable's gateway, answering like OpenAI's chat completions.
const gateway = (answer: unknown) => {
  const calls: Record<string, unknown>[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { calls, client: { key: 'lovable-test', fetch } }
}

// A stand-in for GitHub's REST API over a one-commit repository.
const githubFake = () => {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = []
  const refs = new Set<string>()
  const prs: { head: string; html_url: string; number: number }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.github.com/repos/me/demo', '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status })
    if (method === 'GET' && path === '') return ok({ default_branch: 'main', full_name: 'me/demo' })
    if (path === '/git/ref/heads/main') return ok({ object: { sha: 'c1' } })
    if (path === '/git/commits/c1') return ok({ tree: { sha: 't1' } })
    if (path.startsWith('/git/trees/t1')) return ok({ tree: [{ path: 'README.md', type: 'blob', size: 20 }, { path: 'src/app.js', type: 'blob', size: 40 }, { path: 'node_modules/x/index.js', type: 'blob', size: 10 }] })
    if (path.startsWith('/contents/')) return ok({ content: btoa('hello') })
    if (method === 'POST' && path === '/git/trees') return ok({ sha: 't2' }, 201)
    if (method === 'POST' && path === '/git/commits') return ok({ sha: 'c2' }, 201)
    if (method === 'POST' && path === '/git/refs') {
      if (refs.has(String(body!.ref))) return ok({ message: 'Reference already exists' }, 422)
      refs.add(String(body!.ref))
      return ok({}, 201)
    }
    if (method === 'POST' && path === '/pulls') {
      if (prs.some((p) => p.head === body!.head)) return ok({ message: 'Validation Failed' }, 422)
      prs.push({ head: String(body!.head), html_url: `https://github.com/me/demo/pull/${7 + prs.length}`, number: 7 + prs.length })
      return ok(prs[prs.length - 1], 201)
    }
    if (method === 'GET' && path.startsWith('/pulls?')) return ok(prs.filter((p) => path.includes(encodeURIComponent(`me:${p.head}`))))
    return ok({ message: 'Not Found' }, 404)
  }) as unknown as typeof globalThis.fetch
  return { calls, config: { token: 'gh-test', repo: 'me/demo', fetch } }
}

const SHIP_IN = { goal: 'Add a contact form', name: 'Contact form', tasks: [{ name: 'Build the form', doneWhen: 'The form sends', farmer: 'builder' }], model: 'Claude Sonnet 5' }
const ANSWER = { title: 'Add a contact form', summary: 'Adds a form on the home page.', files: [{ path: 'src/contact.js', content: 'export const x = 1\n' }, { path: '.github/workflows/x.yml', content: 'on: push' }] }

describe('the live calls stay within a visitor’s share', () => {
  beforeEach(() => resetVisitors())

  it('allows 40 calls in 10 minutes, then says so as a 429 the browser simulates', () => {
    for (let i = 0; i < LIMITS.calls.max; i++) checkVisitor('a', 'chat', 1000)
    let err: unknown
    try {
      checkVisitor('a', 'chat', 1000)
    } catch (e) {
      err = e
    }
    expect(errorReply(err)).toMatchObject({ status: 429, body: { code: 'visitor' } })
    // Another visitor, and the same one after the window, are fine.
    expect(() => checkVisitor('b', 'chat', 1000)).not.toThrow()
    expect(() => checkVisitor('a', 'chat', 1000 + LIMITS.calls.ms)).not.toThrow()
  })

  it('allows 3 real pull requests an hour', () => {
    for (let i = 0; i < LIMITS.ship.max; i++) checkVisitor('a', 'ship', i)
    expect(() => checkVisitor('a', 'ship', 10)).toThrow(/3 real pull requests this hour/)
    expect(() => checkVisitor('a', 'chat', 10)).not.toThrow()
  })

  it('runAgent checks the visitor before calling a model', async () => {
    const g = gateway({ to: 'builder', task: null, reply: 'ok' })
    for (let i = 0; i < LIMITS.calls.max; i++) checkVisitor('v', 'route')
    await expect(runAgent({ gateway: g.client }, 'route', { message: 'hi', farmers: [], tasks: [] }, { visitor: 'v' })).rejects.toThrow(/share of live AI calls/)
    expect(g.calls).toHaveLength(0)
  })
})

describe('a live call says what it cost', () => {
  it('prices input and output apart, against Opus 5.5 at $4 and $20 a million', () => {
    expect(priceOf(1, 1_000_000, 0)).toBe(4)
    expect(priceOf(0.5, 1000, 500)).toBeCloseTo((0.5 * (1000 * 4 + 500 * 20)) / 1e6)
  })

  it('returns usd with the answer', async () => {
    const g = gateway({ to: 'builder', task: null, reply: 'ok' })
    const r = await runAgent({ gateway: g.client }, 'route', { message: 'hi', farmers: [], tasks: [] })
    // Routing runs on Haiku 4.5, a quarter of Opus 5.5.
    expect(r.usd).toBeCloseTo(priceOf(0.25, 1000, 500))
  })
})

describe('the live Builder opens a real pull request', () => {
  beforeEach(() => resetVisitors())

  it('without GitHub on the server, says what is missing', async () => {
    const g = gateway(ANSWER)
    const err = await runAgent({ gateway: g.client }, 'ship', SHIP_IN).catch((e) => e)
    expect(errorReply(err)).toMatchObject({ status: 503, body: { error: expect.stringMatching(/GITHUB_TOKEN and GITHUB_REPO/) } })
    expect(g.calls).toHaveLength(0)
  })

  it('writes the change without touching GitHub, then opens the pull request with the cost', async () => {
    const g = gateway(ANSWER)
    const gh = githubFake()
    const w = (await runAgent({ gateway: g.client }, 'ship', SHIP_IN, { github: gh.config })) as { data: ShipWritten; usd?: number }
    expect(w.data.files).toEqual(['src/contact.js'])
    expect(w.usd).toBeGreaterThan(0)
    expect(w.data.draft.usd).toBe(w.usd)
    // The Builder saw the files, not node_modules.
    const prompt = String((g.calls[0].messages as { content: string }[])[1].content)
    expect(prompt).toContain('<file path="README.md">\nhello')
    expect(prompt).not.toContain('node_modules')
    // Writing only reads.
    expect(gh.calls.every((c) => c.method === 'GET')).toBe(true)

    const r = (await runAgent({ gateway: g.client }, 'ship', { step: 'open', draft: w.data.draft, sig: w.data.sig, spent: { usd: 0.42 + w.usd!, calls: 4 } }, { github: gh.config })) as { data: ShipOut; usd?: number; tokens: number }
    expect(r.data).toMatchObject({ url: 'https://github.com/me/demo/pull/7', number: 7, files: ['src/contact.js'] })
    expect(r.data.branch).toMatch(/^homestead\/contact-form-/)
    expect(r).toMatchObject({ tokens: 0, usd: 0 })
    expect(g.calls).toHaveLength(1)
    // The workflow file never reaches the commit.
    const tree = gh.calls.find((c) => c.method === 'POST' && c.path === '/git/trees')!.body!.tree as { path: string }[]
    expect(tree.map((t) => t.path)).toEqual(['src/contact.js'])
    expect(gh.calls.find((c) => c.path === '/git/commits' && c.method === 'POST')!.body).toMatchObject({ parents: ['c1'] })
    const pr = gh.calls.find((c) => c.path === '/pulls')!.body!
    expect(pr).toMatchObject({ title: 'Add a contact form', base: 'main', head: r.data.branch })
    expect(String(pr.body)).toMatch(/across 4 calls/)
    expect(String(pr.body)).toMatch(/was simulated/)
  })

  it('opening again finds the same pull request instead of a second one', async () => {
    const g = gateway(ANSWER)
    const gh = githubFake()
    const w = (await runAgent({ gateway: g.client }, 'ship', SHIP_IN, { github: gh.config })) as { data: ShipWritten }
    const open = () => runAgent({ gateway: g.client }, 'ship', { step: 'open', draft: w.data.draft, sig: w.data.sig }, { github: gh.config }) as Promise<{ data: ShipOut }>
    const a = await open()
    const b = await open()
    expect(b.data).toMatchObject({ url: a.data.url, number: a.data.number, branch: a.data.branch })
    expect(gh.calls.filter((c) => c.method === 'POST' && c.path === '/pulls')).toHaveLength(2)
  })

  it('opens only what the Builder wrote on this server', async () => {
    const g = gateway(ANSWER)
    const gh = githubFake()
    const w = (await runAgent({ gateway: g.client }, 'ship', SHIP_IN, { github: gh.config })) as { data: ShipWritten }
    const draft = { ...w.data.draft, files: [{ path: 'src/contact.js', content: 'evil()' }] }
    await expect(runAgent({ gateway: g.client }, 'ship', { step: 'open', draft, sig: w.data.sig }, { github: gh.config })).rejects.toThrow(/wasn't written by the Builder/)
    await expect(runAgent({ gateway: g.client }, 'ship', { step: 'open', draft: w.data.draft, sig: w.data.sig }, { github: { ...gh.config, token: 'other' } })).rejects.toThrow(/wasn't written by the Builder/)
    expect(gh.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('counts writing against the visitor’s 3 an hour, not opening', async () => {
    const g = gateway(ANSWER)
    const gh = githubFake()
    const w = (await runAgent({ gateway: g.client }, 'ship', SHIP_IN, { github: gh.config, visitor: 'v' })) as { data: ShipWritten }
    for (let i = 0; i < 5; i++) await runAgent({ gateway: g.client }, 'ship', { step: 'open', draft: w.data.draft, sig: w.data.sig }, { github: gh.config, visitor: 'v' })
    await runAgent({ gateway: g.client }, 'ship', SHIP_IN, { github: gh.config, visitor: 'v' })
    await runAgent({ gateway: g.client }, 'ship', SHIP_IN, { github: gh.config, visitor: 'v' })
    await expect(runAgent({ gateway: g.client }, 'ship', SHIP_IN, { github: gh.config, visitor: 'v' })).rejects.toThrow(/3 real pull requests/)
  })

  it('opens nothing when the Builder wrote no file it may commit', async () => {
    const gh = githubFake()
    const g = gateway({ ...ANSWER, files: [{ path: '../etc/passwd', content: 'x' }] })
    await expect(runAgent({ gateway: g.client }, 'ship', SHIP_IN, { github: gh.config })).rejects.toThrow(/wrote no files/)
    expect(gh.calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

describe('a long call keeps its connection alive', () => {
  const read = async (s: ReadableStream<Uint8Array>) => {
    const chunks: string[] = []
    const r = s.getReader()
    for (;;) {
      const { done, value } = await r.read()
      if (done) return chunks
      chunks.push(new TextDecoder().decode(value))
    }
  }

  it('sends spaces while it works, then the answer, which still parses as JSON', async () => {
    const chunks = await read(keepAlive(() => new Promise((ok) => setTimeout(() => ok({ data: 1 }), 60)), 10))
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.slice(0, -1).every((c) => c === ' ')).toBe(true)
    expect(JSON.parse(chunks.join(''))).toEqual({ data: 1 })
  })

  it('puts an error’s status in the body', async () => {
    const chunks = await read(keepAlive(() => Promise.reject(new Error('GitHub answered 403'))))
    expect(JSON.parse(chunks.join(''))).toEqual({ error: 'GitHub answered 403', status: 500 })
  })
})

describe('what the Builder reads and writes', () => {
  it('reads the README and manifest first, and skips lock files and big files', () => {
    const picked = pickContext([
      { path: 'src/deep/a.ts', type: 'blob', size: 10 },
      { path: 'package.json', type: 'blob', size: 10 },
      { path: 'README.md', type: 'blob', size: 10 },
      { path: 'package-lock.json', type: 'blob', size: 10 },
      { path: 'src/big.ts', type: 'blob', size: 50_000 },
      { path: 'logo.png', type: 'blob', size: 10 },
    ])
    expect(picked).toEqual(['README.md', 'package.json', 'src/deep/a.ts'])
  })

  it('keeps plain relative paths only, once each, at most 6', () => {
    const files = safeFiles([
      { path: './a.js', content: '1' },
      { path: 'a.js', content: '2' },
      { path: '/abs.js', content: '' },
      { path: 'x/../../y', content: '' },
      { path: 'yarn.lock', content: '' },
      ...Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.js`, content: '' })),
    ])
    expect(files[0]).toEqual({ path: 'a.js', content: '1' })
    expect(files).toHaveLength(6)
  })
})
