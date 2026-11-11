// The pull request as code: which files each task changed, by how much, and what is being written now.
// Read off the run state, so a file grows line by line while its farmer works on it.
import { FILES, type FileSpec } from './diffs'
import { scenario } from './simPlan'
import type { FarmerId, PlanTask, RunState, TaskState } from './types'

export type Row = { k: ' ' | '+' | '-'; s: string; a?: number; b?: number } | { k: '@'; s: string }

// One task's change to one file.
export interface Part {
  task: string
  taskName: string
  farmer: FarmerId
  summary: string
  rows: Row[]
  add: number
  del: number
  live: boolean // its farmer is writing this part now
  committed: boolean
}

export interface PrFile {
  path: string
  parts: Part[]
  add: number
  del: number
  live: boolean
  committed: boolean // every part is in a commit
  isNew: boolean
  farmers: FarmerId[]
}

export interface Commit {
  id: string
  task: string
  message: string
  farmer: FarmerId
  checkedBy?: FarmerId
  check?: string
  files: string[]
  add: number
  del: number
  t: number
  kind: 'task' | 'change' | 'refactor' | 'fix'
}

export interface Pr {
  files: PrFile[]
  commits: Commit[]
  add: number
  del: number
  // Who is writing which file right now.
  live: { farmer: FarmerId; task: string; path: string }[]
}

type Tpl = 'support' | 'checkout' | 'metrics' | 'generic'
const TPL: Record<string, Tpl> = { 'Support assistant': 'support', Checkout: 'checkout', 'Metrics dashboard': 'metrics' }
const templateOf = (goal: string): Tpl => {
  const sc = scenario(goal)
  return (sc.matched && TPL[sc.name]) || 'generic'
}

interface Parsed {
  rows: Row[]
  add: number
  del: number
  isNew: boolean
}

const parsed = new Map<string, Parsed>()
export function parse(diff: string): Parsed {
  const hit = parsed.get(diff)
  if (hit) return hit
  const lines = diff.replace(/^\n+|\n+$/g, '').split('\n')
  const isNew = !lines.some((l) => l.startsWith('@@'))
  const rows: Row[] = []
  let a = 1
  let b = 1
  let add = 0
  let del = 0
  for (const l of lines) {
    const m = /^@@ (\d+) (\d+)/.exec(l)
    if (m) {
      a = +m[1]
      b = +m[2]
      rows.push({ k: '@', s: `@@ -${a} +${b} @@` })
      continue
    }
    const k = l[0]
    const s = l.slice(1)
    if (k === '+') {
      rows.push({ k, s, b: b++ })
      add++
    } else if (k === '-') {
      rows.push({ k, s, a: a++ })
      del++
    } else rows.push({ k: ' ', s, a: a++, b: b++ })
  }
  const out = { rows, add, del, isNew }
  parsed.set(diff, out)
  return out
}

// Only part of a file while it is being written: the first n changed lines, with the context before them.
function upTo(rows: Row[], n: number): Row[] {
  const out: Row[] = []
  let seen = 0
  for (const r of rows) {
    if (r.k === '+' || r.k === '-') {
      if (seen >= n) break
      seen++
    }
    out.push(r)
  }
  while (out.length && out[out.length - 1].k === '@') out.pop()
  return out
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'from', 'with', 'it', 'its', 'on', 'in', 'when', 'by'])
const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .slice(0, 3)
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const plus = (lines: string[]) => lines.map((l) => `+${l}`).join('\n')

// A task the templates don't know, such as one a live Planner wrote: a plain file for it, and its test.
function generated(t: PlanTask): FileSpec[] {
  const w = words(t.name)
  const slug = w.join('-') || t.id
  const Pascal = w.map(cap).join('') || 'Task'
  const camel = lowerFirst(Pascal)
  const done = esc(lowerFirst(t.doneWhen.replace(/[.]+$/, '')))
  const test = (path: string, imp: string, call: string): FileSpec => ({
    path,
    summary: `Tests that ${lowerFirst(t.doneWhen.replace(/[.]+$/, ''))}`,
    diff: plus([`import { describe, expect, it } from 'vitest'`, imp, ``, `describe('${esc(t.name)}', () => {`, `  it('${done}', async () => {`, `    ${call}`, `  })`, `})`]),
  })
  if (t.farmer === 'designer')
    return [
      {
        path: `src/ui/${Pascal}.tsx`,
        summary: `The ${t.name.toLowerCase()} screen`,
        diff: plus([
          `import './${Pascal}.css'`,
          ``,
          `export function ${Pascal}({ items }: { items: { id: string; title: string }[] }) {`,
          `  if (!items.length) return <p className="${slug}-empty">Nothing here yet</p>`,
          `  return (`,
          `    <section className="${slug}">`,
          `      <h2>${esc(t.name)}</h2>`,
          `      <ul>`,
          `        {items.map((i) => (`,
          `          <li key={i.id}>{i.title}</li>`,
          `        ))}`,
          `      </ul>`,
          `    </section>`,
          `  )`,
          `}`,
        ]),
      },
      {
        path: `src/ui/${Pascal}.css`,
        summary: 'Spacing and type for that screen',
        diff: plus([`.${slug} { display: grid; gap: 12px; padding: 16px; }`, `.${slug} h2 { font-size: 20px; margin: 0; }`, `.${slug} ul { list-style: none; margin: 0; padding: 0; }`, `.${slug}-empty { color: var(--muted); }`]),
      },
    ]
  if (t.farmer === 'tester') return [test(`tests/${slug}.e2e.test.ts`, `import { app } from '../src/app'`, `expect(await app.run()).toMatchObject({ ok: true })`)]
  if (t.farmer === 'deployer')
    return [{ path: `deploy/${slug}.yml`, summary: `How ${t.name.toLowerCase()} ships`, diff: plus([`name: ${slug}`, `rollout:`, `  - stage: 10%`, `    rollback_if: errors > 2%`, `  - stage: 100%`]) }]
  return [
    {
      path: `src/${slug}.ts`,
      summary: t.name,
      diff: plus([
        `export interface ${Pascal}Input {`,
        `  id: string`,
        `}`,
        ``,
        `export async function ${camel}(input: ${Pascal}Input) {`,
        `  if (!input.id) throw new Error('${Pascal}: missing id')`,
        `  return { ok: true as const, id: input.id }`,
        `}`,
      ]),
    },
    test(`tests/${slug}.test.ts`, `import { ${camel} } from '../src/${slug}'`, `expect(await ${camel}({ id: '1' })).toEqual({ ok: true, id: '1' })`),
  ]
}

function specsFor(tpl: Tpl, t: PlanTask): FileSpec[] {
  return FILES[`${tpl}:${t.id}`] ?? (t.id.endsWith('-rest') ? FILES[`${tpl}:rest`] : t.id === 'e2e-check' ? FILES[`${tpl}:e2e-check`] : undefined) ?? generated(t)
}

const passCheck = (t: TaskState) => [...t.checks].reverse().find((c) => c.pass)
const changedLines = (specs: FileSpec[]) => specs.reduce((n, f) => n + parse(f.diff).add + parse(f.diff).del, 0)

export function prOf(s: RunState, goal: string): Pr {
  const tpl = templateOf(goal)
  const sc = scenario(goal).script
  const byPath = new Map<string, PrFile>()
  const commits: Commit[] = []
  const live: Pr['live'] = []

  const put = (path: string, part: Part, isNew: boolean) => {
    let f = byPath.get(path)
    if (!f) byPath.set(path, (f = { path, parts: [], add: 0, del: 0, live: false, committed: true, isNew, farmers: [] }))
    f.parts.push(part)
    f.add += part.add
    f.del += part.del
    f.live ||= part.live
    f.committed &&= part.committed
    if (!f.farmers.includes(part.farmer)) f.farmers.push(part.farmer)
  }
  const addSpecs = (specs: FileSpec[], t: TaskState, farmer: FarmerId, committed: boolean, shown = Infinity) => {
    let left = shown
    for (const spec of specs) {
      if (left <= 0) break
      const p = parse(spec.diff)
      const n = p.add + p.del
      const rows = left >= n ? p.rows : upTo(p.rows, left)
      const add = rows.filter((r) => r.k === '+').length
      const del = rows.filter((r) => r.k === '-').length
      // The cursor stops in this file: its farmer is writing it now.
      const isLive = shown !== Infinity && left <= n
      put(spec.path, { task: t.id, taskName: t.name, farmer, summary: spec.summary, rows, add, del, live: isLive, committed }, p.isNew)
      if (isLive) live.push({ farmer, task: t.id, path: spec.path })
      left -= n
    }
  }
  const sum = (specs: FileSpec[]) => specs.reduce((o, f) => ({ add: o.add + parse(f.diff).add, del: o.del + parse(f.diff).del }), { add: 0, del: 0 })

  // What the activity log says happened on top of the plan: a disagreement settled, a big change, a fix after a rollback.
  const extra = (re: (text: string) => boolean) => s.activity.find((a) => a.kind === 'tool' && re(a.text))

  for (const t of s.tasks) {
    if (t.gate || t.status === 'waiting') continue
    const committed = t.status === 'accepted'
    if (t.stopped && !committed) continue
    const specs = specsFor(tpl, t)
    const doneWriting = committed || t.status === 'checking' || t.status === 'ripe'
    // Still growing: as many changed lines as its progress, so the farmer is mid-file.
    const shown = doneWriting ? Infinity : Math.max(1, Math.round(changedLines(specs) * Math.min(0.97, t.progress)))
    addSpecs(specs, t, t.farmer, committed, shown)

    const side = extra((x) => x === sc.dispute.designer.tool) ? 'designer' : extra((x) => x === sc.dispute.builder.tool) ? 'builder' : null
    const dispute = side && FILES[`${tpl}:dispute-${side}`]
    const disputeLine = side && extra((x) => x === sc.dispute[side].tool)
    if (dispute && disputeLine?.task === t.id) addSpecs(dispute, t, (disputeLine.farmer ?? t.farmer) as FarmerId, committed)

    // The first passing check commits the task; each later one commits a change you sent back.
    const passes = t.checks.filter((c) => c.pass)
    const check = passes[0] ?? passCheck(t)
    if (committed) {
      const own = [...specs, ...(dispute && disputeLine?.task === t.id ? dispute : [])]
      commits.push({ id: t.id, task: t.id, message: t.name, farmer: t.farmer, checkedBy: check?.by, check: check?.notes, files: [...new Set(own.map((f) => f.path))], ...sum(own), t: check?.t ?? 0, kind: 'task' })
      for (const [i, c] of (t.changes ?? []).entries())
        commits.push({ id: `${t.id}-change-${i}`, task: t.id, message: `${t.name}: changed`, farmer: t.farmer, check: c, files: [specs[0]?.path].filter(Boolean) as string[], add: 0, del: 0, t: passes[i + 1]?.t ?? (check?.t ?? 0) + i + 1, checkedBy: passes[i + 1]?.by ?? check?.by, kind: 'change' })
    }

    const big = extra((x) => x.startsWith(sc.refactor.line))
    const moved = FILES[`${tpl}:refactor`]
    if (big?.task === t.id && moved) {
      addSpecs(moved, t, (big.farmer ?? t.farmer) as FarmerId, committed)
      if (committed) commits.push({ id: `${t.id}-refactor`, task: t.id, message: sc.refactor.line, farmer: (big.farmer ?? t.farmer) as FarmerId, checkedBy: check?.by, check: 'Every test still passes after the change', files: moved.map((f) => f.path), ...sum(moved), t: big.t, kind: 'refactor' })
    }
  }

  // After a rollback the crew fixes the cause: one more commit, on top of the merged work.
  const fix = extra((x) => x === sc.rollout.fix)
  const fixes = FILES[`${tpl}:rollout-fix`]
  const fixTask = fix && s.tasks.find((t) => t.id === fix.task)
  if (fix && fixes && fixTask) {
    addSpecs(fixes, fixTask, (fix.farmer ?? fixTask.farmer) as FarmerId, true)
    commits.push({ id: 'rollout-fix', task: fixTask.id, message: sc.rollout.fix, farmer: (fix.farmer ?? fixTask.farmer) as FarmerId, check: sc.rollout.check, files: fixes.map((f) => f.path), ...sum(fixes), t: fix.t, kind: 'fix' })
  }

  const files = [...byPath.values()].sort((x, y) => x.path.localeCompare(y.path))
  return { files, commits: commits.sort((x, y) => x.t - y.t), add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0), live }
}

// A branch name for the project: homestead/support-assistant.
export const branchOf = (name: string) => `homestead/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
