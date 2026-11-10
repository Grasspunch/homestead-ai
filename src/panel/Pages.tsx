// The panel for the two pages that aren't a project's steps: Valleys (every project) and a farm (one agent).
import { goPage } from '../sim/pages'
import { FARM, MISSING, NEIGHBOUR, OTHER_FARMS, VALLEY_STATS, type ValleyState } from '../sim/scenario'
import { stepOf, STEP_LABEL } from '../sim/steps'
import { agentTemplate, teamTemplate } from '../sim/templates'
import type { RoleId } from '../sim/types'
import { fmtK, Portrait, useEngine } from '../ui'
import { Glyph } from './AgentTree'
import { AskCard, ReplanCard } from './Cards'
import { GateMark, LogLine, Section } from './Detail'
import { Crop, Row } from './Overview'
import './pages.css'

type E = ReturnType<typeof useEngine>
type Bucket = 'needs' | 'working' | 'done'
const ORDER: Bucket[] = ['needs', 'working', 'done']
const BUCKET_WORD: Record<Bucket, string> = { needs: 'needs you', working: 'working', done: 'done' }

// ---- Valleys ---------------------------------------------------------------------------

interface ValleyRow {
  name: string
  team: string
  crew: string
  bucket: Bucket
  state: string
  waiting: number
}

function ourState(e: E): { bucket: Bucket; state: string } {
  const waiting = e.openAsks.length + (e.replan?.status === 'open' ? 1 : 0)
  if (waiting) return { bucket: 'needs', state: `${waiting} waiting for you` }
  if (e.phase === 'ship' && (e.shipStage === 'live' || e.shipStage === 'announced')) return { bucket: 'done', state: 'Live for everyone' }
  if (e.phase === 'brief') return { bucket: 'needs', state: 'Waiting for your goal' }
  if (e.planReady) return { bucket: 'needs', state: 'Plan ready for you' }
  return { bucket: 'working', state: STEP_LABEL[stepOf(e.phase)] }
}

const fromState = (s?: ValleyState): Bucket => (s === 'needs' || s === 'failed' ? 'needs' : s === 'done' ? 'done' : 'working')

export function valleyRows(e: E): ValleyRow[] {
  const ours = ourState(e)
  const rows: ValleyRow[] = [
    { name: FARM.name, team: FARM.team, crew: e.team.name, bucket: ours.bucket, state: ours.state, waiting: e.openAsks.length },
    ...[NEIGHBOUR, ...OTHER_FARMS].map((f) => {
      const s = VALLEY_STATS[f.name]
      return { name: f.name, team: f.team, crew: '', bucket: fromState(s?.state), state: s?.doing ?? '', waiting: s?.waiting ?? 0 }
    }),
  ]
  return rows.sort((a, b) => ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket))
}

export function valleysStatus(e: E) {
  const rows = valleyRows(e)
  return ORDER.map((b) => [b, rows.filter((r) => r.bucket === b).length] as const)
    .filter(([, n]) => n)
    .map(([b, n]) => `${n} ${BUCKET_WORD[b]}`)
    .join(', ')
}

export function ValleysBody() {
  const e = useEngine()
  // One list, sorted Needs you, Working, Done; the coloured mark and the state carry the bucket.
  return (
    <ul className="rows">
      {valleyRows(e).map((r) => (
        <li key={r.name}>
          <Row
            mark={<span className={`vmark ${r.bucket}`} aria-hidden />}
            label={r.name}
            sub={r.state || r.team}
            onClick={() => goPage(e, { kind: 'valley', id: r.name })}
            testId={`valley-${r.name === FARM.name ? 'ours' : r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          />
        </li>
      ))}
    </ul>
  )
}

// ---- a farm: one agent's field -------------------------------------------------------------

export function farmTitle(e: E, id: RoleId) {
  return `${e.farmhands[id]?.role ?? id}'s field`
}

export function FarmBody({ id }: { id: RoleId }) {
  const e = useEngine()
  const fh = e.farmhands[id]
  if (!fh) return null
  const cfg = e.settings.agents[id]
  const staffs = teamTemplate(e.crew, e.customTeams)?.staffs?.[id]
  const tpl = staffs ? agentTemplate(staffs) : agentTemplate(id)
  const ask = e.openAsks.find((a) => a.from === id)
  const replan = e.replan?.status === 'open' && e.tasks.some((t) => t.assignee === id && t.id === MISSING.taskId)
  const tasks = e.tasks.filter((t) => t.assignee === id)
  const context = Array.from(new Set(tasks.flatMap((t) => t.signposts)))
  const kinds = (k: 'file' | 'skill' | 'tool') => context.filter((n) => e.lib(n).kind === k)
  const log = e.log.filter((l) => l.who === fh.role).slice(-6).reverse()
  const used = tasks.reduce((n, t) => n + t.used, 0)
  const budget = tasks.reduce((n, t) => n + t.budget, 0)
  // Opened from a link before the run has a plan: say so, with the way to start it.
  if (e.phase === 'brief' || e.phase === 'clarify')
    return (
      <>
        <Section title="Agent">
          <div className="hand">
            <Portrait color={fh.color} shade={fh.colorDark} />
            <span>
              <b>{tpl?.name ?? fh.role}</b>
            </span>
          </div>
          <dl className="agent-facts">
            <dt>Harness</dt>
            <dd className="mono">{cfg?.harness ?? tpl?.harness}</dd>
            <dt>Model</dt>
            <dd className="mono">{cfg?.model ?? tpl?.model}</dd>
          </dl>
        </Section>
        <Section title="Not started">
          <p className="not-started" data-testid="farm-not-started">
            Plant the run from {FARM.name} to start.
          </p>
          <button className="btn primary" onClick={() => goPage(e, { kind: 'valley', id: FARM.name })} data-testid="farm-plant">
            Go to {FARM.name}
          </button>
        </Section>
      </>
    )
  return (
    <>
      {ask && <AskCard ask={ask} key={ask.id} />}
      {!ask && replan && <ReplanCard />}
      <Section title="Agent">
        <div className="hand">
          <Portrait color={fh.color} shade={fh.colorDark} />
          <span>
            <b>{tpl?.name ?? fh.role}</b>
          </span>
        </div>
        <dl className="agent-facts">
          <dt>Harness</dt>
          <dd className="mono">{cfg?.harness ?? tpl?.harness}</dd>
          <dt>Model</dt>
          <dd className="mono">{cfg?.model ?? tpl?.model}</dd>
          <dt>Now</dt>
          <dd>
            <Glyph g={e.glyphOf(fh) as never} /> {e.fhStatus(fh)}
          </dd>
          {budget > 0 && (
            <>
              <dt>Energy</dt>
              <dd className="num">
                {fmtK(used)} of {fmtK(budget)}
              </dd>
            </>
          )}
        </dl>
      </Section>
      <Section title="Plots">
        {tasks.length ? (
          <ul className="rows">
            {tasks.map((t) => {
              const st = e.taskStatus(t)
              const gates = e.taskGates[t.id] ?? []
              return (
                <li key={t.id}>
                  <Row
                    mark={<Crop t={t} />}
                    label={t.name}
                    sub={
                      <span className="gate-marks">
                        {gates.map((g) => (
                          <GateMark key={g} s={e.gateFor(t.id, g).state} />
                        ))}
                        <span>{st.text}</span>
                      </span>
                    }
                    tone={st.tone}
                    onClick={() => e.go({ kind: 'task', id: t.id })}
                    taskId={t.id}
                    testId={`farm-task-${t.id}`}
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="soft">{id === 'reviewer' ? 'Reviews the whole diff at the harvest' : 'No plots yet'}</p>
        )}
      </Section>
      {context.length > 0 && (
        <Section title="Files, skills and tools">
          <ul className="rows">
            {(['file', 'skill', 'tool'] as const).flatMap((k) =>
              kinds(k).map((n) => (
                <li key={n}>
                  <Row mark={<span className={`kind ${k}`}>{k === 'skill' ? 'S' : k === 'tool' ? 'T' : 'F'}</span>} label={<span className="mono">{n}</span>} end={fmtK(e.lib(n).tokens)} onClick={() => e.go({ kind: 'lib', id: n })} />
                </li>
              )),
            )}
          </ul>
        </Section>
      )}
      <Section title="Activity">
        {log.length ? (
          <ul className="log">
            {log.map((l) => (
              <LogLine key={l.id} l={l} />
            ))}
          </ul>
        ) : (
          <p className="soft">Nothing yet</p>
        )}
      </Section>
    </>
  )
}
