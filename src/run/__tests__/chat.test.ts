import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatSim, trustWords } from '../chatSim'
import { chatTurn, setLiveMode } from '../agent'
import { resetLiveProbe } from '../live'
import { readChanges, type Change, type Ctx } from '../reshape'
import { simulatePlan } from '../simPlan'
import { SAMPLE_GOAL, store } from '../store'
import type { ChatIn } from '../talk'

beforeAll(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
})

const base: ChatIn['status'] = {
  goal: 'Support assistant',
  done: false,
  minutes: 12,
  spent: 1.23,
  farmers: [
    { id: 'planner', label: 'Planner', state: 'idle' },
    { id: 'builder', label: 'Builder', state: 'working', task: 'Answer from the docs' },
    { id: 'tester', label: 'Tester', state: 'working', task: 'Check the tasks together' },
    { id: 'deployer', label: 'Deployer', state: 'idle' },
  ],
  tasks: [
    { id: 'docs-index', name: 'Index the help docs', farmer: 'builder', status: 'accepted' },
    { id: 'answer-api', name: 'Answer from the docs', farmer: 'builder', status: 'growing' },
    { id: 'e2e-check', name: 'Check the tasks together', farmer: 'tester', status: 'waiting' },
  ],
  decided: [],
  changesOn: [],
  deploy: 'not shipped',
}
const say = (message: string, status: Partial<ChatIn['status']> = {}) => chatSim({ message, history: [], status: { ...base, ...status } })
const INCIDENT = { id: 'rs-1', title: 'Incident mode', request: 'I’m in an incident, skip the deployer and push straight to main' }
const ALERTS = { id: 'rs-2', title: 'Stage alerts', request: 'Notify me at each stage of the rollout' }
const DECIDED = [
  { id: 'ask-2', question: 'Over budget by $0.40 on Answer from the docs. Raise the budget?', choice: 'Raise it to $2', options: ['Raise it to $2', 'Stop it here'], canChange: true },
  { id: 'ask-1', question: 'The Designer and the Builder disagree on the widget layout.', choice: 'Go with the Designer’s layout', options: ['Go with the Designer’s layout', 'Go with the Builder’s layout'], canChange: true },
]

describe('the scripted Planner answers questions from the run', () => {
  it('spend, what is happening, why an agent is on it, the release, failures', () => {
    expect(say('how much have we spent?')).toMatchObject({ reply: expect.stringContaining('$1.23'), action: { kind: 'none' } })
    expect(say('what are you doing right now?')!.reply).toMatch(/1 of 3 tasks done/)
    const why = say('why is the Tester on this?')!
    expect(why.action.kind).toBe('none')
    expect(why.reply).toMatch(/checks each task/)
    expect(why.reply).toMatch(/Check the tasks together/)
    expect(say('is the deploy going ok?')).toMatchObject({ reply: expect.stringMatching(/Nothing has shipped yet/), action: { kind: 'none' } })
    expect(say('is the deploy going ok?', { deploy: '10%' })!.reply).toMatch(/10% of users/)
    expect(say('why did the build fail?')!.reply).toMatch(/Nothing is failing/)
    expect(say('why did the build fail?', { tasks: [{ id: 'answer-api', name: 'Answer from the docs', farmer: 'builder', status: 'wilted' }] })!.reply).toMatch(/“Answer from the docs” \(Builder\) failed/)
    expect(say('what changes are on?', { changesOn: [INCIDENT] })!.reply).toMatch(/Incident mode/)
    expect(say('what did I decide?', { decided: DECIDED })!.reply).toMatch(/Raise it to \$2/)
  })
  it('a question is never a silent note: a question about a task says where it is and that it was passed on', () => {
    const r = say('is the help docs index tested?')!
    expect(r.reply).toMatch(/“Index the help docs” is done/)
    expect(r.action).toEqual({ kind: 'note', to: 'builder' })
  })
  it('unclear words get a short prompt of what to ask', () => {
    for (const m of ['hmm', 'not sure']) expect(say(m)).toMatchObject({ reply: expect.stringMatching(/^Ask me anything/), action: { kind: 'none' } })
  })
  it('a plain note to the agents is left to the change reader and the router', () => {
    expect(say('make the widget friendlier')).toBeNull()
    expect(say('skip the deployer')).toBeNull()
  })
})

describe('undoing a change in words', () => {
  it('puts back the latest change, or the one named', () => {
    const on = { changesOn: [INCIDENT, ALERTS] }
    for (const m of ['put it back', 'undo that', 'actually no, I liked it before']) expect(say(m, on)!.action).toEqual({ kind: 'undo', id: 'rs-2' })
    for (const m of ['turn off incident mode', 'cancel the incident mode', 'I want the review back', 'bring back the deployer', 'keep the review', 'don’t skip the e2e check', 'keep asking me before merging'])
      expect(say(m, on)!.action, m).toEqual({ kind: 'undo', id: 'rs-1' })
  })
  it('says so honestly when nothing is on', () => {
    expect(say('put it back')).toMatchObject({ reply: expect.stringMatching(/Nothing to put back/), action: { kind: 'none' } })
    expect(say('turn off incident mode')!.reply).toMatch(/isn’t on/)
    expect(say('undo the rollback')!.reply).toMatch(/can’t undo a rollback/)
  })
  it('leaves merging by itself to the app, and screen changes to the change reader', () => {
    expect(trustWords('keep asking me before merging')).toBe('ask')
    expect(trustWords('merge by itself')).toBe('auto')
    expect(say('keep asking me before merging')).toBeNull()
    expect(say('turn off the chickens')).toBeNull()
  })
})

describe('changing an earlier answer in words', () => {
  it('matches the question by its words, or the latest, and an option when one is named', () => {
    expect(say('change my answer on the budget question', { decided: DECIDED })!.action).toEqual({ kind: 'reopen', askId: 'ask-2', choice: null })
    expect(say('actually go with the builder’s way', { decided: DECIDED })!.action).toEqual({ kind: 'reopen', askId: 'ask-1', choice: 'Go with the Builder’s layout' })
    expect(say('undo my last answer', { decided: DECIDED })!.action).toEqual({ kind: 'reopen', askId: 'ask-2', choice: null })
  })
  it('says why when it can’t, and when nothing was answered', () => {
    const locked = [{ ...DECIDED[0], canChange: false, why: 'A release went out after it (to 10%), so it can’t be un-asked.' }]
    expect(say('change my answer on the budget question', { decided: locked })).toMatchObject({ reply: expect.stringMatching(/release went out/), action: { kind: 'none' } })
    expect(say('undo my last answer')!.reply).toMatch(/haven’t answered anything/)
  })
})

describe('talking about an open change card', () => {
  const pending = {
    request: 'incident',
    rows: [
      { id: 'r1', label: 'No pull request review', loss: 'You don’t see the work before it merges' },
      { id: 'r2', label: 'The Deployer is off, so the Builder pushes to main', loss: 'Nobody but the author watches the release' },
      { id: 'r3', label: 'Ship to everyone, no 10% stage', loss: 'No 10% stage, so no automatic rollback' },
    ],
  }
  const card = (m: string) => say(m, { pending })!
  it('keeps some rows, sets how long, cancels, and explains', () => {
    expect(card('actually only the first one').action).toEqual({ kind: 'adjust', keep: ['r1'], scope: null })
    expect(card('just the deployer one').action).toEqual({ kind: 'adjust', keep: ['r2'], scope: null })
    expect(card('not the review').action).toEqual({ kind: 'adjust', keep: ['r2', 'r3'], scope: null })
    expect(card('make it every project').action).toEqual({ kind: 'adjust', keep: null, scope: 'every' })
    expect(card('just this one').action).toEqual({ kind: 'adjust', keep: null, scope: 'farm' })
    expect(card('never mind').action).toEqual({ kind: 'cancel' })
    const q = card('wait, what does that do?')
    expect(q.action.kind).toBe('none')
    expect(q.reply).toMatch(/no automatic rollback/)
  })
})

describe('the change reader, fixed', () => {
  const plan = simulatePlan(SAMPLE_GOAL)
  const incident: Change[] = [{ kind: 'setAutonomy', moment: 'ship', value: 'auto' }, { kind: 'removeFarmer', farmer: 'deployer' }, { kind: 'setRollout', stages: 'everyone' }, { kind: 'removeTask', task: 'e2e-check' }]
  const ctx: Ctx = { tasks: plan.tasks.map((t) => ({ id: t.id, name: t.name, farmer: t.farmer, gate: t.gate })), farmers: plan.farmers.map((f) => f.id) }
  const on: Ctx = { ...ctx, active: incident, on: [{ title: 'Incident mode', changes: incident }] }
  it('turning incident mode off never turns it on', () => {
    for (const m of ['turn off incident mode', 'cancel the incident mode', 'stop incident mode']) {
      expect(readChanges(m, ctx).kind, m).toBe('none')
      const r = readChanges(m, on)
      expect(r.kind === 'none' && r.chips.map((c) => c.label)).toEqual(['Turn off Incident mode'])
    }
  })
  it('“already how it runs” only when it is', () => {
    for (const m of ['keep the review', 'don’t skip the e2e check', 'turn off incident mode']) {
      const r = readChanges(m, on)
      expect(r.kind === 'none' && r.reply, m).toMatch(/Incident mode is on now/)
    }
    const auto = readChanges('keep asking me before merging', { ...ctx, autonomy: { ship: 'auto' } })
    expect(auto.kind === 'none' && auto.reply).toMatch(/merge by themselves/)
    expect(readChanges('keep the review', ctx)).toMatchObject({ kind: 'none', reply: 'That is already how this project runs, so nothing changes.' })
  })
  it('a question is not a change it can’t make, and “not sure” is not a request', () => {
    expect(readChanges('is the deploy going ok?', ctx).kind).toBe('not-a-change')
    expect(readChanges('how is the rollout going', ctx).kind).toBe('not-a-change')
    expect(readChanges('not sure', ctx).kind).toBe('not-a-change')
  })
})

describe('chatTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetLiveProbe()
    setLiveMode(false)
  })
  it('with Live mode off, answers from the script and calls no model', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ live: true, keys: { anthropic: true, openai: true } })))
    vi.stubGlobal('fetch', fetchMock)
    const r = await chatTurn({ message: 'how much have we spent?', history: [], status: base })
    expect(r.live).toBe(false)
    expect(r.error).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('falls back to the script when the server can’t run a model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ live: false }))))
    const r = await chatTurn({ message: 'how much have we spent?', history: [], status: base })
    expect(r.live).toBe(false)
    expect(r.data?.reply).toMatch(/\$1\.23/)
  })
  it('falls back to the script when the live call fails, and checks the live action', async () => {
    setLiveMode(true)
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ live: true })))))
    const r = await chatTurn({ message: 'put it back', history: [], status: { ...base, changesOn: [INCIDENT] } })
    expect(r.live).toBe(false)
    expect(r.data?.action).toEqual({ kind: 'undo', id: 'rs-1' })
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? new Response(JSON.stringify({ data: { reply: 'Off.', action: { kind: 'undo', id: 'nope' } } })) : new Response(JSON.stringify({ live: true })))))
    resetLiveProbe()
    const bad = await chatTurn({ message: 'put it back', history: [], status: { ...base, changesOn: [INCIDENT] } })
    expect(bad.data?.action).toEqual({ kind: 'none' })
  })
})

describe('in the store', () => {
  it('turning down merging by itself after saying yes puts the review back, and words flip it', () => {
    const p = store.newProject('Stripe checkout for our pricing page')
    store.open(p.id)
    store.answerTrust(true)
    expect(p.autonomy.ship).toBe('auto')
    store.answerTrust(false)
    expect(p.autonomy.ship).toBe('ask')
    expect(store.setShip(p.id, 'auto')).toMatch(/^Done/)
    expect(p.autonomy.ship).toBe('auto')
    expect(store.setShip(p.id, 'auto')).toMatch(/already/)
    expect(store.setShip(p.id, 'ask')).toMatch(/^Done/)
    expect(p.autonomy.ship).toBe('ask')
  })
})

describe('requests asked as questions', () => {
  it('go to the change reader, not the answers', () => {
    expect(say('how about we skip the e2e check?')).toBeNull()
    expect(say('can you skip the deployer?')).toBeNull()
  })
})
