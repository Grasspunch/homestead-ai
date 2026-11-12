// The Planner the app talks to. Scripted by default. Live mode in Settings sends every request (the plan, chat, asks,
// changes) to the real models through /api/agent, which on Lovable calls them through Lovable AI, paid with
// workspace credits. Off, nothing calls a model.
// ?demo in the address plays the scripted demo the pitch video was recorded from: Live mode starts off there, and
// a change to it lasts for that page only, so your own choice stays as it was.
// A failed live call, one the server can't run, or one Lovable AI refuses (credits, rate limit) falls back to the
// simulation and says why.

import type { PlanOut, RouteInput, RouteOut } from '../agent/agents'
import type { FarmerId } from './types'
import { GatewayRefused, KeyMissing, SOURCE, askTalkLive, chatLive, discussLive, planGoal as livePlan, probeKeys, reshapeLive, routeMessage as liveRoute } from './live'
import { providerOf } from './kit'
import { changesFromLive, type Ctx as ReshapeCtx, type Proposal } from './reshape'
import { simulatePlan, simulateRoute } from './simPlan'
import { discussSim, type Talk, type TalkLine } from './discuss'
import { askTalkSim } from './askTalk'
import { chatSim } from './chatSim'
import { waitingOn } from './busy'
import type { AskTalkIn, AskTalkOut, ChatIn, ChatOut } from './talk'

const KEY = 'homestead.live'

// Read once, when the page loads: the app changes the address as you move around, and the demo lasts the visit.
export const DEMO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')

// Off unless you turned it on in Settings: the scripted run is quick and free. Outside a browser (the tests) there is
// no server to call, so it's off.
export function getLiveMode(): boolean {
  if (DEMO || typeof window === 'undefined') return false
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setLiveMode(on: boolean) {
  if (!DEMO) {
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      // Private windows: the switch lasts for this page only.
    }
  }
  live = on
}

let live = getLiveMode()

export interface AgentAnswer<T> {
  data: T
  live: boolean
  error?: string // why a live call fell back
  source?: string // who answered a live call: "Lovable AI", "your Anthropic key" or "your OpenAI key"
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// What a live call couldn't do: the server can't run its model, so it was simulated.
export const NO_KEY = { anthropic: 'Anthropic key not set, simulated', openai: 'Lovable AI not set up, simulated' }

// Notes that say a call was simulated for an expected reason, not because it broke.
export const isFallbackNote = (note?: string) =>
  !!note && (Object.values(NO_KEY).includes(note) || note === new GatewayRefused('credits').message || note === new GatewayRefused('rate').message || note === new GatewayRefused('visitor').message)

const noteOf = (e: unknown) => (e instanceof KeyMissing ? NO_KEY[e.provider] : e instanceof Error ? e.message : String(e))

// `model` is the Planner's model. On Lovable both makers run through Lovable AI; in local dev without it, only Claude.
// With Live mode off, nothing calls a model: every answer is scripted.
function run<T>(liveCall: () => Promise<T>, sim: () => T, paceMs: number, model?: string): Promise<AgentAnswer<T>> {
  return waitingOn(answer(liveCall, sim, paceMs, model))
}

async function answer<T>(liveCall: () => Promise<T>, sim: () => T, paceMs: number, model: string | undefined): Promise<AgentAnswer<T>> {
  const provider = providerOf(model)
  if (live && (await probeKeys())[provider]) {
    try {
      const data = await liveCall()
      const src = (data as { source?: keyof typeof SOURCE }).source
      return { data, live: true, source: src && SOURCE[src] }
    } catch (e) {
      return { data: sim(), live: false, error: live ? noteOf(e) : undefined }
    }
  }
  // A short pause so the simulated Planner paces like a real one.
  await pause(paceMs)
  return { data: sim(), live: false, error: live ? NO_KEY[provider] : undefined }
}

export function plan(goal: string, crewSize?: number | FarmerId[], model?: string) {
  return run<PlanOut>(() => livePlan(goal, crewSize, model), () => simulatePlan(goal, crewSize), 1800, model)
}

export function route(input: RouteInput, model?: string) {
  return run<RouteOut>(() => liveRoute(input.message, input.farmers, input.tasks, model), () => simulateRoute(input), 700, model)
}

// A change to the farm, read by the live Planner when Live mode is on. Off, or when the call fails, the app reads it
// with its own scripted parser, and a failed call says so on the card.
// `reply`: what the live Planner said when it found no change it can make, so the reason isn't lost.
export function reshapeRead(message: string, ctx: ReshapeCtx, model?: string): Promise<{ proposal: Proposal | null; note?: string; reply?: string }> {
  return waitingOn(readChange(message, ctx, model))
}

async function readChange(message: string, ctx: ReshapeCtx, model?: string): Promise<{ proposal: Proposal | null; note?: string; reply?: string }> {
  if (!live) return { proposal: null }
  const provider = providerOf(model)
  if (!(await probeKeys())[provider]) return { proposal: null, note: NO_KEY[provider] }
  try {
    const out = await reshapeLive(message, ctx, model)
    const proposal = changesFromLive(out, ctx)
    if (!proposal) return out.reply ? { proposal: null, reply: out.reply } : { proposal: null }
    return { proposal: { ...proposal, note: `Read by the live Planner, through ${out.source ? SOURCE[out.source] : 'Lovable AI'}` } }
  } catch (e) {
    if (e instanceof KeyMissing || e instanceof GatewayRefused) return { proposal: null, note: noteOf(e) }
    return { proposal: null, note: `The live Planner failed (${e instanceof Error ? e.message : String(e)}), so I read this myself.` }
  }
}

// A question about a disagreement. Live, it runs on the model of the side it names, or the Designer's; simulated,
// the sides answer from what they said. Either way the ask stays open.
export async function discuss(question: string, talk: Talk, modelOf: (f: string) => string | undefined): Promise<AgentAnswer<TalkLine[]>> {
  const lower = question.toLowerCase()
  const side = talk.sides.find((s) => lower.includes(s.label.toLowerCase())) ?? talk.sides[0]
  const model = modelOf(side.farmer)
  const r = await run<{ lines: TalkLine[] }>(() => discussLive(question, talk, model), () => ({ lines: discussSim(question, talk) }), 500, model)
  const lines = r.data.lines.filter((l) => talk.sides.some((s) => s.farmer === l.from)).slice(0, 2)
  return { ...r, data: lines.length ? lines : discussSim(question, talk) }
}

// Talking an ask through: you typed into a question an agent asked. Live, it runs on that agent's model; otherwise
// the script answers from the ask. Either way the reply answers you, and a choice it reads is confirmed first.
export async function talkAsk(inp: AskTalkIn, model?: string): Promise<AgentAnswer<AskTalkOut>> {
  const r = await run<AskTalkOut>(() => askTalkLive(inp, model), () => askTalkSim(inp), 500, model)
  return { ...r, data: checkAsk(r.data, inp) }
}

// Only an option the ask has can be picked; a send-back only where work can go back.
function checkAsk(out: AskTalkOut, inp: AskTalkIn): AskTalkOut {
  const choice = out.choice && inp.ask.options.includes(out.choice) ? out.choice : null
  const sendBack = inp.ask.canSendBack && out.sendBack?.trim() ? out.sendBack.trim() : null
  return { reply: out.reply?.trim() || askTalkSim(inp).reply, choice: sendBack ? null : choice, sendBack, hold: !!out.hold && !choice && !sendBack }
}

// A message to the Planner. Live, the Planner answers from the run as it stands and picks at most one action;
// otherwise the script does what it can, and returns null when it has nothing, so the message goes on as before.
export async function chatTurn(inp: ChatIn, model?: string): Promise<AgentAnswer<ChatOut | null>> {
  const r = await run<ChatOut | null>(() => chatLive(inp, model), () => chatSim(inp), 400, model)
  return { ...r, data: r.data && checkChat(r.data, inp) }
}

// An action the run can't take becomes no action, so a model's slip never changes anything by itself.
function checkChat(out: ChatOut, inp: ChatIn): ChatOut {
  const a = out.action
  const st = inp.status
  const ok =
    a.kind === 'none' ||
    a.kind === 'cancel' ||
    (a.kind === 'note' && st.farmers.some((f) => f.id === a.to)) ||
    (a.kind === 'change' && !!a.request?.trim()) ||
    (a.kind === 'undo' && st.changesOn.some((c) => c.id === a.id)) ||
    (a.kind === 'reopen' && st.decided.some((d) => d.id === a.askId && (!a.choice || d.options.includes(a.choice)))) ||
    (a.kind === 'adjust' && !!st.pending && (!a.keep || a.keep.every((id) => st.pending!.rows.some((r) => r.id === id))))
  return { reply: out.reply, action: ok ? a : { kind: 'none' } }
}
