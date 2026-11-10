// The simulated Planner: a plan and a crew for any goal, and message routing, with no model call.
// Used when Live mode is off (the default). Live mode sends the same requests to the real Planner.

import { CREW } from '../agent/agents'
import type { PlanOut, RouteInput, RouteOut } from '../agent/agents'
import type { Estimate, FarmerId, FarmerSetup, PlanTask } from './types'

interface Draft {
  name: string
  tasks: (Omit<PlanTask, 'gate'> & { gate?: boolean; mins: number; usd: number; after?: string[] })[]
  context: Partial<Record<FarmerId, string[]>>
}

const USD_SCALE = 15
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
        { id: 'chat-widget', name: 'Chat widget', farmer: 'designer', doneWhen: 'The widget answers and shows its sources on phone and desktop', mins: 12, usd: 0.8 },
        SHIP,
      ],
      context: { builder: ['src/', 'docs/help/', 'eval/questions.jsonl'], designer: ['src/widget/', 'docs/brand.md'], tester: ['tests/', 'eval/questions.jsonl'] },
    }
  if (/(checkout|payment|stripe|billing|subscription|pricing)/.test(g))
    return {
      name: 'Checkout',
      tasks: [
        { id: 'pricing-model', name: 'Model plans and prices', farmer: 'builder', doneWhen: 'Plans and prices load from one config, with tests', mins: 8, usd: 0.5 },
        { id: 'checkout-api', name: 'Checkout API', farmer: 'builder', doneWhen: 'A test card completes a purchase in test mode', mins: 14, usd: 1.2, after: ['pricing-model'] },
        { id: 'webhooks', name: 'Handle payment webhooks', farmer: 'builder', doneWhen: 'Paid, failed and refunded events update the account', mins: 10, usd: 0.8, after: ['checkout-api'] },
        { id: 'checkout-ui', name: 'Checkout screens', farmer: 'designer', doneWhen: 'Checkout works on phone and desktop with clear errors', mins: 12, usd: 0.8 },
        { ...SHIP, doneWhen: 'Live for 10% of buyers with no failed payments, then for everyone' },
      ],
      context: { builder: ['src/billing/', 'docs/pricing.md'], designer: ['src/checkout/', 'docs/brand.md'], tester: ['tests/billing/'] },
    }
  if (/(dashboard|analytics|metrics|report|chart)/.test(g))
    return {
      name: 'Metrics dashboard',
      tasks: [
        { id: 'metrics-query', name: 'Query the metrics', farmer: 'builder', doneWhen: 'Each metric matches a hand count on sample data', mins: 12, usd: 0.9 },
        { id: 'metrics-api', name: 'Metrics API', farmer: 'builder', doneWhen: 'The API returns every metric in under 300 ms', mins: 10, usd: 0.7, after: ['metrics-query'] },
        { id: 'dashboard-ui', name: 'Dashboard screens', farmer: 'designer', doneWhen: 'Charts read clearly on desktop and phone', mins: 14, usd: 0.9 },
        SHIP,
      ],
      context: { builder: ['src/metrics/', 'db/schema.sql'], designer: ['src/dashboard/'], tester: ['tests/metrics/'] },
    }
  const short = goal.replace(/[.!?]+$/, '').split(/\s+/).slice(0, 4).join(' ')
  return {
    name: short.charAt(0).toUpperCase() + short.slice(1),
    tasks: [
      { id: 'core', name: 'Build the core', farmer: 'builder', doneWhen: 'The main flow works end to end in a test', mins: 15, usd: 1.2 },
      { id: 'data', name: 'Store the data', farmer: 'builder', doneWhen: 'Data survives a restart, with a migration test', mins: 9, usd: 0.6, after: ['core'] },
      { id: 'screens', name: 'Design the screens', farmer: 'designer', doneWhen: 'Every screen works on phone and desktop', mins: 12, usd: 0.8 },
      SHIP,
    ],
    context: { builder: ['src/', 'package.json'], designer: ['src/ui/', 'docs/brand.md'], tester: ['tests/'] },
  }
}

const PRIORITY: FarmerId[] = ['builder', 'tester', 'planner', 'designer', 'deployer']

const WHY: Record<FarmerId, string> = {
  planner: 'Splits the work, prices it and passes your messages on. Needs judgment, so Opus.',
  builder: 'Writes most of the code. Sol is as good at code as Opus here and costs a quarter less.',
  designer: 'Screens and copy need taste, so Opus. Checks its own screens on phone and desktop.',
  tester: 'Checks the others against each done-when. Kept apart so nobody grades its own work.',
  deployer: 'The only one that may ship. Goes to 10% first and rolls back on its own.',
}

function setup(id: FarmerId, d: Draft, usd: number, minutes: number, solo: boolean): FarmerSetup {
  const label = CREW[id].label
  const opus = solo || id === 'planner' || id === 'designer'
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
    agent: opus ? 'claude-code' : 'codex',
    model: opus ? 'Claude Opus 5.5' : 'Codex Sol 6.1',
    context: base[id].context,
    constraints: base[id].constraints,
    limits: { usd: Math.ceil(usd * 1.3), minutes: Math.ceil((minutes * 1.3) / 5) * 5 },
    why: solo ? 'Does everything in a row. Cheapest to run, slowest to finish.' : WHY[id],
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

  // Drafts price each task in Sonnet-hour units; a real crew on Opus and Sol spends about this much.
  const tasks = d.tasks.map((t) => ({ ...t, usd: t.usd * USD_SCALE, farmer: fallback(t.farmer), gate: !!t.gate }))
  // A Tester on the crew gets its own task: the end-to-end check before shipping.
  if (crew.includes('tester')) {
    const i = tasks.findIndex((t) => t.gate)
    tasks.splice(i < 0 ? tasks.length : i, 0, { id: 'e2e-check', name: 'Check it end to end', farmer: 'tester', doneWhen: 'Every done-when passes in one end-to-end run', gate: false, mins: 7, usd: 0.4 * USD_SCALE, after: tasks.filter((t) => !t.gate).map((t) => t.id) })
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
  const handoffs = solo ? 0 : 0.15 * USD_SCALE * (crew.length - 1)
  const estimate: Estimate = solo
    ? { usd: +sum('usd').toFixed(2), minutes: Math.round(sum('mins')) }
    : { usd: +(sum('usd') + handoffs).toFixed(2), minutes: Math.round(Math.max(...Object.values(finish)) + 4) }
  const singleAgentEstimate: Estimate = { usd: +(sum('usd') * 0.92).toFixed(2), minutes: Math.round(sum('mins') * 1.05) }

  const farmers = crew.map((id) => {
    const mine = tasks.filter((t) => t.farmer === id)
    return setup(id, d, Math.max(5, mine.reduce((s, t) => s + t.usd, 0) || 5), Math.max(10, mine.reduce((s, t) => s + t.mins, 0)), solo)
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
