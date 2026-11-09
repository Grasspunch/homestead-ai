// Files, skills and tools: what a task reads, how it does the job, and what it can act on.
import { useState, type ReactNode } from 'react'
import { DOCS } from '../agent/docs'
import { KIND_MARK, SUGGESTIONS, type LibKind } from '../sim/library'
import type { Task } from '../sim/types'
import { fmtK, useEngine } from '../ui'
import { Row } from './Overview'

const CONNECT = 'Paste a server URL or command. Homestead lists its tools and asks what agents may do before anyone can use it.'
const GROUPS: [LibKind, string][] = [
  ['file', 'Files'],
  ['skill', 'Skills'],
  ['tool', 'Tools (MCP servers)'],
]

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h4>
        {title}
        {aside && <span className="soft">{aside}</span>}
      </h4>
      {children}
    </section>
  )
}

export function KindMark({ kind }: { kind: LibKind }) {
  return <span className={`kind ${kind}`}>{KIND_MARK[kind]}</span>
}

function ConnectLink() {
  const e = useEngine()
  return (
    <button className="linkish" onClick={() => e.toast(CONNECT)}>
      Connect another MCP server
    </button>
  )
}

// A task's context: files it reads, skills it uses, tools it can call.
export function Context({ t }: { t: Task }) {
  const e = useEngine()
  const planning = e.phase === 'plan'
  const of = (kind: LibKind) => t.signposts.filter((s) => e.lib(s).kind === kind)
  const sugg = planning ? SUGGESTIONS.find((s) => s.taskIds.includes(t.id) && !t.signposts.includes(s.name)) : undefined
  const libRow = (name: string) => {
    const L = e.lib(name)
    return (
      <li key={name}>
        <Row mark={<KindMark kind={L.kind} />} label={<span className="mono">{name}</span>} sub={L.what} end={fmtK(L.tokens)} onClick={() => e.go({ kind: 'lib', id: name })} />
      </li>
    )
  }
  const list = (names: string[]) => (names.length ? <ul className="rows">{names.map(libRow)}</ul> : <p className="soft">None</p>)
  return (
    <Section title="Context" aside={`${fmtK(e.contextTokens(t))} tokens`}>
      {sugg && (
        <div className="suggest">
          <p>
            <b>Suggested: {sugg.name}</b>
            <br />
            {sugg.why}
          </p>
          <button className="btn sm" onClick={() => e.attach(t.id, sugg.name)}>
            Add
          </button>
        </div>
      )}
      <p className="sublabel">Files it reads</p>
      {list(of('file'))}
      <p className="sublabel">Skills it uses</p>
      {list(of('skill'))}
      <p className="sublabel">Tools it can call (MCP)</p>
      {list(of('tool'))}
      {planning && (
        <button className="linkish" onClick={() => e.go({ kind: 'pick', id: t.id })}>
          Add a file, skill or tool
        </button>
      )}
    </Section>
  )
}

// One item's page: what it is, what it teaches or exposes, who uses it, what it costs.
export function LibView({ name }: { name: string }) {
  const e = useEngine()
  const L = e.lib(name)
  const tool = L.kind === 'tool'
  const users = e.tasks.filter((t) => t.signposts.includes(name))
  const prev = e.nav[e.nav.length - 2]
  const fromTask = prev?.kind === 'task' && e.task(prev.id).signposts.includes(name) ? e.task(prev.id) : null
  return (
    <>
      <Section title="What it is">
        <p>{L.what}</p>
      </Section>
      {tool && L.access && (
        <Section title="What agents may do">
          <ul className="checks">
            {L.access.map((a, i) => (
              <li key={a.label} className={a.on ? 'pass' : ''}>
                <label>
                  <input type="checkbox" checked={a.on} onChange={(ev) => e.setAccess(name, i, ev.target.checked)} />
                  <span>
                    <strong>{a.label}</strong>
                    <span className="evidence">{a.kind === 'read' ? 'Read' : 'Changes things'}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={L.kind === 'skill' ? 'What it teaches' : tool ? 'Tools it exposes' : 'Preview'}>
        <pre className="excerpt">{L.preview || (DOCS[name] ?? '').slice(0, 280)}</pre>
      </Section>
      <Section title="Used by">
        <p>{users.length ? [...new Set(users.map((t) => `${e.farmhands[t.assignee].role} on ${t.name}`))].join(', ') : 'No task yet'}</p>
      </Section>
      <Section title="Cost">
        <p>
          {fmtK(L.tokens)} tokens {tool ? 'of tool definitions per agent that has it' : 'each time an agent reads it'}
        </p>
      </Section>
      {fromTask && e.phase === 'plan' && (
        <button className="btn" onClick={() => e.detach(fromTask.id, name)}>
          Remove from {fromTask.name}
        </button>
      )}
    </>
  )
}

function useSearch(focus: boolean) {
  const e = useEngine()
  const [q, setQ] = useState('')
  const match = (x: { name: string; what: string }) => !q || `${x.name} ${x.what}`.toLowerCase().includes(q.toLowerCase())
  const input = (
    <input className="search" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search files, skills and tools" aria-label="Search files, skills and tools" autoFocus={focus} />
  )
  return { q, input, items: e.library.filter(match) }
}

// Add a file, skill or tool to a task.
export function PickView({ taskId }: { taskId: string }) {
  const e = useEngine()
  const t = e.task(taskId)
  const { q, input, items } = useSearch(true)
  const avail = items.filter((x) => !t.signposts.includes(x.name))
  const group = (kind: LibKind) => {
    const list = avail.filter((x) => x.kind === kind)
    if (!list.length) return <p className="soft">{q ? 'No match' : 'All added'}</p>
    return (
      <ul className="rows">
        {list.map((x) => (
          <li key={x.name} className="pick-row">
            <Row mark={<KindMark kind={x.kind} />} label={<span className="mono">{x.name}</span>} sub={x.what} end={fmtK(x.tokens)} onClick={() => e.go({ kind: 'lib', id: x.name })} />
            <button className="btn sm" onClick={() => e.attach(taskId, x.name)} disabled={e.phase !== 'plan'}>
              Add
            </button>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <>
      {input}
      {GROUPS.map(([kind, label]) => (
        <div key={kind}>
          <p className="sublabel">{label}</p>
          {group(kind)}
        </div>
      ))}
      <ConnectLink />
    </>
  )
}

// Everything in the chest: what each item is, what it costs and who uses it.
export function LibraryView() {
  const e = useEngine()
  const { input, items } = useSearch(false)
  const group = (kind: LibKind) => {
    const list = items.filter((x) => x.kind === kind)
    if (!list.length) return <p className="soft">No match</p>
    return (
      <ul className="rows">
        {list.map((x) => {
          const users = e.tasks.filter((t) => t.signposts.includes(x.name)).length
          const allowed = x.access ? `${x.access.filter((a) => a.on).length} of ${x.access.length} allowed` : null
          return (
            <li key={x.name}>
              <Row
                mark={<KindMark kind={x.kind} />}
                label={<span className="mono">{x.name}</span>}
                sub={x.what}
                end={allowed ?? (users ? `${users} ${users > 1 ? 'tasks' : 'task'}` : 'Not attached')}
                onClick={() => e.go({ kind: 'lib', id: x.name })}
              />
            </li>
          )
        })}
      </ul>
    )
  }
  return (
    <>
      {input}
      {GROUPS.map(([kind, label]) => (
        <div key={kind}>
          <p className="sublabel">{label}</p>
          {group(kind)}
        </div>
      ))}
      <ConnectLink />
    </>
  )
}
