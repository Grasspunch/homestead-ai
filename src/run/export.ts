// A finished run as files to keep: the pull request as markdown, and a report of the run.
// Built only from the run's own events (through its RunState), so every number matches the screen.
// Pure: no DOM, no store. `download` at the bottom is the one browser helper.

import type { FarmerId, RunState, TaskState } from './types'
import { FARMER_ORDER } from './types'
import { BY_YOU as ROLLED_BY_YOU } from './rollback'

// What the exports need from a farm. A Project fits it as it is.
export interface ExportFarm {
  name: string
  goal: string
  kind: 'sample' | 'own'
  plannedLive?: boolean
  plannedEarlier?: string
  liveSource?: string
  notes?: Record<string, string> // answers you gave in your own words, by ask id
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`
const cents = (n: number) => `$${n.toFixed(2)}`
const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h ${Math.round(n % 60)} min` : `${Math.round(n)} min`)
const whole = (n: number) => `$${Math.round(n)}` // limits are whole dollars
const at = (ms: number) => mins(ms / 60_000)
// Markdown table cells: no pipes or line breaks inside a cell.
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run'

const label = (s: RunState, f: FarmerId) => s.farmers[f]?.label ?? f

// Where the release ended up.
function releaseState(s: RunState) {
  const last = s.deploy[s.deploy.length - 1]
  if (!last) return 'Not merged'
  return last.stage === '100%' ? 'Merged, live for everyone' : last.stage === 'rollback' ? 'Merged, then rolled back' : 'Merged, live for 10% of users'
}

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

// One line per check: pass or fail, by whom, and what the proof showed.
function checkLine(c: TaskState['checks'][number]) {
  const tests = c.proof?.tests
  const proof = tests ? ` (${tests.filter((t) => t.pass).length} of ${tests.length} tests pass)` : c.proof?.shots ? ' (screenshot)' : ''
  return `${c.notes}${proof}`
}

// The commits: each task whose check passed, then each change you asked for on it.
function commitsOf(s: RunState) {
  const out: { task: TaskState; title: string; body: string }[] = []
  for (const t of s.tasks.filter((x) => !x.gate && x.status === 'accepted')) {
    const pass = [...t.checks].reverse().find((c) => c.pass)
    out.push({ task: t, title: t.name, body: `By the ${label(s, t.farmer)}${pass ? `, checked by the ${label(s, pass.by)}` : ''}. Done when: ${t.doneWhen}` })
    for (const c of t.changes ?? []) out.push({ task: t, title: `${t.name}: changed`, body: /^your way/i.test(c) ? c : `You asked: ${c}` })
  }
  return out
}

// Problems a check caught before the merge, and bad releases stopped at 10%.
function caught(s: RunState) {
  const checks = s.tasks.flatMap((t) => t.checks.filter((c) => !c.pass).map((c) => ({ where: t.name, what: c.notes })))
  const canary = s.deploy.filter((d, i) => d.stage === 'rollback' && d.reason !== ROLLED_BY_YOU && s.deploy[i - 1]?.stage === '10%')
  return { checks, canary }
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

function spendLines(s: RunState) {
  const total = s.done?.usd ?? s.usage.usd
  const k = s.usage.byKind
  const lines = [`- In all: ${cents(total)}${s.done ? ` over ${mins(s.done.minutes)}` : ''}`]
  if (s.estimate) lines.push(`- Planned: ${usd(s.estimate.usd)} over ${mins(s.estimate.minutes)}`)
  lines.push(`- Reading ${cents(k.read.usd)}, writing ${cents(k.write.usd)}, redoing work ${cents(k.retry.usd)}`)
  if (s.checkUsd !== undefined) lines.push(`- Checks: ${cents(s.checkUsd)}`)
  if (s.soloActual) lines.push(`- One Claude Sonnet 5 agent alone, estimated from this run: about ${usd(s.soloActual.usd)} over ${mins(s.soloActual.minutes)}, assuming one agent runs a third slower`)
  return lines.join('\n')
}

// The pull request, as you'd paste it into GitHub: title, summary, commits, checks, your decisions and the spend.
export function prMarkdown(p: ExportFarm, s: RunState): string {
  const commits = commitsOf(s)
  const work = s.tasks.filter((t) => !t.gate)
  const stopped = work.filter((t) => t.stopped && t.status !== 'accepted')
  const c = caught(s)
  const summary = [
    `- ${p.goal}`,
    `- ${commits.length} commit${commits.length === 1 ? '' : 's'} from ${work.length - stopped.length} of ${work.length} tasks. ${releaseState(s)}.`,
    `- ${c.checks.length || 'No'} problem${c.checks.length === 1 ? '' : 's'} caught by a check before merge${c.canary.length ? `, ${c.canary.length} bad release stopped at 10%` : ''}.`,
    `- ${s.asks.filter((a) => a.answer).length} decisions came to you; the crew handled ${s.autoFixes.length} by itself.`,
  ]
  const commitList = commits.length
    ? commits.map((x, i) => `${i + 1}. **${x.title}** (${cents(x.task.usd)})\n   ${x.body}`).join('\n')
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
    '## Checks',
    checkTable,
    ...(release ? ['## Release', release] : []),
    '## Decisions',
    decisions(p, s),
    '## Spend',
    spendLines(s),
    spendTable(s),
    '',
  ].join('\n\n')
}

// The run, start to end: outcome, the crew and what each could see, every moment in order, and the spend.
export function runReport(p: ExportFarm, s: RunState): string {
  const c = caught(s)
  const work = s.tasks.filter((t) => !t.gate)
  const done = work.filter((t) => t.status === 'accepted').length
  const crew = FARMER_ORDER.filter((f) => s.farmers[f]).map((f) => {
    const x = s.farmers[f]!
    return [x.label, `${x.model} on ${x.agent === 'codex' ? 'Codex' : 'Claude Code'}`, x.context.join(', '), x.constraints.join('; '), `${whole(x.limits.usd)}, ${mins(x.limits.minutes)}`]
  })
  const outcome = [
    `- ${done} of ${work.length} tasks committed. ${releaseState(s)}.`,
    s.done ? `- ${cents(s.done.usd)} over ${mins(s.done.minutes)}${s.estimate ? `, against a plan of ${usd(s.estimate.usd)} over ${mins(s.estimate.minutes)}` : ''}.` : '- The run has not finished.',
    `- ${c.checks.length || 'No'} problem${c.checks.length === 1 ? '' : 's'} caught before merge${c.canary.length ? `, ${c.canary.length} bad release stopped at 10%` : ''}.`,
    `- ${s.asks.filter((a) => a.answer).length} decisions came to you; the crew handled ${s.autoFixes.length} by itself.`,
  ]
  // Every moment worth a line: not each tool step.
  const moments = s.activity.filter((a) => a.kind !== 'tool').map((a) => `- ${at(a.t)}${a.farmer ? `, ${label(s, a.farmer)}` : ''}: ${a.text}`)
  const caughtList = [...c.checks.map((x) => `- ${x.where}: ${x.what}`), ...c.canary.map((d) => `- Rollout: ${d.reason ?? 'errors passed the limit at 10%, so it rolled back by itself'}`)]
  const byTask = work.map((t) => [t.name, label(s, t.farmer), t.status === 'accepted' ? 'Committed' : t.stopped ? 'Stopped' : 'Not done', cents(t.usd)])
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
    spendLines(s),
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
