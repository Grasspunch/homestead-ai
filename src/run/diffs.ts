// What each simulated task changes in the code: its files, a one-line plain summary of each, and the diff.
// Keys are `${template}:${task id}`. Templates: support, checkout, metrics, generic (see simPlan.ts).
//
// A diff is plain text, one line per row:
// - A new file: every line starts with '+'.
// - An edited file: hunks. Each opens with '@@ <old line> <new line>', then lines that start with
//   ' ' (kept), '-' (removed) or '+' (added).

export interface FileSpec {
  path: string
  summary: string // one plain sentence a non-engineer can read
  diff: string
}

export const FILES: Record<string, FileSpec[]> = {
  // ─── Support assistant ────────────────────────────────────────────────────────────────────────

  'support:docs-index': [
    {
      path: 'src/docs/index.ts',
      summary: 'Reads every help page and makes it searchable by its words',
      diff: `+import { readdirSync, readFileSync } from 'node:fs'
+import { join } from 'node:path'
+
+export interface Page { slug: string; title: string; body: string }
+export interface Hit { page: Page; score: number }
+
+const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []
+
+export function loadPages(dir = 'docs/help'): Page[] {
+  return readdirSync(dir)
+    .filter((name) => name.endsWith('.md'))
+    .map((name) => {
+      const body = readFileSync(join(dir, name), 'utf8')
+      const title = body.match(/^# (.+)$/m)?.[1] ?? name
+      return { slug: name.replace(/\\.md$/, ''), title, body }
+    })
+}
+
+export function buildIndex(pages: Page[]) {
+  const terms = new Map<string, Map<Page, number>>()
+  for (const page of pages) {
+    for (const w of words(page.title + ' ' + page.title + ' ' + page.body)) {
+      const counts = terms.get(w) ?? new Map<Page, number>()
+      counts.set(page, (counts.get(page) ?? 0) + 1)
+      terms.set(w, counts)
+    }
+  }
+  return {
+    size: pages.length,
+    search(query: string, limit = 3): Hit[] {
+      const scores = new Map<Page, number>()
+      for (const w of words(query)) {
+        const counts = terms.get(w)
+        if (!counts) continue
+        const idf = Math.log(1 + pages.length / counts.size)
+        for (const [page, n] of counts) {
+          scores.set(page, (scores.get(page) ?? 0) + n * idf)
+        }
+      }
+      return [...scores].map(([page, score]) => ({ page, score }))
+        .sort((a, b) => b.score - a.score)
+        .slice(0, limit)
+    },
+  }
+}`,
    },
    {
      path: 'tests/docs-index.test.ts',
      summary: 'Checks every help page can be found, including the refunds page',
      diff: `+import { describe, expect, it } from 'vitest'
+import { buildIndex, loadPages } from '../src/docs/index'
+
+const pages = loadPages()
+const index = buildIndex(pages)
+
+describe('help docs index', () => {
+  it('indexes every help doc', () => {
+    expect(pages.length).toBeGreaterThan(0)
+    expect(index.size).toBe(pages.length)
+  })
+
+  it('finds every page by its own title', () => {
+    for (const page of pages) {
+      const slugs = index.search(page.title).map((hit) => hit.page.slug)
+      expect(slugs).toContain(page.slug)
+    }
+  })
+
+  it('finds the refunds page', () => {
+    const [top] = index.search('how do I get my money back for a refund')
+    expect(top.page.slug).toBe('refunds')
+  })
+})`,
    },
  ],

  'support:answer-api': [
    {
      path: 'src/answer.ts',
      summary: 'Answers a question from the best help pages and names them',
      diff: `+import { buildIndex, loadPages, type Hit } from './docs/index'
+import { complete } from './llm'
+
+export interface Answer {
+  text: string
+  sources: { slug: string; title: string }[]
+  sure: boolean
+}
+
+const index = buildIndex(loadPages())
+const MIN_SCORE = 2.5
+
+function prompt(question: string, hits: Hit[]) {
+  const docs = hits.map((h) => '## ' + h.page.title + '\\n' + h.page.body).join('\\n\\n')
+  return [
+    'Answer the customer using only these help pages.',
+    'Name the page you used. If they do not cover it, say so.',
+    docs,
+    'Question: ' + question,
+  ].join('\\n\\n')
+}
+
+export async function answer(question: string): Promise<Answer> {
+  const hits = index.search(question)
+  if (!hits.length || hits[0].score < MIN_SCORE) {
+    return { text: '', sources: [], sure: false }
+  }
+  const text = await complete(prompt(question, hits), { maxTokens: 400 })
+  const sources = hits.map((h) => ({ slug: h.page.slug, title: h.page.title }))
+  return { text, sources, sure: true }
+}`,
    },
    {
      path: 'src/api/answer.ts',
      summary: 'Adds the web address the chat widget sends questions to',
      diff: `+import { answer } from '../answer'
+
+// POST /api/answer with { question }
+export async function POST(req: Request): Promise<Response> {
+  const body = await req.json().catch(() => null)
+  const question = typeof body?.question === 'string' ? body.question.trim() : ''
+  if (!question) {
+    return Response.json({ error: 'Ask a question first' }, { status: 400 })
+  }
+  const result = await answer(question)
+  return Response.json(result)
+}`,
    },
    {
      path: 'eval/run.ts',
      summary: 'Scores the answers on the eval questions and fails under 90%',
      diff: `+import { readFileSync } from 'node:fs'
+import { answer } from '../src/answer'
+
+interface Case { question: string; expect: string }
+
+const cases: Case[] = readFileSync('eval/questions.jsonl', 'utf8')
+  .split('\\n')
+  .filter(Boolean)
+  .map((line) => JSON.parse(line))
+
+let cited = 0
+for (const c of cases) {
+  const result = await answer(c.question)
+  const hit = result.sources.some((s) => s.slug === c.expect)
+  if (result.sure && hit) cited++
+  else console.log('miss:', c.question)
+}
+
+const rate = cited / cases.length
+console.log('cited', cited, 'of', cases.length, '=', Math.round(rate * 100) + '%')
+process.exit(rate >= 0.9 ? 0 : 1)`,
    },
  ],

  'support:handoff': [
    {
      path: 'src/handoff.ts',
      summary: 'Opens a helpdesk ticket with the whole chat attached',
      diff: `+export interface ChatMessage {
+  from: 'customer' | 'assistant'
+  text: string
+  at: string
+}
+
+export interface Ticket { id: string; queue: string; url: string }
+
+const HELPDESK_URL = process.env.HELPDESK_URL ?? 'http://localhost:4010'
+
+export async function handOff(question: string, chat: ChatMessage[]): Promise<Ticket> {
+  const res = await fetch(HELPDESK_URL + '/tickets', {
+    method: 'POST',
+    headers: { 'content-type': 'application/json' },
+    body: JSON.stringify({
+      queue: 'support',
+      subject: question.slice(0, 120),
+      transcript: chat,
+      tags: ['needs-person'],
+    }),
+  })
+  if (!res.ok) throw new Error('Helpdesk refused the ticket: ' + res.status)
+  return (await res.json()) as Ticket
+}`,
    },
    {
      path: 'src/answer.ts',
      summary: 'Sends unsure questions to a person instead of guessing',
      diff: `@@ 1 1
 import { buildIndex, loadPages, type Hit } from './docs/index'
+import { handOff, type ChatMessage, type Ticket } from './handoff'
 import { complete } from './llm'
@@ 4 5
 export interface Answer {
   text: string
   sources: { slug: string; title: string }[]
   sure: boolean
+  ticket?: Ticket
 }
@@ 23 25
-export async function answer(question: string): Promise<Answer> {
+export async function answer(
+  question: string,
+  chat: ChatMessage[] = [],
+): Promise<Answer> {
   const hits = index.search(question)
   if (!hits.length || hits[0].score < MIN_SCORE) {
-    return { text: '', sources: [], sure: false }
+    const ticket = await handOff(question, chat)
+    const text = 'I am not sure about this one, so I have passed it to our team.'
+    return { text, sources: [], sure: false, ticket }
   }`,
    },
    {
      path: 'src/api/answer.ts',
      summary: 'Passes the chat so far along with each question',
      diff: `@@ 3 3
 // POST /api/answer with { question }
+// and the chat so far, so a person can pick it up
 export async function POST(req: Request): Promise<Response> {
   const body = await req.json().catch(() => null)
   const question = typeof body?.question === 'string' ? body.question.trim() : ''
+  const chat = Array.isArray(body?.chat) ? body.chat : []
   if (!question) {
     return Response.json({ error: 'Ask a question first' }, { status: 400 })
   }
-  const result = await answer(question)
+  const result = await answer(question, chat)
   return Response.json(result)
 }`,
    },
  ],

  'support:chat-widget': [
    {
      path: 'src/widget/ChatWidget.tsx',
      summary: 'Adds the chat panel that asks a question and shows the answer',
      diff: `+import { useState } from 'react'
+import './chat-widget.css'
+
+interface Source { slug: string; title: string }
+interface Message { from: 'customer' | 'assistant'; text: string; sources?: Source[] }
+
+export function ChatWidget() {
+  const [chat, setChat] = useState<Message[]>([])
+  const [draft, setDraft] = useState('')
+  const last = chat[chat.length - 1]
+
+  async function send() {
+    const question = draft.trim()
+    if (!question) return
+    const next = [...chat, { from: 'customer' as const, text: question }]
+    setChat(next)
+    setDraft('')
+    const res = await fetch('/api/answer', {
+      method: 'POST',
+      body: JSON.stringify({ question, chat: next }),
+    })
+    const { text, sources } = await res.json()
+    setChat([...next, { from: 'assistant', text, sources }])
+  }
+
+  return (
+    <section className="chat" aria-label="Help chat">
+      <ol className="chat__log">
+        {chat.map((m, i) => <li key={i} className={'msg msg--' + m.from}>{m.text}</li>)}
+      </ol>
+      {last?.sources?.length ? (
+        <aside className="chat__sources">
+          {last.sources.map((s) => (
+            <a key={s.slug} href={'/help/' + s.slug}>{s.title}</a>
+          ))}
+        </aside>
+      ) : null}
+      <form className="chat__reply" onSubmit={(e) => { e.preventDefault(); send() }}>
+        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
+        <button>Send</button>
+      </form>
+    </section>
+  )
+}`,
    },
    {
      path: 'src/widget/chat-widget.css',
      summary: 'Styles the chat panel, the messages and the reply box',
      diff: `+.chat {
+  position: relative;
+  display: flex;
+  flex-direction: column;
+  width: 380px;
+  height: 560px;
+  font: 15px/1.45 var(--font-body);
+  background: var(--surface);
+  border-radius: 14px;
+  box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
+}
+.chat__log { flex: 1; overflow-y: auto; margin: 0; padding: 16px; list-style: none; }
+.msg { max-width: 80%; margin-bottom: 10px; padding: 8px 12px; border-radius: 12px; }
+.msg--customer { margin-left: auto; color: white; background: var(--brand); }
+.msg--assistant { background: var(--muted); }
+.chat__sources {
+  position: absolute;
+  right: 16px;
+  bottom: 12px;
+  left: 16px;
+  display: grid;
+  gap: 6px;
+}
+.chat__sources a { padding: 8px 10px; background: var(--muted); border-radius: 8px; }
+.chat__reply {
+  display: flex;
+  gap: 8px;
+  padding: 12px;
+  border-top: 1px solid var(--line);
+}
+.chat__reply input { flex: 1; padding: 8px 10px; border: 1px solid var(--line); }`,
    },
  ],

  'support:dispute-designer': [
    {
      path: 'src/widget/ChatWidget.tsx',
      summary: 'Folds the sources into one button that opens them on click',
      diff: `@@ 1 1
-import { useState } from 'react'
+import { useEffect, useState } from 'react'
 import './chat-widget.css'
@@ 9 9
   const [draft, setDraft] = useState('')
+  const [open, setOpen] = useState(false)
   const last = chat[chat.length - 1]
+  useEffect(() => setOpen(false), [last])
@@ 31 33
       {last?.sources?.length ? (
-        <aside className="chat__sources">
-          {last.sources.map((s) => (
-            <a key={s.slug} href={'/help/' + s.slug}>{s.title}</a>
-          ))}
-        </aside>
+        <div className="chat__chip">
+          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
+            Sources ({last.sources.length})
+          </button>
+          {open && (
+            <aside className="chat__sources">
+              {last.sources.map((s) => (
+                <a key={s.slug} href={'/help/' + s.slug}>{s.title}</a>
+              ))}
+            </aside>
+          )}
+        </div>
       ) : null}`,
    },
  ],

  'support:dispute-builder': [
    {
      path: 'src/widget/ChatWidget.tsx',
      summary: 'Lists the sources under the answer in smaller text',
      diff: `@@ 28 28
       <ol className="chat__log">
         {chat.map((m, i) => <li key={i} className={'msg msg--' + m.from}>{m.text}</li>)}
-      </ol>
-      {last?.sources?.length ? (
-        <aside className="chat__sources">
-          {last.sources.map((s) => (
-            <a key={s.slug} href={'/help/' + s.slug}>{s.title}</a>
-          ))}
-        </aside>
-      ) : null}
+        {last?.sources?.length ? (
+          <li className="msg__sources" style={{ fontSize: 12 }}>
+            {last.sources.map((s) => (
+              <a key={s.slug} href={'/help/' + s.slug}>{s.title}</a>
+            ))}
+          </li>
+        ) : null}
+      </ol>
       <form className="chat__reply" onSubmit={(e) => { e.preventDefault(); send() }}>`,
    },
  ],

  'support:e2e-check': [
    {
      path: 'tests/e2e/support.spec.ts',
      summary: 'Checks every done-when of the support assistant in one run',
      diff: `+import { readFileSync } from 'node:fs'
+import { expect, test } from '@playwright/test'
+import { buildIndex, loadPages } from '../../src/docs/index'
+
+const cases = readFileSync('eval/questions.jsonl', 'utf8').split('\\n').filter(Boolean)
+  .map((line) => JSON.parse(line) as { question: string; expect: string })
+
+test('every help doc is searchable, and a test finds the refunds page', () => {
+  const pages = loadPages()
+  const index = buildIndex(pages)
+  for (const p of pages) {
+    expect(index.search(p.title).map((h) => h.page.slug)).toContain(p.slug)
+  }
+  expect(index.search('refund my order')[0].page.slug).toBe('refunds')
+})
+
+test('90% of eval questions get an answer with a cited doc', async ({ request }) => {
+  let cited = 0
+  for (const c of cases) {
+    const body = await (await request.post('/api/answer', { data: c })).json()
+    const slugs: string[] = body.sources.map((s: { slug: string }) => s.slug)
+    if (body.sure && slugs.includes(c.expect)) cited++
+  }
+  expect(cited / cases.length).toBeGreaterThanOrEqual(0.9)
+})
+
+test('unsure answers go to a person with the chat attached', async ({ request }) => {
+  const chat = [{ from: 'customer', text: 'Hello', at: '2026-11-10T09:00:00Z' }]
+  const data = { question: 'Can you repaint my boat?', chat }
+  const body = await (await request.post('/api/answer', { data })).json()
+  expect(body.sure).toBe(false)
+  const ticket = await request.get('http://localhost:4010/tickets/' + body.ticket.id)
+  expect((await ticket.json()).transcript).toEqual(chat)
+})
+
+test('the widget answers with sources and a clear reply box', async ({ page }) => {
+  await page.goto('/')
+  await page.getByRole('textbox').fill('How do refunds work?')
+  await page.getByRole('button', { name: 'Send' }).click()
+  // A trial click runs every click check, including that nothing sits on top
+  await page.getByRole('textbox').click({ trial: true })
+  const chip = page.getByRole('button', { name: /Sources/ })
+  if (await chip.count()) await chip.click()
+  await expect(page.locator('a[href="/help/refunds"]')).toBeVisible()
+})`,
    },
  ],

  'support:rest': [
    {
      path: 'src/docs/index.ts',
      summary: 'Handles help pages with no heading, front matter or no text',
      diff: `@@ 7 7
 const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []
+
+// "refund-policy" becomes "Refund policy"
+const titleFrom = (slug: string) =>
+  slug.charAt(0).toUpperCase() + slug.slice(1).replace(/[-_]+/g, ' ')
+
+// Drops YAML front matter so its keys don't show up in search
+const stripFrontMatter = (text: string) => text.replace(/^---\\n[\\s\\S]*?\\n---\\n/, '')
 
 export function loadPages(dir = 'docs/help'): Page[] {
   return readdirSync(dir)
     .filter((name) => name.endsWith('.md'))
     .map((name) => {
-      const body = readFileSync(join(dir, name), 'utf8')
-      const title = body.match(/^# (.+)$/m)?.[1] ?? name
-      return { slug: name.replace(/\\.md$/, ''), title, body }
+      const slug = name.replace(/\\.md$/, '')
+      const body = stripFrontMatter(readFileSync(join(dir, name), 'utf8')).trim()
+      const title = body.match(/^# (.+)$/m)?.[1].trim() || titleFrom(slug)
+      return { slug, title, body }
     })
+    .filter((page) => page.body.length > 0)
 }`,
    },
    {
      path: 'tests/docs-index-edge.test.ts',
      summary: 'Tests untitled, empty and front-matter help pages',
      diff: `+import { mkdtempSync, writeFileSync } from 'node:fs'
+import { tmpdir } from 'node:os'
+import { join } from 'node:path'
+import { describe, expect, it } from 'vitest'
+import { buildIndex, loadPages } from '../src/docs/index'
+
+function helpDir(files: Record<string, string>) {
+  const dir = mkdtempSync(join(tmpdir(), 'help-'))
+  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
+  return dir
+}
+
+describe('help docs index, hard cases', () => {
+  it('names a page with no heading after its file', () => {
+    const [page] = loadPages(helpDir({ 'gift-cards.md': 'Gift cards never expire.' }))
+    expect(page.title).toBe('Gift cards')
+  })
+
+  it('skips empty pages', () => {
+    const pages = loadPages(helpDir({ 'empty.md': '\\n\\n', 'faq.md': '# FAQ\\nAsk us.' }))
+    expect(pages.map((p) => p.slug)).toEqual(['faq'])
+  })
+
+  it('keeps front matter out of search', () => {
+    const dir = helpDir({ 'shipping.md': '---\\nowner: ops\\n---\\n# Shipping\\nFast.' })
+    const index = buildIndex(loadPages(dir))
+    expect(index.search('owner')).toEqual([])
+    expect(index.search('shipping')[0].page.title).toBe('Shipping')
+  })
+})`,
    },
  ],

  'support:refactor': [
    {
      path: 'src/routing.ts',
      summary: 'Decides in one place whether the docs or a person answers',
      diff: `+import { buildIndex, loadPages, type Hit } from './docs/index'
+import { handOff, type ChatMessage, type Ticket } from './handoff'
+
+const index = buildIndex(loadPages())
+const MIN_SCORE = 2.5
+
+export type Route =
+  | { to: 'answer'; hits: Hit[] }
+  | { to: 'person'; ticket: Ticket }
+
+// The help docs answer when they cover the question; otherwise a person does
+export async function route(question: string, chat: ChatMessage[]): Promise<Route> {
+  const hits = index.search(question)
+  if (hits.length && hits[0].score >= MIN_SCORE) return { to: 'answer', hits }
+  return { to: 'person', ticket: await handOff(question, chat) }
+}`,
    },
    {
      path: 'src/answer.ts',
      summary: 'Answers through the new routing module instead of deciding itself',
      diff: `@@ 1 1
-import { buildIndex, loadPages, type Hit } from './docs/index'
-import { handOff, type ChatMessage, type Ticket } from './handoff'
+import type { Hit } from './docs/index'
+import type { ChatMessage, Ticket } from './handoff'
 import { complete } from './llm'
+import { route } from './routing'
@@ 10 11
 }
 
-const index = buildIndex(loadPages())
-const MIN_SCORE = 2.5
-
 function prompt(question: string, hits: Hit[]) {
@@ 25 23
 export async function answer(
   question: string,
   chat: ChatMessage[] = [],
 ): Promise<Answer> {
-  const hits = index.search(question)
-  if (!hits.length || hits[0].score < MIN_SCORE) {
-    const ticket = await handOff(question, chat)
+  const next = await route(question, chat)
+  if (next.to === 'person') {
     const text = 'I am not sure about this one, so I have passed it to our team.'
-    return { text, sources: [], sure: false, ticket }
+    return { text, sources: [], sure: false, ticket: next.ticket }
   }
+  const { hits } = next
   const text = await complete(prompt(question, hits), { maxTokens: 400 })`,
    },
  ],

  'support:rollout-fix': [
    {
      path: 'src/answer.ts',
      summary: 'Shortens long questions and hands off if an answer takes too long',
      diff: `@@ 1 1
 import type { Hit } from './docs/index'
-import type { ChatMessage, Ticket } from './handoff'
+import { handOff, type ChatMessage, type Ticket } from './handoff'
 import { complete } from './llm'
 import { route } from './routing'
+
+const MAX_WORDS = 300
+const TIMEOUT_MS = 4000
+const HANDED_OFF = 'I am not sure about this one, so I have passed it to our team.'
+
+// Keeps the start and the last sentence, where the actual question usually is
+export function shorten(question: string): string {
+  const words = question.split(/\\s+/)
+  if (words.length <= MAX_WORDS) return question
+  const last = question.trim().split(/(?<=[.?!])\\s+/).pop() ?? ''
+  return words.slice(0, MAX_WORDS - 40).join(' ') + ' … ' + last
+}
@@ 23 35
 export async function answer(
   question: string,
   chat: ChatMessage[] = [],
 ): Promise<Answer> {
-  const next = await route(question, chat)
+  const asked = shorten(question)
+  const next = await route(asked, chat)
   if (next.to === 'person') {
-    const text = 'I am not sure about this one, so I have passed it to our team.'
-    return { text, sources: [], sure: false, ticket: next.ticket }
+    return { text: HANDED_OFF, sources: [], sure: false, ticket: next.ticket }
   }
   const { hits } = next
-  const text = await complete(prompt(question, hits), { maxTokens: 400 })
+  const text = await complete(prompt(asked, hits), {
+    maxTokens: 400,
+    signal: AbortSignal.timeout(TIMEOUT_MS),
+  }).catch(() => null)
+  if (text === null) {
+    const ticket = await handOff(question, chat)
+    return { text: HANDED_OFF, sources: [], sure: false, ticket }
+  }
   const sources = hits.map((h) => ({ slug: h.page.slug, title: h.page.title }))`,
    },
    {
      path: 'tests/long-questions.test.ts',
      summary: 'Tests long questions, the timeout fallback and short questions',
      diff: `+import { beforeEach, describe, expect, it, vi } from 'vitest'
+import { answer, shorten } from '../src/answer'
+import { handOff } from '../src/handoff'
+import { complete } from '../src/llm'
+
+vi.mock('../src/llm', () => ({ complete: vi.fn() }))
+vi.mock('../src/handoff', () => ({ handOff: vi.fn(async () => ({ id: 't-1' })) }))
+
+const long = 'I bought a jacket last week. '.repeat(330) + 'How do I get a refund?'
+const chat = [{ from: 'customer' as const, text: long, at: '2026-11-10T09:00:00Z' }]
+
+describe('long questions', () => {
+  beforeEach(() => {
+    vi.mocked(complete).mockResolvedValue('Refunds start from Orders.')
+  })
+
+  it('a 2,000-word question answers in under 4 s', async () => {
+    const started = performance.now()
+    const result = await answer(long, chat)
+    expect(result.sure).toBe(true)
+    expect(performance.now() - started).toBeLessThan(4000)
+  })
+
+  it('a timeout falls back to a person', async () => {
+    vi.mocked(complete).mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
+    const result = await answer(long, chat)
+    expect(result).toMatchObject({ sure: false, ticket: { id: 't-1' } })
+  })
+
+  it('short questions are unchanged', () => {
+    expect(shorten('Where is my parcel?')).toBe('Where is my parcel?')
+  })
+
+  it('the fallback keeps the chat', async () => {
+    vi.mocked(complete).mockRejectedValue(new Error('aborted'))
+    await answer(long, chat)
+    expect(handOff).toHaveBeenCalledWith(long, chat)
+  })
+
+  it('no answer is cut mid-sentence', async () => {
+    const result = await answer(long, chat)
+    expect(result.text).toMatch(/[.?!]$/)
+  })
+})`,
    },
  ],

  // ─── Checkout ─────────────────────────────────────────────────────────────────────────────────

  'checkout:pricing-model': [
    {
      path: 'src/billing/plans.yaml',
      summary: 'Lists every plan and its monthly price in one file',
      diff: `+# Every plan and price lives here. Amounts are in cents.
+currency: usd
+yearly_discount: 0.2
+plans:
+  - id: starter
+    name: Starter
+    monthly: 900
+    seats: 1
+    features: [projects, email-support]
+  - id: team
+    name: Team
+    monthly: 2900
+    seats: 10
+    features: [projects, email-support, shared-boards, sso]
+  - id: business
+    name: Business
+    monthly: 7900
+    seats: 50
+    features: [projects, priority-support, shared-boards, sso, audit-log]`,
    },
    {
      path: 'src/billing/prices.ts',
      summary: 'Reads the plans file and works out the price for each plan',
      diff: `+import config from './plans.yaml'
+
+export type Interval = 'month' | 'year'
+
+export interface Plan {
+  id: string
+  name: string
+  monthly: number
+  seats: number
+  features: string[]
+}
+
+interface Config { currency: string; yearly_discount: number; plans: Plan[] }
+
+const { currency, yearly_discount, plans } = config as Config
+export { currency, plans }
+
+export function planById(id: string): Plan | undefined {
+  return plans.find((p) => p.id === id)
+}
+
+// Price in cents for one billing period
+export function priceFor(planId: string, interval: Interval): number {
+  const plan = planById(planId)
+  if (!plan) throw new Error('Unknown plan: ' + planId)
+  if (interval === 'month') return plan.monthly
+  return plan.monthly * 12 * (1 - yearly_discount)
+}`,
    },
    {
      path: 'tests/billing/prices.test.ts',
      summary: 'Tests each plan’s monthly and yearly price',
      diff: `+import { describe, expect, it } from 'vitest'
+import { planById, plans, priceFor } from '../../src/billing/prices'
+
+describe('plans and prices', () => {
+  it('loads every plan from the config', () => {
+    expect(plans.map((p) => p.id)).toEqual(['starter', 'team', 'business'])
+  })
+
+  it('charges the monthly price each month', () => {
+    expect(priceFor('team', 'month')).toBe(2900)
+  })
+
+  it('takes 20% off a yearly plan', () => {
+    expect(priceFor('team', 'year')).toBe(27840)
+  })
+
+  it('looks up a plan by id', () => {
+    expect(planById('business')?.seats).toBe(50)
+    expect(planById('gold')).toBeUndefined()
+  })
+
+  it('refuses an unknown plan', () => {
+    expect(() => priceFor('gold', 'month')).toThrow('Unknown plan: gold')
+  })
+})`,
    },
  ],

  'checkout:checkout-api': [
    {
      path: 'src/billing/provider.ts',
      summary: 'Connects to the payment provider and tells test mode from live',
      diff: `+import Stripe from 'stripe'
+
+const key = process.env.STRIPE_SECRET_KEY
+if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
+
+export const testMode = key.startsWith('sk_test_')
+
+export const stripe = new Stripe(key, {
+  timeout: 10_000,
+  maxNetworkRetries: 0,
+})
+
+export function assertTestMode() {
+  if (!testMode) throw new Error('Refusing to run against live payments')
+}`,
    },
    {
      path: 'src/billing/checkout.ts',
      summary: 'Charges the card for the chosen plan and returns the order',
      diff: `+import { randomUUID } from 'node:crypto'
+import { currency, planById, priceFor, type Interval } from './prices'
+import { stripe } from './provider'
+
+export interface CheckoutRequest {
+  accountId: string
+  planId: string
+  interval: Interval
+  paymentMethod: string
+  coupon?: { percentOff: number }
+}
+
+export async function checkout(req: CheckoutRequest) {
+  const plan = planById(req.planId)
+  if (!plan) return { ok: false as const, error: 'That plan no longer exists' }
+
+  let amount = priceFor(plan.id, req.interval)
+  if (req.coupon) amount = Math.round(amount * (1 - req.coupon.percentOff / 100))
+  const tax = Math.round(amount * 0.08)
+
+  const intent = await stripe.paymentIntents.create(
+    {
+      amount: amount + tax,
+      currency,
+      payment_method: req.paymentMethod,
+      confirm: true,
+      metadata: { accountId: req.accountId, planId: plan.id, interval: req.interval },
+      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
+    },
+    { idempotencyKey: randomUUID() },
+  )
+  if (intent.status !== 'succeeded') {
+    return { ok: false as const, error: 'Your card was not charged. Try another card.' }
+  }
+  return { ok: true as const, orderId: intent.id, amount: intent.amount }
+}`,
    },
    {
      path: 'tests/billing/checkout.test.ts',
      summary: 'Buys a plan with a test card and checks a declined card fails',
      diff: `+import { describe, expect, it } from 'vitest'
+import { checkout } from '../../src/billing/checkout'
+import { testMode } from '../../src/billing/provider'
+
+const order = { accountId: 'acct_test_1', planId: 'team', interval: 'month' as const }
+
+describe('checkout in test mode', () => {
+  it('runs against test keys only', () => {
+    expect(testMode).toBe(true)
+  })
+
+  it('completes a purchase with a test card', async () => {
+    const result = await checkout({ ...order, paymentMethod: 'pm_card_visa' })
+    // Team is 29.00 a month, plus 8% tax
+    expect(result).toMatchObject({ ok: true, amount: 3132 })
+  })
+
+  it('does not complete a declined card', async () => {
+    const declined = checkout({ ...order, paymentMethod: 'pm_card_chargeDeclined' })
+    await expect(declined).rejects.toMatchObject({ code: 'card_declined' })
+  })
+})`,
    },
  ],

  'checkout:webhooks': [
    {
      path: 'src/billing/accounts.ts',
      summary: 'Saves an account’s billing status, plan and paid-through date',
      diff: `+import { db } from '../db'
+
+export type BillingStatus = 'active' | 'past_due' | 'refunded'
+
+export async function setBilling(
+  accountId: string,
+  change: { status: BillingStatus; planId?: string; paidThrough?: Date },
+) {
+  await db
+    .updateTable('accounts')
+    .set({
+      billing_status: change.status,
+      ...(change.planId && { plan_id: change.planId }),
+      ...(change.paidThrough && { paid_through: change.paidThrough }),
+      updated_at: new Date(),
+    })
+    .where('id', '=', accountId)
+    .execute()
+}`,
    },
    {
      path: 'src/billing/webhooks.ts',
      summary: 'Updates the account when a payment succeeds, fails or is refunded',
      diff: `+import type Stripe from 'stripe'
+import { setBilling } from './accounts'
+import { stripe } from './provider'
+
+const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
+
+function paidThrough(interval: string): Date {
+  const d = new Date()
+  if (interval === 'year') d.setFullYear(d.getFullYear() + 1)
+  else d.setMonth(d.getMonth() + 1)
+  return d
+}
+
+export async function handleWebhook(raw: string, signature: string) {
+  // Throws on a bad signature, so a forged event never touches an account
+  const event = stripe.webhooks.constructEvent(raw, signature, secret)
+  switch (event.type) {
+    case 'payment_intent.succeeded': {
+      const { accountId, planId, interval } = event.data.object.metadata
+      await setBilling(accountId, {
+        status: 'active',
+        planId,
+        paidThrough: paidThrough(interval),
+      })
+      break
+    }
+    case 'payment_intent.payment_failed': {
+      await setBilling(event.data.object.metadata.accountId, { status: 'past_due' })
+      break
+    }
+    case 'charge.refunded': {
+      const charge = event.data.object as Stripe.Charge
+      if (charge.amount_refunded === charge.amount) {
+        await setBilling(charge.metadata.accountId, { status: 'refunded' })
+      }
+      break
+    }
+  }
+  return { received: true, type: event.type }
+}`,
    },
    {
      path: 'tests/billing/webhooks.test.ts',
      summary: 'Tests that paid, failed and refunded events update the account',
      diff: `+import { beforeEach, describe, expect, it, vi } from 'vitest'
+import { setBilling } from '../../src/billing/accounts'
+import { stripe } from '../../src/billing/provider'
+import { handleWebhook } from '../../src/billing/webhooks'
+
+vi.mock('../../src/billing/accounts', () => ({ setBilling: vi.fn() }))
+
+const metadata = { accountId: 'acct_1', planId: 'team', interval: 'month' }
+
+function send(type: string, object: object) {
+  const event = { type, data: { object } } as never
+  vi.spyOn(stripe.webhooks, 'constructEvent').mockReturnValue(event)
+  return handleWebhook('{}', 'sig')
+}
+
+describe('payment webhooks', () => {
+  beforeEach(() => vi.mocked(setBilling).mockClear())
+
+  it('marks the account active when paid', async () => {
+    await send('payment_intent.succeeded', { metadata })
+    const [id, change] = vi.mocked(setBilling).mock.calls[0]
+    expect(id).toBe('acct_1')
+    expect(change).toMatchObject({ status: 'active', planId: 'team' })
+  })
+
+  it('marks the account past due when a payment fails', async () => {
+    await send('payment_intent.payment_failed', { metadata })
+    expect(setBilling).toHaveBeenCalledWith('acct_1', { status: 'past_due' })
+  })
+
+  it('marks a fully refunded account as refunded', async () => {
+    await send('charge.refunded', { amount: 2900, amount_refunded: 2900, metadata })
+    expect(setBilling).toHaveBeenCalledWith('acct_1', { status: 'refunded' })
+  })
+
+  it('leaves a partly refunded account active', async () => {
+    await send('charge.refunded', { amount: 2900, amount_refunded: 900, metadata })
+    expect(setBilling).not.toHaveBeenCalled()
+  })
+})`,
    },
  ],

  'checkout:checkout-ui': [
    {
      path: 'src/checkout/CheckoutForm.tsx',
      summary: 'Adds the checkout form with the card field, errors and pay button',
      diff: `+import { useState } from 'react'
+import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
+import { planById, priceFor, type Interval } from '../billing/prices'
+import { CookieNotice } from './CookieNotice'
+import './checkout.css'
+
+const money = (cents: number) => '$' + (cents / 100).toFixed(2)
+const post = (body: object) =>
+  fetch('/api/checkout', { method: 'POST', body: JSON.stringify(body) })
+    .then((r) => r.json())
+
+interface Props { planId: string; interval: Interval }
+
+export function CheckoutForm({ planId, interval }: Props) {
+  const stripe = useStripe()
+  const elements = useElements()
+  const [error, setError] = useState<string | null>(null)
+  const [paying, setPaying] = useState(false)
+  const plan = planById(planId)!
+  const total = Math.round(priceFor(planId, interval) * 1.08)
+
+  async function pay(e: React.FormEvent) {
+    e.preventDefault()
+    if (!stripe || !elements) return
+    setPaying(true)
+    const card = elements.getElement(CardElement)!
+    const made = await stripe.createPaymentMethod({ type: 'card', card })
+    const res = made.error
+      ? { ok: false, error: made.error.message ?? 'Check your card details' }
+      : await post({ planId, interval, paymentMethod: made.paymentMethod.id })
+    setPaying(false)
+    if (res.ok) window.location.assign('/thanks?order=' + res.orderId)
+    else setError(res.error)
+  }
+
+  return (
+    <form className="checkout" onSubmit={pay}>
+      <h1>{plan.name}, {money(total)} a {interval}</h1>
+      <CardElement className="checkout__card" />
+      {error && <p className="checkout__error" role="alert">{error}</p>}
+      <button className="checkout__pay" disabled={paying}>Pay {money(total)}</button>
+      <CookieNotice />
+    </form>
+  )
+}`,
    },
    {
      path: 'src/checkout/checkout.css',
      summary: 'Styles the checkout form, its errors and the pay button',
      diff: `+.checkout {
+  display: grid;
+  gap: 16px;
+  max-width: 440px;
+  margin: 48px auto;
+  padding: 24px;
+  font: 16px/1.5 var(--font-body);
+}
+.checkout h1 { margin: 0; font-size: 22px; }
+.checkout__card {
+  padding: 12px;
+  border: 1px solid var(--line);
+  border-radius: 8px;
+}
+.checkout__error {
+  margin: 0;
+  padding: 10px 12px;
+  color: var(--danger-ink);
+  background: var(--danger-bg);
+  border-radius: 8px;
+}
+.checkout__pay {
+  height: 48px;
+  font-weight: 600;
+  color: white;
+  background: var(--brand);
+  border: 0;
+  border-radius: 8px;
+}
+.checkout__pay:disabled { opacity: 0.6; }
+.checkout .cookie-notice {
+  position: sticky;
+  bottom: 0;
+  padding: 16px;
+  background: var(--surface);
+  box-shadow: 0 -4px 16px rgb(0 0 0 / 0.12);
+}`,
    },
  ],

  'checkout:dispute-designer': [
    {
      path: 'src/checkout/CheckoutForm.tsx',
      summary: 'Asks about cookies on the cart page, so checkout stays clear',
      diff: `@@ 1 1
-import { useState } from 'react'
+import { useEffect, useState } from 'react'
 import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
 import { planById, priceFor, type Interval } from '../billing/prices'
-import { CookieNotice } from './CookieNotice'
+import { cookieChoiceMade } from './CookieNotice'
 import './checkout.css'
@@ 20 20
   const total = Math.round(priceFor(planId, interval) * 1.08)
+
+  // Cookies are asked once on the cart page, so nothing covers the pay button here
+  useEffect(() => {
+    if (!cookieChoiceMade()) window.location.assign('/cart?ask=cookies')
+  }, [])
 
   async function pay(e: React.FormEvent) {
@@ 41 46
       <button className="checkout__pay" disabled={paying}>Pay {money(total)}</button>
-      <CookieNotice />
     </form>`,
    },
  ],

  'checkout:dispute-builder': [
    {
      path: 'src/checkout/CheckoutForm.tsx',
      summary: 'Shows the cookie notice as a slim strip above the form',
      diff: `@@ 4 4
-import { CookieNotice } from './CookieNotice'
+import { CookieNotice, cookieChoiceMade } from './CookieNotice'
 import './checkout.css'
@@ 18 18
   const [paying, setPaying] = useState(false)
+  const [askCookies, setAskCookies] = useState(!cookieChoiceMade())
   const plan = planById(planId)!
@@ 37 38
     <form className="checkout" onSubmit={pay}>
+      {askCookies && (
+        <CookieNotice variant="strip" onChoose={() => setAskCookies(false)} />
+      )}
       <h1>{plan.name}, {money(total)} a {interval}</h1>
@@ 41 45
       <button className="checkout__pay" disabled={paying}>Pay {money(total)}</button>
-      <CookieNotice />
     </form>`,
    },
  ],

  'checkout:e2e-check': [
    {
      path: 'tests/billing/checkout.e2e.spec.ts',
      summary: 'Checks every done-when of checkout in one run',
      diff: `+import { expect, test, type Page } from '@playwright/test'
+import { plans, priceFor } from '../../src/billing/prices'
+import { stripe } from '../../src/billing/provider'
+
+const secret = process.env.STRIPE_WEBHOOK_SECRET!
+const metadata = { accountId: 'acct_e2e', planId: 'team', interval: 'month' }
+
+async function pay(page: Page, card: string) {
+  await page.goto('/checkout?plan=team&interval=month')
+  const field = page.frameLocator('iframe[title="Secure card payment input frame"]')
+  await field.getByPlaceholder('Card number').fill(card)
+  await field.getByPlaceholder('MM / YY').fill('12 / 34')
+  await field.getByPlaceholder('CVC').fill('123')
+  await page.getByRole('button', { name: /^Pay/ }).click()
+}
+
+test('plans and prices load from one config', () => {
+  expect(plans.map((p) => p.id)).toEqual(['starter', 'team', 'business'])
+  for (const p of plans) expect(priceFor(p.id, 'month')).toBe(p.monthly)
+})
+
+test('a test card completes a purchase in test mode', async ({ page }) => {
+  await pay(page, '4242 4242 4242 4242')
+  await expect(page).toHaveURL(/\\/thanks\\?order=pi_/)
+})
+
+test('paid, failed and refunded events update the account', async ({ request }) => {
+  const object = { amount: 3132, amount_refunded: 3132, metadata }
+  const statusAfter = { 'payment_intent.succeeded': 'active',
+    'payment_intent.payment_failed': 'past_due', 'charge.refunded': 'refunded' }
+  for (const [type, status] of Object.entries(statusAfter)) {
+    const payload = JSON.stringify({ id: 'evt_' + status, type, data: { object } })
+    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret })
+    const headers = { 'stripe-signature': signature }
+    await request.post('/api/billing/webhooks', { data: payload, headers })
+    const account = await (await request.get('/api/accounts/acct_e2e')).json()
+    expect(account.billing_status, type).toBe(status)
+  }
+})
+
+test('checkout shows clear errors and keeps the pay button clear', async ({ page }) => {
+  await pay(page, '4000 0000 0000 0002')
+  await expect(page.getByRole('alert')).toHaveText(/declined/i)
+  await page.getByRole('button', { name: /^Pay/ }).click({ trial: true })
+})`,
    },
  ],

  'checkout:rest': [
    {
      path: 'src/billing/prices.ts',
      summary: 'Rounds yearly prices to whole cents and refuses broken prices',
      diff: `@@ 18 18
 export function planById(id: string): Plan | undefined {
-  return plans.find((p) => p.id === id)
+  const wanted = id.trim().toLowerCase()
+  return plans.find((p) => p.id === wanted)
 }
@@ 22 23
 // Price in cents for one billing period
 export function priceFor(planId: string, interval: Interval): number {
   const plan = planById(planId)
   if (!plan) throw new Error('Unknown plan: ' + planId)
+  if (!Number.isInteger(plan.monthly) || plan.monthly < 0) {
+    throw new Error('Plan ' + planId + ' needs a whole, non-negative monthly price')
+  }
   if (interval === 'month') return plan.monthly
-  return plan.monthly * 12 * (1 - yearly_discount)
+  // Whole cents only: 15% off 19.99 a month is 20389.8 cents a year otherwise
+  return Math.round(plan.monthly * 12 * (1 - yearly_discount))
 }`,
    },
    {
      path: 'tests/billing/prices-edge.test.ts',
      summary: 'Tests free plans, odd discounts and badly written plan ids',
      diff: `+import { describe, expect, it, vi } from 'vitest'
+import { planById, priceFor } from '../../src/billing/prices'
+
+vi.mock('../../src/billing/plans.yaml', () => ({
+  default: {
+    currency: 'usd',
+    yearly_discount: 0.15,
+    plans: [
+      { id: 'free', name: 'Free', monthly: 0, seats: 1, features: [] },
+      { id: 'plus', name: 'Plus', monthly: 1999, seats: 3, features: [] },
+      { id: 'broken', name: 'Broken', monthly: 12.5, seats: 1, features: [] },
+    ],
+  },
+}))
+
+describe('prices, hard cases', () => {
+  it('charges nothing for the free plan, monthly or yearly', () => {
+    expect(priceFor('free', 'month')).toBe(0)
+    expect(priceFor('free', 'year')).toBe(0)
+  })
+
+  it('rounds a yearly discount to whole cents', () => {
+    expect(priceFor('plus', 'year')).toBe(20390)
+  })
+
+  it('finds a plan whatever the case or spacing', () => {
+    expect(planById(' Plus ')?.id).toBe('plus')
+  })
+
+  it('refuses a price that is not whole cents', () => {
+    expect(() => priceFor('broken', 'month')).toThrow(/whole, non-negative/)
+  })
+})`,
    },
  ],

  'checkout:refactor': [
    {
      path: 'src/billing/prices.ts',
      summary: 'Works out discount, tax and total in one place',
      diff: `@@ 26 26
   if (interval === 'month') return plan.monthly
   return plan.monthly * 12 * (1 - yearly_discount)
 }
+
+export const TAX_RATE = 0.08
+
+export type Total = Record<'subtotal' | 'discount' | 'tax' | 'total', number>
+
+// Everything a buyer pays, in cents. Checkout, the form and receipts all use this.
+export function totalFor(planId: string, interval: Interval, percentOff = 0): Total {
+  const subtotal = priceFor(planId, interval)
+  const discount = Math.round(subtotal * (percentOff / 100))
+  const tax = Math.round((subtotal - discount) * TAX_RATE)
+  return { subtotal, discount, tax, total: subtotal - discount + tax }
+}`,
    },
    {
      path: 'src/billing/checkout.ts',
      summary: 'Charges the total from the pricing module instead of its own math',
      diff: `@@ 1 1
 import { randomUUID } from 'node:crypto'
-import { currency, planById, priceFor, type Interval } from './prices'
+import { currency, planById, totalFor, type Interval } from './prices'
 import { stripe } from './provider'
@@ 16 16
 
-  let amount = priceFor(plan.id, req.interval)
-  if (req.coupon) amount = Math.round(amount * (1 - req.coupon.percentOff / 100))
-  const tax = Math.round(amount * 0.08)
+  const { total } = totalFor(plan.id, req.interval, req.coupon?.percentOff)
 
   const intent = await stripe.paymentIntents.create(
     {
-      amount: amount + tax,
+      amount: total,
       currency,`,
    },
    {
      path: 'src/checkout/CheckoutForm.tsx',
      summary: 'Shows the same total and tax that checkout charges',
      diff: `@@ 3 3
-import { planById, priceFor, type Interval } from '../billing/prices'
+import { planById, totalFor, type Interval } from '../billing/prices'
 import { CookieNotice } from './CookieNotice'
@@ 19 19
   const plan = planById(planId)!
-  const total = Math.round(priceFor(planId, interval) * 1.08)
+  const { total, tax } = totalFor(planId, interval)
 
@@ 38 38
       <h1>{plan.name}, {money(total)} a {interval}</h1>
+      <p className="checkout__tax">Includes {money(tax)} tax</p>
       <CardElement className="checkout__card" />`,
    },
  ],

  'checkout:rollout-fix': [
    {
      path: 'src/billing/checkout.ts',
      summary: 'Waits for a slow payment provider and makes a retry charge once',
      diff: `@@ 1 1
-import { randomUUID } from 'node:crypto'
+import Stripe from 'stripe'
 import { currency, planById, totalFor, type Interval } from './prices'
 import { stripe } from './provider'
@@ 17 17
   const { total } = totalFor(plan.id, req.interval, req.coupon?.percentOff)
+  // Same buyer, plan and card is the same charge, so a retry never charges twice
+  const idempotencyKey =
+    ['checkout', req.accountId, plan.id, req.interval, req.paymentMethod].join(':')
 
-  const intent = await stripe.paymentIntents.create(
-    {
-      amount: total,
-      currency,
-      payment_method: req.paymentMethod,
-      confirm: true,
-      metadata: { accountId: req.accountId, planId: plan.id, interval: req.interval },
-      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
-    },
-    { idempotencyKey: randomUUID() },
-  )
+  let intent: Stripe.PaymentIntent
+  try {
+    intent = await stripe.paymentIntents.create(
+      {
+        amount: total,
+        currency,
+        payment_method: req.paymentMethod,
+        confirm: true,
+        metadata: { accountId: req.accountId, planId: plan.id, interval: req.interval },
+        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
+      },
+      // Wait for a slow provider instead of giving up at 10 s; retries reuse the key
+      { idempotencyKey, timeout: 45_000, maxNetworkRetries: 2 },
+    )
+  } catch (err) {
+    if (err instanceof Stripe.errors.StripeCardError) {
+      return { ok: false as const, error: 'Your card was declined. Try another card.' }
+    }
+    throw err
+  }
   if (intent.status !== 'succeeded') {`,
    },
    {
      path: 'tests/billing/slow-provider.test.ts',
      summary: 'Tests slow payments, retries, declines, timeouts and refunds',
      diff: `+import Stripe from 'stripe'
+import { beforeEach, describe, expect, it, vi } from 'vitest'
+import { setBilling } from '../../src/billing/accounts'
+import { checkout } from '../../src/billing/checkout'
+import { stripe } from '../../src/billing/provider'
+import { handleWebhook } from '../../src/billing/webhooks'
+vi.mock('../../src/billing/accounts', () => ({ setBilling: vi.fn() }))
+const order = { accountId: 'acct_1', planId: 'team', interval: 'month' as const }
+const buy = () => checkout({ ...order, paymentMethod: 'pm_card_visa' })
+const paid = { id: 'pi_1', status: 'succeeded', amount: 3132 } as never
+const create = vi.spyOn(stripe.paymentIntents, 'create')
+
+describe('slow payment provider', () => {
+  beforeEach(() => create.mockReset().mockResolvedValue(paid))
+
+  it('a slow provider answer still completes the order', async () => {
+    expect(await buy()).toMatchObject({ ok: true, orderId: 'pi_1' })
+    expect(create.mock.calls[0][1]).toMatchObject({ timeout: 45_000 })
+  })
+
+  it('a retried payment charges once', async () => {
+    await buy().then(buy)
+    const keys = create.mock.calls.map((call) => call[1]?.idempotencyKey)
+    expect(new Set(keys).size).toBe(1)
+  })
+
+  it('a declined card shows a clear error', async () => {
+    create.mockRejectedValue(new Stripe.errors.StripeCardError({ type: 'card_error' }))
+    expect(await buy()).toMatchObject({ error: expect.stringMatching(/declined/) })
+  })
+
+  it('a timeout leaves no half-paid order', async () => {
+    create.mockRejectedValue(new Stripe.errors.StripeConnectionError({}))
+    await expect(buy()).rejects.toThrow()
+    expect(setBilling).not.toHaveBeenCalled()
+  })
+
+  it('refunds still post to the account', async () => {
+    const object = { amount: 3132, amount_refunded: 3132, metadata: order }
+    const event = { type: 'charge.refunded', data: { object } } as never
+    vi.spyOn(stripe.webhooks, 'constructEvent').mockReturnValue(event)
+    await handleWebhook('{}', 'sig')
+    expect(setBilling).toHaveBeenCalledWith('acct_1', { status: 'refunded' })
+  })
+})`,
    },
  ],

  // ─── Metrics dashboard ────────────────────────────────────────────────────────────────────────

  'metrics:metrics-query': [
    {
      path: 'src/metrics/queries.ts',
      summary: 'Counts signups, active users and revenue for each day',
      diff: `+import { sql } from '../db'
+
+export type MetricName = 'signups' | 'activeUsers' | 'revenue'
+export interface Range { accountId: number; from: string; to: string }
+export interface DayValue { day: string; value: number }
+
+// What each metric counts per day, as a SQL expression over events
+const VALUE: Record<MetricName, string> = {
+  signups: "count(*) filter (where name = 'signup')",
+  activeUsers: 'count(distinct user_id)',
+  revenue: "coalesce(sum(amount_cents) filter (where name = 'payment'), 0)",
+}
+
+export async function daily(metric: MetricName, range: Range): Promise<DayValue[]> {
+  return sql<DayValue[]>\`
+    select date_trunc('day', created_at)::date::text as day,
+           \${sql.unsafe(VALUE[metric])}::int as value
+    from events
+    where account_id = \${range.accountId}
+      and created_at >= \${range.from} and created_at < \${range.to}
+    group by 1
+    order by 1\`
+}
+
+export function weekOverWeek(days: DayValue[]): number | null {
+  const sum = (xs: DayValue[]) => xs.reduce((n, d) => n + d.value, 0)
+  const thisWeek = sum(days.slice(-7))
+  const lastWeek = sum(days.slice(-14, -7))
+  return lastWeek === 0 ? null : (thisWeek - lastWeek) / lastWeek
+}`,
    },
    {
      path: 'tests/metrics/sample.sql',
      summary: 'Adds a small sample account whose numbers can be counted by hand',
      diff: `+-- A small account with hand-countable numbers, used by tests/metrics/queries.test.ts
+insert into accounts (id, name) values (1, 'Sample Co');
+
+insert into events (account_id, user_id, name, amount_cents, created_at) values
+  (1, 101, 'signup',  null, '2026-03-01 09:00Z'),
+  (1, 102, 'signup',  null, '2026-03-01 10:30Z'),
+  (1, 103, 'signup',  null, '2026-03-01 14:00Z'),
+  (1, 101, 'payment', 2900, '2026-03-01 15:10Z'),
+  (1, 104, 'login',   null, '2026-03-01 18:45Z'),
+  (1, 101, 'login',   null, '2026-03-02 08:00Z'),
+  (1, 105, 'signup',  null, '2026-03-02 12:20Z'),
+  (1, 101, 'login',   null, '2026-03-03 07:55Z'),
+  (1, 102, 'login',   null, '2026-03-03 09:05Z'),
+  (1, 106, 'signup',  null, '2026-03-03 11:00Z'),
+  (1, 107, 'signup',  null, '2026-03-03 11:30Z'),
+  (1, 103, 'payment', 7900, '2026-03-03 16:40Z');`,
    },
    {
      path: 'tests/metrics/queries.test.ts',
      summary: 'Checks each metric against a count done by hand',
      diff: `+import { beforeAll, describe, expect, it } from 'vitest'
+import { sql } from '../../src/db'
+import { daily, weekOverWeek } from '../../src/metrics/queries'
+
+const range = { accountId: 1, from: '2026-03-01', to: '2026-03-04' }
+const values = async (name: Parameters<typeof daily>[0]) =>
+  (await daily(name, range)).map((d) => d.value)
+
+// Counted by hand from tests/metrics/sample.sql
+describe('metric queries against hand counts', () => {
+  beforeAll(() => sql.file('tests/metrics/sample.sql'))
+
+  it('counts signups per day', async () => {
+    expect(await daily('signups', range)).toEqual([
+      { day: '2026-03-01', value: 3 },
+      { day: '2026-03-02', value: 1 },
+      { day: '2026-03-03', value: 2 },
+    ])
+  })
+
+  it('counts each active user once a day', async () => {
+    expect(await values('activeUsers')).toEqual([4, 2, 5])
+  })
+
+  it('adds up revenue in cents', async () => {
+    expect(await values('revenue')).toEqual([2900, 0, 7900])
+  })
+
+  it('compares this week with last week', () => {
+    const value = (i: number) => (i < 7 ? 10 : 15)
+    const days = Array.from({ length: 14 }, (_, i) => ({ day: '', value: value(i) }))
+    expect(weekOverWeek(days)).toBeCloseTo(0.5)
+  })
+})`,
    },
  ],

  'metrics:metrics-api': [
    {
      path: 'src/metrics/api.ts',
      summary: 'Returns every metric for an account in one fast request',
      diff: `+import { daily, weekOverWeek, type MetricName } from './queries'
+
+const METRICS: MetricName[] = ['signups', 'activeUsers', 'revenue']
+const DAY = 86_400_000
+
+export interface MetricOut {
+  name: MetricName
+  total: number
+  change: number | null
+  days: { day: string; value: number }[]
+}
+
+// GET /api/metrics?account=1&days=28
+export async function GET(req: Request): Promise<Response> {
+  const url = new URL(req.url)
+  const accountId = Number(url.searchParams.get('account'))
+  const span = Math.min(Number(url.searchParams.get('days') ?? 28), 90)
+  if (!Number.isInteger(accountId) || accountId <= 0) {
+    return Response.json({ error: 'account must be a positive id' }, { status: 400 })
+  }
+  const to = new Date().toISOString().slice(0, 10)
+  const from = new Date(Date.now() - span * DAY).toISOString().slice(0, 10)
+  const range = { accountId, from, to }
+
+  // Run the metrics side by side; the slowest one sets the response time
+  const metrics: MetricOut[] = await Promise.all(
+    METRICS.map(async (name) => {
+      const days = await daily(name, range)
+      const total = days.reduce((n, d) => n + d.value, 0)
+      return { name, total, change: weekOverWeek(days), days }
+    }),
+  )
+  return Response.json({ from, to, metrics }, {
+    headers: { 'cache-control': 'private, max-age=0' },
+  })
+}`,
    },
    {
      path: 'db/schema.sql',
      summary: 'Adds indexes so each metric reads only one account’s days',
      diff: `@@ 9 9
 create table events (
   id bigserial primary key,
   account_id bigint not null references accounts (id),
   user_id bigint not null,
   name text not null,
   amount_cents integer,
   created_at timestamptz not null default now()
 );
+
+-- The dashboard reads one account's events by day. These keep each metric to an
+-- index scan instead of reading the whole table.
+create index events_account_day on events (account_id, created_at);
+create index events_account_name_day on events (account_id, name, created_at)
+  include (user_id, amount_cents);`,
    },
    {
      path: 'tests/metrics/api.test.ts',
      summary: 'Tests the API returns every metric in under 300 ms',
      diff: `+import { beforeAll, describe, expect, it } from 'vitest'
+import { sql } from '../../src/db'
+import { GET } from '../../src/metrics/api'
+
+const get = (query: string) => GET(new Request('http://test/api/metrics?' + query))
+
+describe('metrics API', () => {
+  beforeAll(() => sql.file('tests/metrics/sample.sql'))
+
+  it('returns every metric', async () => {
+    const body = await (await get('account=1&days=28')).json()
+    expect(body.metrics.map((m: { name: string }) => m.name))
+      .toEqual(['signups', 'activeUsers', 'revenue'])
+  })
+
+  it('answers in under 300 ms', async () => {
+    const started = performance.now()
+    await get('account=1&days=90')
+    expect(performance.now() - started).toBeLessThan(300)
+  })
+
+  it('refuses a missing account', async () => {
+    expect((await get('days=7')).status).toBe(400)
+  })
+})`,
    },
  ],

  'metrics:dashboard-ui': [
    {
      path: 'src/dashboard/Dashboard.tsx',
      summary: 'Adds the dashboard with a chart and total for each metric',
      diff: `+import { useEffect, useState } from 'react'
+import type { MetricOut } from '../metrics/api'
+import { LineChart } from './LineChart'
+import './dashboard.css'
+
+const LABEL = { signups: 'Signups', activeUsers: 'Active users', revenue: 'Revenue' }
+
+const money = (cents: number) => '$' + Math.round(cents / 100).toLocaleString()
+const total = (m: MetricOut) =>
+  m.name === 'revenue' ? money(m.total) : m.total.toLocaleString()
+const change = (c: number | null) =>
+  c === null ? 'new' : (c > 0 ? '+' : '') + Math.round(c * 100) + '%'
+
+export function Dashboard({ accountId }: { accountId: number }) {
+  const [metrics, setMetrics] = useState<MetricOut[] | null>(null)
+
+  useEffect(() => {
+    fetch('/api/metrics?account=' + accountId + '&days=28')
+      .then((res) => res.json())
+      .then((body) => setMetrics(body.metrics))
+  }, [accountId])
+
+  if (!metrics) return <p className="board__loading">Loading metrics…</p>
+
+  return (
+    <main className="board">
+      <div className="board__charts">
+        {metrics.map((m) => (
+          <figure key={m.name} className="chart">
+            <figcaption>{LABEL[m.name]}, last 28 days</figcaption>
+            <p className="chart__total">{total(m)}</p>
+            <LineChart points={m.days} />
+          </figure>
+        ))}
+      </div>
+      <ul className="board__legend">
+        {metrics.map((m) => (
+          <li key={m.name}>{LABEL[m.name]} {change(m.change)} vs last week</li>
+        ))}
+      </ul>
+    </main>
+  )
+}`,
    },
    {
      path: 'src/dashboard/dashboard.css',
      summary: 'Lays out the charts in a grid with the weekly changes on top',
      diff: `+.board {
+  position: relative;
+  display: grid;
+  gap: 24px;
+  padding: 24px;
+  font: 14px/1.4 var(--font-body);
+}
+.board__charts {
+  display: grid;
+  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
+  gap: 16px;
+}
+.chart {
+  margin: 0;
+  padding: 16px;
+  background: var(--surface);
+  border: 1px solid var(--line);
+  border-radius: 12px;
+}
+.chart figcaption { color: var(--ink-muted); font-size: 13px; }
+.chart__total { margin: 4px 0 12px; font-size: 28px; font-weight: 600; }
+.board__legend {
+  position: absolute;
+  top: 40px;
+  left: 40px;
+  margin: 0;
+  padding: 10px 14px;
+  list-style: none;
+  background: var(--surface);
+  border-radius: 10px;
+  box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
+}
+.board__legend li + li { margin-top: 4px; }`,
    },
  ],

  'metrics:dispute-designer': [
    {
      path: 'src/dashboard/Dashboard.tsx',
      summary: 'Moves the weekly changes into a row under the charts',
      diff: `@@ 35 35
       </div>
-      <ul className="board__legend">
+      <ul
+        className="board__changes"
+        aria-label="Change since last week"
+        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}
+      >
         {metrics.map((m) => (
-          <li key={m.name}>{LABEL[m.name]} {change(m.change)} vs last week</li>
+          <li key={m.name} data-trend={(m.change ?? 0) < 0 ? 'down' : 'up'}>
+            <span>{LABEL[m.name]}</span> <strong>{change(m.change)}</strong>
+          </li>
         ))}
       </ul>`,
    },
  ],

  'metrics:dispute-builder': [
    {
      path: 'src/dashboard/Dashboard.tsx',
      summary: 'Shows the weekly changes only while the charts are hovered',
      diff: `@@ 15 15
   const [metrics, setMetrics] = useState<MetricOut[] | null>(null)
+  const [hovered, setHovered] = useState(false)
 
@@ 26 27
     <main className="board">
-      <div className="board__charts">
+      <div
+        className="board__charts"
+        onMouseEnter={() => setHovered(true)}
+        onMouseLeave={() => setHovered(false)}
+      >
         {metrics.map((m) => (
@@ 35 40
       </div>
-      <ul className="board__legend">
+      <ul className="board__legend" hidden={!hovered}>
         {metrics.map((m) => (`,
    },
  ],

  'metrics:e2e-check': [
    {
      path: 'tests/metrics/dashboard.e2e.spec.ts',
      summary: 'Checks every done-when of the dashboard in one run',
      diff: `+import { expect, test } from '@playwright/test'
+import { daily, type MetricName } from '../../src/metrics/queries'
+
+const range = { accountId: 1, from: '2026-03-01', to: '2026-03-04' }
+// Counted by hand from tests/metrics/sample.sql
+const HAND: Record<MetricName, number[]> = {
+  signups: [3, 1, 2],
+  activeUsers: [4, 2, 5],
+  revenue: [2900, 0, 7900],
+}
+
+test('each metric matches a hand count on sample data', async () => {
+  for (const [name, counts] of Object.entries(HAND)) {
+    const days = await daily(name as MetricName, range)
+    expect(days.map((d) => d.value), name).toEqual(counts)
+  }
+})
+
+test('the API returns every metric in under 300 ms', async ({ request }) => {
+  const started = Date.now()
+  const res = await request.get('/api/metrics?account=1&days=90')
+  expect(Date.now() - started).toBeLessThan(300)
+  const { metrics } = await res.json()
+  expect(metrics.map((m: { name: string }) => m.name)).toEqual(Object.keys(HAND))
+})
+
+test('charts read clearly at a glance', async ({ page }) => {
+  await page.goto('/dashboard?account=1')
+  const charts = page.locator('figure.chart')
+  await expect(charts).toHaveCount(3)
+  for (const chart of await charts.all()) {
+    await expect(chart.locator('figcaption')).not.toBeEmpty()
+    await expect(chart.locator('.chart__total')).not.toBeEmpty()
+    // A trial click runs every click check, including that nothing sits on top
+    await chart.click({ trial: true })
+  }
+})`,
    },
  ],

  'metrics:rest': [
    {
      path: 'src/metrics/queries.ts',
      summary: 'Shows a zero for quiet days and counts days in the account’s timezone',
      diff: `@@ 14 14
 export async function daily(metric: MetricName, range: Range): Promise<DayValue[]> {
+  // Every day in the range gets a row, even with no events, and days follow the
+  // account's own timezone rather than the server's
   return sql<DayValue[]>\`
-    select date_trunc('day', created_at)::date::text as day,
-           \${sql.unsafe(VALUE[metric])}::int as value
-    from events
-    where account_id = \${range.accountId}
-      and created_at >= \${range.from} and created_at < \${range.to}
-    group by 1
+    with tz as (select timezone from accounts where id = \${range.accountId})
+    select d.day::date::text as day,
+           coalesce(\${sql.unsafe(VALUE[metric])}, 0)::int as value
+    from tz, generate_series(\${range.from}::date, \${range.to}::date - 1, '1 day')
+      as d(day)
+    left join events e
+      on e.account_id = \${range.accountId}
+      and (e.created_at at time zone tz.timezone)::date = d.day
+    group by d.day
     order by 1\`
 }`,
    },
    {
      path: 'tests/metrics/empty-days.test.ts',
      summary: 'Tests quiet days, timezones and week-over-week with gaps',
      diff: `+import { beforeAll, describe, expect, it } from 'vitest'
+import { sql } from '../../src/db'
+import { daily, weekOverWeek } from '../../src/metrics/queries'
+
+describe('metric queries, hard cases', () => {
+  beforeAll(async () => {
+    await sql.file('tests/metrics/sample.sql')
+    await sql\`insert into accounts (id, name, timezone)
+      values (2, 'Late Co', 'America/Los_Angeles')\`
+    await sql\`insert into events (account_id, user_id, name, created_at)
+      values (2, 201, 'signup', '2026-03-02 06:30Z')\`
+  })
+
+  it('shows a zero for a day with no events', async () => {
+    const range = { accountId: 1, from: '2026-03-01', to: '2026-03-06' }
+    const days = await daily('signups', range)
+    expect(days.map((d) => d.value)).toEqual([3, 1, 2, 0, 0])
+  })
+
+  it('counts an event on the day it was in the account timezone', async () => {
+    // 06:30 UTC on 2 March is still 1 March in Los Angeles
+    const range = { accountId: 2, from: '2026-03-01', to: '2026-03-03' }
+    const days = await daily('signups', range)
+    expect(days.map((d) => d.value)).toEqual([1, 0])
+  })
+
+  it('compares whole weeks even when days are empty', async () => {
+    const range = { accountId: 1, from: '2026-02-23', to: '2026-03-09' }
+    const days = await daily('signups', range)
+    expect(days).toHaveLength(14)
+    // 3 signups in the week to 1 March, 3 in the week after
+    expect(weekOverWeek(days)).toBe(0)
+  })
+})`,
    },
  ],

  'metrics:refactor': [
    {
      path: 'src/metrics/layer.ts',
      summary: 'Defines every metric and how it is counted in one shared place',
      diff: `+import { sql } from '../db'
+
+export type MetricName = 'signups' | 'activeUsers' | 'revenue'
+export interface Range { accountId: number; from: string; to: string }
+export interface DayValue { day: string; value: number }
+export interface Summary {
+  name: MetricName
+  total: number
+  change: number | null
+  days: DayValue[]
+}
+
+// Each metric is defined once here; the API, the queries and the tests all read it
+export const METRICS: Record<MetricName, string> = {
+  signups: "count(*) filter (where name = 'signup')",
+  activeUsers: 'count(distinct user_id)',
+  revenue: "coalesce(sum(amount_cents) filter (where name = 'payment'), 0)",
+}
+
+export function daily(metric: MetricName, range: Range): Promise<DayValue[]> {
+  return sql<DayValue[]>\`
+    with tz as (select timezone from accounts where id = \${range.accountId})
+    select d.day::date::text as day,
+           coalesce(\${sql.unsafe(METRICS[metric])}, 0)::int as value
+    from tz, generate_series(\${range.from}::date, \${range.to}::date - 1, '1 day')
+      as d(day)
+    left join events e
+      on e.account_id = \${range.accountId}
+      and (e.created_at at time zone tz.timezone)::date = d.day
+    group by d.day
+    order by 1\`
+}
+
+export function weekOverWeek(days: DayValue[]): number | null {
+  const sum = (xs: DayValue[]) => xs.reduce((n, d) => n + d.value, 0)
+  const thisWeek = sum(days.slice(-7))
+  const lastWeek = sum(days.slice(-14, -7))
+  return lastWeek === 0 ? null : (thisWeek - lastWeek) / lastWeek
+}
+
+export async function summarize(name: MetricName, range: Range): Promise<Summary> {
+  const days = await daily(name, range)
+  const total = days.reduce((n, d) => n + d.value, 0)
+  return { name, total, change: weekOverWeek(days), days }
+}`,
    },
    {
      path: 'src/metrics/queries.ts',
      summary: 'Now just points older imports at the shared metrics layer',
      diff: `@@ 1 1
-import { sql } from '../db'
-
-export type MetricName = 'signups' | 'activeUsers' | 'revenue'
-export interface Range { accountId: number; from: string; to: string }
-export interface DayValue { day: string; value: number }
-
-// What each metric counts per day, as a SQL expression over events
-const VALUE: Record<MetricName, string> = {
-  signups: "count(*) filter (where name = 'signup')",
-  activeUsers: 'count(distinct user_id)',
-  revenue: "coalesce(sum(amount_cents) filter (where name = 'payment'), 0)",
-}
-
-export async function daily(metric: MetricName, range: Range): Promise<DayValue[]> {
-  // Every day in the range gets a row, even with no events, and days follow the
-  // account's own timezone rather than the server's
-  return sql<DayValue[]>\`
-    with tz as (select timezone from accounts where id = \${range.accountId})
-    select d.day::date::text as day,
-           coalesce(\${sql.unsafe(VALUE[metric])}, 0)::int as value
-    from tz, generate_series(\${range.from}::date, \${range.to}::date - 1, '1 day')
-      as d(day)
-    left join events e
-      on e.account_id = \${range.accountId}
-      and (e.created_at at time zone tz.timezone)::date = d.day
-    group by d.day
-    order by 1\`
-}
-
-export function weekOverWeek(days: DayValue[]): number | null {
-  const sum = (xs: DayValue[]) => xs.reduce((n, d) => n + d.value, 0)
-  const thisWeek = sum(days.slice(-7))
-  const lastWeek = sum(days.slice(-14, -7))
-  return lastWeek === 0 ? null : (thisWeek - lastWeek) / lastWeek
-}
+// Kept so older imports still work; the metrics now live in layer.ts
+export { daily, weekOverWeek } from './layer'
+export type { DayValue, MetricName, Range } from './layer'`,
    },
    {
      path: 'src/metrics/api.ts',
      summary: 'Reads every metric through the shared layer',
      diff: `@@ 1 1
-import { daily, weekOverWeek, type MetricName } from './queries'
+import { METRICS, summarize, type MetricName, type Summary } from './layer'
 
-const METRICS: MetricName[] = ['signups', 'activeUsers', 'revenue']
+const NAMES = Object.keys(METRICS) as MetricName[]
 const DAY = 86_400_000
 
-export interface MetricOut {
-  name: MetricName
-  total: number
-  change: number | null
-  days: { day: string; value: number }[]
-}
+export type MetricOut = Summary
 
@@ 25 20
   // Run the metrics side by side; the slowest one sets the response time
-  const metrics: MetricOut[] = await Promise.all(
-    METRICS.map(async (name) => {
-      const days = await daily(name, range)
-      const total = days.reduce((n, d) => n + d.value, 0)
-      return { name, total, change: weekOverWeek(days), days }
-    }),
-  )
+  const metrics = await Promise.all(NAMES.map((name) => summarize(name, range)))
   return Response.json({ from, to, metrics }, {`,
    },
  ],

  'metrics:rollout-fix': [
    {
      path: 'src/metrics/pages.ts',
      summary: 'Splits a long date range into two-week pages',
      diff: `+import type { Range } from './layer'
+
+const DAY_MS = 86_400_000
+// Fourteen days per query keeps each page on the index, even on the largest accounts
+export const PAGE_DAYS = 14
+
+const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
+
+// Back-to-back pages: each day lands in exactly one of them
+export function pages(range: Range): Range[] {
+  const end = Date.parse(range.to)
+  const out: Range[] = []
+  for (let at = Date.parse(range.from); at < end; at += PAGE_DAYS * DAY_MS) {
+    const to = Math.min(at + PAGE_DAYS * DAY_MS, end)
+    out.push({ ...range, from: isoDay(at), to: isoDay(to) })
+  }
+  return out
+}`,
    },
    {
      path: 'src/metrics/layer.ts',
      summary: 'Keeps each metric for a minute and reads big ranges page by page',
      diff: `@@ 1 1
 import { sql } from '../db'
+import { pages } from './pages'
@@ 18 19
 }
+
+const TTL_MS = 60_000
+const SLOW_MS = 250
+const cache = new Map<string, { at: number; value: Summary }>()
 
-export function daily(metric: MetricName, range: Range): Promise<DayValue[]> {
+function dailyPage(metric: MetricName, range: Range): Promise<DayValue[]> {
   return sql<DayValue[]>\`
@@ 32 37
 }
+
+export async function daily(metric: MetricName, range: Range): Promise<DayValue[]> {
+  const all = await Promise.all(pages(range).map((page) => dailyPage(metric, page)))
+  return all.flat()
+}
 
@@ 41 51
-export async function summarize(name: MetricName, range: Range): Promise<Summary> {
+async function compute(name: MetricName, range: Range): Promise<Summary> {
   const days = await daily(name, range)
   const total = days.reduce((n, d) => n + d.value, 0)
   return { name, total, change: weekOverWeek(days), days }
 }
+
+export async function summarize(name: MetricName, range: Range): Promise<Summary> {
+  const key = [name, range.accountId, range.from, range.to].join(':')
+  const hit = cache.get(key)
+  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
+  const fresh = compute(name, range).then((value) => {
+    cache.set(key, { at: Date.now(), value })
+    return value
+  })
+  if (!hit) return fresh
+  // A slow query answers with the last value and refreshes in the background
+  const stale = new Promise<Summary>((done) => {
+    setTimeout(() => done(hit.value), SLOW_MS)
+  })
+  return Promise.race([fresh, stale])
+}`,
    },
    {
      path: 'tests/metrics/large-account.test.ts',
      summary: 'Tests the largest account, the cache, paging and empty accounts',
      diff: `+import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
+import { sql } from '../../src/db'
+import { daily, summarize } from '../../src/metrics/layer'
+
+const big = { accountId: 9, from: '2026-01-01', to: '2026-03-31' } // two million events
+const names = ['signups', 'activeUsers', 'revenue'] as const
+
+describe('large accounts', () => {
+  beforeAll(() => sql.file('tests/metrics/seed-large.sql'))
+  afterEach(() => vi.useRealTimers())
+
+  it('the largest account loads in under 300 ms', async () => {
+    const started = performance.now()
+    await Promise.all(names.map((name) => summarize(name, big)))
+    expect(performance.now() - started).toBeLessThan(300)
+  })
+
+  it('a cached metric refreshes after a minute', async () => {
+    vi.useFakeTimers({ toFake: ['Date'] })
+    const first = await summarize('signups', big)
+    expect(await summarize('signups', big)).toBe(first)
+    vi.advanceTimersByTime(61_000)
+    expect(await summarize('signups', big)).not.toBe(first)
+  })
+
+  it('paging returns every row once', async () => {
+    const days = (await daily('signups', big)).map((d) => d.day)
+    expect([days.length, new Set(days).size]).toEqual([89, 89])
+  })
+
+  it('an empty account shows zeroes', async () => {
+    await sql\`insert into accounts (id, name) values (10, 'Quiet Co')\`
+    const quiet = await summarize('revenue', { ...big, accountId: 10 })
+    expect(quiet.days.every((d) => d.value === 0)).toBe(true)
+  })
+
+  it('a slow query falls back to the cache', async () => {
+    vi.useFakeTimers({ toFake: ['Date'] })
+    const cached = await summarize('activeUsers', big)
+    vi.advanceTimersByTime(61_000)
+    const locked = sql.begin((tx) => [tx\`lock table events\`, tx\`select pg_sleep(1)\`])
+    expect(await summarize('activeUsers', big)).toBe(cached)
+    await locked
+  })
+})`,
    },
  ],

  // ─── Generic (an items app) ───────────────────────────────────────────────────────────────────

  'generic:core': [
    {
      path: 'src/items.ts',
      summary: 'Adds items, lists them and marks them done',
      diff: `+export interface Item {
+  id: string
+  title: string
+  done: boolean
+  createdAt: string
+}
+
+export interface ItemStore {
+  all(): Promise<Item[]>
+  get(id: string): Promise<Item | undefined>
+  put(item: Item): Promise<void>
+}
+
+export function memoryStore(): ItemStore {
+  const items = new Map<string, Item>()
+  return {
+    all: async () => [...items.values()],
+    get: async (id) => items.get(id),
+    put: async (item) => void items.set(item.id, item),
+  }
+}
+
+export function createItems(store: ItemStore) {
+  return {
+    list: () => store.all(),
+    async add(title: string): Promise<Item> {
+      const item: Item = {
+        id: crypto.randomUUID(),
+        title,
+        done: false,
+        createdAt: new Date().toISOString(),
+      }
+      await store.put(item)
+      return item
+    },
+    async complete(id: string): Promise<Item> {
+      const item = await store.get(id)
+      if (!item) throw new Error('No item with id ' + id)
+      const done = { ...item, done: true }
+      await store.put(done)
+      return done
+    },
+  }
+}`,
    },
    {
      path: 'src/app.ts',
      summary: 'Adds the web addresses the screens use to list, add and finish items',
      diff: `+import { createItems, type ItemStore } from './items'
+
+export function createApp(store: ItemStore) {
+  const items = createItems(store)
+  return async function handle(req: Request): Promise<Response> {
+    const url = new URL(req.url)
+    if (req.method === 'GET' && url.pathname === '/api/items') {
+      return Response.json(await items.list())
+    }
+    if (req.method === 'POST' && url.pathname === '/api/items') {
+      const { title } = await req.json()
+      return Response.json(await items.add(title), { status: 201 })
+    }
+    const done = url.pathname.match(/^\\/api\\/items\\/([\\w-]+)\\/done$/)
+    if (req.method === 'POST' && done) {
+      return Response.json(await items.complete(done[1]))
+    }
+    return new Response('Not found', { status: 404 })
+  }
+}`,
    },
    {
      path: 'tests/flow.test.ts',
      summary: 'Tests adding an item, listing it and marking it done',
      diff: `+import { describe, expect, it } from 'vitest'
+import { createApp } from '../src/app'
+import { memoryStore } from '../src/items'
+
+type App = ReturnType<typeof createApp>
+const call = (app: App, method: string, path: string, body?: object) =>
+  app(new Request('http://test' + path, { method, body: body && JSON.stringify(body) }))
+
+describe('main flow', () => {
+  it('adds an item, lists it and marks it done', async () => {
+    const app = createApp(memoryStore())
+    const title = 'Call the plumber'
+    const added = await (await call(app, 'POST', '/api/items', { title })).json()
+    expect(added).toMatchObject({ title, done: false })
+
+    const list = await (await call(app, 'GET', '/api/items')).json()
+    expect(list).toHaveLength(1)
+
+    const res = await call(app, 'POST', '/api/items/' + added.id + '/done')
+    expect((await res.json()).done).toBe(true)
+  })
+
+  it('answers 404 for an unknown path', async () => {
+    const res = await call(createApp(memoryStore()), 'GET', '/api/nope')
+    expect(res.status).toBe(404)
+  })
+})`,
    },
  ],

  'generic:data': [
    {
      path: 'src/db.ts',
      summary: 'Saves items to a database file so they survive a restart',
      diff: `+import Database from 'better-sqlite3'
+import { readdirSync, readFileSync } from 'node:fs'
+import { join } from 'node:path'
+import type { Item, ItemStore } from './items'
+
+const MIGRATIONS = join(import.meta.dirname, 'migrations')
+
+interface Row { id: string; title: string; done: 0 | 1; created_at: string }
+
+const toItem = (r: Row): Item => ({
+  id: r.id,
+  title: r.title,
+  done: r.done === 1,
+  createdAt: r.created_at,
+})
+
+export function migrate(db: Database.Database) {
+  db.exec('create table if not exists migrations (name text primary key)')
+  const ran = db.prepare('select name from migrations').pluck().all() as string[]
+  for (const name of readdirSync(MIGRATIONS).sort()) {
+    if (ran.includes(name)) continue
+    db.transaction(() => {
+      db.exec(readFileSync(join(MIGRATIONS, name), 'utf8'))
+      db.prepare('insert into migrations (name) values (?)').run(name)
+    })()
+  }
+}
+
+export function sqliteStore(file: string): ItemStore {
+  const db = new Database(file)
+  migrate(db)
+  const all = db.prepare<[], Row>('select * from items order by created_at')
+  const one = db.prepare<[string], Row>('select * from items where id = ?')
+  const save = db.prepare(
+    'insert or replace into items (id, title, done, created_at) values (?, ?, ?, ?)',
+  )
+  return {
+    all: async () => all.all().map(toItem),
+    get: async (id) => {
+      const r = one.get(id)
+      return r && toItem(r)
+    },
+    put: async (i) => void save.run(i.id, i.title, i.done ? 1 : 0, i.createdAt),
+  }
+}`,
    },
    {
      path: 'src/migrations/001_create_items.sql',
      summary: 'Creates the items table the first time the app starts',
      diff: `+-- 001: the items table
+-- Titles are 1 to 200 characters; done is 0 or 1.
+create table items (
+  id text primary key,
+  title text not null check (length(title) between 1 and 200),
+  done integer not null default 0 check (done in (0, 1)),
+  created_at text not null
+);
+
+create index items_created_at on items (created_at);
+
+-- Most screens show open items first
+create index items_open on items (created_at) where done = 0;`,
    },
    {
      path: 'tests/data.test.ts',
      summary: 'Tests that items survive a restart and migrations run once',
      diff: `+import { mkdtempSync } from 'node:fs'
+import { tmpdir } from 'node:os'
+import { join } from 'node:path'
+import Database from 'better-sqlite3'
+import { describe, expect, it } from 'vitest'
+import { migrate, sqliteStore } from '../src/db'
+import { createItems } from '../src/items'
+
+const tempFile = () => join(mkdtempSync(join(tmpdir(), 'items-')), 'items.db')
+
+describe('stored data', () => {
+  it('keeps items after a restart', async () => {
+    const file = tempFile()
+    const before = createItems(sqliteStore(file))
+    const item = await before.add('Renew the lease')
+    await before.complete(item.id)
+
+    // A fresh store on the same file is what the app sees after a restart
+    const after = createItems(sqliteStore(file))
+    expect(await after.list()).toEqual([{ ...item, done: true }])
+  })
+
+  it('runs each migration once', () => {
+    const db = new Database(tempFile())
+    migrate(db)
+    migrate(db)
+    const names = db.prepare('select name from migrations').pluck().all()
+    expect(names).toEqual(['001_create_items.sql'])
+  })
+})`,
    },
  ],

  'generic:screens': [
    {
      path: 'src/ui/ItemsScreen.tsx',
      summary: 'Adds the main screen with the item list and the Add item button',
      diff: `+import { useEffect, useState } from 'react'
+import type { Item } from '../items'
+import { Notice } from './Notice'
+import './items.css'
+
+export function ItemsScreen() {
+  const [items, setItems] = useState<Item[]>([])
+  const [title, setTitle] = useState('')
+  const [error, setError] = useState('')
+
+  useEffect(() => {
+    fetch('/api/items').then((r) => r.json()).then(setItems)
+  }, [])
+
+  async function add(e: React.FormEvent) {
+    e.preventDefault()
+    if (!title.trim()) return setError('Give the item a name first')
+    const body = JSON.stringify({ title })
+    const res = await fetch('/api/items', { method: 'POST', body })
+    if (!res.ok) return setError('That did not save. Try again.')
+    setItems([...items, await res.json()])
+    setTitle('')
+    setError('')
+  }
+
+  return (
+    <main className="items">
+      <h1>Items</h1>
+      {items.length === 0 && (
+        <p className="items__empty">No items yet. Add your first one below.</p>
+      )}
+      <ul className="items__list">
+        {items.map((item) => (
+          <li key={item.id} className={item.done ? 'is-done' : ''}>{item.title}</li>
+        ))}
+      </ul>
+      <form className="items__add" onSubmit={add}>
+        <input value={title} onChange={(e) => setTitle(e.target.value)} />
+        {error && <p role="alert">{error}</p>}
+        <button className="items__main">Add item</button>
+      </form>
+      <Notice />
+    </main>
+  )
+}`,
    },
    {
      path: 'src/ui/items.css',
      summary: 'Styles the list, the add form and the main button',
      diff: `+.items {
+  max-width: 520px;
+  margin: 0 auto;
+  padding: 24px 16px 96px;
+  font: 16px/1.5 var(--font-body);
+}
+.items__empty { color: var(--ink-muted); }
+.items__list { margin: 0 0 24px; padding: 0; list-style: none; }
+.items__list li { padding: 10px 0; border-bottom: 1px solid var(--line); }
+.items__list li.is-done { color: var(--ink-muted); text-decoration: line-through; }
+.items__add { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
+.items__add input {
+  padding: 10px 12px;
+  border: 1px solid var(--line);
+  border-radius: 8px;
+}
+.items__add [role='alert'] { grid-column: 1 / -1; margin: 0; color: var(--danger-ink); }
+.items__main {
+  padding: 0 20px;
+  font-weight: 600;
+  color: white;
+  background: var(--brand);
+  border: 0;
+  border-radius: 8px;
+}
+.items .notice {
+  position: fixed;
+  inset: auto 0 0;
+  padding: 16px 24px 24px;
+  background: var(--surface);
+  box-shadow: 0 -4px 16px rgb(0 0 0 / 0.12);
+}`,
    },
  ],

  'generic:dispute-designer': [
    {
      path: 'src/ui/ItemsScreen.tsx',
      summary: 'Asks the notice once on the page before, so this screen stays clear',
      diff: `@@ 1 1
 import { useEffect, useState } from 'react'
 import type { Item } from '../items'
-import { Notice } from './Notice'
+import { noticeAnswered } from './Notice'
 import './items.css'
@@ 11 11
   useEffect(() => {
+    // The notice is asked once on the welcome page, so nothing covers Add item here
+    if (!noticeAnswered()) {
+      window.location.assign('/welcome?next=/items')
+      return
+    }
     fetch('/api/items').then((r) => r.json()).then(setItems)
   }, [])
@@ 41 46
       </form>
-      <Notice />
     </main>`,
    },
  ],

  'generic:dispute-builder': [
    {
      path: 'src/ui/ItemsScreen.tsx',
      summary: 'Shows the notice as a slim strip above the form',
      diff: `@@ 3 3
-import { Notice } from './Notice'
+import { Notice, noticeAnswered } from './Notice'
 import './items.css'
@@ 9 9
   const [error, setError] = useState('')
+  const [noticeOpen, setNoticeOpen] = useState(!noticeAnswered())
 
@@ 27 28
     <main className="items">
+      {noticeOpen && (
+        <Notice variant="strip" onAnswer={() => setNoticeOpen(false)} />
+      )}
       <h1>Items</h1>
@@ 41 45
       </form>
-      <Notice />
     </main>`,
    },
  ],

  'generic:e2e-check': [
    {
      path: 'tests/e2e.spec.ts',
      summary: 'Checks every done-when of the app in one run',
      diff: `+import { mkdtempSync } from 'node:fs'
+import { tmpdir } from 'node:os'
+import { join } from 'node:path'
+import Database from 'better-sqlite3'
+import { expect, test } from '@playwright/test'
+import { sqliteStore } from '../src/db'
+import { createItems } from '../src/items'
+
+test('the main flow works end to end', async ({ page }) => {
+  await page.goto('/items')
+  await page.getByRole('textbox').fill('Book the venue')
+  await page.getByRole('button', { name: 'Add item' }).click()
+  await expect(page.getByRole('listitem').filter({ hasText: 'Book the venue' }))
+    .toBeVisible()
+})
+
+test('data survives a restart, with a migration test', async () => {
+  const file = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'items.db')
+  const item = await createItems(sqliteStore(file)).add('Send the invoice')
+  // A second store on the same file is a restart
+  const after = await createItems(sqliteStore(file)).list()
+  expect(after.map((i) => i.id)).toContain(item.id)
+  const ran = new Database(file).prepare('select name from migrations').pluck().all()
+  expect(ran).toEqual(['001_create_items.sql'])
+})
+
+test('every screen works, with nothing covering its main button', async ({ page }) => {
+  for (const width of [375, 1280]) {
+    await page.setViewportSize({ width, height: 640 })
+    await page.goto('/items')
+    await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible()
+    // A trial click runs every click check, including that nothing sits on top
+    await page.getByRole('button', { name: 'Add item' }).click({ trial: true })
+  }
+})`,
    },
  ],

  'generic:rest': [
    {
      path: 'src/items.ts',
      summary: 'Refuses blank or overlong titles and makes finishing twice safe',
      diff: `@@ 21 21
 }
+
+export const MAX_TITLE = 200
+
+export class ItemError extends Error {}
 
 export function createItems(store: ItemStore) {
   return {
     list: () => store.all(),
     async add(title: string): Promise<Item> {
+      const clean = title.replace(/\\s+/g, ' ').trim()
+      if (!clean) throw new ItemError('An item needs a title')
+      if (clean.length > MAX_TITLE) {
+        throw new ItemError('Keep the title to ' + MAX_TITLE + ' characters')
+      }
       const item: Item = {
         id: crypto.randomUUID(),
-        title,
+        title: clean,
         done: false,
@@ 37 46
       const item = await store.get(id)
-      if (!item) throw new Error('No item with id ' + id)
+      if (!item) throw new ItemError('No item with id ' + id)
+      // Finishing twice is fine and changes nothing
+      if (item.done) return item
       const done = { ...item, done: true }`,
    },
    {
      path: 'tests/items-edge.test.ts',
      summary: 'Tests blank, messy and overlong titles and finishing twice',
      diff: `+import { describe, expect, it } from 'vitest'
+import { createItems, ItemError, MAX_TITLE, memoryStore } from '../src/items'
+
+const fresh = () => createItems(memoryStore())
+
+describe('items, hard cases', () => {
+  it('refuses an empty or blank title', async () => {
+    await expect(fresh().add('')).rejects.toThrow(ItemError)
+    await expect(fresh().add('   \\n ')).rejects.toThrow('An item needs a title')
+  })
+
+  it('tidies spaces in a title', async () => {
+    expect((await fresh().add('  Pay   the  rent ')).title).toBe('Pay the rent')
+  })
+
+  it('refuses a title over the limit', async () => {
+    await expect(fresh().add('x'.repeat(MAX_TITLE + 1))).rejects.toThrow(ItemError)
+  })
+
+  it('finishing twice changes nothing', async () => {
+    const items = fresh()
+    const item = await items.add('Pay the rent')
+    const first = await items.complete(item.id)
+    expect(await items.complete(item.id)).toEqual(first)
+  })
+
+  it('says which id it could not find', async () => {
+    await expect(fresh().complete('missing')).rejects.toThrow('No item with id missing')
+  })
+})`,
    },
  ],

  'generic:refactor': [
    {
      path: 'src/store.ts',
      summary: 'Puts the shared storage code in one module',
      diff: `+import type { Item } from './items'
+
+// How an item is stored, and the one place that turns a stored row into an item
+export interface ItemStore {
+  all(): Promise<Item[]>
+  get(id: string): Promise<Item | undefined>
+  put(item: Item): Promise<void>
+}
+
+export interface Row { id: string; title: string; done: 0 | 1; created_at: string }
+
+export const toItem = (r: Row): Item => ({
+  id: r.id,
+  title: r.title,
+  done: r.done === 1,
+  createdAt: r.created_at,
+})
+
+export const toRow = (i: Item): Row => ({
+  id: i.id,
+  title: i.title,
+  done: i.done ? 1 : 0,
+  created_at: i.createdAt,
+})
+
+export function memoryStore(): ItemStore {
+  const items = new Map<string, Item>()
+  return {
+    all: async () => [...items.values()],
+    get: async (id) => items.get(id),
+    put: async (item) => void items.set(item.id, item),
+  }
+}`,
    },
    {
      path: 'src/items.ts',
      summary: 'Uses the shared storage module instead of its own copy',
      diff: `@@ 1 1
+import type { ItemStore } from './store'
+
+export { memoryStore, type ItemStore } from './store'
+
 export interface Item {
@@ 7 11
 
-export interface ItemStore {
-  all(): Promise<Item[]>
-  get(id: string): Promise<Item | undefined>
-  put(item: Item): Promise<void>
-}
-
-export function memoryStore(): ItemStore {
-  const items = new Map<string, Item>()
-  return {
-    all: async () => [...items.values()],
-    get: async (id) => items.get(id),
-    put: async (item) => void items.set(item.id, item),
-  }
-}
-
 export function createItems(store: ItemStore) {`,
    },
    {
      path: 'src/db.ts',
      summary: 'Uses the shared code to turn stored rows into items and back',
      diff: `@@ 1 1
 import Database from 'better-sqlite3'
 import { readdirSync, readFileSync } from 'node:fs'
 import { join } from 'node:path'
-import type { Item, ItemStore } from './items'
+import { toItem, toRow, type ItemStore, type Row } from './store'
 
 const MIGRATIONS = join(import.meta.dirname, 'migrations')
 
-interface Row { id: string; title: string; done: 0 | 1; created_at: string }
-
-const toItem = (r: Row): Item => ({
-  id: r.id,
-  title: r.title,
-  done: r.done === 1,
-  createdAt: r.created_at,
-})
-
 export function migrate(db: Database.Database) {
@@ 34 25
   const save = db.prepare(
-    'insert or replace into items (id, title, done, created_at) values (?, ?, ?, ?)',
+    'insert or replace into items (id, title, done, created_at) ' +
+      'values (@id, @title, @done, @created_at)',
   )
@@ 43 35
-    put: async (i) => void save.run(i.id, i.title, i.done ? 1 : 0, i.createdAt),
+    put: async (item) => void save.run(toRow(item)),
   }`,
    },
  ],

  'generic:rollout-fix': [
    {
      path: 'src/app.ts',
      summary: 'Answers busy requests within a second instead of leaving them hanging',
      diff: `@@ 1 1
 import { createItems, type ItemStore } from './items'
+
+const TIMEOUT_MS = 1000
+
+const busy = () =>
+  new Response('Busy, try again', { status: 503, headers: { 'retry-after': '1' } })
+
+// Under load, answers 503 with a retry hint instead of leaving the request hanging
+function withTimeout(work: Promise<Response>): Promise<Response> {
+  const late = new Promise<Response>((done) => {
+    setTimeout(() => done(busy()), TIMEOUT_MS)
+  })
+  return Promise.race([work, late])
+}
 
 export function createApp(store: ItemStore) {
   const items = createItems(store)
-  return async function handle(req: Request): Promise<Response> {
+  return (req: Request) => withTimeout(handle(req))
+
+  async function handle(req: Request): Promise<Response> {
     const url = new URL(req.url)`,
    },
    {
      path: 'src/db.ts',
      summary: 'Reads the item list in pages so a long list can’t hold up the server',
      diff: `@@ 4 4
+import type { Item } from './items'
 import { toItem, toRow, type ItemStore, type Row } from './store'
 
 const MIGRATIONS = join(import.meta.dirname, 'migrations')
+// Rows read per step when listing items
+const PAGE_SIZE = 500
@@ 23 26
-  const all = db.prepare<[], Row>('select * from items order by created_at')
+  // Keyset paging: each step walks the created_at index for one page, then lets
+  // other requests run, so a long list never holds up the server
+  const page = db.prepare<[string, string, number], Row>(
+    'select * from items where (created_at, id) > (?, ?) ' +
+      'order by created_at, id limit ?',
+  )
   const one = db.prepare<[string], Row>('select * from items where id = ?')
@@ 30 38
-    all: async () => all.all().map(toItem),
+    all: async () => {
+      const out: Item[] = []
+      for (let rows = page.all('', '', PAGE_SIZE); rows.length; ) {
+        out.push(...rows.map(toItem))
+        const last = rows[rows.length - 1]
+        await new Promise((next) => setImmediate(next))
+        rows = page.all(last.created_at, last.id, PAGE_SIZE)
+      }
+      return out
+    },`,
    },
    {
      path: 'tests/load.test.ts',
      summary: 'Tests a busy minute, the timeout, paging, restarts and an empty list',
      diff: `+import { mkdtempSync } from 'node:fs'
+import { createElement } from 'react'
+import { render, screen } from '@testing-library/react'
+import { describe, expect, it, vi } from 'vitest'
+import { createApp } from '../src/app'
+import { sqliteStore } from '../src/db'
+import { ItemsScreen } from '../src/ui/ItemsScreen'
+
+const file = mkdtempSync('/tmp/load-') + '/items.db'
+const app = createApp(sqliteStore(file))
+const ITEMS = 'http://test/api/items'
+const list = (a = app) => a(new Request(ITEMS)).then((r) => r.json())
+const add = (title: string) =>
+  app(new Request(ITEMS, { method: 'POST', body: JSON.stringify({ title }) }))
+
+describe('under load', () => {
+  it('a busy minute answers in under 1 s', async () => {
+    await Promise.all(Array.from({ length: 2000 }, (_, i) => add('Item ' + i)))
+    const started = performance.now()
+    await Promise.all(Array.from({ length: 50 }, () => list()))
+    expect(performance.now() - started).toBeLessThan(1000)
+  })
+
+  it('a timeout falls back cleanly', async () => {
+    const never = () => new Promise<never>(() => {})
+    const stuck = createApp({ all: never, get: never, put: never })
+    expect((await stuck(new Request(ITEMS))).status).toBe(503)
+  })
+
+  it('paging returns every row once', async () => {
+    const ids = (await list()).map((item: { id: string }) => item.id)
+    expect([ids.length, new Set(ids).size]).toEqual([2000, 2000])
+  })
+
+  it('a restart keeps the data', async () => {
+    expect(await list(createApp(sqliteStore(file)))).toHaveLength(2000)
+  })
+
+  it('an empty list shows a clear message', async () => {
+    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]))
+    render(createElement(ItemsScreen))
+    expect(await screen.findByText(/No items yet/)).toBeTruthy()
+  })
+})`,
    },
  ],
}
