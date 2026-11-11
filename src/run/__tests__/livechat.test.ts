import { describe, expect, it } from 'vitest'
import { runAgent } from '../../agent/agents'
import type { AskTalkIn, ChatIn } from '../talk'

// A stand-in for Lovable AI that answers every call with the given JSON, and keeps what it was sent.
const gateway = (answer: unknown) => {
  const calls: Record<string, unknown>[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { calls, client: { key: 'lovable-test', fetch } }
}

const ASK: AskTalkIn = {
  ask: { id: 'ask-9', farmer: 'deployer', farmerLabel: 'Deployer', reason: 'irreversible', question: 'The pull request is ready. Merge?', suggested: 'Merge and ship to 10%', options: ['Merge and ship to 10%', 'Not yet'], canSendBack: true },
  history: [],
  message: 'can we put it through an adversarial agentic review',
}

const STATUS: ChatIn['status'] = {
  goal: 'A support assistant',
  done: false,
  minutes: 9,
  spent: 15.75,
  farmers: [{ id: 'builder', label: 'Builder', state: 'working', task: 'Chat widget' }],
  tasks: [{ id: 't1', name: 'Chat widget', farmer: 'builder', status: 'growing' }],
  decided: [{ id: 'ask-1', question: 'Over budget. Split it?', choice: 'Split it in two', options: ['Split it in two', 'Raise its limit to $30'], canChange: true }],
  changesOn: [{ id: 'rs-1', title: 'Incident mode', request: 'incident mode' }],
  merge: 'ask',
  deploy: 'not shipped',
}

describe('the live chat turns', () => {
  it('an ask is talked through on the asking agent’s model, with its options and the message', async () => {
    const g = gateway({ reply: 'I can send it back with that note.', choice: null, sendBack: 'Put it through an adversarial review', hold: false })
    const r = await runAgent({ gateway: g.client }, 'talk', { ...ASK, model: 'GPT-6 Luna' })
    expect(r.data).toMatchObject({ choice: null, sendBack: 'Put it through an adversarial review' })
    expect(g.calls[0].model).toBe('openai/gpt-6-luna')
    const user = (g.calls[0].messages as { content: string }[])[1].content
    expect(user).toContain('adversarial agentic review')
    expect(user).toContain('"Merge and ship to 10%"')
  })
  it('the Planner answers from the run, and its flat answer is read into one action', async () => {
    const g = gateway({ reply: 'Switch to raising the limit?', kind: 'reopen', to: null, request: null, id: null, askId: 'ask-1', choice: 'Raise its limit to $30', keep: null, scope: null })
    const r = await runAgent({ gateway: g.client }, 'chat', { message: 'raise the limit instead', history: [], status: STATUS })
    expect(r.data).toEqual({ reply: 'Switch to raising the limit?', action: { kind: 'reopen', askId: 'ask-1', choice: 'Raise its limit to $30' } })
    const user = (g.calls[0].messages as { content: string }[])[1].content
    expect(user).toContain('$15.75')
    expect(user).toContain('ask-1')
    expect(user).toContain('rs-1: Incident mode')
  })
  it('an answer that breaks the schema is refused, not acted on', async () => {
    const g = gateway({ reply: 'x', kind: 'undo', to: null, request: null, id: 'rs-404', askId: null, choice: null, keep: null, scope: null })
    await expect(runAgent({ gateway: g.client }, 'chat', { message: 'undo', history: [], status: STATUS })).rejects.toThrow()
  })
})
