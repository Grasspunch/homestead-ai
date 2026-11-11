// The scripted Planner, used when no model can answer: it answers questions from the run as it stands, and reads
// requests to undo a change, change an earlier answer, or adjust an open change card.
import { CREW } from '../agent/agents'
import type { ChatIn, ChatOut, DecidedAsk } from './talk'
import type { FarmerId } from './types'

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

type Status = ChatIn['status']

// Lower case, apostrophes dropped, punctuation to spaces, padded so ` word ` matches whole words.
const norm = (s: string) => ` ${s.toLowerCase().replace(/[’‘`]/g, "'").replace(/n't\b/g, 'nt').replace(/'/g, '').replace(/[^a-z0-9%$ ]+/g, ' ').replace(/\s+/g, ' ').trim()} `

const STOP = new Set('the a an and or but to of on in for with this that these those it its is are was were be been my your our me you we i do does did so as at by from about what why how when which who just only not one ones please can could would will after all instead again back way want like liked go with answer question choice decision change'.split(' '))
const words = (s: string) => norm(s).trim().split(' ').filter((w) => w.length > 2 && !STOP.has(w))
const overlap = (msg: string, text: string) => {
  const m = new Set(words(msg).map(stem))
  return words(text).filter((w, i, a) => a.indexOf(w) === i && m.has(stem(w))).length
}
const stem = (w: string) => w.replace(/(s|es|ing|ed)$/, '')

const usd = (n: number) => `$${n.toFixed(2)}`
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Merging by itself, in words. The app flips it directly, since it is a setting of the project, not a change card.
export function trustWords(message: string): 'ask' | 'auto' | null {
  const t = norm(message)
  if (/ (keep|start|go back to|back to) ask(ing)? me (before|to) (merg|ship)| (ask|check with) me (first )?before (merg|ship)| dont (merge|ship) (it )?(by|on) (it|them)sel| stop merging by | no more merging by | (i want to|let me) (merge|approve) (it |them |pull requests )?myself /.test(t)) return 'ask'
  if (/ (merge|ship)s? (it |them )?(by|on) (it|them)sel(f|ves) | let it merge | (stop|dont keep|no need to keep) asking me (before|to) (merg|ship)| auto ?merge /.test(t)) return 'auto'
  return null
}

// ---- what is on, by concept --------------------------------------------------------------

type Concept = 'review' | 'deployer' | 'stage' | 'e2e' | 'synth' | 'notify' | 'incident'
const SAID: Record<Concept, RegExp> = {
  review: / (review|reviews|pull request|pr|asking me|ask me|merging|merge) /,
  deployer: / deployer /,
  stage: / (10 ?%|10 percent|canary|staged|stage|stages) /,
  e2e: / (e2e|end to end|checks?|hard cases) /,
  synth: / synthetic/,
  notify: / (notif\w*|alerts?|ping|pings) /,
  incident: / incident /,
}
const conceptsIn = (t: string) => (Object.keys(SAID) as Concept[]).filter((c) => SAID[c].test(t) && !(c === 'stage' && / (each|every) stage /.test(t)))
// What a change turned off, from its title and the request that made it.
function changeHas(c: { title: string; request: string }, k: Concept) {
  const t = norm(`${c.title} ${c.request}`)
  const incident = / (incident|outage|emergency|sev ?[0-2]|hotfix) /.test(t)
  switch (k) {
    case 'incident':
      return incident
    case 'review':
      return incident || / (review|pull request|pr|approval|main|master) /.test(t)
    case 'deployer':
      return incident || / (deployer|main|master) /.test(t)
    case 'stage':
      return !/ stage alerts /.test(t) && (incident || / (10 ?%|canary|stage|staged|everyone|instantly|immediately|at once) /.test(t))
    case 'e2e':
      return incident || / (e2e|end to end|check|unnecessary|hard cases) /.test(t)
    case 'synth':
      return / synthetic/.test(t)
    case 'notify':
      return / (stage alerts|notif\w*|ping|alert) /.test(t)
  }
}

// ---- intents -----------------------------------------------------------------------------

const UNDO = / (put (it|that|them|things|everything|the \w+) back|undo|take (it|that) back|turn (it|that) off|revert|go back to (how|the way|what)|liked it( better)? before|back to (normal|how it was)|as (it|they) (was|were)|bring back|want (the|my) [a-z0-9% ]+ back|turn off|switch off|cancel|stop|no more|actually no|i changed my mind about the change) /
const KEEPING = / (keep|dont skip|do not skip|dont drop|dont remove|dont turn off|i need the|i want the) /
const REOPEN = / (my (last )?(answer|choice|decision|call|pick)|change my (mind|answer)|after all|undo my|answer (it|that) again|ask me (that )?again|reopen|take back my|go with the [a-z]+s? (way|side|option|plan|idea|one)|pick the other|other option) /
const QUESTION = /^ (is|are|was|were|why|what|whats|how|hows|when|where|who|whos|which|does|did|do|has|have|should|can you tell|tell me|explain|any news|status|update) /
const UNCLEAR = /^ (hmm+|hm+|um+|uh+|huh|not sure|im not sure|unsure|idk|i dont know|dont know|dunno|ok|okay|what|eh|meh|help|\?+) $/

export function chatSim(inp: ChatIn): ChatOut | null {
  const st = inp.status
  const raw = inp.message.trim()
  const t = norm(raw)
  if (!t.trim()) return null
  if (st.pending) {
    const r = onCard(raw, t, st)
    if (r) return r
  }
  if (UNCLEAR.test(t)) return { reply: helpLine(st), action: { kind: 'none' } }
  // Merging by itself is the app's to flip, unless a change of yours turned the review off: then that change comes off.
  const tw = trustWords(raw)
  if (tw === 'auto' || (tw === 'ask' && !st.changesOn.some((c) => changeHas(c, 'review')))) return null
  if (/ (undo|cancel|reverse|take back) (the )?rollback /.test(t) || / un ?roll /.test(t))
    return { reply: 'I can’t undo a rollback: nothing is live now, and the next release ships it again. I can tell the Deployer what you want instead.', action: { kind: 'none' } }
  if (REOPEN.test(t) && !(st.changesOn.length && / change /.test(t) && !/ (answer|choice|decision|call|pick|question|way|side|option) /.test(t))) {
    const r = reopenOf(raw, t, st)
    if (r) return r
  }
  const u = undoOf(t, st)
  if (u) return u
  // A request asked as a question ("how about we skip the e2e check?") is for the change reader.
  if (/^ (how about|what about|what if|can you|could you|should we|shall we|would you|will you|can we|could we) /.test(t) && / (skip|drop|remove|cut|turn (on|off)|switch|use|notify|ping|hide|show|move|rename|make|ship|push|merge|deploy) /.test(t)) return null
  if (QUESTION.test(t) || /\?\s*$/.test(raw)) return answer(t, st)
  return null
}

// ---- the open change card ------------------------------------------------------------------

const ORDINAL: [RegExp, (n: number) => number][] = [
  [/ (first|1st|top) /, () => 0],
  [/ (second|2nd) /, () => 1],
  [/ (third|3rd) /, () => 2],
  [/ (fourth|4th) /, () => 3],
  [/ (fifth|5th) /, () => 4],
  [/ (last|bottom) /, (n) => n - 1],
]

function onCard(raw: string, t: string, st: Status): ChatOut | null {
  const pd = st.pending!
  const rows = pd.rows
  if (/^ (cancel|never mind|nevermind|forget (it|that|about it)|no thanks|scrap (it|that)|drop (it|that|this)|dont|dont bother|no|nope|leave it|actually never mind) $/.test(t) || / (cancel (this|it|that|these|all|them)|forget (it|the whole thing)|never mind) /.test(t))
    return { reply: 'Cancelled. Nothing changed.', action: { kind: 'cancel' } }
  // How long: this project, or every project from now on.
  let scope: 'farm' | 'every' | null = null
  if (/ (every|all|each|any) (farm|farms|project|projects) | everywhere | always | for good | new projects /.test(t)) scope = 'every'
  else if (/ (just|only) (this|here|for this|for now|this one|this project)| this (project|farm) only | only here | for now /.test(t)) scope = 'farm'
  // Which rows: by place ("the first one"), or by their words ("just the deployer one").
  const picked = new Set<number>()
  for (const [re, at] of ORDINAL) if (re.test(t)) picked.add(Math.max(0, Math.min(rows.length - 1, at(rows.length))))
  const msgWords = words(raw).filter((w) => !/^(first|second|third|fourth|fifth|last|top|bottom|row|rows|keep|skip|except|without|drop|apply|make|every|farm|farms|project|projects)$/.test(w))
  if (!picked.size)
    rows.forEach((r, i) => {
      const lw = new Set(words(r.label).map(stem))
      if (msgWords.some((w) => lw.has(stem(w)))) picked.add(i)
    })
  const only = / (only|just|keep|apply) /.test(t) && !/ (just|only) (this|here|for now|this one|this project)/.test(t)
  const not = / (not|except|without|leave out|drop|minus|dont|but not|take off|untick|uncheck) /.test(t)
  if (QUESTION.test(t) || /\?\s*$/.test(raw)) {
    const which = picked.size ? [...picked].map((i) => rows[i]) : rows
    const say = which.map((r) => `${r.label}${r.loss ? ` (you lose: ${r.loss.charAt(0).toLowerCase()}${r.loss.slice(1)})` : ''}`)
    return { reply: `${which.length === 1 ? 'That one' : rows.length === 1 ? 'It' : 'These'}: ${say.join('; ')}. Each lasts for this project until you turn it off, and Undo puts it all back.`, action: { kind: 'none' } }
  }
  if (picked.size && (only || not)) {
    const keep = rows.filter((_, i) => (not && !only ? !picked.has(i) : picked.has(i))).map((r) => r.id)
    if (!keep.length) return { reply: 'That leaves nothing on the card. Say “cancel” to drop it, or name what to keep.', action: { kind: 'none' } }
    const kept = rows.filter((r) => keep.includes(r.id)).map((r) => r.label.charAt(0).toLowerCase() + r.label.slice(1))
    return { reply: `Keeping ${keep.length === 1 ? 'one' : keep.length}: ${list(kept)}${scope ? `, ${scope === 'every' ? 'for every project' : 'for this project only'}` : ''}. Apply when it looks right.`, action: { kind: 'adjust', keep, scope } }
  }
  if (scope) return { reply: scope === 'every' ? 'Set to every project: new projects start with these too. Apply when it looks right.' : 'Set to this project only. Apply when it looks right.', action: { kind: 'adjust', keep: null, scope } }
  return null
}

// ---- undoing a change ------------------------------------------------------------------------

function undoOf(t: string, st: Status): ChatOut | null {
  const undo = UNDO.test(t) && !/ (stop|cancel) (asking|the rollback|it from)/.test(t)
  const keeping = KEEPING.test(t)
  if (!undo && !keeping) return null
  const on = st.changesOn
  const named = conceptsIn(t)
  const byTitle = on.filter((c) => t.includes(norm(c.title)) || (words(c.title).length && words(c.title).every((w) => t.includes(` ${w} `))))
  let target: (typeof on)[number] | undefined = byTitle[byTitle.length - 1]
  if (!target && named.length) target = [...on].reverse().find((c) => named.some((k) => changeHas(c, k)))
  if (target) {
    const what = named.filter((k) => k !== 'incident' && changeHas(target!, k))
    const back = what.length ? ` ${cap(list(what.map(conceptName)))} ${what.length > 1 ? 'are' : 'is'} back.` : ''
    return { reply: `Turning off ${target.title}, so the project runs as it did before it.${back}`, action: { kind: 'undo', id: target.id } }
  }
  // Something named that no change of yours turned off.
  if (named.length) {
    const k = named[0]
    if (k === 'deployer' && !st.farmers.some((f) => f.id === 'deployer')) return { reply: 'This project has no Deployer in its plan, so there is nothing to bring back. The Builder ships it.', action: { kind: 'none' } }
    if (keeping || / (back|bring) /.test(t) || ['incident', 'synth', 'notify'].includes(k))
      return { reply: `${cap(conceptName(k))} ${k === 'incident' || k === 'synth' || k === 'notify' ? 'isn’t on' : 'is on as planned'}: none of your changes touch it.${on.length ? ` On now: ${list(on.map((c) => c.title))}.` : ''}`, action: { kind: 'none' } }
    return null
  }
  // Unnamed: the latest change, when there is one.
  if (!undo || /^ (stop|cancel) /.test(t)) return null
  if (/ (it|that|them|things|everything|before|normal|how it was|actually no|the change) /.test(t) || /^ (undo|put it back|revert|undo that) $/.test(t)) {
    if (!on.length) return { reply: 'Nothing to put back: no change of yours is on this project.', action: { kind: 'none' } }
    const last = on[on.length - 1]
    return { reply: `Turning off ${last.title}, so the project runs as it did before it.`, action: { kind: 'undo', id: last.id } }
  }
  return null
}

const conceptName = (k: Concept) =>
  ({ review: 'the pull request review', deployer: 'the Deployer', stage: 'the 10% stage', e2e: 'the checks it skipped', synth: 'judging by synthetic tests', notify: 'stage alerts', incident: 'incident mode' })[k]

// ---- changing an answer --------------------------------------------------------------------------

function reopenOf(raw: string, t: string, st: Status): ChatOut | null {
  if (!st.decided.length) return { reply: 'You haven’t answered anything on this run yet, so there is no answer to change.', action: { kind: 'none' } }
  // The question named by its words, or the latest one.
  const scored = st.decided.map((d) => ({ d, n: overlap(raw, `${d.question} ${d.choice}`) + (/ budget | money | cost | spend /.test(t) && / (budget|cost|spend|\$|usd|over) /.test(norm(d.question)) ? 2 : 0) }))
  const best = scored.reduce((a, b) => (b.n > a.n ? b : a), { d: st.decided[0], n: 0 })
  const d = best.d
  if (!d.canChange) return { reply: `I can’t change your answer to “${d.question}”. ${d.why ?? ''}`.trim(), action: { kind: 'none' } }
  const choice = choiceOf(raw, t, d)
  if (choice === d.choice) return { reply: `“${d.choice}” is already your answer to “${d.question}”.`, action: { kind: 'none' } }
  if (choice) return { reply: `Switch from “${d.choice}” to “${choice}” on “${clip(d.question, 60)}”? The run goes back to that moment, and answers after it are asked again.`, action: { kind: 'reopen', askId: d.id, choice } }
  return { reply: `Going back to “${d.question}” so you can answer it again. Answers after it are cleared, since they may not come up the same way.`, action: { kind: 'reopen', askId: d.id, choice: null } }
}

function choiceOf(raw: string, t: string, d: DecidedAsk): string | null {
  const others = d.options.filter((o) => o !== d.choice)
  if (/ (other (one|option|way|side)|the alternative|opposite) /.test(t) && others.length === 1) return others[0]
  // An agent named: its way.
  for (const f of Object.keys(CREW) as FarmerId[]) {
    if (!new RegExp(` ${f}s? `).test(t)) continue
    const o = d.options.find((x) => norm(x).includes(` ${f}`))
    if (o) return o
  }
  const scored = d.options.map((o) => ({ o, n: overlap(raw, o) })).filter((x) => x.n > 0)
  if (!scored.length) return null
  scored.sort((a, b) => b.n - a.n)
  if (scored.length > 1 && scored[0].n === scored[1].n) return null
  return scored[0].o
}

// ---- answering a question ------------------------------------------------------------------------

const STAGE_SAID: Record<string, string> = { 'not shipped': 'Nothing has shipped yet: the release comes after the work is checked.', '10%': 'It’s live for 10% of users, watched before it goes to everyone.', everyone: 'It’s live for everyone.', 'rolled back': 'It was rolled back, so nothing is live now.' }

function answer(t: string, st: Status): ChatOut {
  const none = (reply: string): ChatOut => ({ reply, action: { kind: 'none' } })
  const agent = st.farmers.find((f) => new RegExp(` (${f.id}|${norm(f.label).trim()})s? `).test(t))
  const doneN = st.tasks.filter((x) => x.status === 'accepted' || x.status === 'ripe').length
  const failing = st.tasks.filter((x) => x.status === 'wilted')
  if (/ (spen[td]|spending|cost|costs|money|budget|dollars|usd|\$|how much|price|paid) /.test(t) && !agent)
    return none(`${usd(st.spent)} so far${st.minutes ? `, over ${st.minutes} min of the run` : ''}${st.budget ? `, of a ${usd(st.budget)} budget` : ''}.`)
  if (/ (fail|failed|failing|broke|broken|wrong|error|errors|bug|bugs|wilted|stuck) /.test(t)) {
    if (failing.length) return none(`${list(failing.map((x) => `“${x.name}” (${label(st, x.farmer)})`))} failed ${failing.length > 1 ? 'their checks' : 'its check'}, so it goes back for a fix before anything ships. The ${label(st, failing[0].farmer)}’s page has what the check found.`)
    const stuck = st.farmers.filter((f) => f.state === 'stuck')
    if (stuck.length) return none(`${list(stuck.map((f) => `The ${f.label}`))} ${stuck.length > 1 ? 'are' : 'is'} stuck${stuck[0].task ? ` on “${stuck[0].task}”` : ''}. Its page says why.`)
    return none(st.deploy === 'rolled back' ? `Nothing is failing now. The release was rolled back, so nothing is live.` : `Nothing is failing right now: ${doneN} of ${st.tasks.length} tasks are done${st.done ? '' : ' and the rest are on track'}.`)
  }
  if (agent) {
    const role = CREW[agent.id]?.role
    const mine = st.tasks.filter((x) => x.farmer === agent.id)
    const why = / why /.test(t) ? `${agent.label === 'Planner' ? 'I' : `The ${agent.label}`} ${role ?? 'has a part in this plan'}. ` : ''
    const now = agent.task ? `${agent.label === 'Planner' ? 'I’m' : 'It’s'} on “${agent.task}” now` : `${agent.label === 'Planner' ? 'I’m' : 'It’s'} ${STATE[agent.state] ?? agent.state}`
    const its = mine.length ? `, with ${mine.length} task${mine.length === 1 ? '' : 's'} in the plan: ${list(mine.map((x) => `“${x.name}”`))}` : ''
    return none(`${why}${now}${its}${agent.model ? `, on ${agent.model}` : ''}.`)
  }
  if (/ (deploy|deployed|deploying|release|released|ship|shipped|shipping|rollout|roll out|live|launch|launched|rollback|rolled back|prod|production) /.test(t)) return none(STAGE_SAID[st.deploy ?? 'not shipped'] ?? `The release: ${st.deploy}.`)
  if (/ (changes?|modes?|incident|turned on|switched on|whats on) /.test(t))
    return none(st.changesOn.length ? `On now: ${list(st.changesOn.map((c) => `${c.title} (from “${c.request}”)`))}. Say “put it back” to turn the latest one off.` : 'No changes of yours are on: the project runs as planned.')
  if (/ (decide|decided|decision|decisions|answered|answers|my answer|picked|chose|choices) /.test(t))
    return none(st.decided.length ? `You decided: ${list(st.decided.slice(0, 4).map((d) => `“${d.question}”: ${d.choice}`))}. Say “change my answer on …” to change one.` : 'You haven’t answered anything on this run yet.')
  if (/ (need|needs|waiting|wait) (me|for me|on me) | need from me | (any|a) question /.test(t))
    return none(st.openAsk ? `One question is waiting on you: “${st.openAsk.question}”.` : 'Nothing is waiting on you right now.')
  if (/ (how long|time|minutes|eta|when will|finish) /.test(t)) return none(st.done ? `It finished in ${st.minutes} min.` : `${st.minutes} min in, with ${st.tasks.length - doneN} of ${st.tasks.length} tasks to go.`)
  if (/ (who|whos) /.test(t) || / (team|agents|crew) /.test(t)) return none(whoLine(st))
  // About a task: where it is, and the question goes to its agent too, said so.
  const task = st.tasks.map((x) => ({ x, n: overlap(t, x.name) })).filter((m) => m.n > 0).sort((a, b) => b.n - a.n)[0]?.x
  if (task) {
    const who = label(st, task.farmer)
    return { reply: `“${task.name}” is ${TASK_SAID[task.status] ?? task.status}, with the ${who}. I’ve passed your question to the ${who} too; its answer goes on its page.`, action: { kind: 'note', to: task.farmer } }
  }
  if (/ (what are you|what you are|whats happening|whats going on|where are we|progress|how is it going|hows it going|status|update|so far) /.test(t)) return none(statusLine(st))
  return none(`${statusLine(st)} I can’t tell more than that from the run itself.`)
}

const TASK_SAID: Record<string, string> = { waiting: 'not started yet', growing: 'being built', checking: 'being checked', wilted: 'failing its check, so it goes back for a fix', ripe: 'done and waiting to be accepted', accepted: 'done', stopped: 'stopped, as you asked' }

const STATE: Record<string, string> = { idle: 'waiting for its next task', working: 'working', stuck: 'stuck', needs: 'waiting on you', done: 'done' }
const label = (st: Status, id: FarmerId) => st.farmers.find((f) => f.id === id)?.label ?? CREW[id]?.label ?? id

function whoLine(st: Status) {
  const on = st.farmers.filter((f) => f.task).map((f) => `the ${f.label} on “${f.task}”`)
  return on.length ? `${cap(list(on))}.` : `Nobody is mid-task: ${list(st.farmers.map((f) => `the ${f.label} is ${STATE[f.state] ?? f.state}`))}.`
}

function statusLine(st: Status) {
  const doneN = st.tasks.filter((x) => x.status === 'accepted' || x.status === 'ripe').length
  if (st.done) return `The run is done: ${doneN} of ${st.tasks.length} tasks, ${usd(st.spent)}. ${STAGE_SAID[st.deploy ?? 'not shipped'] ?? ''}`.trim()
  const parts = [`${doneN} of ${st.tasks.length} tasks done, ${usd(st.spent)} so far.`, whoLine(st)]
  if (st.openAsk) parts.push(`Waiting on you: “${st.openAsk.question}”.`)
  if (st.changesOn.length) parts.push(`On: ${list(st.changesOn.map((c) => c.title))}.`)
  return parts.join(' ')
}

function helpLine(st: Status) {
  const ex = ['“how much have we spent?”', '“what is the Tester doing?”', '“is the deploy going ok?”']
  if (st.changesOn.length) ex.push('“put it back”')
  if (st.decided.length) ex.push('“change my last answer”')
  return `Ask me anything about the run, like ${list(ex)}. Or tell me to change how it runs, like “skip the end to end check”.`
}
