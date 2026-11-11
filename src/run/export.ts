// A finished run as files to keep: the pull request as markdown, and a report of the run.
// Built only from the run's own events (through its RunState), so every number matches the screen.
// Pure: no DOM, no store. `download` at the bottom is the one browser helper.

import type { FarmerId, RunEvent, RunState, TaskState } from './types'
import { FARMER_ORDER } from './types'
import { BY_YOU as ROLLED_BY_YOU } from './rollback'
import { prOf } from './files'
import { caught as allCaught } from './scale'
import { budgetStopOf, doneLead, plannerEstimate } from './done'
import { fixLineOf, lessonLine, type FixFarm, type Lesson } from './learn'

// What the exports need from a farm. A Project fits it as it is.
export interface ExportFarm {
  name: string
  goal: string
  kind: 'sample' | 'own'
  plannedLive?: boolean
  plannedEarlier?: string
  liveSource?: string
  notes?: Record<string, string> // answers you gave in your own words, by ask id
  events?: RunEvent[] // with run.lesson: the "Learned from run N" line, as Done says it
  run?: { lesson?: Lesson; fixedRollback?: number }
  autonomy?: FixFarm['autonomy']
  trust?: string
  everSentBack?: boolean
  cleanRuns?: number
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`
const cents = (n: number) => `$${n.toFixed(2)}`
// The same as the screen's: rounded first, then split, so 119.7 reads "2 h 0 min", never "1 h 60 min".
export const mins = (n: number) => {
  const m = Math.round(n)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}
const whole = (n: number) => `$${Math.round(n)}` // limits are whole dollars
const at = (ms: number) => mins(ms / 60_000)
// Markdown table cells: no pipes or line breaks inside a cell.
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run'

const label = (s: RunState, f: FarmerId) => s.farmers[f]?.label ?? f

// What was real and what was simulated, said first.
function provenance(p: ExportFarm) {
  const plan = p.plannedEarlier
    ? `The plan came from a live call to the Planner${p.liveSource ? ` through ${p.liveSource}` : ''} on ${p.plannedEarlier.slice(0, 10)}.`
    : p.plannedLive
      ? `The plan came from a live call to the Planner${p.liveSource ? ` through ${p.liveSource}` : ''}.`
      : 'The plan was simulated.'
  const run = p.kind === 'sample' ? 'The run is the simulated sample in Homestead' : 'The run was simulated in Homestead'
  return `> ${plan} ${run}: commits, checks, spend and the release are the simulation's, not a real repository's.`
}

// One agent alone on the same work, with the assumption the time rests on. The pull request window says it too.
export function soloLine(s: Pick<RunState, 'soloActual'>, short = false) {
  if (!s.soloActual) return ''
  if (short) return `One agent alone: about ${usd(s.soloActual.usd)} in ${mins(s.soloActual.minutes)}, assuming it runs a third slower.`
  return `One Claude Sonnet 5 agent alone, estimated from this run: about ${usd(s.soloActual.usd)} over ${mins(s.soloActual.minutes)}, assuming one agent runs a third slower.`
}

// What the last run taught the Planner, in Done's words.
function learnedLine(p: ExportFarm) {
  return p.run?.lesson && p.events ? lessonLine(p.run.lesson, p.events, true) : ''
}

// One line per check: pass or fail, by whom, and what the proof showed.
function checkLine(c: TaskState['checks'][number]) {
  const tests = c.proof?.tests
  const proof = tests ? ` (${tests.filter((t) => t.pass).length} of ${tests.length} tests pass)` : c.proof?.shots ? ' (screenshot)' : ''
  return `${c.notes}${proof}`
}

// The commits, the same list the pull request window shows: each task once its check passed, each change you
// asked for on it, and any refactor or rollout fix. A task's commit carries the task's cost.
function commitsOf(p: ExportFarm, s: RunState) {
  const out: { title: string; body: string; usd?: number }[] = []
  for (const c of prOf(s, p.goal).commits) {
    const t = s.tasks.find((x) => x.id === c.task)
    const by = `By the ${label(s, c.farmer)}${c.checkedBy ? `, checked by the ${label(s, c.checkedBy)}` : ''}`
    if (c.kind === 'task' && t) out.push({ title: c.message, usd: t.usd, body: `${by}. Done when: ${t.doneWhen}` })
    else if (c.kind === 'change') out.push({ title: c.message, body: c.check && /^your way/i.test(c.check) ? c.check : `You asked: ${c.check ?? ''}` })
    else out.push({ title: c.message, body: `${by}. ${c.check ?? ''}`.trim() })
  }
  return out
}

// Problems a check caught before the merge, and bad releases stopped at 10%: the same list Done reads.
function caught(s: RunState) {
  const all = allCaught(s)
  return { checks: all.filter((x) => x.kind === 'check'), canary: all.filter((x) => x.kind === 'canary') }
}

function decisions(p: ExportFarm, s: RunState) {
  const asked = s.asks.filter((a) => a.answer)
  if (!asked.length) return '_No decisions came to you._'
  return table(
    ['At', 'Asked by', 'Question', 'Your answer'],
    asked.map((a) => [at(a.t), label(s, a.farmer), a.question, a.answer!.choice + (p.notes?.[a.id] ? ` (you wrote: “${p.notes[a.id]}”)` : '')]),
  )
}

function spendTable(s: RunState) {
  const ids = FARMER_ORDER.filter((f) => s.farmers[f])
  const rows = ids.map((f) => {
    const x = s.farmers[f]!
    return [x.label, x.model, cents(x.usd), whole(x.limits.usd)]
  })
  return table(['Farmer', 'Model', 'Spent', 'Limit'], rows)
}

function spendLines(p: ExportFarm, s: RunState) {
  // A run you stopped at its budget isn't compared with the plan or with one agent: it didn't do the same work.
  const stopped = !!budgetStopOf(s)
  const plan = p.events && !stopped ? plannerEstimate(p.events) : undefined
  const total = s.done?.usd ?? s.usage.usd
  const k = s.usage.byKind
  const lines = [`- In all: ${cents(total)}${s.done ? ` over ${mins(s.done.minutes)}` : ''}`]
  if (plan) lines.push(`- The Planner's estimate: ${usd(plan.usd)}`)
  lines.push(`- Reading ${cents(k.read.usd)}, writing ${cents(k.write.usd)}, redoing work ${cents(k.retry.usd)}`)
  if (s.checkUsd !== undefined) lines.push(`- Checks: ${cents(s.checkUsd)}`)
  if (s.soloActual && !stopped) lines.push(`- ${soloLine(s).replace(/\.$/, '')}`)
  return lines.join('\n')
}

// The pull request, as you'd paste it into GitHub: title, summary, commits, checks, your decisions and the spend.
export function prMarkdown(p: ExportFarm, s: RunState): string {
  const commits = commitsOf(p, s)
  const work = s.tasks.filter((t) => !t.gate)
  const stopped = work.filter((t) => t.stopped && t.status !== 'accepted')
  const c = caught(s)
  const learned = learnedLine(p)
  const fixed = s.done ? fixLineOf(p, s.deploy.some((d) => d.stage === 'rollback')) : null
  // Tasks counted as Done counts them: every plot, the release included.
  const summary = [
    `- ${p.goal}`,
    `- ${doneLead(s)} ${commits.length} commit${commits.length === 1 ? '' : 's'}.`,
    `- ${c.checks.length || 'No'} problem${c.checks.length === 1 ? '' : 's'} caught by a check before merge${c.canary.length ? `, ${c.canary.length} bad release stopped at 10%` : ''}.`,
    `- ${s.asks.filter((a) => a.answer).length} decisions came to you; the crew handled ${s.autoFixes.length} by itself.`,
    ...(learned ? [`- ${learned}`] : []),
    ...(fixed ? [`- ${fixed}`] : []),
  ]
  const commitList = commits.length
    ? commits.map((x, i) => `${i + 1}. **${x.title}**${x.usd !== undefined ? ` (${cents(x.usd)})` : ''}\n   ${x.body}`).join('\n')
    : '_No commits._'
  const left = stopped.map((t) => `- ~~${t.name}~~: ${t.stopped ?? 'stopped, left out of this pull request'}`).join('\n')
  const checks = work.filter((t) => t.checks.length)
  const checkTable = checks.length
    ? table(['Task', 'Result', 'Checked by', 'What it found'], checks.flatMap((t) => t.checks.map((ch) => [t.name, ch.pass ? '✅ Pass' : '❌ Fail', label(s, ch.by), checkLine(ch)])))
    : '_No checks ran._'
  const release = s.deploy.length
    ? s.deploy.map((d) => `- ${at(d.t)}: ${d.stage === 'rollback' ? (d.reason === ROLLED_BY_YOU ? 'Rolled back by you' : `Rolled back by itself${d.reason ? `: ${d.reason}` : ''}`) : d.stage === '100%' ? 'Live for everyone' : 'Live for 10% of users'}`).join('\n')
    : ''
  return [
    `# ${p.name}`,
    provenance(p),
    '## Summary',
    summary.join('\n'),
    '## Commits',
    commitList,
    ...(left ? ['Left out:', left] : []),
    '## Files changed',
    filesTable(p, s),
    '## Checks',
    checkTable,
    ...(release ? ['## Release', release] : []),
    '## Decisions',
    decisions(p, s),
    '## Spend',
    spendLines(p, s),
    spendTable(s),
    '',
  ].join('\n\n')
}

// Every file the pull request changes, with its lines, as the pull request window counts them.
function filesTable(p: ExportFarm, s: RunState) {
  const pr = prOf(s, p.goal)
  if (!pr.files.length) return '_No files changed._'
  const who = (ids: FarmerId[]) => ids.map((f) => label(s, f)).join(', ')
  return [
    `${pr.files.length} file${pr.files.length === 1 ? '' : 's'} changed, +${pr.add} −${pr.del} lines.`,
    table(['File', 'Lines', 'By', 'What changed'], pr.files.map((f) => [`\`${f.path}\``, `+${f.add} −${f.del}`, who(f.farmers), f.parts.map((x) => x.summary).join('; ')])),
  ].join('\n\n')
}

// The run, start to end: outcome, the crew and what each could see, every moment in order, and the spend.
export function runReport(p: ExportFarm, s: RunState): string {
  const c = caught(s)
  const learned = learnedLine(p)
  const fixed = s.done ? fixLineOf(p, s.deploy.some((d) => d.stage === 'rollback')) : null
  const crew = FARMER_ORDER.filter((f) => s.farmers[f]).map((f) => {
    const x = s.farmers[f]!
    return [x.label, `${x.model} on ${x.agent === 'codex' ? 'Codex' : 'Claude Code'}`, x.context.join(', '), x.constraints.join('; '), `${whole(x.limits.usd)}, ${mins(x.limits.minutes)}`]
  })
  const outcome = [
    `- ${doneLead(s)}`,
    s.done ? `- ${cents(s.done.usd)} over ${mins(s.done.minutes)}${!budgetStopOf(s) && plannerEstimate(p.events ?? []) ? `, against the Planner's ${usd(plannerEstimate(p.events ?? [])!.usd)} estimate` : ''}.` : '- The run has not finished.',
    `- ${c.checks.length || 'No'} problem${c.checks.length === 1 ? '' : 's'} caught before merge${c.canary.length ? `, ${c.canary.length} bad release stopped at 10%` : ''}.`,
    `- ${s.asks.filter((a) => a.answer).length} decisions came to you; the crew handled ${s.autoFixes.length} by itself.`,
    ...(learned ? [`- ${learned}`] : []),
    ...(fixed ? [`- ${fixed}`] : []),
  ]
  // Every moment worth a line: not each tool step.
  const moments = s.activity.filter((a) => a.kind !== 'tool').map((a) => `- ${at(a.t)}${a.farmer ? `, ${label(s, a.farmer)}` : ''}: ${a.text}`)
  const caughtList = [...c.checks.map((x) => `- ${x.where}: ${x.what}`), ...c.canary.map((d) => `- Rollout: ${d.what}`)]
  // Every plot, the release included, so the rows add up to the count above.
  const byTask = s.tasks.map((t) => [t.name, label(s, t.farmer), t.status === 'accepted' ? (t.gate ? 'Done' : 'Committed') : t.stopped ? 'Stopped' : 'Not done', cents(t.usd)])
  return [
    `# Run report: ${p.name}`,
    provenance(p),
    `**Goal:** ${p.goal}`,
    '## Outcome',
    outcome.join('\n'),
    '## Crew',
    table(['Farmer', 'Model', 'Could see', 'Rules', 'Limit'], crew),
    '## What the checks caught',
    caughtList.length ? caughtList.join('\n') : '_Nothing failed._',
    '## Decisions',
    decisions(p, s),
    ...(s.autoFixes.length ? ['## Handled by the crew', s.autoFixes.map((a) => `- ${at(a.t)}: ${a.what}`).join('\n')] : []),
    '## Timeline',
    moments.length ? moments.join('\n') : '_Nothing happened yet._',
    '## Spend',
    spendLines(p, s),
    table(['Task', 'Farmer', 'Result', 'Spent'], byTask),
    '',
  ].join('\n\n')
}

// Save text as a file: a Blob behind a temporary link.
export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
