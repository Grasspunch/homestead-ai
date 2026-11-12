// The parts of the screen you can ask the Planner to change: hide or bring back ("remove the pull request button"),
// move ("put the inbox on the left"), resize ("make the plot labels bigger"), rename ("call the inbox Questions")
// and recolour ("make the spend counter green"). Each part has the words people use for it and what it allows.

export type UiId = 'pr' | 'inbox' | 'spend' | 'agents' | 'skip' | 'play' | 'settings' | 'home' | 'sampleTag' | 'chips' | 'progress' | 'proofPops' | 'bubbles' | 'plotLabels' | 'chickens'

// What a part allows. Hide covers bringing it back.
export type UiCan = 'hide' | 'move' | 'size' | 'label' | 'color'

export interface UiPart {
  id: UiId
  name: string // as the change card says it: "Hide the pull request button"
  words: RegExp // matched against the normalised request
  loose?: RegExp // a looser name, read only next to a screen verb such as move, rename or bigger: "rename pull request"
  instead?: string // where it still is, when you hide it
  stays?: string // why it can't be hidden
  can: UiCan[]
  text?: string // its label today, for a part you can rename
  sizes?: [number, number] // the steps it allows, smallest and biggest; 0 is as it ships
  plural?: boolean
}

const BAR_CAN: UiCan[] = ['hide', 'move', 'size', 'label', 'color']

export const UI_PARTS: UiPart[] = [
  { id: 'pr', name: 'pull request button', words: /\b(pull request|pr) (button|link|tab)\b|\bpull request\b(?= (at|in|on) the top)|\bpr button\b/, loose: /\b(pull request|pr)\b/, instead: 'The chest on the farm still opens the pull request', can: BAR_CAN, text: 'Pull request', sizes: [-2, 2] },
  { id: 'inbox', name: 'inbox button', words: /\b(inbox|mail|mailbox|envelope|letters?)\b/, instead: 'The mailbox on the farm still opens it, and asks still pop up', can: BAR_CAN, text: 'Inbox', sizes: [-2, 2] },
  { id: 'spend', name: 'spend counter', words: /\b(spend|spent|cost|costs|coin|coins|money|dollars?|price|usage) ?(counter|button|badge|total|meter)?\b/, instead: 'The coins on the farm still open your spend', can: BAR_CAN, text: 'Spend', sizes: [-2, 2] },
  // Not on the bar as it ships: the demo run's release puts it in the spend counter's place (see App's Top).
  { id: 'agents', name: 'agents button', words: /\bagents? (dashboard|button|board|panel)\b/, instead: 'Each agent’s page is still a click on its farmer', can: ['hide', 'size', 'label', 'color'], text: 'Agents', sizes: [-2, 2] },
  { id: 'skip', name: 'skip button', words: /\bskip (button|icon|ahead button|forward)\b|\bfast ?forward\b/, can: BAR_CAN, text: 'Skip', sizes: [-2, 2] },
  { id: 'play', name: 'play button', words: /\b(play|pause|play ?pause) (button|icon)\b/, loose: /\b(play|pause)\b/, stays: 'The play button stays, so you can always pause the run.', can: ['move', 'size', 'color'], sizes: [-2, 2] },
  { id: 'settings', name: 'settings button', words: /\b(settings?|gear|cog) ?(button|icon)?\b/, stays: 'The settings button stays, so Your flow is always one click away.', can: ['move', 'size', 'label', 'color'], text: 'Settings', sizes: [-2, 2] },
  { id: 'home', name: 'home button', words: /\bhome (button|icon)\b|\bhouse (button|icon)\b/, loose: /\b(home|house)\b/, instead: 'Escape, then the farms list, still takes you home', can: BAR_CAN, text: 'Your farms', sizes: [-2, 2] },
  { id: 'sampleTag', name: 'simulated tag', words: /\b(simulated|sample|demo) (tag|label|badge|pill)\b/, can: ['hide'] },
  { id: 'chips', name: 'change chips', words: /\b(change|mode|incident|reshape) (chips?|tags?|pills?)\b/, instead: 'Settings still lists Your flow', can: ['hide'], plural: true },
  { id: 'progress', name: 'task count', words: /\b(task count|tasks done|progress|of \d+ tasks|subtitle)\b/, can: ['hide'] },
  { id: 'proofPops', name: 'check pop-ups', words: /\b(check|proof|test|result|done)s? ?(pop ?ups?|popups?|bubbles?|cards?|toasts?)\b|\bpop ?ups?\b/, instead: 'Each plot’s label still shows how it went', can: ['hide', 'size'], sizes: [0, 2], plural: true },
  { id: 'bubbles', name: 'speech bubbles', words: /\b(speech|emote|emoji|thought) ?(bubbles?|icons?)\b|\bbubbles?\b/, can: ['hide', 'size'], sizes: [0, 2], plural: true },
  { id: 'plotLabels', name: 'plot labels', words: /\b(plot|task|crop) (labels?|names?|signs?|tags?)\b/, loose: /\blabels\b/, can: ['hide', 'size'], sizes: [0, 2], plural: true },
  { id: 'chickens', name: 'chickens', words: /\b(chickens?|hens?|animals?)\b/, can: ['hide'], plural: true },
]

export const uiPart = (id: string) => UI_PARTS.find((x) => x.id === id)
const the = (id: UiId) => `the ${uiPart(id)?.name ?? id}`
const isAre = (id: UiId) => (uiPart(id)?.plural ? 'are' : 'is')

// The top bar, left to right. The title sits between the left group and the right one.
export type BarSlot = UiId | 'title'
export const BAR_DEFAULT: BarSlot[] = ['home', 'title', 'pr', 'inbox', 'spend', 'play', 'skip', 'settings']
export const BAR_IDS = BAR_DEFAULT.filter((x): x is UiId => x !== 'title')

// Colours come from the HUD's own buttons and tokens, never free CSS.
export type UiColor = 'white' | 'cream' | 'tan' | 'brown' | 'leaf' | 'berry' | 'sky' | 'gold'
export const COLORS: { id: UiColor; name: string; words: RegExp }[] = [
  { id: 'white', name: 'white', words: /\bwhite\b/ },
  { id: 'cream', name: 'cream', words: /\b(cream|beige|ivory)\b/ },
  { id: 'tan', name: 'tan', words: /\b(tan|wood|wooden|sand)\b/ },
  { id: 'brown', name: 'brown', words: /\b(brown|dark)\b/ },
  { id: 'leaf', name: 'green', words: /\b(green|leaf)\b/ },
  { id: 'berry', name: 'red', words: /\b(red|berry)\b/ },
  { id: 'sky', name: 'blue', words: /\b(blue|sky)\b/ },
  { id: 'gold', name: 'gold', words: /\b(gold|golden|yellow|honey)\b/ },
]
export const colorName = (c: UiColor) => COLORS.find((x) => x.id === c)?.name ?? c
const OTHER_COLOR = /\b(purple|pink|orange|black|gr[ae]y|teal|cyan|magenta|violet|navy|lime|silver|maroon|turquoise|indigo|rainbow|transparent)\b|#[0-9a-f]{3,6}\b|\brgb\b/

export type UiPlace = 'start' | 'end' | 'left' | 'before' | 'after'
export type UiChange =
  | { kind: 'ui'; el: UiId; show: boolean } // hide a part, or bring it back
  | { kind: 'uiMove'; el: UiId; to: UiPlace; of?: UiId } // start/end of the right group, left (beside home), or before/after a part
  | { kind: 'uiSize'; el: UiId; size: number } // steps from as it ships: -2 to 2
  | { kind: 'uiLabel'; el: UiId; label: string }
  | { kind: 'uiColor'; el: UiId; color: UiColor }
  | { kind: 'uiReset'; el: UiId } // back as it shipped

const UI_KINDS = new Set(['ui', 'uiMove', 'uiSize', 'uiLabel', 'uiColor', 'uiReset'])
export const isUi = (c: { kind: string }): c is UiChange => UI_KINDS.has(c.kind)
export type UiProp = 'hide' | 'move' | 'size' | 'label' | 'color'
export const propOf = (c: UiChange): UiProp | 'all' => (c.kind === 'ui' ? 'hide' : c.kind === 'uiMove' ? 'move' : c.kind === 'uiSize' ? 'size' : c.kind === 'uiLabel' ? 'label' : c.kind === 'uiColor' ? 'color' : 'all')
export const LABEL_MAX = 20

// How the screen looks after every change you made.
export interface UiLook {
  hidden: UiId[]
  order: BarSlot[]
  size: Partial<Record<UiId, number>>
  label: Partial<Record<UiId, string>>
  color: Partial<Record<UiId, UiColor>>
}

export function moved(order: BarSlot[], m: { el: UiId; to: UiPlace; of?: UiId }): BarSlot[] {
  if ((m.to === 'before' || m.to === 'after') && (!m.of || m.of === m.el || !order.includes(m.of))) return order
  const rest = order.filter((x) => x !== m.el)
  const at = m.to === 'start' ? rest.indexOf('title') + 1 : m.to === 'end' ? rest.length : m.to === 'left' ? rest.indexOf('title') : rest.indexOf(m.of!) + (m.to === 'after' ? 1 : 0)
  return [...rest.slice(0, at), m.el, ...rest.slice(at)]
}

// This farm's changes come first, then Your flow, per part and per property: the latest one wins, and a reset
// takes every property of its part back to how it ships.
export function uiLookOf(farm: { kind: string }[], flow: { kind: string }[] = []): UiLook {
  const g = flow.filter(isUi)
  const f = farm.filter(isUi)
  const seq = [...g.map((c, i) => ({ c, i, farm: false })), ...f.map((c, i) => ({ c, i: g.length + i, farm: true }))]
  const eff = (el: UiId, prop: UiProp) => {
    const pick = (mine: boolean) => [...seq].reverse().find((x) => x.farm === mine && x.c.el === el && (propOf(x.c) === prop || x.c.kind === 'uiReset'))
    const x = pick(true) ?? pick(false)
    return x && x.c.kind !== 'uiReset' ? x : undefined
  }
  const look: UiLook = { hidden: [], order: [...BAR_DEFAULT], size: {}, label: {}, color: {} }
  const moves: { c: UiChange; i: number }[] = []
  for (const p of UI_PARTS) {
    const h = eff(p.id, 'hide')?.c
    if (h?.kind === 'ui' && !h.show) look.hidden.push(p.id)
    const s = eff(p.id, 'size')?.c
    if (s?.kind === 'uiSize' && s.size) look.size[p.id] = s.size
    const l = eff(p.id, 'label')?.c
    if (l?.kind === 'uiLabel') look.label[p.id] = l.label
    const k = eff(p.id, 'color')?.c
    if (k?.kind === 'uiColor') look.color[p.id] = k.color
    const m = eff(p.id, 'move')
    if (m) moves.push(m)
  }
  for (const m of moves.sort((a, b) => a.i - b.i)) if (m.c.kind === 'uiMove') look.order = moved(look.order, m.c)
  return look
}

// What a reset would change: nothing means the part is already as it ships.
const changedProps = (el: UiId, look: UiLook) =>
  [look.hidden.includes(el) && 'hide', look.order.indexOf(el) !== BAR_DEFAULT.indexOf(el) && 'move', !!look.size[el] && 'size', !!look.label[el] && 'label', !!look.color[el] && 'color'].filter((x): x is UiProp => !!x)

// A change that would leave the screen as it is.
export function uiNoop(c: UiChange, look: UiLook): boolean {
  switch (c.kind) {
    case 'ui':
      return look.hidden.includes(c.el) === !c.show
    case 'uiMove':
      return moved(look.order, c).join() === look.order.join()
    case 'uiSize':
      return (look.size[c.el] ?? 0) === c.size
    case 'uiLabel':
      return (look.label[c.el] ?? uiPart(c.el)?.text) === c.label
    case 'uiColor':
      return (look.color[c.el] ?? 'white') === c.color
    case 'uiReset':
      return !changedProps(c.el, look).length
  }
}

// ---- reading a request ----

const APOS = /[´`’‘ʼ′]/g
export const norm = (s: string) => ` ${s.toLowerCase().replace(APOS, "'").replace(/n't\b/g, 'nt').replace(/'/g, '').replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ')} `

const HIDE = /\b(remove|hide|get rid of|take away|take out|drop|lose|ditch|turn off|switch off|kill|delete|dont show|do not show|dont need|dont want|no more|without|stop showing)\b/
const SHOW = /\b(show|bring back|add back|restore|unhide|turn on|switch on|i want|i need|give me) (the )?/
// Words that say a request is about the screen, not the run.
export const SCREEN = /\b(button|buttons|icon|icons|tag|tags|badge|badges|counter|pop ?ups?|popups?|bubbles?|labels?|chips?|pills?|bar|top|corner|header|title|screen|ui|interface|panel|menu|link|tab|display)\b/
const BIGGER = /\b(bigger|larger|enlarge|grow|big|large|huge|giant|biggest|largest|bump up|scale up)\b/
const SMALLER = /\b(smaller|tinier|shrink|small|tiny|smallest|scale down)\b/
const MUCH = /\b(much|a lot|way|lots|biggest|largest|smallest|huge|giant|tiny|as big as|as small as|max|maximum|minimum)\b/
const USUAL_SIZE = /\b(normal|usual|default|regular|original|standard) size\b|\bsize back\b/
const PAINT = /\b(make|turn|paint|colou?r|recolou?r|change|set|switch|in)\b/
const MOVE = /\b(move|put|place|shift|swap|drag|stick|want|like|prefer|have|keep|should|go|sit)\b/
const RESET = /\breset\b|\b(put|set|change|turn|make|move|switch)\b.*\bback\b|\bback to (normal|default|the default|how it was|as it was|the way it was)\b|\bas it was\b|\b(undo|revert)\b/
const PRONOUN = /\b(it|them|that one|this one|that|this|those|these)\b/
const ONLY_PRONOUN = /^ (it|them|that one|this one|that|this|those|these|the button|that button|this button) $/

// Where in the bar, in the person's words. Before or after a part needs the part.
const SIDES: [RegExp, UiPlace][] = [
  [/\b(?:right next to|next to|beside|by|right after|after|to the right of|right of)\s+(.+)$/, 'after'],
  [/\b(?:just before|before|to the left of|left of|in front of)\s+(.+)$/, 'before'],
  [/\b(?:to|on|at|over to|onto|over on) the (?:far )?left\b|\bleft (?:side|hand side|corner|end)\b|\bleftmost\b|\bleft\s*$/, 'left'],
  [/\b(?:to|on|at|over to|onto|over on) the (?:far )?right\b|\bright (?:side|hand side|corner|end)\b|\brightmost\b|\bright\s*$/, 'end'],
  [/\b(?:first|at the (?:start|beginning|front)|to the (?:start|beginning|front))\b/, 'start'],
  [/\b(?:last|at the end|to the end)\b/, 'end'],
]

const partsIn = (c: string, ids?: UiId[]) => {
  const pool = ids ? UI_PARTS.filter((p) => ids.includes(p.id)) : UI_PARTS
  const strict = pool.filter((p) => p.words.test(c))
  // The most specific part wins: "pull request button" over "button", "spend" never by the pull request's own words.
  const best = strict.filter((h) => !(h.id === 'spend' && strict.some((o) => o.id === 'pr')))
  return best.length ? best : pool.filter((p) => p.loose?.test(c))
}

export const cleanLabel = (s: string) => {
  const t = s
    .trim()
    .replace(/\s+(instead|please|thanks|thank you)\s*$/i, '')
    .replace(/^["“”'‘’«»]+|["“”'‘’«»]+$/g, '')
    .replace(/[.!?]+$/, '')
    .replace(/^["“”'‘’«»]+|["“”'‘’«»]+$/g, '')
    .trim()
  return t && t.charAt(0).toUpperCase() + t.slice(1)
}

// A rename in the person's own words and casing: "rename Pull request to Review", "call the inbox Questions".
function renameIn(raw: string): { part: string; label: string } | null {
  const r =
    raw.match(/\b(?:rename|relabel)\s+(.+?)\s+(?:to|as|into)\s+(.+)$/i) ??
    raw.match(/\b(?:change|set|switch)\s+(.+?)(?:'s|’s)?\s+(?:label|text|name|wording|title)\s+(?:to|as)\s+(.+)$/i) ??
    raw.match(/\b(?:make|have|let)\s+(.+?)\s+(?:say|read)\s+(.+)$/i) ??
    raw.match(/^(.+?)\s+should\s+(?:say|read|be called|be named)\s+(.+)$/i)
  if (r) return { part: r[1], label: r[2] }
  const c = raw.match(/(?:^|\s)(?:call|name|label)\s+(.+)$/i)
  if (!c) return null
  // "call the spend counter Budget": the longest start that names a part, and the rest is the new name.
  const words = c[1].trim().split(/\s+/)
  for (let i = words.length - 1; i >= 1; i--) {
    const part = words.slice(0, i).join(' ')
    if (partsIn(norm(part)).length || ONLY_PRONOUN.test(norm(part))) return { part, label: words.slice(i).join(' ') }
  }
  return null
}

export interface UiRead {
  changes: UiChange[]
  notes: string[] // what it can't do, or what is already so
  screen: boolean // the clause is about the screen, so it never changes the run
  unknown: boolean // a screen change for a part it doesn't know
  last: UiId[] // the parts it named, for an "it" in the next clause
  verb?: 'hide' | 'show'
}

const CAN_VERB: Record<UiCan, string> = { hide: 'hide', move: 'move', size: 'resize', label: 'rename', color: 'recolour' }
const partsThatCan = (can: UiCan) => {
  const ps = UI_PARTS.filter((p) => p.can.includes(can))
  const names = ps.map((p) => p.name.replace(/ (button|counter)$/, ''))
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
const cant = (id: UiId, can: UiCan) =>
  can === 'hide' && uiPart(id)?.stays ? uiPart(id)!.stays! : `I can’t ${CAN_VERB[can]} ${the(id)}. I can ${CAN_VERB[can]} the ${partsThatCan(can)}${can === 'size' || can === 'hide' ? '' : ' buttons'}.`
export const COLOR_LIST = `I can colour the top bar buttons ${COLORS.slice(0, -1).map((c) => c.name).join(', ')} or ${COLORS[COLORS.length - 1].name}.`
export const UI_CAN =
  'I can change these parts of the screen. Top bar buttons: move, resize, rename, recolour or hide them (play and settings always stay). Plot labels, speech bubbles and check pop-ups: resize or hide. Chickens, change chips, task count and simulated tag: hide.'

// One clause of a request: the screen changes it asks for, read against how the screen looks now.
export function uiClause(raw: string, look: UiLook, last: UiId[] = [], carry?: 'hide' | 'show'): UiRead {
  const out: UiRead = { changes: [], notes: [], screen: false, unknown: false, last }
  // "move the inbox to the left and make it green": each verb on its own.
  const subs = raw.split(/\s+and\s+(?=(?:then\s+)?(?:make|move|put|rename|call|hide|remove|show|bring|turn|colou?r|paint|change|set|reset|place|shift)\b)/i)
  for (const s of subs) {
    const r = one(s, look, out.last, carry)
    out.changes.push(...r.changes)
    out.notes.push(...r.notes)
    out.screen ||= r.screen
    out.unknown ||= r.unknown
    if (r.last.length) out.last = r.last
    if (r.verb) carry = out.verb = r.verb
  }
  return out
}

function one(raw: string, look: UiLook, last: UiId[], carry?: 'hide' | 'show'): UiRead {
  const c = norm(raw)
  const out: UiRead = { changes: [], notes: [], screen: false, unknown: false, last: [] }
  const strict = UI_PARTS.filter((p) => p.words.test(c))
  const ids = (list: UiPart[]) => list.map((p) => p.id)
  const subject = (text: string) => {
    const ps = ids(partsIn(text))
    return ps.length ? ps : PRONOUN.test(text) ? last : []
  }
  const done = (els: UiId[]) => {
    out.screen = true
    out.last = els
    return out
  }
  const nothing = (screeny: boolean) => {
    if (screeny) out.unknown = true
    out.screen = screeny || strict.length > 0
    if (strict.length) out.last = ids(strict)
    return out
  }

  // Rename.
  const rn = renameIn(raw)
  if (rn) {
    const p = norm(rn.part)
    const named = ids(partsIn(p))
    const els = named.length ? named : ONLY_PRONOUN.test(p) ? last : []
    const label = cleanLabel(rn.label)
    if (!els.length || !label) return nothing(SCREEN.test(p))
    for (const el of els) {
      if (!uiPart(el)?.can.includes('label')) out.notes.push(cant(el, 'label'))
      else if (label.length > LABEL_MAX) out.notes.push(`“${label}” is too long for a button. Keep it to ${LABEL_MAX} letters or fewer.`)
      else if ((look.label[el] ?? uiPart(el)?.text) === label) out.notes.push(`${cap(the(el))} already says “${label}”.`)
      else out.changes.push({ kind: 'uiLabel', el, label })
    }
    return done(els)
  }

  // Size.
  const usual = USUAL_SIZE.test(c)
  if (usual || BIGGER.test(c) || SMALLER.test(c)) {
    const els = subject(c)
    if (!els.length) return nothing(SCREEN.test(c) || /\b(font|text)\b/.test(c))
    const step = usual ? 0 : (BIGGER.test(c) ? 1 : -1) * (MUCH.test(c) ? 2 : 1)
    for (const el of els) {
      const p = uiPart(el)!
      if (!p.can.includes('size') || !p.sizes) {
        out.notes.push(cant(el, 'size'))
        continue
      }
      const now = look.size[el] ?? 0
      const want = usual ? 0 : Math.max(p.sizes[0], Math.min(p.sizes[1], now + step))
      if (want !== now) out.changes.push({ kind: 'uiSize', el, size: want })
      else out.notes.push(usual ? `${cap(the(el))} ${isAre(el)} already the usual size.` : `${cap(the(el))} ${isAre(el)} as ${step > 0 ? 'big' : 'small'} as ${p.plural ? 'they go' : 'it goes'}.`)
    }
    return done(els)
  }

  // Colour.
  const colour = COLORS.find((k) => k.words.test(c))
  const other = c.match(OTHER_COLOR)
  if ((colour || other) && PAINT.test(c) && !HIDE.test(c)) {
    const els = subject(c)
    if (els.length) {
      for (const el of els) {
        if (!uiPart(el)?.can.includes('color')) out.notes.push(cant(el, 'color'))
        else if (!colour) out.notes.push(`I can’t make it ${other![0].trim()}. ${COLOR_LIST}`)
        else if ((look.color[el] ?? 'white') === colour.id) out.notes.push(`${cap(the(el))} ${isAre(el)} already ${colour.name}.`)
        else out.changes.push({ kind: 'uiColor', el, color: colour.id })
      }
      return done(els)
    }
  }

  // Move.
  if (MOVE.test(c)) {
    for (const [re, to] of SIDES) {
      const m = c.match(re)
      if (!m) continue
      let of: UiId | undefined
      if (to === 'before' || to === 'after') {
        const target = partsIn(` ${m[1]} `, BAR_IDS)
        if (!target.length) continue
        of = target[0].id
      }
      const els = subject(c.slice(0, m.index))
      if (!els.length) return nothing(SCREEN.test(c))
      for (const el of els) {
        if (!uiPart(el)?.can.includes('move')) {
          out.notes.push(cant(el, 'move'))
          continue
        }
        const ch: UiChange = { kind: 'uiMove', el, to, ...(of ? { of } : {}) }
        if (moved(look.order, ch).join() === look.order.join()) out.notes.push(`${cap(the(el))} ${isAre(el)} already there.`)
        else out.changes.push(ch)
      }
      return done(els)
    }
  }

  // Back as it was: "put the inbox back", "reset the spend counter".
  if (RESET.test(c) && !/\b(limit|budget|cap)\b/.test(c)) {
    const els = subject(c)
    if (els.length) {
      for (const el of els) {
        const props = changedProps(el, look)
        if (!props.length) out.notes.push(`${cap(the(el))} ${isAre(el)} already as ${uiPart(el)?.plural ? 'they were' : 'it was'}.`)
        // Only hidden: bringing it back says so.
        else out.changes.push(props.length === 1 && props[0] === 'hide' ? { kind: 'ui', el, show: true } : { kind: 'uiReset', el })
      }
      return done(els)
    }
  }

  // Hide or bring back.
  const hits = strict.length ? partsIn(c) : []
  const els = hits.length ? ids(hits) : HIDE.test(c) || SHOW.test(c) ? (PRONOUN.test(c) ? last : []) : []
  if (!els.length) return nothing(false)
  // A part named only by a word the run also uses ("cost", "progress"), with nothing else about the screen, is the run's.
  const screenish = !hits.length || SCREEN.test(c) || hits.some((h) => ['chickens', 'proofPops', 'bubbles', 'inbox'].includes(h.id))
  const hide = HIDE.test(c)
  const show = SHOW.test(c) && !hide
  const verb = hide ? 'hide' : show ? 'show' : hits.length ? carry : undefined
  if (!screenish || !verb) {
    out.last = ids(strict)
    out.screen = strict.length > 0 && screenish
    return out
  }
  for (const el of els) {
    if (!uiPart(el)?.can.includes('hide')) {
      if (verb === 'hide') out.notes.push(cant(el, 'hide'))
      else out.notes.push(`${cap(the(el))} ${isAre(el)} already showing.`)
      continue
    }
    const hidden = look.hidden.includes(el)
    if (hidden === (verb === 'hide')) out.notes.push(`${cap(the(el))} ${isAre(el)} already ${hidden ? 'hidden' : 'showing'}.`)
    else out.changes.push({ kind: 'ui', el, show: verb === 'show' })
  }
  out.verb = verb
  return done(els)
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
