// Budgets: each project's spend against its budget, said in one format. The teammate runs and buildTeam below are
// no longer on any screen (Homestead is for one person); tests still read them.
import { duration, reduce } from './reduce'
import { fitLimits, simulateRun } from './simulate'
import { scenario, simulatePlan } from './simPlan'
import type { AskReason, RunEvent } from './types'

export interface Area {
  id: string
  name: string
  budget: number // each project in the area starts with this as its spend limit
}

export const AREAS: Area[] = [
  { id: 'help', name: 'Help center', budget: 60 },
  { id: 'checkout', name: 'Checkout', budget: 60 },
  { id: 'insights', name: 'Insights', budget: 50 },
]

// An area's budget per project: whole dollars, at least $1 and at most $1,000. Anything typed outside is pulled in.
export const BUDGET = { min: 1, max: 1000 }
export const clampBudget = (n: number) => Math.min(BUDGET.max, Math.max(BUDGET.min, Math.round(n)))

// Spent against a limit, both in one format: cents only when both are under $10, so "$13 of $5", never "$13 of $5.00".
export function spentOf(spent: number, limit: number) {
  const f = spent < 10 && limit < 10 ? (n: number) => `$${n.toFixed(2)}` : (n: number) => `$${Math.round(n)}`
  return { spent: f(spent), limit: f(limit), over: f(Math.max(0, spent - limit)) }
}

// The area a new project belongs to, from its goal.
export function areaFor(goal: string): string {
  const g = goal.toLowerCase()
  if (/check ?out|stripe|payment|\bpay\b|pricing|billing|invoice|\bcart\b/.test(g)) return 'checkout'
  if (/dashboard|metric|sign-?ups?|report|chart|analytics|insight/.test(g)) return 'insights'
  return 'help'
}

// A teammate's project, simulated, and where its run stands: at a kind of ask, or a share of the way through.
export interface Mate {
  id: string
  owner: string
  name: string
  goal: string
  area: string
  at: { ask: AskReason } | { share: number }
}

export const MATES: Mate[] = [
  { id: 'team-maya-1', owner: 'Maya', name: 'Help-center bot', goal: 'A help-center bot that answers questions from a shop’s help pages', area: 'help', at: { ask: 'cost' } },
  { id: 'team-sam-1', owner: 'Sam', name: 'Help page search', goal: 'Search across a shop’s help pages', area: 'help', at: { share: 0.3 } },
  { id: 'team-dev-1', owner: 'Dev', name: 'Card checkout', goal: 'Card checkout for an online shop', area: 'checkout', at: { ask: 'disagree' } },
  { id: 'team-dev-2', owner: 'Dev', name: 'Invoice export', goal: 'Export invoices to CSV', area: 'checkout', at: { share: 1 } },
  { id: 'team-ines-1', owner: 'Ines', name: 'Sign-up dashboard', goal: 'A dashboard of new sign-ups each week', area: 'insights', at: { share: 0.6 } },
]

// A teammate's run, made the way the sample is: the plan, limits fitted to its own path, then the run.
const runs = new Map<string, RunEvent[]>()
export function mateEvents(m: Mate): RunEvent[] {
  let ev = runs.get(m.id)
  if (!ev) {
    const plan = simulatePlan(m.goal)
    plan.farmers = fitLimits({ goal: m.goal, ...plan })
    ev = simulateRun({ goal: m.goal, ...plan })
    runs.set(m.id, ev)
  }
  return ev
}

// Where a teammate's run stands: the time, and the suggested answer to every ask before it.
export function snapAt(events: RunEvent[], at: Mate['at']): { t: number; answers: Record<string, string> } {
  const ask = 'ask' in at ? events.find((e) => e.type === 'ask' && e.reason === at.ask) : undefined
  const t = ask ? ask.t : Math.round(duration(events) * ('share' in at ? at.share : 1))
  const answers: Record<string, string> = {}
  for (const e of events) if (e.type === 'ask' && (ask ? e.t < t : e.t <= t)) answers[e.id] = e.suggested
  return { t, answers }
}

// One project as the lead sees it: whose, how many agents, spent against its limit. No activity, no timeline.
export interface TeamFarm {
  id: string
  name: string
  owner: string // "You" for yours
  area: string
  agents: number
  spent: number
  limit: number
  events: RunEvent[]
  t: number
  answers: Record<string, string>
  mine: boolean
}

export type Outlier =
  | { kind: 'spike'; farm: TeamFarm; text: string }
  | { kind: 'twice'; farm: TeamFarm; other: TeamFarm; text: string }
  | { kind: 'conflict'; farm: TeamFarm; text: string }

export interface Team {
  areas: (Area & { farms: TeamFarm[]; spent: number })[]
  people: { name: string; projects: number; agents: number }[]
  outliers: Outlier[]
  spent: number
  agents: number
  projects: number
}

// What a project of yours brings to the team view.
export interface MineIn {
  id: string
  name: string
  goal: string
  events: RunEvent[]
  approved: boolean
  clock?: number
  answers?: Record<string, string>
  area?: string
  spendLimit?: number
  owner?: string
}

const spentBy = (events: RunEvent[], t: number) => events.reduce((m, e) => m + (e.type === 'usage' && e.t <= t ? e.usd : 0), 0)
const crew = (events: RunEvent[]) => new Set(events.flatMap((e) => (e.type === 'farmer' ? [e.id] : []))).size
const taskNames = (events: RunEvent[]) => events.find((e) => e.type === 'plan')?.tasks.filter((k) => !k.gate).map((k) => k.name) ?? []

export function buildTeam(mine: MineIn[], budgets: Record<string, number>): Team {
  const limitOf = (area: string, own?: number) => own ?? budgets[area] ?? AREAS.find((a) => a.id === area)?.budget ?? 0
  const farms: TeamFarm[] = []
  // Your projects with a plan; a teammate's project you opened is still theirs.
  for (const p of mine) {
    if (p.owner || !p.events.some((e) => e.type === 'plan')) continue
    const t = p.approved ? (p.clock ?? 0) : 0
    const area = p.area ?? areaFor(p.goal)
    farms.push({ id: p.id, name: p.name, owner: 'You', area, agents: crew(p.events), spent: spentBy(p.events, t), limit: limitOf(area, p.spendLimit), events: p.events, t, answers: p.answers ?? {}, mine: true })
  }
  for (const m of MATES) {
    const opened = mine.find((p) => p.id === m.id)
    const events = opened?.events ?? mateEvents(m)
    const snap = opened?.clock !== undefined ? { t: opened.clock, answers: opened.answers ?? {} } : snapAt(events, m.at)
    farms.push({ id: m.id, name: m.name, owner: m.owner, area: m.area, agents: crew(events), spent: spentBy(events, snap.t), limit: limitOf(m.area, opened?.spendLimit), events, t: snap.t, answers: snap.answers, mine: false })
  }

  // Outliers only: one cost spike, one piece of work done twice, one disagreement. Asks a project's own
  // owner is already handling don't show; a pending cost or disagreement ask does, because it is the outlier.
  const outliers: Outlier[] = []
  const pending = (f: TeamFarm, reason: AskReason) => {
    const s = reduce(f.events, f.t, f.answers)
    const a = s.asks.find((x) => !x.answer && x.reason === reason)
    return a ? { a, s } : null
  }
  const over = farms.find((f) => f.spent > f.limit)
  const spike = farms.map((f) => ({ f, p: pending(f, 'cost') })).find((x) => x.p)
  if (over) outliers.push({ kind: 'spike', farm: over, text: `Over its limit by ${spentOf(over.spent, over.limit).over}.` })
  else if (spike?.p) outliers.push({ kind: 'spike', farm: spike.f, text: spike.p.a.question })
  for (let i = 0; i < farms.length && !outliers.some((o) => o.kind === 'twice'); i++)
    for (let j = i + 1; j < farms.length; j++) {
      const a = farms[i]
      const b = farms[j]
      if (a.owner === b.owner) continue
      const same = taskNames(a.events).filter((n) => taskNames(b.events).includes(n))
      if (same.length >= 2 && scenario(goalOf(a)).name === scenario(goalOf(b)).name) {
        // Open the other person's project: yours you know.
        const [farm, other] = a.mine ? [b, a] : [a, b]
        outliers.push({ kind: 'twice', farm, other, text: `Both have “${same[0]}” and “${same[1]}”.` })
        break
      }
    }
  const fight = farms.map((f) => ({ f, p: pending(f, 'disagree') })).find((x) => x.p)
  if (fight?.p) {
    const { a, s } = fight.p
    const who = (id: string) => s.farmers[id as keyof typeof s.farmers]?.label ?? id
    const text = a.question.replace(/^The (\w+) and I disagree/, (_, other: string) => `The ${other} and the ${who(a.farmer)} disagree`)
    outliers.push({ kind: 'conflict', farm: fight.f, text })
  }

  const people = new Map<string, { name: string; projects: number; agents: number }>()
  for (const f of farms) {
    const p = people.get(f.owner) ?? { name: f.owner, projects: 0, agents: 0 }
    p.projects++
    p.agents += f.agents
    people.set(f.owner, p)
  }
  const areas = AREAS.map((a) => {
    const fs = farms.filter((f) => f.area === a.id)
    return { ...a, budget: budgets[a.id] ?? a.budget, farms: fs, spent: fs.reduce((m, f) => m + f.spent, 0) }
  })
  return {
    areas,
    people: [...people.values()],
    outliers,
    spent: farms.reduce((m, f) => m + f.spent, 0),
    agents: farms.reduce((m, f) => m + f.agents, 0),
    projects: farms.length,
  }
}

function goalOf(f: TeamFarm) {
  const g = f.events.find((e) => e.type === 'goal')
  return g && g.type === 'goal' ? g.text : f.name
}
