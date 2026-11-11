// The scripted side of talking an ask through, used when no model can answer: it answers from what the ask says
// (its question, impact, basis and options), and never picks for you unless your words clearly do.
// It also holds the fast-path guard the ask card uses: only a plain, unconditional pick skips the talk.
import type { AskTalkIn, AskTalkOut } from './talk'
import { ownWayOf, type Talk } from './discuss'

type Ask = AskTalkIn['ask']

const APOS = /[´`’‘ʼ′]/g
// Lower case, apostrophes dropped ("don't" is "dont"), and only words, numbers and amounts kept.
const toks = (s: string) =>
  s
    .toLowerCase()
    .replace(APOS, "'")
    .replace(/'/g, '')
    .replace(/[^a-z0-9$%. ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
const padded = (s: string) => ` ${toks(s).join(' ')} `
const stem = (w: string) => w.slice(0, 5)

// Words that don't change what a short pick means: "ok, go with that one", "the builder is wrong".
const FILLER = new Set(
  'yes yep yeah yup sure ok okay fine go ahead do it that this those these sounds good great perfect agreed agree right lets let us please the a an to with take pick choose one way side option its is be for of on me i id ill im we and just then dollars wrong overrule mistaken thanks thank you'.split(' '),
)
// "but", "only", "first": a condition, which the options can't carry.
const CLAUSE = new Set('but except only first instead unless if though although provided until till after before also plus while rather cap capped max maximum most least without more less cheaper smaller bigger faster slower too'.split(' '))
const NEG = new Set('no not never nope nah neither none nor dont didnt doesnt cant cannot wont wouldnt shouldnt isnt arent wasnt havent stop wait hold later skip cancel avoid hate dislike against'.split(' '))
const QWORD = /^\s*(what|why|how|when|where|which|who|is|are|was|were|does|did|do|can|could|would|should|shall|will|may|might|has|have)\b/i
const AFFIRM = /^\s*(do it|do that|do so|can do|will do|is fine|is ok|is okay|are fine)\b/i

export function isQuestion(text: string) {
  const s = text.replace(APOS, "'")
  if (s.includes('?')) return true
  if (AFFIRM.test(s)) return false
  return QWORD.test(s) || /\b(tell me|explain|wondering|curious|what if|what happens|whats|hows)\b/i.test(s)
}

// The fast path: true only for an option's own words, or a short yes, no or naming that carries no question,
// condition or anything else. Everything else is talked through.
export function plainPick(text: string, options: string[], names: string[] = []): boolean {
  const said = toks(text)
  if (!said.length) return false
  if (options.some((o) => toks(o).join(' ') === said.join(' '))) return true
  if (isQuestion(text)) return false
  const known = new Set([...options.flatMap(toks), ...names.flatMap(toks)])
  const inOptions = (w: string) => known.has(w) || known.has(w.replace(/^\$/, '')) || known.has(`$${w}`) || (w.length >= 4 && [...known].some((k) => k.length >= 4 && k.slice(0, 4) === w.slice(0, 4)))
  // A no-word counts as an option's own only where the option has it the same way: "no refactor", "stop it".
  const negOk = (w: string, i: number) => options.some((o) => { const ot = toks(o); const j = ot.indexOf(w); return j === 0 || (j > 0 && ot[j + 1] !== undefined && ot[j + 1] === said[i + 1]) })
  for (const [i, w] of said.entries()) {
    if (NEG.has(w) ? negOk(w, i) : inOptions(w)) continue
    if (CLAUSE.has(w) || NEG.has(w)) return false
    if (!FILLER.has(w) && !/^\$?\d/.test(w)) return false
  }
  return true
}

// A request for more work: a review, more tests, a fix. Not a question asking what happened.
const WORK = /\b(review|reviewed|reviewer|adversarial|tests?|tested|testing|qa|audit|check|checked|recheck|fix|fixed|redo|rework|rename|colou?r|button|copy|wording|typo|bug|broken|polish|clean ?up|security|send (it )?back|look (at it )?again|another look)\b/
// "skip the review", "no more tests": waving a step off, not asking for one.
const WAIVE = /\b(skip|no|without|dont|not|never|forget|drop)( the| a| any| more| another)? (review|reviews|tests?|testing|qa|audit|checks?)\b/
const INFO = /^\s*(what(?! about)|why|how(?! about)|which|when|where|who|is|are|was|were|does|did|has)\b/i
export function isRequest(text: string) {
  const t = padded(text)
  return WORK.test(t) && !WAIVE.test(t) && !INFO.test(text.replace(APOS, "'"))
}

// A way of your own on a disagreement, past a leading no ("no, put it in the footer"). A step for the project,
// such as a review or more tests, is not a way to settle it.
export function ownWayIn(text: string, talk: Pick<Talk, 'sides'>): string | null {
  if (isRequest(text) || HOLD.test(padded(text))) return null
  const rest = text.replace(APOS, "'").replace(/^\s*(no|nope|nah|neither( of them| one)?|none of (these|them|those)|not either|i'?d rather not( do)?( either)?|i don'?t like (either|them|those|these))\b[\s,.:;!-]*/i, '')
  return ownWayOf(rest || text, talk.sides)
}

// A plain question the disagreement's sides can answer themselves: why, cost, time, compare.
export function sidesCanAnswer(text: string) {
  const t = padded(text)
  return isQuestion(text) && !isRequest(text) && !hasCondition(text) && /\b(why|reason|cost|costs|price|cheap|cheaper|expensive|money|how long|time|faster|slower|compare|difference|better|worse|versus|vs|pros|cons|which one|which is|both|each)\b/.test(t)
}

const COND = /\s*(?:,|;|\b)\s*\b(but|except|only if|only|as long as|so long as|provided|unless|though|although|and then|then|first|instead)\b/i
export function hasCondition(text: string) {
  return COND.test(` ${text.replace(APOS, "'")}`)
}

// The task a send-back note names: by its name, or by the agent who built it. Else the ask's task, else the first.
export function taskFor(note: string, tasks: { id: string; name: string; farmer: string; label?: string }[], fallback?: string) {
  const t = padded(note)
  const words = (s: string) => toks(s).filter((w) => w.length > 3)
  const byName = tasks
    .map((x) => ({ x, n: words(x.name).filter((w) => t.includes(` ${stem(w)}`)).length }))
    .filter((y) => y.n > 0)
    .sort((a, b) => b.n - a.n)
  if (byName.length && (byName.length === 1 || byName[0].n > byName[1].n)) return byName[0].x.id
  const byAgent = tasks.filter((x) => new RegExp(`\\b${(x.label ?? x.farmer).toLowerCase()}s?\\b`).test(t))
  if (byAgent.length) return byAgent[0].id
  return tasks.find((x) => x.id === fallback)?.id ?? tasks[0]?.id
}

// ---- the script --------------------------------------------------------------------

const sentences = (s?: string) => (s ? s.split(/(?<=[.!?])\s+/).filter(Boolean) : [])
const firstOf = (s?: string) => sentences(s)[0] ?? ''
const q = (o: string) => `“${o}”`
const orList = (xs: string[]) => (xs.length < 2 ? xs.map(q).join('') : `${xs.slice(0, -1).map(q).join(', ')} or ${q(xs[xs.length - 1])}`)
const SURE = { high: 'I’m sure', medium: 'I’m fairly sure', low: 'I’m not sure' } as const
// At most three sentences, so a reply stays short.
const short = (...parts: (string | undefined)[]) =>
  parts
    .filter(Boolean)
    .flatMap((p) => sentences(p))
    .slice(0, 3)
    .join(' ')
    .trim()

// What picking an option does, in one sentence, from the ask's own words where it has them.
export function meaning(o: string, a: Ask): string {
  const side = a.sides?.find((s) => s.option === o)
  if (side) return `${q(o)} is the ${side.label}’s way: ${firstOf(side.why) || side.position}`
  const about = (re: RegExp) => [...sentences(a.impact), ...sentences(a.basis)].find((s) => re.test(s.toLowerCase()))
  const amt = o.match(/\$\d+(\.\d+)?/)?.[0]
  if (/^not yet/i.test(o)) return `${q(o)} holds it: nothing moves until you say so.`
  if (/ship to everyone|ship to all/i.test(o)) return `${q(o)} puts it in front of every user at once${a.canSendBack ? ', with no 10% stage first' : ''}.`
  if (/^merge/i.test(o)) return `${q(o)} merges the pull request. ${firstOf(a.impact)}`.trim()
  if (/^stay at 10%/i.test(o)) return `${q(o)} keeps it with 10% of users, and nothing goes wider until you say so.`
  if (/^raise/i.test(o) && amt) return `${q(o)} lets it keep going until it has spent ${amt}.`
  if (/^split/i.test(o)) return about(/split/) ? `${q(o)}: ${about(/split/)}` : `${q(o)} cuts the task in two, each part with its own limit.`
  if (/^stop/i.test(o)) return about(/stop/) ? `${q(o)}: ${about(/stop/)}` : `${q(o)} stops it where it is, and its unfinished work stays out of the pull request.`
  if (/no refactor|keep it small/i.test(o)) return `${q(o)} keeps the change inside this task, so no other task’s code moves.`
  if (/^go ahead/i.test(o)) return `${q(o)} goes ahead as asked. ${firstOf(a.impact)}`.trim()
  if (/^fix/i.test(o)) return `${q(o)}: ${firstOf(a.impact) || 'the agent fixes it and the check runs again.'}`
  if (/^show me/i.test(o)) return `${q(o)} opens the task so you can look first; it decides nothing.`
  return `${q(o)} carries the task on that way.`
}

// The option a message names by its words, when exactly one does.
function named(t: string, a: Ask, among = a.options): string | null {
  // A word an option refuses ("no refactor") doesn't name it.
  const words = (o: string) => toks(o).filter((w, i, all) => w.length > 3 && !['no', 'not', 'without'].includes(all[i - 1]) && !['your', 'with', 'here', 'that', 'this', 'again', 'from'].includes(w))
  const scored = among.map((o) => ({ o, n: words(o).filter((w) => t.includes(` ${stem(w)}`)).length })).sort((x, y) => y.n - x.n)
  const side = a.sides?.filter((s) => new RegExp(`\\b${s.label.toLowerCase()}s?\\b`).test(t)) ?? []
  if (side.length === 1 && among.includes(side[0].option)) return side[0].option
  return scored[0]?.n && scored[0].n > (scored[1]?.n ?? 0) ? scored[0].o : null
}

// Options the message rules out: "don't stop it", "not the designer's way".
function ruledOut(t: string, a: Ask): string[] {
  return a.options.filter((o) => {
    const side = a.sides?.find((s) => s.option === o)
    if (side && new RegExp(`\\b(not|no|never|dont) (the )?${side.label.toLowerCase()}`).test(t)) return true
    const lead = toks(o).find((w) => w.length > 3)
    return !!lead && new RegExp(`\\b(not|no|never|dont|without|skip) (to )?(the |a )?${stem(lead)}`).test(t)
  })
}

const HOLD = /\b(not yet|wait|hold on|hold off|hold it|let me think|think about it|think it over|sleep on it|later|tomorrow|tonight|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|give me a (minute|moment|sec|second|bit)|pause|not now|not today|in a bit|need to think)\b/
const DATED = /\b(tomorrow|tonight|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/
const REJECT = /\b(neither|none of (these|them|those)|dont like|do not like|hate|dislike|not happy|not great|not good|not sure about|rather not|nope|nah|no|not that|not this|too (expensive|much|slow|risky|big|costly|pricey))\b/

const bothSides = (a: Ask) => short(...(a.sides ?? []).map((s) => `The ${s.label} wants ${q(s.option)}: ${firstOf(s.why) || s.position}`))

function answer(a: Ask, t: string, msg: string): string {
  const pick = named(t, a)
  const opt = /\b(what happens|what if|what would|mean|means|meaning|tell me more|more about|explain|what is|whats|what does)\b/.test(t)
  if (pick && (opt || !/\b(why|cost|price|money|risk|safe|long|time)\b/.test(t)))
    return short(meaning(pick, a), pick === a.suggested && a.basis ? `It’s what I suggest. ${a.basis}` : undefined)
  if (/\b(why|reason|how come|point of|need)\b/.test(t)) {
    if (a.sides?.length) {
      const who = a.sides.filter((s) => new RegExp(`\\b${s.label.toLowerCase()}s?\\b`).test(t))
      return short(...(who.length ? who : a.sides).map((s) => `The ${s.label}: ${firstOf(s.why) || s.position}`))
    }
    return short(firstOf(a.question), firstOf(a.impact), `That’s why I suggest ${q(a.suggested)}.`)
  }
  if (/\b(cost|costs|price|pricey|cheap|cheaper|expensive|afford|money|spend|spent|dollars?|budget|limit)\b|\$/.test(t)) {
    const priced = [...sentences(a.question), ...sentences(a.impact), ...sentences(a.basis)].filter((s) => /\$|cost|spen/i.test(s))
    const opts = a.options.filter((o) => /\$/.test(o))
    if (priced.length) return short(...priced.slice(0, 2), opts.length ? `The option with a number: ${orList(opts)}.` : undefined)
    return short('I don’t have a separate cost for this choice.', firstOf(a.impact))
  }
  if (/\b(how long|time|slow|slower|fast|faster|quick|minutes?|hours?|when)\b/.test(t)) {
    const timed = [...sentences(a.question), ...sentences(a.impact), ...sentences(a.basis)].filter((s) => /\bmin|minute|hour|second|day\b/i.test(s))
    return timed.length ? short(...timed.slice(0, 2)) : short('I don’t have a time for this beyond what it says here.', firstOf(a.impact))
  }
  if (/\b(risk|risky|safe|safely|danger|dangerous|break|breaks|undo|reversible|sure|confident|confidence|worst|go wrong)\b/.test(t)) {
    const sure = a.confidence && a.basis ? `${SURE[a.confidence]} about ${q(a.suggested)}: ${a.basis}` : undefined
    const guard = [...sentences(a.impact)].find((s) => /roll back|undo|hard to|users|break|test/i.test(s))
    if (!sure && a.sides?.length) return bothSides(a)
    return short(sure, guard ?? firstOf(a.impact)) || short(a.question)
  }
  // Anything else: the sentences of the ask that share words with the question, else the ask restated.
  const content = toks(msg).filter((w) => w.length > 4 && !['about', 'there', 'their', 'would', 'could', 'should', 'which', 'thing', 'things'].includes(w))
  const hits = [...sentences(a.question), ...sentences(a.impact), ...sentences(a.basis)].filter((s) => content.some((w) => s.toLowerCase().includes(stem(w))))
  if (hits.length) return short(...hits.slice(0, 2), `I suggest ${q(a.suggested)}.`)
  if (a.sides?.length) return bothSides(a)
  return short(firstOf(a.question), firstOf(a.impact), `I suggest ${q(a.suggested)}${a.basis ? `: ${firstOf(a.basis)}` : '.'}`)
}

export function askTalkSim(inp: AskTalkIn): AskTalkOut {
  const a = inp.ask
  const msg = inp.message.trim()
  const t = padded(msg)
  const out = (reply: string, extra: Partial<AskTalkOut> = {}): AskTalkOut => ({ reply, choice: null, sendBack: null, hold: false, ...extra })
  const others = `You can pick ${orList(a.options)}, hold this, or tell me what you’d rather do.`

  // More work on a pull request: send it back with their words as the note.
  if (a.canSendBack && isRequest(msg)) {
    const note = msg.replace(/^\s*(yes|ok|okay|sure|no|not yet)\b[\s,]*(but\s+)?/i, '').replace(/^\s*(can|could) (we|you)\s+/i, '').replace(/^\s*please\s+/i, '').replace(/[\s?]+$/, '')
    const body = note.charAt(0).toUpperCase() + note.slice(1)
    return out(`I can send it back with your note: “${body}”. The agent that built it changes it, another agent checks it, and the pull request comes back to you.`, { sendBack: body })
  }
  // Waiting is fine: the ask stays open and nothing moves.
  if (HOLD.test(t) && !/\b(dont|do not|no need to|cant|cannot|without) (wait|hold|pause)/.test(t)) {
    return out(DATED.test(t) ? 'I can’t set a date, but this waits for you: nothing moves on it until you come back and say so.' : 'Fine, take your time. Nothing moves on this until you say so, and you can ask me anything in the meantime.', { hold: true })
  }
  // Changing your mind before it's decided.
  if (/\b(changed my mind|change my mind|on second thought|second thoughts)\b/.test(t) && !named(t, a)) {
    return out(short('That’s fine, nothing is decided yet.', a.sides?.length ? a.sides.map((s) => `${q(s.option)} is the ${s.label}’s way.`).join(' ') : undefined, others))
  }
  // A step for the project, such as a review or more tests, where the options can't add one.
  if (isRequest(msg)) {
    const what = a.sides?.length ? 'That’s a step for the project, not a way to settle this, so I can’t pick it here.' : 'This question can’t add that by itself.'
    // Closest only when an option offers that very step: "more tests" and "test everything".
    const work = toks(msg).filter((w) => WORK.test(` ${w} `))
    const close = a.options.find((o) => work.some((w) => padded(o).includes(` ${w.slice(0, 4)}`)))
    return out(short(what, close ? `The closest here is ${q(close)}: ${meaning(close, a)}` : `The options are ${orList(a.options)}.`, 'You can also hold this, or ask the Planner to change the project.'), close ? { choice: close } : {})
  }
  // Waving the review off on the pull request: this is the review.
  if (a.canSendBack && WAIVE.test(t)) {
    const ship = a.options.filter((o) => !/^not yet/i.test(o))
    return out(short('This is the review, so there’s nothing else to skip.', ship.map((o) => meaning(o, a)).join(' '), 'Pick one and it goes.'))
  }
  if (isQuestion(msg)) return out(answer(a, t, msg))

  // A pick with a condition: "yes but cap it at $20", "merge it but only to staging".
  const m = msg.match(COND)
  if (m && m.index !== undefined && m.index > 0) {
    const head = msg.slice(0, m.index)
    const cond = msg.slice(m.index).replace(/^[\s,;]+/, '').replace(/^(but|and then|then)\s+/i, '')
    const hp = padded(head)
    const base = named(hp, a) ?? (/\b(yes|yep|yeah|sure|ok|okay|go|go ahead|do it|fine)\b/.test(hp) ? a.suggested : null)
    // The condition names an option that refuses what it refuses: "go ahead but don't refactor" is "no refactor".
    const refusing = a.options.find((o) => {
      const r = o.toLowerCase().match(/\b(?:no|not|without) ([a-z]{4,})/)
      return !!r && new RegExp(`\\b(no|not|never|dont|without|skip) (the |a |any )?${r[1].slice(0, 6)}`).test(padded(cond))
    })
    if (refusing && refusing !== base) return out(short(`${base ? `${q(base)} and “${cond}” pull different ways. ` : ''}The closest option is ${q(refusing)}.`, meaning(refusing, a)), { choice: refusing })
    const amount = cond.match(/\$\d+(\.\d+)?/)?.[0]
    return out(
      short(
        base ? `${meaning(base, a)}` : undefined,
        amount ? `I can’t set ${amount} from here: the options only offer ${orList(a.options)}.` : `“${cond.replace(/[.!]+$/, '')}” isn’t something this question can do; the options only offer ${orList(a.options)}.`,
        base ? `Pick ${q(base)} to go with it as it is, hold this, or ask the Planner for the rest.` : 'Pick one, hold this, or ask the Planner for the rest.',
      ),
    )
  }

  // Ruling options out: "don't stop it".
  const out_ = ruledOut(t, a)
  if (out_.length && out_.length < a.options.length) {
    const left = a.options.filter((o) => !out_.includes(o))
    if (left.length === 1 && a.sides?.length) return out(`Then it’s ${q(left[0])}. ${meaning(left[0], a)}`, { choice: left[0] })
    return out(short(`OK, not ${orList(out_)}.`, left.length === 1 ? `That leaves ${q(left[0])}: ${meaning(left[0], a)}` : `That leaves ${orList(left)}. Which one?`), left.length === 1 && !/^not yet/i.test(left[0]) ? { choice: left[0] } : {})
  }

  // Not happy with any of them.
  if (REJECT.test(t)) {
    const way = a.sides?.length ? ownWayOf(msg.replace(/^\s*(no|nope|nah|neither)\b[\s,.:;!-]*/i, ''), a.sides) : null
    if (way) return out(`Your own way, “${way}”, means the Designer reworks it and another agent checks it. Say “my way: ${way}” to go with it, or pick one of theirs.`)
    const cost = /\b(expensive|costly|pricey|much)\b/.test(t) ? [...sentences(a.impact)].find((s) => /\$/.test(s)) : undefined
    return out(short(`Understood, none of these suits you yet: you can hold this, or tell me what you want instead.`, cost, a.options.slice(0, 2).map((o) => meaning(o, a)).join(' ')))
  }

  // A number of parts no option has: "split it in three" is not "Split it in two".
  const NUM = /\b(one|two|three|four|five|six|half|halves|thirds?|quarters?)\b/g
  const offered = a.options.flatMap((o) => o.toLowerCase().match(NUM) ?? [])
  if ((t.match(NUM) ?? []).some((w) => offered.length && !offered.includes(w)))
    return out(short(`There’s no option for “${msg.replace(/[.!]+$/, '')}”.`, `The options are ${orList(a.options)}.`, 'You can hold this, or ask the Planner to change the project.'))
  // An amount no option has is never rounded to one: "raise it to $30" when the option says $29.
  const amounts = a.options.flatMap((o) => o.match(/\d+(\.\d+)?/g) ?? []).map(Number)
  const typed = (msg.match(/\$?\d+(\.\d+)?/g) ?? []).map((n) => Number(n.replace('$', '')))
  const off = typed.find((n) => !amounts.includes(n))
  if (off !== undefined && /\$|dollar|limit|raise|cap|budget/i.test(msg)) {
    const near = a.options.find((o) => /\$\d/.test(o))
    return out(short(`I can’t set $${off} from here.`, near ? `The nearest option is ${q(near)}: ${meaning(near, a)}` : `The options are ${orList(a.options)}.`, 'Pick one, hold this, or ask the Planner to change the limit.'))
  }
  // A clear pick, said with more words than the fast path takes.
  const pick = named(t, a)
  const unknown = toks(msg).filter((w) => !FILLER.has(w) && !a.options.some((o) => padded(o).includes(` ${stem(w)}`)) && !(a.sides ?? []).some((s) => s.label.toLowerCase().startsWith(stem(w))))
  if (pick && unknown.length <= 1) return out(`That’s ${q(pick)}. ${meaning(pick, a)}`, { choice: pick })
  if (!pick && !unknown.length && /\b(yes|yep|yeah|sure|ok|okay|go ahead|do it|sounds good|fine)\b/.test(t)) return out(`That’s ${q(a.suggested)}. ${meaning(a.suggested, a)}`, { choice: a.suggested })

  // Something the options can't do: "go with the cheaper model", "split it in three".
  return out(short(`I can’t do “${msg.replace(/[.!]+$/, '')}” from this question.`, `The options are ${orList(a.options)}.`, 'You can hold this, ask me about any of them, or ask the Planner to change the project.'))
}
