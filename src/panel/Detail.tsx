// Levels 2 and 3: a step, a task, a file, skill or tool, an activity entry, a gate or output to review.
import './review.css'
import { useState, type ReactNode } from 'react'
import type { Nav, OutId } from '../sim/engine'
import { CLASH, FARM, LESSON_TRACE, MISSING, BUILDERS } from '../sim/scenario'
import { DOCS } from '../sim/docs'
import { KIND_NAME } from '../sim/library'
import { CHECKS, COMMIT_STATS, COMMITS, GATE_DETAIL, GATE_ORDER, GATES, GUIDE, OUTPUT, TASK_GATES, type GateId, type GateState } from '../sim/review'
import type { LogEntry, RoleId, Task } from '../sim/types'
import { fmtK, fmtT, Portrait, useEngine } from '../ui'
import { AskOptions, PROV, ReplyBox } from './Cards'
import { Context, LibraryView, LibView, PickView } from './Library'
import { Crop, Mark, Row } from './Overview'
import { settingsName, settingsStatus, SettingsView } from './Settings'

export interface ViewSpec {
  title: string
  status?: ReactNode
  body: ReactNode
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
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

const OUT_NAME: Record<string, string> = { pr: `Pull request #${OUTPUT.pr}`, guide: OUTPUT.guide.title, decisions: 'Your decisions', lessons: 'Lessons saved' }

// ---- trail names --------------------------------------------------------------

export function navName(n: Nav, e: ReturnType<typeof useEngine>): string {
  switch (n.kind) {
    case 'step':
      return { brief: 'Your brief', clarify: 'Your answers', plan: 'The plan', grow: 'Grow', harvest: 'Harvest' }[n.id]
    case 'task':
      return e.task(n.id).name
    case 'log':
      return 'Activity'
    case 'why':
      return 'Why it’s asking'
    case 'trace':
      return `Why ${e.farmhands[e.task(MISSING.taskId).assignee].role} used ${CLASH.ours}`
    case 'out':
      return OUT_NAME[n.id] ?? GATES[n.id as GateId]?.name ?? n.id
    case 'lib':
      return n.id
    case 'pick':
      return `Add to ${e.task(n.id).name}`
    case 'library':
      return 'Files, skills and tools'
    case 'settings':
      return settingsName(n.id)
  }
}

function gateStatus(g: GateId, e: ReturnType<typeof useEngine>) {
  const r = e.harvestGates[g]
  const word = r.state === 'fail' ? 'Failed' : r.state === 'run' ? 'Running' : r.state === 'wait' ? 'Not run yet' : 'Passed'
  return `${word}. ${g === 'review' ? 'The Reviewer read the whole diff and wrote none of it.' : g === 'shots' ? 'Captured on staging by Tests, with the Playwright MCP.' : GATE_DETAIL[g]?.status ?? ''}`
}

export function viewFor(n: Nav, e: ReturnType<typeof useEngine>): ViewSpec {
  const title = navName(n, e)
  switch (n.kind) {
    case 'step':
      return { title, body: <StepView id={n.id} /> }
    case 'task': {
      const t = e.task(n.id)
      const fh = e.farmhands[t.assignee]
      const growing = e.phase === 'grow' || e.phase === 'harvest'
      return { title, status: growing ? `${fh.role}. ${e.taskStatus(t).text}.` : `Proposed for ${fh.role}`, body: <TaskView t={t} /> }
    }
    case 'log':
      return { title, body: <LogView tab={n.tab} /> }
    case 'why': {
      const ask = e.asks.find((a) => a.id === n.id)
      return { title, body: ask ? <WhyView id={n.id} /> : <p className="quiet">Answered.</p> }
    }
    case 'trace':
      return { title, body: <TraceView /> }
    case 'out':
      if (n.id === 'decisions') return { title, body: <DecisionsView /> }
      if (n.id === 'lessons') return { title, body: <LessonsView /> }
      if (n.id === 'guide') return { title, status: `Stays with you. ${OUTPUT.guide.file}.`, body: <GuideView /> }
      if (n.id === 'pr') return { title, status: `${FARM.repo}. Opened by Homestead. Its CI checks are the gates.`, body: <PrView /> }
      return { title, status: gateStatus(n.id, e), body: <GateView g={n.id} /> }
    case 'lib': {
      const L = e.lib(n.id)
      return { title, status: L.kind === 'tool' ? `${L.owner}.` : `${KIND_NAME[L.kind]}. ${L.owner}${L.updated ? `, updated ${L.updated}` : ''}.`, body: <LibView name={n.id} /> }
    }
    case 'pick':
      return { title, status: 'Files are facts. Skills are how to do the job. Tools are what it can act on.', body: <PickView taskId={n.id} /> }
    case 'library':
      return { title, status: 'Everything your crew can read, use or call.', body: <LibraryView /> }
    case 'settings':
      return { title, status: settingsStatus(n.id, e), body: <SettingsView id={n.id} /> }
  }
}

// ---- steps ------------------------------------------------------------------------

function StepView({ id }: { id: string }) {
  const e = useEngine()
  if (id === 'brief') {
    const names = e.attachments.filter((a) => a.selected).map((a) => a.name)
    const group = (kind: 'file' | 'skill' | 'tool', label: string) => {
      const list = names.filter((n) => e.lib(n).kind === kind)
      return (
        <Section title={label}>
          {list.length ? (
            <ul className="rows">
              {list.map((n) => (
                <li key={n}>
                  <Row mark={<span className={`kind ${kind}`}>{kind === 'skill' ? 'S' : kind === 'tool' ? 'T' : 'F'}</span>} label={<span className="mono">{n}</span>} sub={e.lib(n).what} onClick={() => e.go({ kind: 'lib', id: n })} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="soft">None</p>
          )}
        </Section>
      )
    }
    return (
      <>
        <Section title="Goal">
          <p>{e.goal}</p>
        </Section>
        {group('file', 'Files the crew may read')}
        {group('skill', 'Skills')}
        {group('tool', 'Tools (MCP servers)')}
        <Section title="Energy budget">
          <p className="num">{fmtK(e.budget)}</p>
        </Section>
      </>
    )
  }
  if (id === 'clarify')
    return (
      <>
        {e.questions.map((q) => (
          <Section key={q.id} title={q.q}>
            <p>{e.clarifyAnswers[q.id] ?? q.options[0]}</p>
          </Section>
        ))}
      </>
    )
  if (id === 'plan') {
    const approval = e.log.find((l) => l.kind === 'answer' && l.text.startsWith('Approved the quest plan'))
    const replan = e.log.find((l) => l.kind === 'replan')
    return (
      <>
        <p className="quiet">
          Approved at {fmtT(approval?.t ?? 0)}. {approval?.reason ? `${approval.reason}.` : 'No changes.'}
        </p>
        {replan && <p className="quiet">Changed at {fmtT(replan.t)} by the re-plan: {e.task(MISSING.taskId).name} now reads {MISSING.file}.</p>}
        <ul className="rows">
          {e.tasks.map((t) => (
            <li key={t.id}>
              <Row mark={<Crop t={t} />} label={t.name} sub={`${e.farmhands[t.assignee].role}, ${t.signposts.length} files, skills and tools`} end={fmtK(t.budget)} onClick={() => e.go({ kind: 'task', id: t.id })} taskId={t.id} />
            </li>
          ))}
        </ul>
      </>
    )
  }
  return (
    <ul className="rows">
      {e.tasks.map((t) => (
        <li key={t.id}>
          <Row mark={<Crop t={t} />} label={t.name} sub={e.farmhands[t.assignee].role} end="Done" tone="done" onClick={() => e.go({ kind: 'task', id: t.id })} taskId={t.id} />
        </li>
      ))}
      <li>
        <Row label="All activity" end={String(e.log.length)} onClick={() => e.go({ kind: 'log', tab: 'all' })} />
      </li>
    </ul>
  )
}

// ---- a task -------------------------------------------------------------------------

export function GateMark({ s }: { s: GateState | 'look' | 'now' }) {
  const k = s === 'pass' ? 'done' : s === 'wait' ? 'later' : s
  return <span className={`mark ${k}`} aria-hidden />
}

function TaskView({ t }: { t: Task }) {
  const e = useEngine()
  const fh = e.farmhands[t.assignee]
  const planning = e.phase === 'plan'
  const growing = !planning
  const firstOpen = t.subtasks.findIndex((s) => !s.done)
  const entries = e.log.filter((l) => l.taskId === t.id).slice().reverse()
  const have = e.taskGates[t.id] ?? []
  const what = (g: GateId) => TASK_GATES[t.id]?.find((x) => x.gate === g)?.what ?? GATES[g].detail
  return (
    <>
      <Section title="Agent">
        <div className="hand">
          <Portrait color={fh.color} shade={fh.colorDark} />
          {planning ? (
            <select value={t.assignee} onChange={(ev) => e.reassign(t.id, ev.target.value as RoleId)} aria-label={`Assign ${t.name}`}>
              {BUILDERS.map((r) => (
                <option key={r} value={r}>
                  {e.farmhands[r].role}
                </option>
              ))}
            </select>
          ) : (
            <span>
              <b>{fh.role}</b> <span className="soft">{e.fhStatus(fh)}</span>
            </span>
          )}
          {growing && e.phase === 'grow' && (
            <button className="btn sm" onClick={() => e.togglePauseFarmhand(fh.id)}>
              {fh.paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>
        {planning && t.proposalNote && t.assignee === t.proposedAssignee && <p className="quiet">{t.proposalNote}</p>}
      </Section>

      <Section title="Steps">
        <ul className="ticks">
          {t.subtasks.map((s, i) => {
            const k = s.done ? 'done' : growing && i === firstOpen && s.started ? 'now' : 'later'
            return (
              <li key={s.id}>
                <Mark k={k} />
                <span>{s.name}</span>
                <span className="soft">{k === 'now' && fh.status === 'working' ? 'Working' : ''}</span>
              </li>
            )
          })}
          {t.pests.map((p) => (
            <li key={p.id} className="warn">
              <Mark k="later" />
              <span>{p.label}</span>
              <span />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Done when" aside={planning ? 'The crop ripens only when these pass' : undefined}>
        {planning ? (
          <ul className="checks">
            {GATE_ORDER.map((g) => (
              <li key={g} className="manual">
                <label>
                  <input type="checkbox" checked={have.includes(g)} onChange={() => e.toggleGate(t.id, g)} data-testid={`gate-${t.id}-${g}`} />
                  <span>
                    <b>{GATES[g].name}</b>
                    <span className="evidence">{what(g)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="ticks">
            {have.map((g) => {
              const r = e.gateFor(t.id, g)
              return (
                <li key={g}>
                  <GateMark s={r.state} />
                  <span>
                    {GATES[g].name}
                    <span className="soft"> {what(g)}</span>
                  </span>
                  <span className={r.state === 'fail' ? 'end fail' : 'soft'}>{r.text}</span>
                </li>
              )
            })}
            {!have.length && <li className="soft">No gates. The crop ripens when the steps are done.</li>}
          </ul>
        )}
      </Section>

      <Context t={t} />

      {growing && (
        <Section title="Activity">
          {entries.length ? (
            <ul className="log">
              {entries.map((l) => (
                <LogLine key={l.id} l={l} />
              ))}
            </ul>
          ) : (
            <p className="soft">Nothing yet.</p>
          )}
        </Section>
      )}
    </>
  )
}

// ---- activity -----------------------------------------------------------------------

export function LogLine({ l }: { l: LogEntry }) {
  const e = useEngine()
  const [open, setOpen] = useState(false)
  const traceable = l.traceId === 'endpoint' && e.flags.has('replanApplied') && !e.flags.has('seedSaved')
  return (
    <li className={`k-${l.kind} ${open ? 'open' : ''}`}>
      <button className="entry" onClick={() => l.reason && setOpen(!open)} aria-expanded={l.reason ? open : undefined} disabled={!l.reason}>
        <span className="t">{fmtT(l.t)}</span>
        <span className="what">
          <b>{l.who}</b> {l.text}
        </span>
      </button>
      {open && l.reason && <p className="why">{l.reason}</p>}
      {traceable && (
        <button className="linkish why-btn" onClick={() => e.openTrace('endpoint')}>
          Why?
        </button>
      )}
    </li>
  )
}

const TABS: [Extract<Nav, { kind: 'log' }>['tab'], string][] = [
  ['all', 'All'],
  ['asks', 'Asked you'],
  ['auto', 'Decided without you'],
]

function LogView({ tab }: { tab: Extract<Nav, { kind: 'log' }>['tab'] }) {
  const e = useEngine()
  const items = e.log
    .filter((l) => tab === 'all' || (tab === 'auto' ? l.kind === 'auto' : l.kind === 'ask' || l.kind === 'answer'))
    .slice()
    .reverse()
  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => e.setNav([...e.nav.slice(0, -1), { kind: 'log', tab: k }])}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="log">
        {items.length ? items.map((l) => <LogLine key={l.id} l={l} />) : <li className="soft">Nothing yet.</li>}
      </ul>
    </>
  )
}

// ---- level 3: why an ask is asking -------------------------------------------------

function WhyView({ id }: { id: string }) {
  const e = useEngine()
  const ask = e.asks.find((a) => a.id === id)!
  return (
    <>
      <p className="headline">{ask.question}</p>
      <ul className="facts">
        <li>
          <b>{ask.confidence} confidence.</b> {ask.basis}
        </li>
        <li>{ask.details.reasoning}</li>
        {ask.impact.map((i) => (
          <li key={i}>{i}</li>
        ))}
        <li>
          {ask.details.sources.map((s) => (
            <span key={s} className="mono source">
              {s}
            </span>
          ))}
        </li>
        {PROV[ask.provenance] && <li className="soft">{PROV[ask.provenance]}</li>}
      </ul>
      {ask.details.preview && <pre className="excerpt">{ask.details.preview}</pre>}
      {ask.status !== 'resolved' && (
        <>
          <AskOptions ask={ask} />
          <ReplyBox ask={ask} />
        </>
      )}
    </>
  )
}

function TraceView() {
  const e = useEngine()
  const t = e.task(MISSING.taskId)
  const fh = e.farmhands[t.assignee]
  const seen = t.signposts.filter((s) => s !== MISSING.file && e.lib(s).kind !== 'tool')
  const line = (DOCS['web-app/src/api/session.ts'] ?? '').split('\n').find((l) => l.includes(CLASH.ours))?.trim()
  return (
    <>
      <p className="headline">
        {MISSING.file} was never attached to {t.name}, so {fh.role} couldn’t see that {CLASH.ours} was retired.
      </p>
      <details className="fine">
        <summary>The full trace</summary>
        <ol className="trace-steps">
          <li>
            {fh.role} could read <span className="mono">{seen.join(', ')}</span>.
          </li>
          <li>
            The only session call in them was <span className="mono">{line}</span> in src/api/session.ts.
          </li>
          <li>It reused that call for Google sign-in, and staging returned 404.</li>
          <li>
            <span className="mono">lesson-check-changelogs.md</span> says to attach a project’s changelog, but it names no project, so nothing tied it to this task.
          </li>
        </ol>
      </details>
      <div className="seed-card">
        <div className="mono soft">{LESSON_TRACE.file}</div>
        <b>{LESSON_TRACE.title}</b>
        <p>{LESSON_TRACE.body}</p>
      </div>
      <button className="btn primary full" onClick={() => e.saveSeed()} data-testid="save-seed">
        Save as a skill
      </button>
    </>
  )
}

// ---- the harvest review ---------------------------------------------------------------

// The parts of a gate only you can judge, each beside its evidence.
function Checks({ g }: { g: GateId }) {
  const e = useEngine()
  const list = CHECKS.filter((c) => c.gate === g)
  if (!list.length) return null
  const state = e.harvestGates[g].state
  return (
    <Section title="Needs your eyes" aside={`${list.filter((c) => e.ticked.has(c.id)).length} of ${list.length}`}>
      <ul className="checks">
        {list.map((c) => (
          <li key={c.id} className={state === 'fail' ? 'fail' : state === 'run' ? 'blocked' : ''}>
            <label>
              <input type="checkbox" checked={e.ticked.has(c.id)} disabled={!e.canTick(c)} onChange={() => e.toggleTick(c.id)} data-testid={`tick-${c.id}`} />
              <span>
                <b>{c.text}</b>
                <span className="evidence">{c.evidence}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {state === 'fail' && <p className="quiet">Can’t be ticked while this gate fails.</p>}
      {state === 'run' && <p className="quiet">Running again. Tick these when it passes.</p>}
    </Section>
  )
}

export function LoginShot({ after, err }: { after?: boolean; err?: boolean }) {
  return (
    <div className="shot" role="img" aria-label={err ? 'Sign-in page showing an error' : after ? 'Sign-in page after the change' : 'Sign-in page before the change'}>
      <div className="shot-t">Sign in</div>
      {after && <div className="shot-g">Continue with Google</div>}
      {err ? <div className="shot-err">Google sign-in was cancelled. Try again.</div> : after ? <div className="shot-or">or</div> : null}
      <div className="shot-f" />
      <div className="shot-f" />
      <div className="shot-b">Sign in</div>
    </div>
  )
}

function ResultRows({ rows }: { rows: [string, string, string][] }) {
  return (
    <ul className="rows">
      {rows.map(([l, s, end]) => (
        <li key={l}>
          <Row mark={<GateMark s="pass" />} label={<span className="mono">{l}</span>} sub={s} end={end} tone="done" />
        </li>
      ))}
    </ul>
  )
}

function SendBackButton() {
  const e = useEngine()
  const who = e.farmhands[e.task('backend').assignee].role
  return (
    <button className="btn primary" onClick={() => e.sendBack()} data-testid="send-back">
      Send back to {who}
    </button>
  )
}

function GateView({ g }: { g: GateId }) {
  const e = useEngine()
  const d = GATE_DETAIL[g]
  const r = e.harvestGates[g]
  if (g === 'shots')
    return (
      <>
        <div className="ba">
          <figure>
            <figcaption>Before</figcaption>
            <LoginShot />
          </figure>
          <figure>
            <figcaption>After</figcaption>
            <LoginShot after />
          </figure>
        </div>
        <div className="ba">
          <figure>
            <figcaption>After, Google cancelled</figcaption>
            <LoginShot after err />
          </figure>
          <figure>
            <figcaption>Email form, pixel diff</figcaption>
            <div className="shot diff">
              <span className="big">0</span>
              <span className="soft">pixels changed</span>
            </div>
          </figure>
        </div>
        <Checks g="shots" />
      </>
    )
  if (g === 'review') {
    const rev = e.out.review?.data
    const b = rev?.blocking[0]
    return (
      <>
        {r.state === 'fail' && b ? (
          <div className="blocking" data-testid="blocking">
            <div className="who">
              <strong>Blocking</strong>
              <span>{e.farmhands[e.task('backend').assignee].role}’s code</span>
            </div>
            <h3>{b.problem}</h3>
            <pre className="excerpt">
              {b.file}, line {b.line}
              {'\n'}
              <span className="bad">{b.code}</span>
            </pre>
            <p className="quiet">Breaks {b.rule}</p>
            <div className="opts">
              <SendBackButton />
            </div>
          </div>
        ) : (
          <Section title="Blocking">
            <p>{r.state === 'run' ? 'Reviewing.' : 'None'}</p>
          </Section>
        )}
        <Section title="Notes">
          <ul className="rows flat">
            {(rev?.notes ?? []).map((n) => (
              <li key={n.title}>
                <Row label={n.title} sub={n.where} />
              </li>
            ))}
          </ul>
        </Section>
        <Section title="The change that matters">
          <pre className="excerpt">
            src/api/session.ts{'\n'}
            <del>- post("{CLASH.ours}", {'{ token }'})</del>
            {'\n'}
            <ins>+ post("{e.endpoint ?? CLASH.theirs}", {'{ token }'})</ins>
          </pre>
          <p className="quiet">
            {OUTPUT.files} files, +{OUTPUT.added} −{OUTPUT.removed}.
          </p>
        </Section>
        <Section title="Checked against">
          <ul className="rows">
            {['oauth-security.md', 'react-components.md', 'auth-spec.md'].map((f) => (
              <li key={f}>
                <Row mark={<span className={`kind ${e.lib(f).kind}`}>{e.lib(f).kind === 'skill' ? 'S' : 'F'}</span>} label={<span className="mono">{f}</span>} sub={e.lib(f).what} onClick={() => e.go({ kind: 'lib', id: f })} />
              </li>
            ))}
          </ul>
        </Section>
        <Checks g="review" />
      </>
    )
  }
  return (
    <>
      {d && <Section title="Suites">{r.state === 'run' ? <p className="quiet">Running again.</p> : <ResultRows rows={d.rows} />}</Section>}
      {g === 'unit' && (
        <Section title="Changed lines covered">
          <p className="coverage">
            <span className="bar">
              <i style={{ width: '94%' }} />
            </span>
            <span className="num">94%</span>
          </p>
        </Section>
      )}
      {d?.output && (
        <Section title="Output">
          <pre className="excerpt">{d.output}</pre>
        </Section>
      )}
      {d?.steps && (
        <Section title="Recording">
          <ol className="recording">
            {d.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Section>
      )}
    </>
  )
}

function copy(text: string, e: ReturnType<typeof useEngine>) {
  navigator.clipboard?.writeText(text).catch(() => undefined)
  e.toast('Copied')
  e.notify()
}

function PrView() {
  const e = useEngine()
  return (
    <>
      <Section title="Check it out yourself">
        <div className="cmd">
          <code>{OUTPUT.checkout}</code>
          <button className="btn sm" onClick={() => copy(OUTPUT.checkout, e)}>
            Copy
          </button>
        </div>
      </Section>
      <Section title="Commits, one per task">
        <ul className="rows">
          {e.tasks.map((t) => (
            <li key={t.id}>
              <Row mark={<Crop t={t} />} label={COMMITS[t.id] ?? t.name} sub={e.farmhands[t.assignee].role} end={<span className="mono">{COMMIT_STATS[t.id]}</span>} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="CI checks on the pull request">
        <ul className="rows">
          {GATE_ORDER.map((g) => {
            const s = e.harvestGates[g].state
            return (
              <li key={g}>
                <Row mark={<GateMark s={s === 'look' ? 'pass' : s} />} label={<span className="mono">homestead/{g}</span>} end={s === 'fail' ? 'Failed' : s === 'run' ? 'Running' : s === 'wait' ? 'Waiting' : 'Passed'} tone={s === 'fail' ? 'fail' : s === 'run' || s === 'wait' ? '' : 'done'} onClick={() => e.go({ kind: 'out', id: g })} />
              </li>
            )
          })}
        </ul>
      </Section>
      <div className="foot">
        <button className="btn" onClick={() => e.toast(`Simulated. In the app this opens the pull request on GitHub.`)}>
          Open in GitHub
        </button>
      </div>
    </>
  )
}

function GuideView() {
  return (
    <div className="doc">
      <b>Google sign-in</b>
      <p>{GUIDE}</p>
    </div>
  )
}

function DecisionsView() {
  const e = useEngine()
  return (
    <ul className="rows">
      {e.decisions.map((d, i) => (
        <li key={i}>
          <Row label={d.text} sub={d.word} />
        </li>
      ))}
    </ul>
  )
}

function LessonsView() {
  const e = useEngine()
  const saved = e.seeds.filter((s) => s.isNew)
  return (
    <>
      <p className="quiet">Lessons join Files and skills. The head farmer offers them on the next run.</p>
      <ul className="rows">
        {saved.map((s) => (
          <li key={s.file}>
            <Row mark={<span className="kind skill">S</span>} label={s.title} sub={s.file} />
          </li>
        ))}
        {e.pendingSeeds.map((s) => (
          <li key={s.file} className="pick-row">
            <Row mark={<span className="kind skill">S</span>} label={s.title} sub={s.file} />
            <span className="pair">
              <button className="btn sm" onClick={() => e.keepPendingSeed(s.file, true)}>
                Keep
              </button>
              <button className="btn sm ghost" onClick={() => e.keepPendingSeed(s.file, false)}>
                Discard
              </button>
            </span>
          </li>
        ))}
        {!saved.length && !e.pendingSeeds.length && <li className="soft">None this run.</li>}
      </ul>
    </>
  )
}

export type { OutId }
