// Changing the farm by asking the Planner: "I'm in an incident, skip the deployer and push straight to main",
// "judge the rollout by synthetic tests", "notify me at each stage of the rollout".
// A request becomes a list of typed changes. The card shows each one as a row you can uncheck; the ones you keep
// change the run itself, from now on, and last for the farm until you turn them off.
import type { FarmerId } from './types'

// The kinds of change the Planner can make today. Each is one row on the card.
export type Change =
  | { kind: 'removeTask'; task: string } // skip a task
  | { kind: 'removeFarmer'; farmer: 'deployer' } // the Deployer is off: the Builder pushes and deploys
  | { kind: 'setAutonomy'; moment: 'ship'; value: 'auto' } // no pull request review
  | { kind: 'setRollout'; stages: 'everyone' } // ship to everyone at once, no 10% stage
  | { kind: 'setRolloutCheck'; check: 'synthetics' } // the rollout is judged by synthetic tests in prod
  | { kind: 'setDoneWhen'; task: string; doneWhen: string }
  | { kind: 'notifyOn'; on: 'stage' } // a desktop notification at each stage of the rollout

// Where a change applies. Only "this farm" ships today; "every farm" is kept for later.
export type Scope = 'farm' | 'every'

export interface ChangeRow {
  id: string
  change: Change
  label: string
  loss?: string // what you give up, for a change that removes a safety step
  scope: Scope // how long the Planner suggests it lasts: this farm, or every farm from now on
}

// A change kept for every farm: new farms start with it. Lives beside the farms in the same saved store.
export interface FlowItem {
  id: string
  change: Change
  label: string // the change card's row
  short: string // a few words, for the plan's first line
  on: boolean
  from: string // the request that added it, so its Undo takes it back out
  notify?: 'desktop' | 'toast'
}

// The Planner's suggestion: anything that removes a safety step, incident mode included, and the success
// criteria last for this farm; a preference like stage alerts is for every farm.
export const suggestScope = (c: Change): Scope => (c.kind === 'notifyOn' ? 'every' : 'farm')

// A change in a few words, as the plan names your flow.
export function shortOf(c: Change, name: (id: string) => string = (x) => x): string {
  switch (c.kind) {
    case 'removeTask':
      return `skip “${name(c.task)}”`
    case 'removeFarmer':
      return 'no Deployer'
    case 'setAutonomy':
      return 'no review'
    case 'setRollout':
      return 'no 10% stage'
    case 'setRolloutCheck':
      return 'synthetic checks'
    case 'setDoneWhen':
      return 'synthetic done-when'
    case 'notifyOn':
      return 'stage alerts'
  }
}

export interface Proposal {
  title: string // the chip's name, such as "Incident mode"
  rows: ChangeRow[]
  note?: string // why the live Planner wasn't used
}

export type Reading = { kind: 'changes'; proposal: Proposal } | { kind: 'none'; reply: string } | { kind: 'not-a-change' }

export interface Ctx {
  tasks: { id: string; name: string; farmer: FarmerId; gate?: boolean; status?: string }[]
  farmers: FarmerId[]
  active?: Change[] // changes already on
}

// What the Planner can change today, said plainly when it can't read a request.
export const CAN_DO =
  'Today I can skip tasks or the pull request review, turn the Deployer off so the Builder pushes to main, ship straight to everyone, judge the rollout by synthetic tests, and notify you at each rollout stage.'

const APOS = /[´`’‘ʼ′]/g
const norm = (s: string) => ` ${s.toLowerCase().replace(APOS, "'").replace(/n't\b/g, 'nt').replace(/'/g, '').replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ')} `

// A clause that keeps something as it is: "don't skip the tester", "keep the review", "leave the 10% stage".
const KEEP = /\b(dont|do not|never|not|keep|leave|without skipping|no skipping)\b/

const SHIP_WORDS = /\b(ship|shipping|deploy|deploying|release|push|rollout|roll out|launch)\b/

export function readChanges(text: string, ctx: Ctx): Reading {
  const t = norm(text)
  // Each clause on its own, so "skip the deployer but don't skip the tester" reads both ways.
  const clauses = t.split(/\b(?:but|and then|then|however|except|also)\b|[,;.]/).map((c) => ` ${c.trim()} `).filter((c) => c.trim())
  const want: Change[] = []
  const keep = { review: false, deployer: false, stage10: false, tasks: new Set<string>(), farmers: new Set<FarmerId>() }
  // A task named by its own name, or by a long word of it: "skip the hard cases", "drop the widget".
  const taskByWords = (c: string) =>
    ctx.tasks.filter((k) => {
      const n = norm(k.name).trim()
      return !k.gate && (c.includes(` ${n} `) || n.split(' ').some((w) => w.length > 4 && !['check', 'tests', 'users'].includes(w) && c.includes(` ${w} `)))
    })
  const named = (c: string, who: string) => new RegExp(`\\b${who}s?\\b`).test(c)
  const unnecessary = () => ctx.tasks.filter((k) => !k.gate && (k.id === 'e2e-check' || /-rest$/.test(k.id)) && k.status !== 'accepted')
  let incident = false
  let matched = false
  for (const c of clauses) {
    const no = KEEP.test(c)
    const skip = /\b(skip|skipping|drop|remove|cut|without|no|turn off|switch off|bypass|ditch|lose)\b/.test(c)
    if (/\b(incident|outage|emergency|sev ?[0-2]|hotfix|on fire|asap)\b/.test(c) && !no) incident = true
    // Synthetic tests as the rollout's measure of success, and a notification at each stage, unless refused.
    const refused = /\b(dont|do not|never|no|not)\b/.test(c)
    if (/\bsynthetics?\b/.test(c) && !refused) {
      const ship = ctx.tasks.find((k) => k.gate)
      if (ship) want.push({ kind: 'setDoneWhen', task: ship.id, doneWhen: 'Synthetic tests pass in prod at every stage' })
      want.push({ kind: 'setRolloutCheck', check: 'synthetics' })
      matched = true
    }
    if (/\b(notif\w*|notify|ping|alert|tell|let me know|message|posted)\b/.test(c) && (SHIP_WORDS.test(c) || /\b(stage|stages|step|steps)\b/.test(c)) && !refused) {
      want.push({ kind: 'notifyOn', on: 'stage' })
      matched = true
      continue
    }
    // Keeping something as it is.
    if (no) {
      if (named(c, 'review') || /pull request|\bpr\b/.test(c)) keep.review = true
      if (named(c, 'deployer')) keep.deployer = true
      if (/10 ?%|canary|stage/.test(c) && !/each stage|every stage/.test(c)) keep.stage10 = true
      for (const f of ['tester', 'designer', 'builder', 'planner'] as FarmerId[]) if (named(c, f)) keep.farmers.add(f)
      for (const k of taskByWords(c.replace(KEEP, ' skip '))) keep.tasks.add(k.id)
      if (/\bcheck(s|ing)?\b|end to end|e2e/.test(c)) keep.tasks.add('e2e-check')
      if (/hard cases/.test(c)) for (const k of ctx.tasks.filter((x) => /-rest$/.test(x.id))) keep.tasks.add(k.id)
      matched = true
      continue
    }
    if (skip && named(c, 'deployer')) want.push({ kind: 'removeFarmer', farmer: 'deployer' })
    if ((skip && (named(c, 'review') || /pull request|\bpr\b|approval/.test(c))) || /\b(push|merge|commit)( it)?( straight| directly| right)?( to| into) (main|master|prod)\b/.test(c))
      want.push({ kind: 'setAutonomy', moment: 'ship', value: 'auto' })
    if (/\b(push|merge|commit)( it)?( straight| directly| right)?( to| into) (main|master)\b/.test(c) && !keep.deployer && /deployer/.test(t)) want.push({ kind: 'removeFarmer', farmer: 'deployer' })
    if ((SHIP_WORDS.test(c) && /\b(instantly|immediately|right away|now|straight|directly|at once|to everyone|everyone|all users|100 ?%)\b/.test(c)) || (skip && /10 ?%|canary|staged|stage/.test(c)))
      want.push({ kind: 'setRollout', stages: 'everyone' })
    if (/\b(unnecessary|non essential|nonessential|optional|extra|nice to have)\b/.test(c) && /\b(step|steps|task|tasks|work|checks?)\b/.test(c)) for (const k of unnecessary()) want.push({ kind: 'removeTask', task: k.id })
    if (skip) for (const k of taskByWords(c)) want.push({ kind: 'removeTask', task: k.id })
    if (skip && /\b(end to end|e2e)\b/.test(c)) for (const k of ctx.tasks.filter((x) => x.id === 'e2e-check')) want.push({ kind: 'removeTask', task: k.id })
    if (skip && /hard cases/.test(c)) for (const k of ctx.tasks.filter((x) => /-rest$/.test(x.id))) want.push({ kind: 'removeTask', task: k.id })
    if (want.length) matched = true
  }
  if (incident) {
    want.push({ kind: 'setAutonomy', moment: 'ship', value: 'auto' })
    if (ctx.farmers.includes('deployer')) want.push({ kind: 'removeFarmer', farmer: 'deployer' })
    want.push({ kind: 'setRollout', stages: 'everyone' })
    for (const k of unnecessary()) want.push({ kind: 'removeTask', task: k.id })
    matched = true
  }
  // What you said to keep wins over the rest.
  const kept = (c: Change) =>
    (c.kind === 'setAutonomy' && keep.review) ||
    (c.kind === 'removeFarmer' && keep.deployer) ||
    (c.kind === 'setRollout' && keep.stage10) ||
    (c.kind === 'removeTask' && (keep.tasks.has(c.task) || keep.farmers.has(ctx.tasks.find((k) => k.id === c.task)?.farmer as FarmerId)))
  const seen = new Set<string>()
  const active = new Set((ctx.active ?? []).map(key))
  const changes = want.filter((c) => {
    const k = key(c)
    if (kept(c) || seen.has(k) || active.has(k)) return false
    if (c.kind === 'removeFarmer' && !ctx.farmers.includes(c.farmer)) return false
    seen.add(k)
    return true
  })
  if (!changes.length) return matched || /\b(skip|change|switch|turn off|remove|stop|instead|notify|deploy|push|ship)\b/.test(t) ? { kind: 'none', reply: matched ? 'That is already how this farm runs, so nothing changes.' : CAN_DO } : { kind: 'not-a-change' }
  return { kind: 'changes', proposal: { title: titleOf(changes, incident), rows: rowsFor(changes, ctx) } }
}

export const key = (c: Change) => `${c.kind}:${'task' in c ? c.task : 'farmer' in c ? c.farmer : ''}`

function titleOf(changes: Change[], incident: boolean) {
  if (incident || (changes.some((c) => c.kind === 'setRollout') && changes.some((c) => c.kind === 'setAutonomy'))) return 'Incident mode'
  if (changes.every((c) => c.kind === 'notifyOn')) return 'Stage alerts'
  if (changes.some((c) => c.kind === 'setRolloutCheck')) return 'Synthetic checks'
  if (changes.every((c) => c.kind === 'removeTask')) return changes.length === 1 ? 'Skipped task' : 'Skipped tasks'
  return 'Changed plan'
}

// One row per change: what it does, in the person's terms, and what it costs in safety.
export function rowsFor(changes: Change[], ctx: Ctx): ChangeRow[] {
  const name = (id: string) => ctx.tasks.find((k) => k.id === id)?.name ?? id
  const noDeployer = changes.some((c) => c.kind === 'removeFarmer')
  return changes.map((c, i) => {
    const id = `row-${i + 1}-${key(c)}`
    return { ...row(id, c), scope: suggestScope(c) }
  })
  function row(id: string, c: Change): Omit<ChangeRow, 'scope'> {
    switch (c.kind) {
      case 'removeTask':
        return { id, change: c, label: `Skip “${name(c.task)}”`, loss: c.task === 'e2e-check' ? 'Nothing checks the tasks together before release' : 'Its part stays out of the release' }
      case 'removeFarmer':
        return { id, change: c, label: 'The Deployer is off, so the Builder pushes to main', loss: 'Nobody but the author watches the release' }
      case 'setAutonomy':
        return { id, change: c, label: noDeployer ? 'No pull request review' : 'No pull request review, it merges by itself', loss: 'You don’t see the work before it merges' }
      case 'setRollout':
        return { id, change: c, label: 'Ship to everyone, no 10% stage', loss: 'No 10% stage, so no automatic rollback' }
      case 'setRolloutCheck':
        return { id, change: c, label: 'Roll back on a failing synthetic test, not the error rate', loss: 'The error rate no longer triggers a rollback' }
      case 'setDoneWhen':
        return { id, change: c, label: `“${name(c.task)}” is done when ${c.doneWhen.charAt(0).toLowerCase()}${c.doneWhen.slice(1)}` }
      case 'notifyOn':
        return { id, change: c, label: 'A desktop notification at each rollout stage' }
    }
  }
}

// What the simulation needs from a set of changes.
export interface Reshaped {
  at: number // ms into the run when they took effect
  skip: string[]
  noDeployer: boolean
  noReview: boolean
  everyone: boolean
  synthetics: boolean
  doneWhen: Record<string, string>
  titles: string[]
}

export function reshapedOf(list: { title: string; changes: Change[]; at: number }[]): Reshaped | undefined {
  if (!list.length) return undefined
  const all = list.flatMap((r) => r.changes)
  const doneWhen: Record<string, string> = {}
  for (const c of all) if (c.kind === 'setDoneWhen') doneWhen[c.task] = c.doneWhen
  return {
    at: Math.max(...list.map((r) => r.at)),
    skip: all.flatMap((c) => (c.kind === 'removeTask' ? [c.task] : [])),
    noDeployer: all.some((c) => c.kind === 'removeFarmer'),
    noReview: all.some((c) => c.kind === 'setAutonomy'),
    everyone: all.some((c) => c.kind === 'setRollout'),
    synthetics: all.some((c) => c.kind === 'setRolloutCheck'),
    doneWhen,
    titles: list.map((r) => r.title),
  }
}

// The live Planner's answer: the same typed changes, checked against this farm before they become rows.
export function changesFromLive(out: { title?: string; changes?: unknown[] }, ctx: Ctx): Proposal | null {
  const ok: Change[] = []
  for (const raw of out.changes ?? []) {
    const c = raw as Record<string, unknown>
    if (c.kind === 'removeTask' && typeof c.task === 'string' && ctx.tasks.some((k) => k.id === c.task && !k.gate)) ok.push({ kind: 'removeTask', task: c.task })
    if (c.kind === 'removeFarmer' && c.farmer === 'deployer' && ctx.farmers.includes('deployer')) ok.push({ kind: 'removeFarmer', farmer: 'deployer' })
    if (c.kind === 'setAutonomy') ok.push({ kind: 'setAutonomy', moment: 'ship', value: 'auto' })
    if (c.kind === 'setRollout') ok.push({ kind: 'setRollout', stages: 'everyone' })
    if (c.kind === 'setRolloutCheck') ok.push({ kind: 'setRolloutCheck', check: 'synthetics' })
    if (c.kind === 'setDoneWhen' && typeof c.task === 'string' && typeof c.doneWhen === 'string' && ctx.tasks.some((k) => k.id === c.task)) ok.push({ kind: 'setDoneWhen', task: c.task, doneWhen: c.doneWhen.slice(0, 120) })
    if (c.kind === 'notifyOn') ok.push({ kind: 'notifyOn', on: 'stage' })
  }
  const active = new Set((ctx.active ?? []).map(key))
  const seen = new Set<string>()
  const changes = ok.filter((c) => !active.has(key(c)) && !seen.has(key(c)) && !!seen.add(key(c)))
  if (!changes.length) return null
  return { title: (typeof out.title === 'string' && out.title.trim().slice(0, 24)) || titleOf(changes, false), rows: rowsFor(changes, ctx) }
}

// The JSON schema the live Planner answers with.
export function reshapeSchema(ctx: Ctx) {
  const taskIds = ctx.tasks.map((k) => k.id)
  const nonGate = ctx.tasks.filter((k) => !k.gate).map((k) => k.id)
  const obj = (kind: string, props: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: ['kind', ...Object.keys(props)],
    properties: { kind: { type: 'string', enum: [kind] }, ...props },
  })
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'changes', 'reply'],
    properties: {
      title: { type: 'string', description: 'Two or three words naming the mode, such as "Incident mode"' },
      reply: { type: 'string', description: 'One short sentence to the person, used only when no change fits' },
      changes: {
        type: 'array',
        items: {
          anyOf: [
            obj('removeTask', { task: { type: 'string', enum: nonGate.length ? nonGate : ['none'] } }),
            obj('removeFarmer', { farmer: { type: 'string', enum: ['deployer'] } }),
            obj('setAutonomy', { moment: { type: 'string', enum: ['ship'] }, value: { type: 'string', enum: ['auto'] } }),
            obj('setRollout', { stages: { type: 'string', enum: ['everyone'] } }),
            obj('setRolloutCheck', { check: { type: 'string', enum: ['synthetics'] } }),
            obj('setDoneWhen', { task: { type: 'string', enum: taskIds.length ? taskIds : ['none'] }, doneWhen: { type: 'string' } }),
            obj('notifyOn', { on: { type: 'string', enum: ['stage'] } }),
          ],
        },
      },
    },
  }
}
