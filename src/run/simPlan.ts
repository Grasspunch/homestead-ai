// The simulated Planner: a plan and a crew for any goal, and message routing, with no model call.
// Used when Live mode is off (the default). Live mode sends the same requests to the real Planner.

import { CREW } from '../agent/agents'
import { MODELS } from './kit'
import type { PlanOut, RouteInput, RouteOut } from '../agent/agents'
import type { Estimate, FarmerId, FarmerSetup, PlanTask, Screen } from './types'

// The moments every simulated run passes through, written for one kind of project, so the text a farmer
// says fits the goal. A goal that matches no template runs the generic one, marked as a demo scenario.
export interface Side { position: string; why: string; option: string; tool: string; check: string; shot: 'ok' | 'alt' }
export interface Script {
  screen: Screen
  refactor: { what: string; line: string }
  dispute: { topic: string; failNote: string; impact: string; designer: Side; builder: Side }
  rollout: { peak: number; cause: string; fix: string; check: string; file: string; tests: string[] }
}

interface Draft {
  name: string
  tasks: (Omit<PlanTask, 'gate'> & { gate?: boolean; mins: number; usd: number; after?: string[] })[]
  context: Partial<Record<FarmerId, string[]>>
  // Why this project needs each farmer, in the project's own terms.
  why?: Partial<Record<FarmerId, string>>
  script: Script
  matched: boolean
}

const SUPPORT: Script = {
  screen: 'chat',
  refactor: { what: 'move how answers are routed into one module', line: 'Moved answer routing into one module' },
  dispute: {
    topic: 'how the sources fit in the chat panel',
    failNote: 'The sources cover the reply box',
    impact: 'People get either a tidy panel with one click to see sources, or every source at once in smaller text.',
    designer: { position: 'Fold the sources into one click-to-open chip', why: 'In the 380 px chat panel the three sources take 180 px and cover the reply box. A chip keeps the box clear, and the done-when asks for the sources without getting in the way. The cost is one extra click for people who want them.', option: 'Fold into a chip', tool: 'Folded the sources into a chip', check: 'The sources fold into a chip, and the reply box is clear', shot: 'ok' },
    builder: { position: 'List them under the answer in smaller text', why: 'Support answers are only trusted when the source is visible, and a chip hides it. Listing the sources at 12 px under the answer clears the reply box. It is a two-line change with no new component to test.', option: 'Smaller text', tool: 'Listed the sources under the answer at 12 px', check: 'Every source shows under the answer, and the reply box is clear', shot: 'alt' },
  },
  rollout: { peak: 0.031, cause: 'long questions time out after 10 s', fix: 'Shortened long questions before answering, added a timeout fallback', check: 'Long questions answer in under 4 s', file: 'tests/long-questions.test.ts', tests: ['a 2,000-word question answers in under 4 s', 'a timeout falls back to a person', 'short questions are unchanged', 'the fallback keeps the chat', 'no answer is cut mid-sentence'] },
}

const CHECKOUT: Script = {
  screen: 'app',
  refactor: { what: 'move every price calculation into one pricing module', line: 'Moved price calculation into one module' },
  dispute: {
    topic: 'where the cookie notice goes on the checkout screen',
    failNote: 'The cookie notice covers the pay button',
    impact: 'Buyers get either a clear checkout with the notice asked earlier, or the notice kept on checkout as a slim strip.',
    designer: { position: 'Ask about cookies once, before checkout', why: 'On short windows the notice covers the pay button, and people leave a checkout they can’t finish. Asking once on the page before keeps checkout clear.', option: 'Ask before checkout', tool: 'Moved the cookie notice before checkout', check: 'Nothing covers the pay button', shot: 'ok' },
    builder: { position: 'Keep it on checkout as a slim strip on top', why: 'Consent should show where the card is entered. A slim strip above the form keeps it there and clears the pay button, with no new page to build.', option: 'Slim strip on top', tool: 'Made the cookie notice a slim strip above the form', check: 'The notice sits above the form, and the pay button is clear', shot: 'alt' },
  },
  rollout: { peak: 0.027, cause: 'card payments time out after 10 s when the provider is slow', fix: 'Waited for the provider’s answer instead of timing out, and made retries charge once', check: 'Slow card payments complete, and a retry never charges twice', file: 'tests/billing/slow-provider.test.ts', tests: ['a slow provider answer still completes the order', 'a retried payment charges once', 'a declined card shows a clear error', 'a timeout leaves no half-paid order', 'refunds still post to the account'] },
}

const DASHBOARD: Script = {
  screen: 'dash',
  refactor: { what: 'compute every metric in one shared query layer', line: 'Moved the metric queries into one shared layer' },
  dispute: {
    topic: 'where the week-over-week changes go',
    failNote: 'The legend covers the signups chart',
    impact: 'People get either every change in a row under the charts, or clean charts with the changes on hover.',
    designer: { position: 'Put the changes in a row under the charts', why: 'The floating legend hides the first chart at most widths. A row under the charts keeps every number visible and reads left to right with the cards.', option: 'A row under the charts', tool: 'Moved the changes into a row under the charts', check: 'Every chart is clear, and the changes sit in a row under them', shot: 'alt' },
    builder: { position: 'Show the legend only on hover', why: 'The charts carry the story and the changes are secondary. A hover legend is a two-line change and keeps the board quiet.', option: 'Only on hover', tool: 'Showed the legend on hover only', check: 'Every chart is clear, and the changes show on hover', shot: 'ok' },
  },
  rollout: { peak: 0.024, cause: 'the metrics API takes over 3 s on the largest accounts, so their boards time out', fix: 'Cached each metric for a minute and paged the largest accounts', check: 'Every metric loads in under 300 ms on the largest account', file: 'tests/metrics/large-account.test.ts', tests: ['the largest account loads in under 300 ms', 'a cached metric refreshes after a minute', 'paging returns every row once', 'an empty account shows zeroes', 'a slow query falls back to the cache'] },
}

const GENERIC: Script = {
  screen: 'app',
  refactor: { what: 'move the shared data code into one module', line: 'Moved the shared data code into one module' },
  dispute: {
    topic: 'where the notice goes on the main screen',
    failNote: 'A notice covers the main button',
    impact: 'People get either a clear main screen with the notice asked earlier, or the notice kept as a slim strip.',
    designer: { position: 'Ask once, before the main screen', why: 'On short windows the notice covers the main button. Asking once on the page before keeps the main screen clear.', option: 'Ask before', tool: 'Moved the notice before the main screen', check: 'Nothing covers the main button', shot: 'ok' },
    builder: { position: 'Keep it as a slim strip on top', why: 'A slim strip above the form keeps the notice where it applies and clears the button, with no new page to build.', option: 'Slim strip on top', tool: 'Made the notice a slim strip above the form', check: 'The notice sits above the form, and the button is clear', shot: 'alt' },
  },
  rollout: { peak: 0.029, cause: 'requests time out under load after 10 s', fix: 'Added a timeout fallback and paged the slow query', check: 'Every request answers in under 1 s under load', file: 'tests/load.test.ts', tests: ['a busy minute answers in under 1 s', 'a timeout falls back cleanly', 'paging returns every row once', 'a restart keeps the data', 'an empty list shows a clear message'] },
}

// Which template a goal runs, and whether it really matched one.
export function scenario(goal: string): { script: Script; matched: boolean; name: string } {
  const d = draft(goal)
  return { script: d.script, matched: d.matched, name: d.name }
}

const USD_SCALE = 15
// Drafts list minutes for a small slice of work; real agent tasks run 20 to 60 minutes.
const MIN_SCALE = 3
// One agent alone, against a crew. These are the assumptions behind the comparison, kept in one place:
// it runs every task on Opus and rereads one growing context, which slows every step (caching keeps the
// rereads cheap, not fast). Nobody independent checks its work, so some problems surface late and get redone.
export const SOLO = { contextTime: 1.35, contextCost: 1.1, rework: 1.2 }
// Each handoff between farmers costs a little: a summary written and read.
const HANDOFF = 0.25
// Which model each farmer runs on, and its price per token relative to Claude Opus 5.5 (the model picker's rates).
const MODEL_OF: Record<FarmerId, string> = { planner: 'Claude Opus 5.5', designer: 'Claude Opus 5.5', builder: 'Claude Sonnet 5.5', tester: 'Claude Haiku 5.5', deployer: 'Claude Haiku 5.5' }
const rateOf = (model: string) => MODELS.find((m) => m.model === model)?.rate ?? 1
const SHIP = { id: 'ship', name: 'Ship to users', farmer: 'deployer' as FarmerId, doneWhen: 'Live for 10% with errors under 2%, then for everyone', gate: true, mins: 8, usd: 0.3 }

function draft(goal: string): Draft {
  const g = goal.toLowerCase()
  if (/(support|assistant|chat ?bot|chatbot|help ?desk|answer)/.test(g))
    return {
      name: 'Support assistant',
      tasks: [
        { id: 'docs-index', name: 'Index the help docs', farmer: 'builder', doneWhen: 'Every help doc is searchable, and a test finds the refunds page', mins: 10, usd: 0.6 },
        { id: 'answer-api', name: 'Answer from the docs', farmer: 'builder', doneWhen: '90% of eval questions get an answer with a cited doc', mins: 16, usd: 1.4, after: ['docs-index'] },
        { id: 'handoff', name: 'Hand off when unsure', farmer: 'builder', doneWhen: 'Unsure answers go to a person with the chat attached', mins: 9, usd: 0.7, after: ['answer-api'] },
        { id: 'chat-widget', name: 'Chat widget', farmer: 'designer', doneWhen: 'The widget answers and shows its sources without covering the reply box', mins: 12, usd: 0.8 },
        SHIP,
      ],
      script: SUPPORT,
      matched: true,
      context: { builder: ['src/', 'docs/help/', 'eval/questions.jsonl'], designer: ['src/widget/', 'docs/brand.md'], tester: ['tests/', 'eval/questions.jsonl'] },
      why: {
        planner: "Keeps the answers and the widget in step, and passes your notes on. Opus, for judgment.",
        builder: "Indexes the help docs, answers from them and hands off when unsure. Sonnet, at half of Opus’s price.",
        designer: "The widget is what customers see, so it needs taste. Opus, and it keeps the reply box clear.",
        tester: "Runs the eval questions against every answer, so a wrong one never reaches a customer.",
        deployer: "Wrong answers reach real customers, so it ships to 10% first and rolls back on its own.",
      },
    }
  if (/(checkout|payment|stripe|billing|subscription|pricing)/.test(g))
    return {
      name: 'Checkout',
      tasks: [
        { id: 'pricing-model', name: 'Model plans and prices', farmer: 'builder', doneWhen: 'Plans and prices load from one config, with tests', mins: 8, usd: 0.5 },
        { id: 'checkout-api', name: 'Checkout API', farmer: 'builder', doneWhen: 'A test card completes a purchase in test mode', mins: 14, usd: 1.2, after: ['pricing-model'] },
        { id: 'webhooks', name: 'Handle payment webhooks', farmer: 'builder', doneWhen: 'Paid, failed and refunded events update the account', mins: 10, usd: 0.8, after: ['checkout-api'] },
        { id: 'checkout-ui', name: 'Checkout screens', farmer: 'designer', doneWhen: 'Checkout works with clear errors and nothing covering the pay button', mins: 12, usd: 0.8 },
        { ...SHIP, doneWhen: 'Live for 10% of buyers with no failed payments, then for everyone' },
      ],
      script: CHECKOUT,
      matched: true,
      context: { builder: ['src/billing/', 'docs/pricing.md'], designer: ['src/checkout/', 'docs/brand.md'], tester: ['tests/billing/'] },
      why: {
        planner: "Keeps prices, payments and screens reading from one plan config. Opus, for judgment.",
        builder: "Prices, the checkout API and webhooks are one chain of money code. Sonnet, at half of Opus’s price.",
        designer: "Buyers leave at confusing errors, so the checkout screens need taste. Opus.",
        tester: "Runs test-card purchases and refunds against every done-when, so nobody is charged wrong.",
        deployer: "Payments can't be half broken, so 10% of buyers first, rolled back at the first failed payment.",
      },
    }
  if (/(dashboard|analytics|metrics|report|chart)/.test(g))
    return {
      name: 'Metrics dashboard',
      tasks: [
        { id: 'metrics-query', name: 'Query the metrics', farmer: 'builder', doneWhen: 'Each metric matches a hand count on sample data', mins: 12, usd: 0.9 },
        { id: 'metrics-api', name: 'Metrics API', farmer: 'builder', doneWhen: 'The API returns every metric in under 300 ms', mins: 10, usd: 0.7, after: ['metrics-query'] },
        { id: 'dashboard-ui', name: 'Dashboard screens', farmer: 'designer', doneWhen: 'Charts read clearly at a glance', mins: 14, usd: 0.9 },
        SHIP,
      ],
      script: DASHBOARD,
      matched: true,
      context: { builder: ['src/metrics/', 'db/schema.sql'], designer: ['src/dashboard/'], tester: ['tests/metrics/'] },
      why: {
        planner: "Keeps the queries and the charts agreeing on what each metric means. Opus, for judgment.",
        builder: "Writes the metric queries and the API. Sonnet, at half of Opus’s price.",
        designer: "Charts only help if they read at a glance, so Opus designs them.",
        tester: "Checks every metric against a hand count, so the dashboard never shows a wrong number.",
        deployer: "Ships to 10% first and rolls back if the API slows down or errors.",
      },
    }
  const short = goal.replace(/[.!?]+$/, '').split(/\s+/).slice(0, 4).join(' ')
  return {
    name: short.charAt(0).toUpperCase() + short.slice(1),
    tasks: [
      { id: 'core', name: 'Build the core', farmer: 'builder', doneWhen: 'The main flow works end to end in a test', mins: 15, usd: 1.2 },
      { id: 'data', name: 'Store the data', farmer: 'builder', doneWhen: 'Data survives a restart, with a migration test', mins: 9, usd: 0.6, after: ['core'] },
      { id: 'screens', name: 'Design the screens', farmer: 'designer', doneWhen: 'Every screen works, with nothing covering its main button', mins: 12, usd: 0.8 },
      SHIP,
    ],
    script: GENERIC,
    matched: false,
    context: { builder: ['src/', 'package.json'], designer: ['src/ui/', 'docs/brand.md'], tester: ['tests/'] },
  }
}

const PRIORITY: FarmerId[] = ['builder', 'tester', 'planner', 'designer', 'deployer']

const WHY: Record<FarmerId, string> = {
  planner: 'Splits the work, prices it and passes your messages on. Needs judgment, so Opus.',
  builder: 'Writes most of the code. Sonnet, at half of Opus’s price.',
  designer: 'Screens and copy need taste, so Opus.',
  tester: 'Checks the others against each done-when, so nobody grades its own work. Haiku, for very little.',
  deployer: 'The only one that may ship. Goes to 10% first and rolls back on its own. Haiku, for very little.',
}

function setup(id: FarmerId, d: Draft, usd: number, minutes: number, solo: boolean): FarmerSetup {
  const label = CREW[id].label
  const model = solo ? 'Claude Opus 5.5' : MODEL_OF[id]
  const base: Record<FarmerId, { context: string[]; constraints: string[] }> = {
    planner: { context: ['docs/', 'README.md'], constraints: ['Read only', 'May not deploy'] },
    builder: { context: d.context.builder ?? ['src/'], constraints: solo ? ['Waits for you before shipping', 'No network calls to production'] : ['May not deploy', 'No network calls to production'] },
    designer: { context: d.context.designer ?? ['src/ui/'], constraints: ['Changes only its own screens', 'May not deploy'] },
    tester: { context: d.context.tester ?? ['tests/'], constraints: ['May not change src/', 'Runs tests only'] },
    deployer: { context: ['deploy/', '.env.example'], constraints: ['Ships to 10% first', 'Rolls back if errors pass 2%'] },
  }
  return {
    id,
    label: solo ? 'Builder' : label,
    agent: 'claude-code',
    model,
    context: base[id].context,
    constraints: base[id].constraints,
    limits: { usd: Math.ceil(usd * 1.3), minutes: Math.ceil((minutes * 1.3) / 5) * 5 },
    why: solo ? 'Does everything in a row. Cheapest to run, slowest to finish.' : d.why?.[id] ?? WHY[id],
  }
}

export function simulatePlan(goal: string, crewSize?: number | FarmerId[]): PlanOut {
  const d = draft(goal)
  // Default crew: everyone with work, plus the Tester and Planner who check it.
  const wanted = new Set<FarmerId>(['builder', 'tester', 'planner', ...d.tasks.map((t) => t.farmer)])
  let crew = PRIORITY.filter((id) => wanted.has(id))
  if (Array.isArray(crewSize)) crew = PRIORITY.filter((id) => id === 'builder' || crewSize.includes(id))
  else if (crewSize !== undefined) crew = PRIORITY.slice(0, Math.max(1, Math.min(5, Math.round(crewSize))))
  const solo = crew.length === 1
  const fallback = (f: FarmerId): FarmerId => (crew.includes(f) ? f : 'builder')

  // Drafts price each task in small units; scaled, this is what the task costs on Opus.
  const tasks = d.tasks.map((t) => ({ ...t, mins: t.mins * MIN_SCALE, usd: t.usd * USD_SCALE, farmer: fallback(t.farmer), gate: !!t.gate }))
  // A Tester on the crew gets its own task: the end-to-end check before shipping.
  if (crew.includes('tester')) {
    const i = tasks.findIndex((t) => t.gate)
    tasks.splice(i < 0 ? tasks.length : i, 0, { id: 'e2e-check', name: 'Check it end to end', farmer: 'tester', doneWhen: 'Every done-when passes in one end-to-end run', gate: false, mins: 7 * MIN_SCALE, usd: 0.4 * USD_SCALE, after: tasks.filter((t) => !t.gate).map((t) => t.id) })
  }

  // Crew time: the longest chain, since farmers work in parallel. One agent: everything in a row.
  const finish: Record<string, number> = {}
  const busy: Partial<Record<FarmerId, number>> = {}
  for (const t of tasks) {
    const deps = t.gate ? tasks.filter((x) => !x.gate).map((x) => x.id) : t.after ?? []
    const start = Math.max(busy[t.farmer] ?? 0, ...deps.map((id) => finish[id] ?? 0))
    finish[t.id] = start + t.mins
    busy[t.farmer] = finish[t.id]
  }
  const sum = (k: 'mins' | 'usd') => tasks.reduce((s, t) => s + t[k], 0)
  // Task prices are in Opus terms; each farmer pays its own model's rate.
  const rate = (f: FarmerId) => (solo ? 1 : rateOf(MODEL_OF[f]))
  const crewUsd = tasks.reduce((s, t) => s + t.usd * rate(t.farmer), 0) + HANDOFF * USD_SCALE * (crew.length - 1)
  const alone: Estimate = { usd: +(sum('usd') * SOLO.contextCost * SOLO.rework).toFixed(2), minutes: Math.round(sum('mins') * SOLO.contextTime * SOLO.rework) }
  const estimate: Estimate = solo ? alone : { usd: +crewUsd.toFixed(2), minutes: Math.round(Math.max(...Object.values(finish)) + 4) }
  const singleAgentEstimate: Estimate = alone

  const farmers = crew.map((id) => {
    const mine = tasks.filter((t) => t.farmer === id)
    return setup(id, d, Math.max(5, mine.reduce((s, t) => s + t.usd * rate(t.farmer), 0) || 5), Math.max(10, mine.reduce((s, t) => s + t.mins, 0)), solo)
  })
  return {
    name: d.name,
    farmers,
    tasks: tasks.map(({ id, name, farmer, doneWhen, gate }) => ({ id, name, farmer, doneWhen, gate })),
    estimate,
    singleAgentEstimate,
  }
}

const ROUTES: [RegExp, FarmerId, string][] = [
  [/(colou?r|font|button|layout|screen|copy|design|look|mobile|phone)/i, 'designer', 'since it is about how it looks'],
  [/(test|bug|broken|fail|check|flaky)/i, 'tester', 'since it is about whether it works'],
  [/(deploy|ship|release|rollback|prod|live)/i, 'deployer', 'since it is about shipping'],
  [/(code|api|endpoint|database|refactor|build|function|error)/i, 'builder', 'since it is a code change'],
]

export function simulateRoute(input: RouteInput): RouteOut {
  const ids = input.farmers.map((f) => f.id)
  const hit = ROUTES.find(([re, id]) => re.test(input.message) && ids.includes(id))
  const to: FarmerId = hit ? hit[1] : ids.includes('planner') ? 'planner' : ids[0] ?? 'builder'
  const label = input.farmers.find((f) => f.id === to)?.label ?? CREW[to].label
  const words = input.message.toLowerCase()
  const task = input.tasks.find((t) => t.farmer === to && words.includes(t.name.toLowerCase().split(' ').slice(-1)[0]))?.id ?? input.tasks.find((t) => t.farmer === to)?.id
  const reply = hit ? `Handed to the ${label}, ${hit[2]}.` : `I'll take this one, since it is about the plan.`
  return task ? { to, task, reply } : { to, reply }
}
