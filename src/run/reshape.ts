// Changing the farm by asking the Planner: "I'm in an incident, skip the deployer and push straight to main",
// "judge the rollout by synthetic tests", "notify me at each stage of the rollout".
// A request becomes a list of typed changes. The card shows each one as a row you can uncheck; the ones you keep
// change the run itself, from now on, and last for the farm until you turn them off.
import type { FarmerId } from './types'
import { BAR_IDS, COLORS, LABEL_MAX, SCREEN, UI_CAN, UI_PARTS, cleanLabel, colorName, isUi, norm, uiClause, uiLookOf, uiNoop, uiPart, type UiChange, type UiId, type UiLook, type UiCan, type UiPlace } from './ui'

// The kinds of change the Planner can make today. Each is one row on the card.
export type Change =
  | { kind: 'removeTask'; task: string } // skip a task
  | { kind: 'removeFarmer'; farmer: 'deployer' } // the Deployer is off: the Builder pushes and deploys
  | { kind: 'setAutonomy'; moment: 'ship'; value: 'auto' } // no pull request review
  | { kind: 'setRollout'; stages: 'everyone' } // ship to everyone at once, no 10% stage
  | { kind: 'setRolloutCheck'; check: 'synthetics' } // the rollout is judged by synthetic tests in prod
  | { kind: 'setDoneWhen'; task: string; doneWhen: string }
  | { kind: 'notifyOn'; on: 'stage' } // a desktop notification at each stage of the rollout
  | UiChange // the screen: hide, move, resize, rename or recolour a part, or put it back

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
export const suggestScope = (c: Change): Scope => (c.kind === 'notifyOn' || isUi(c) ? 'every' : 'farm')

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
    case 'ui':
      return `${c.show ? 'show' : 'no'} ${uiPart(c.el)?.name ?? c.el}`
    case 'uiMove':
      return `${uiPart(c.el)?.name ?? c.el} moved`
    case 'uiSize':
      return `${c.size > 0 ? 'bigger' : c.size < 0 ? 'smaller' : 'usual-size'} ${uiPart(c.el)?.name ?? c.el}`
    case 'uiLabel':
      return `${uiPart(c.el)?.name ?? c.el} called “${c.label}”`
    case 'uiColor':
      return `${colorName(c.color)} ${uiPart(c.el)?.name ?? c.el}`
    case 'uiReset':
      return `${uiPart(c.el)?.name ?? c.el} as it was`
  }
}

export interface Proposal {
  title: string // the chip's name, such as "Incident mode"
  rows: ChangeRow[]
  note?: string // why the live Planner wasn't used
}

export type Reading = { kind: 'changes'; proposal: Proposal } | { kind: 'none'; reply: string; closest?: string; chips: Suggestion[] } | { kind: 'not-a-change' }

// A request the Planner can make, offered as a chip under a reply: clicking it sends the request.
export interface Suggestion {
  label: string
  request: string
}
const OFFER = {
  incident: { label: 'Incident mode', request: 'I’m in an incident, skip the deployer and push straight to main' },
  synth: { label: 'Judge by synthetic tests', request: 'Judge the rollout by synthetic tests in prod' },
  notify: { label: 'Notify me at each stage', request: 'Notify me at each stage of the rollout' },
} satisfies Record<string, Suggestion>
type Offer = keyof typeof OFFER

// For a request the Planner can't make, the nearest thing it can, if any, and up to three chips, nearest first.
function nearest(t: string, ctx: Ctx): { closest?: string; chips: Suggestion[] } {
  const on = (ctx.active ?? []).map((c) => c.kind)
  const done: Record<Offer, boolean> = { incident: on.includes('removeFarmer'), synth: on.includes('setRolloutCheck'), notify: on.includes('notifyOn') }
  let near: Offer | undefined
  if (/\b(page|paging|pager|pagerduty|on ?call|slack|email|e mail|sms|text me|phone|alert|alerts|wake)\b/.test(t)) near = 'notify'
  else if (/\b(test|tests|testing|monitor|monitors|metric|metrics|criteria|success|health|check|checks|error rate)\b/.test(t)) near = 'synth'
  else if (SHIP_WORDS.test(t) || /\b(prod|production|hotfix|faster|quick|quickly|main|merge|rollback|roll back|rolls back)\b/.test(t)) near = 'incident'
  const line: Record<Offer, string> = {
    notify: 'Closest I can do: a desktop notification to you at each rollout stage, a rollback included.',
    synth: 'Closest I can do: judge the rollout by synthetic tests in prod.',
    incident: 'Closest I can do: incident mode, which pushes straight to main and ships to everyone.',
  }
  const order = [near, 'incident', 'synth', 'notify'].filter((k, i, a): k is Offer => !!k && a.indexOf(k) === i && !done[k as Offer])
  return { closest: near && !done[near] ? line[near] : undefined, chips: order.slice(0, 3).map((k) => OFFER[k]) }
}

export interface Ctx {
  tasks: { id: string; name: string; farmer: FarmerId; gate?: boolean; status?: string }[]
  farmers: FarmerId[]
  active?: Change[] // changes already on
  on?: { title: string; changes: Change[] }[] // the same changes, by the request that turned them on
  autonomy?: { ship?: 'ask' | 'auto' } // how pull requests merge now: 'auto' after you let it merge by itself
  ui?: UiLook // how the screen looks now, Your flow included; without it, from this farm's changes alone
}

const lookOf = (ctx: Ctx) => ctx.ui ?? uiLookOf(ctx.active ?? [])

// What the Planner can change today, said plainly when it can't read a request.
export const CAN_DO = 'I can’t change that yet.'


// A clause that keeps something as it is: "don't skip the tester", "keep the review", "leave the 10% stage".
const KEEP = /\b(dont|do not|never|not|keep|leave|without skipping|no skipping)\b/

const SHIP_WORDS = /\b(ship|shipping|deploy|deploying|release|push|rollout|roll out|launch)\b/

// Turning something off that a change turned on: "turn off incident mode", "cancel the stage alerts".
const OFF = /\b(turn off|switch off|turn it off|cancel|stop|disable|undo|no more|exit|get out of|done with|back out of)\b/

// A question, not a request: "is the deploy going ok?", "why is the Tester on this". "Can you skip…" is a request.
const QUESTION = /^\s*(is|are|was|were|why|what|whats|how|hows|when|where|who|whos|which|does|did|do|has|have|should)\b/

type Mode = 'incident' | 'synth' | 'notify'
const MODE_NAME: Record<Mode, string> = { incident: 'Incident mode', synth: 'Judging the rollout by synthetic tests', notify: 'Stage alerts' }
const inMode = (m: Mode, c: Change) =>
  m === 'incident' ? c.kind === 'setAutonomy' || c.kind === 'removeFarmer' || c.kind === 'setRollout' : m === 'synth' ? c.kind === 'setRolloutCheck' || c.kind === 'setDoneWhen' : c.kind === 'notifyOn'

export function readChanges(text: string, ctx: Ctx): Reading {
  const t = norm(text)
  const look = lookOf(ctx)
  // The screen first, clause by clause in your own words (a rename keeps your capitals). Those clauses are about
  // the screen, not the run, so "remove the pull request button" never turns off the review.
  const ui: UiChange[] = []
  const uiNotes: string[] = []
  let uiUnknown = false
  let work = ''
  {
    let last: UiId[] = []
    let carry: 'hide' | 'show' | undefined
    for (const piece of text.split(/([,;.!?]|\b(?:but|and then|then|however|except|also)\b)/i)) {
      if (!piece.trim() || /^([,;.!?]|but|and then|then|however|except|also)$/i.test(piece.trim())) {
        work += ` ${piece} `
        continue
      }
      const r = uiClause(piece, look, last, carry)
      ui.push(...r.changes)
      uiNotes.push(...r.notes)
      uiUnknown ||= r.unknown
      last = r.last
      carry = r.verb
      if (!r.screen) work += ` ${piece} `
    }
  }
  // Each clause on its own, so "skip the deployer but don't skip the tester" reads both ways.
  const clauses = norm(work).split(/\b(?:but|and then|then|however|except|also)\b|[,;.]/).map((c) => ` ${c.trim()} `).filter((c) => c.trim())
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
  // Modes you asked to turn off or refused: never turned on, and said back as they are.
  const offAsked = new Set<Mode>()
  want.push(...ui)
  for (const c of clauses) {
    const no = KEEP.test(c)
    const off = OFF.test(c)
    const skip = /\b(skip|skipping|drop|remove|cut|without|no|turn off|switch off|bypass|ditch|lose)\b/.test(c)
    if (/\b(incident|outage|emergency|sev ?[0-2]|hotfix|on fire|asap)\b/.test(c)) {
      if (off || /\b(dont|do not|never|not|no longer|no more)\b/.test(c)) {
        offAsked.add('incident')
        continue
      }
      if (!no) incident = true
    }
    // Synthetic tests as the rollout's measure of success, and a notification at each stage, unless refused.
    const refused = /\b(dont|do not|never|no|not)\b/.test(c) || off
    if (/\bsynthetics?\b/.test(c) && refused) {
      offAsked.add('synth')
      continue
    }
    if (/\b(notif\w*|notify|ping|alert|alerts)\b/.test(c) && refused) {
      offAsked.add('notify')
      continue
    }
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
      const was = JSON.stringify([keep.review, keep.deployer, keep.stage10, [...keep.tasks], [...keep.farmers]])
      if (named(c, 'review') || /pull request|\bpr\b|before merging|asking me|ask me/.test(c)) keep.review = true
      if (named(c, 'deployer')) keep.deployer = true
      if (/10 ?%|canary|stage/.test(c) && !/each stage|every stage/.test(c)) keep.stage10 = true
      for (const f of ['tester', 'designer', 'builder', 'planner'] as FarmerId[]) if (named(c, f)) keep.farmers.add(f)
      for (const k of taskByWords(c.replace(KEEP, ' skip '))) keep.tasks.add(k.id)
      if (/\bcheck(s|ing)?\b|end to end|e2e/.test(c)) keep.tasks.add('e2e-check')
      if (/hard cases/.test(c)) for (const k of ctx.tasks.filter((x) => /-rest$/.test(x.id))) keep.tasks.add(k.id)
      // "Not sure" keeps nothing, so it isn't read as a request at all.
      if (JSON.stringify([keep.review, keep.deployer, keep.stage10, [...keep.tasks], [...keep.farmers]]) !== was) matched = true
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
    if (kept(c) || seen.has(k) || (!isUi(c) && active.has(k))) return false
    if (c.kind === 'removeFarmer' && !ctx.farmers.includes(c.farmer)) return false
    seen.add(k)
    return true
  })
  if (!changes.length) {
    // What you asked to keep or turn off, against what is on now: said as it is, never as "already so" when it isn't.
    const on = ctx.active ?? []
    const titleOn = (c: Change) => ctx.on?.find((r) => r.changes.some((x) => key(x) === key(c)))?.title ?? 'A change you made'
    const against = [...on.filter((c) => kept(c)), ...on.filter((c) => [...offAsked].some((m) => inMode(m, c)))]
    const titles = [...new Set(against.map(titleOn))]
    if (titles.length)
      return {
        kind: 'none',
        reply: `${titles.join(' and ')} ${titles.length > 1 ? 'are' : 'is'} on now, and ${titles.length > 1 ? 'they change' : 'it changes'} that. Turn ${titles.length > 1 ? 'them' : 'it'} off to put it back.`,
        chips: titles.map((x) => ({ label: `Turn off ${x}`, request: `turn off ${x}` })),
      }
    if (keep.review && ctx.autonomy?.ship === 'auto')
      return { kind: 'none', reply: 'Pull requests merge by themselves on this project now, since you let them.', chips: [{ label: 'Keep asking me', request: 'keep asking me before merging' }] }
    if (offAsked.size && !on.some((c) => [...offAsked].some((m) => inMode(m, c))))
      return { kind: 'none', reply: `${[...offAsked].map((m) => MODE_NAME[m]).join(' and ')} ${offAsked.size > 1 ? 'aren’t' : 'isn’t'} on, so there is nothing to turn off.`, chips: [] }
    if (uiNotes.length) return { kind: 'none', reply: [...new Set(uiNotes)].join(' '), chips: [] }
    if (uiUnknown) return { kind: 'none', reply: UI_CAN, chips: [] }
    if (matched) return { kind: 'none', reply: 'That is already how this project runs, so nothing changes.', chips: [] }
    // A question about the run is answered, not read as a change it can't make.
    if (/\?\s*$/.test(text.trim()) || QUESTION.test(t)) return { kind: 'not-a-change' }
    // About the screen, but no part of it I know: say what I can change.
    if (SCREEN.test(t) && /\b(remove|hide|get rid of|take away|move|change|show|bring back|make|resize|rename|recolou?r|colou?r|bigger|smaller)\b/.test(t)) return { kind: 'none', reply: UI_CAN, chips: [] }
    if (/\b(skip|change|switch|turn off|remove|stop|instead|notify|deploy|push|ship|page|paging|on ?call|pager|slack|email|rolls? back|rollback|when it)\b/.test(t)) return { kind: 'none', reply: CAN_DO, ...nearest(t, ctx) }
    return { kind: 'not-a-change' }
  }
  return { kind: 'changes', proposal: { title: titleOf(changes, incident), rows: rowsFor(changes, ctx) } }
}

export const key = (c: Change) => `${c.kind}:${'task' in c ? c.task : 'farmer' in c ? c.farmer : isUi(c) ? `${c.el}:${uiValue(c)}` : ''}`
const uiValue = (c: UiChange) => (c.kind === 'ui' ? (c.show ? 'show' : 'hide') : c.kind === 'uiMove' ? `${c.to}${c.of ? `-${c.of}` : ''}` : c.kind === 'uiSize' ? c.size : c.kind === 'uiLabel' ? c.label : c.kind === 'uiColor' ? c.color : '')

function titleOf(changes: Change[], incident: boolean) {
  if (incident || (changes.some((c) => c.kind === 'setRollout') && changes.some((c) => c.kind === 'setAutonomy'))) return 'Incident mode'
  if (changes.every((c) => c.kind === 'notifyOn')) return 'Stage alerts'
  if (changes.every(isUi)) return changes.length === 1 ? uiTitle(changes[0] as UiChange) : 'Screen changes'
  if (changes.some((c) => c.kind === 'setRolloutCheck')) return 'Synthetic checks'
  if (changes.every((c) => c.kind === 'removeTask')) return changes.length === 1 ? 'Skipped task' : 'Skipped tasks'
  return 'Changed plan'
}

// One row per change: what it does, in the person's terms, and what it costs in safety.
export function rowsFor(changes: Change[], ctx: Ctx): ChangeRow[] {
  const name = (id: string) => ctx.tasks.find((k) => k.id === id)?.name ?? id
  const noDeployer = changes.some((c) => c.kind === 'removeFarmer')
  const look = lookOf(ctx)
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
      case 'ui': {
        const part = uiPart(c.el)
        return { id, change: c, label: `${c.show ? 'Show' : 'Hide'} the ${part?.name ?? c.el}`, loss: c.show ? undefined : part?.instead }
      }
      case 'uiMove': {
        const where: Record<UiPlace, string> = { left: 'to the left', start: 'first', end: 'last', before: `left of the ${uiPart(c.of ?? '')?.name}`, after: `next to the ${uiPart(c.of ?? '')?.name}` }
        return { id, change: c, label: `${c.to === 'start' || c.to === 'end' ? 'Put' : 'Move'} the ${uiPart(c.el)?.name} ${where[c.to]}` }
      }
      case 'uiSize': {
        const d = c.size - (look.size[c.el] ?? 0)
        return { id, change: c, label: c.size === 0 ? `Put the ${uiPart(c.el)?.name} back to the usual size` : `Make the ${uiPart(c.el)?.name} ${Math.abs(d) > 1 ? 'much ' : ''}${d > 0 ? 'bigger' : 'smaller'}` }
      }
      case 'uiLabel':
        return { id, change: c, label: `Rename “${look.label[c.el] ?? uiPart(c.el)?.text ?? c.el}” to “${c.label}”` }
      case 'uiColor':
        return { id, change: c, label: `Make the ${uiPart(c.el)?.name} ${colorName(c.color)}` }
      case 'uiReset':
        return { id, change: c, label: `Put the ${uiPart(c.el)?.name} back as ${uiPart(c.el)?.plural ? 'they were' : 'it was'}` }
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
  const look = lookOf(ctx)
  for (const raw of out.changes ?? []) {
    const c = raw as Record<string, unknown>
    if (c.kind === 'removeTask' && typeof c.task === 'string' && ctx.tasks.some((k) => k.id === c.task && !k.gate)) ok.push({ kind: 'removeTask', task: c.task })
    if (c.kind === 'removeFarmer' && c.farmer === 'deployer' && ctx.farmers.includes('deployer')) ok.push({ kind: 'removeFarmer', farmer: 'deployer' })
    if (c.kind === 'setAutonomy') ok.push({ kind: 'setAutonomy', moment: 'ship', value: 'auto' })
    if (c.kind === 'setRollout') ok.push({ kind: 'setRollout', stages: 'everyone' })
    if (c.kind === 'setRolloutCheck') ok.push({ kind: 'setRolloutCheck', check: 'synthetics' })
    if (c.kind === 'setDoneWhen' && typeof c.task === 'string' && typeof c.doneWhen === 'string' && ctx.tasks.some((k) => k.id === c.task)) ok.push({ kind: 'setDoneWhen', task: c.task, doneWhen: c.doneWhen.slice(0, 120) })
    if (c.kind === 'notifyOn') ok.push({ kind: 'notifyOn', on: 'stage' })
    // The screen: each kind checked against what its part allows.
    const el = typeof c.el === 'string' && uiPart(c.el) ? (c.el as UiId) : null
    const part = el ? uiPart(el) : undefined
    if (!el || !part) continue
    if (c.kind === 'ui' && part.can.includes('hide')) ok.push({ kind: 'ui', el, show: c.show === true })
    if (c.kind === 'uiMove' && part.can.includes('move') && typeof c.to === 'string' && ['start', 'end', 'left', 'before', 'after'].includes(c.to)) {
      const to = c.to as UiPlace
      const of = typeof c.of === 'string' && (BAR_IDS as string[]).includes(c.of) && c.of !== el ? (c.of as UiId) : undefined
      if (to !== 'before' && to !== 'after') ok.push({ kind: 'uiMove', el, to })
      else if (of) ok.push({ kind: 'uiMove', el, to, of })
    }
    if (c.kind === 'uiSize' && part.sizes && (c.size === 'bigger' || c.size === 'smaller' || c.size === 'default')) {
      const now = look.size[el] ?? 0
      ok.push({ kind: 'uiSize', el, size: c.size === 'default' ? 0 : Math.max(part.sizes[0], Math.min(part.sizes[1], now + (c.size === 'bigger' ? 1 : -1))) })
    }
    if (c.kind === 'uiLabel' && part.can.includes('label') && typeof c.label === 'string') {
      const label = cleanLabel(c.label).slice(0, LABEL_MAX).trim()
      if (label) ok.push({ kind: 'uiLabel', el, label })
    }
    const color = COLORS.find((k) => k.id === c.color || k.name === c.color)
    if (c.kind === 'uiColor' && part.can.includes('color') && color) ok.push({ kind: 'uiColor', el, color: color.id })
    if (c.kind === 'uiReset') ok.push({ kind: 'uiReset', el })
  }
  const active = new Set((ctx.active ?? []).map(key))
  const seen = new Set<string>()
  const changes = ok.filter((c) => (isUi(c) ? !uiNoop(c, look) : !active.has(key(c))) && !seen.has(key(c)) && !!seen.add(key(c)))
  if (!changes.length) return null
  return { title: (typeof out.title === 'string' && out.title.trim().slice(0, 24)) || titleOf(changes, false), rows: rowsFor(changes, ctx) }
}

// The JSON schema the live Planner answers with.
export function reshapeSchema(ctx: Ctx) {
  const taskIds = ctx.tasks.map((k) => k.id)
  const nonGate = ctx.tasks.filter((k) => !k.gate).map((k) => k.id)
  const part = (can?: UiCan) => {
    const ps = UI_PARTS.filter((p) => !can || p.can.includes(can))
    return { type: 'string', enum: ps.map((p) => p.id), description: ps.map((p) => `${p.id}: the ${p.name}`).join('; ') }
  }
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
      title: { type: 'string', description: 'Two or three words naming what changes, such as "Incident mode" or "Hidden PR button"' },
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
            obj('ui', { el: part('hide'), show: { type: 'boolean', description: 'true brings it back, false hides it' } }),
            obj('uiMove', {
              el: part('move'),
              to: { type: 'string', enum: ['start', 'end', 'left', 'before', 'after'], description: 'start: first of the right-hand buttons; end: last; left: the left side, beside home; before or after: beside the part named in of' },
              of: { type: 'string', enum: [...BAR_IDS, 'none'], description: 'The part to go before or after; none for start, end and left' },
            }),
            obj('uiSize', { el: part('size'), size: { type: 'string', enum: ['bigger', 'smaller', 'default'] } }),
            obj('uiLabel', { el: part('label'), label: { type: 'string', description: `The button's new text, ${LABEL_MAX} characters at most` } }),
            obj('uiColor', { el: part('color'), color: { type: 'string', enum: COLORS.map((k) => k.name) } }),
            obj('uiReset', { el: part() }),
          ],
        },
      },
    },
  }
}

// A part of the screen in a word or two, for a chip's title.
const uiShort = (id: UiId) => ({ pr: 'PR button', inbox: 'inbox', spend: 'spend', agents: 'agents', skip: 'skip', play: 'play', settings: 'settings', home: 'home button', sampleTag: 'tag', chips: 'chips', progress: 'task count', proofPops: 'pop-ups', bubbles: 'bubbles', plotLabels: 'labels', chickens: 'chickens' })[id]
function uiTitle(c: UiChange) {
  const s = uiShort(c.el)
  switch (c.kind) {
    case 'ui':
      return `${c.show ? 'Shown' : 'Hidden'} ${s}`
    case 'uiMove':
      return `Moved ${s}`
    case 'uiSize':
      return `${c.size > 0 ? 'Bigger' : c.size < 0 ? 'Smaller' : 'Usual-size'} ${s}`
    case 'uiLabel':
      return `Renamed ${s}`
    case 'uiColor':
      return `${colorName(c.color).charAt(0).toUpperCase()}${colorName(c.color).slice(1)} ${s}`
    case 'uiReset':
      return `Reset ${s}`
  }
}
