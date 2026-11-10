// Level 1: what needs you in the step you're on. Plant, Grow and Harvest sit in the step bar above.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Task } from '../sim/types'
import { BRIEF_GOAL, FARM } from '../sim/scenario'
import { stepOf } from '../sim/steps'
import { CHECKS, GATE_ORDER, GATES, HARVEST_FAIL, OUTPUT } from '../sim/review'
import { fmtK, Sprite, useEngine } from '../ui'
import { NeedsYou } from './Cards'
import { GateMark } from './Detail'
import { ShipNow } from './Ship'
import { CrewRow } from './Templates'

export function Mark({ k }: { k: 'done' | 'now' | 'later' }) {
  return <span className={`mark ${k}`} aria-hidden />
}

export function Crop({ t }: { t: Task }) {
  return <Sprite name={`crop_${t.crop}_3`} scale={1.25} className="crop" />
}

export function Row({
  mark,
  label,
  sub,
  end,
  tone,
  onClick,
  taskId,
  testId,
}: {
  mark?: ReactNode
  label: ReactNode
  sub?: ReactNode
  end?: ReactNode
  tone?: string
  onClick?: () => void
  taskId?: string
  testId?: string
}) {
  const e = useEngine()
  const hot = !!taskId && (e.hoverTask === taskId || e.openTaskId === taskId)
  const hover = taskId ? { onMouseEnter: () => e.hover(taskId), onMouseLeave: () => e.hover(null) } : {}
  const inner = (
    <>
      <span className="mark-col">{mark}</span>
      <span className="row-main">
        <span className="label">{label}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      <span className={`end ${tone ?? ''}`}>{end}</span>
      {onClick ? <span className="chev" aria-hidden /> : <span />}
    </>
  )
  return onClick ? (
    <button type="button" className={`row ${hot ? 'hot' : ''}`} onClick={onClick} data-testid={testId} {...hover}>
      {inner}
    </button>
  ) : (
    <div className={`row static ${hot ? 'hot' : ''}`} {...hover}>
      {inner}
    </div>
  )
}

// The panel body shows only what needs you or what you're reviewing: the Plant form, an ask,
// or the harvest evidence. The step bar in the header opens each done step's review.
export function Overview() {
  const e = useEngine()
  const step = stepOf(e.phase)
  return (
    <>
      <p className="repo" aria-label="Repository and branch">
        <code>{FARM.repo}</code>
        <code>{FARM.branch}</code>
      </p>
      <NeedsYou />
      {step === 'plant' && <PlantNow />}
      {step === 'grow' && <GrowNow />}
      {step === 'harvest' && (e.phase === 'ship' ? <ShipNow /> : <HarvestNow />)}
    </>
  )
}

// Plant: the goal and crew, then the head farmer's questions inline, then its plan. Approve once.
function PlantNow() {
  const e = useEngine()
  if (e.phase === 'brief') return <BriefNow />
  const n = e.attachments.filter((a) => a.selected).length
  return (
    <div className="plant">
      <div className="plant-goal" data-testid="plant-goal">
        <p>{e.goal}</p>
        <p className="quiet">
          {e.team?.name ? `${e.team.name}, ` : ''}
          {n} files, skills and tools, {fmtK(e.budget)} energy
        </p>
      </div>
      <ClarifyNow />
      {e.phase === 'plan' && (
        <>
          <PlanNow />
        </>
      )}
    </div>
  )
}

function BriefNow() {
  const e = useEngine()
  const [edit, setEdit] = useState(false)
  const n = e.attachments.filter((a) => a.selected).length
  return (
    <>
      <label className="field-label" htmlFor="goal">
        Goal
      </label>
      <textarea
        id="goal"
        className="goal"
        value={e.goal}
        placeholder={BRIEF_GOAL}
        readOnly={!e.liveAI}
        onChange={(ev) => e.setGoal(ev.target.value)}
        onKeyDown={(ev) => {
          // Enter plants the goal, or the prompt the box shows. Shift+Enter starts a new line.
          if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
            ev.preventDefault()
            e.submitBrief()
          }
        }}
        data-testid="goal"
      />
      <CrewRow />
      <div className="line">
        <span>
          <b>{n} files, skills and tools</b> the crew may use
        </span>
        <button className="linkish" onClick={() => setEdit(!edit)} aria-expanded={edit}>
          {edit ? 'Done' : 'Edit'}
        </button>
      </div>
      {edit && (
        <div className="picker" role="group" aria-label="Files, skills and tools the crew may use">
          {e.attachments.map((a) => (
            <button key={a.id} className="pick" role="checkbox" aria-checked={a.selected} onClick={() => e.toggleAttachment(a.id)} title={a.note}>
              <span className="box">{a.selected ? '✓' : ''}</span>
              <code>{a.name}</code>
            </button>
          ))}
        </div>
      )}
      <div className="line">
        <label htmlFor="energy" title="Token budget for the whole crew">
          Energy
        </label>
        <input id="energy" type="range" min={40_000} max={240_000} step={10_000} value={e.budget} onChange={(ev) => e.setBudget(Number(ev.target.value))} />
        <b className="num">{fmtK(e.budget)}</b>
      </div>
      <button className="btn primary full" onClick={() => e.submitBrief()} data-testid="send-brief">
        Send to the head farmer
      </button>
    </>
  )
}

function Slow() {
  const e = useEngine()
  return e.slowCall ? <p className="quiet">Still reading. Live calls can take 20 seconds.</p> : null
}

function ClarifyNow() {
  const e = useEngine()
  const [open, setOpen] = useState<number | null>(null)
  const n = e.attachments.filter((a) => a.selected).length
  if (e.phase === 'clarify' && e.headThinking > 0)
    return (
      <>
        <p className="quiet">Reading your goal and {n} files, skills and tools</p>
        <Slow />
      </>
    )
  // Once the plan is under way the answers are part of the record.
  if (e.phase !== 'clarify')
    return (
      <ul className="rows nested">
        {e.questions.map((q) => (
          <li key={q.id}>
            <Row label={<span className="q-label">{q.q}</span>} sub={e.clarifyAnswers[q.id] ?? q.options[0]} />
          </li>
        ))}
      </ul>
    )
  const firstOpen = e.questions.findIndex((q) => !e.clarifyAnswers[q.id])
  const cur = open ?? (firstOpen >= 0 ? firstOpen : null)
  return (
    <>
      {e.questions.map((q, i) =>
        i === cur ? (
          <div className="q" key={q.id}>
            <h3>{q.q}</h3>
            <div className="opts">
              {q.options.map((o) => (
                <button
                  key={o}
                  className="opt"
                  title={q.why}
                  aria-pressed={e.clarifyAnswers[q.id] === o}
                  onClick={() => {
                    e.answerClarify(q.id, o)
                    setOpen(null)
                    // The last answer sends the head farmer off to plan.
                    if (e.questions.every((x) => e.clarifyAnswers[x.id])) e.finishClarify()
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Row
            key={q.id}
            label={<span className="q-label">{q.q}</span>}
            sub={e.clarifyAnswers[q.id] ?? (i < (cur ?? 99) ? undefined : 'Not answered yet')}
            onClick={() => setOpen(i)}
          />
        ),
      )}
      {cur === null ? (
        <button className="btn primary full" onClick={() => e.finishClarify()} data-testid="continue">
          Plan it
        </button>
      ) : (
        <button className="linkish" onClick={() => e.finishClarify()} title={`Skipped questions use the first option`}>
          Skip the rest
        </button>
      )}
    </>
  )
}

function PlanNow() {
  const e = useEngine()
  const shown = e.tasks.slice(0, e.planShown)
  return (
    <>
      {e.planShown === 0 && <p className="quiet">Laying out the plan</p>}
      <ul className="rows nested">
        {shown.map((t) => {
          const changed = t.assignee !== t.proposedAssignee
          return (
            <li key={t.id}>
              <Row
                mark={<Crop t={t} />}
                label={t.name}
                sub={changed ? 'Changed by you' : undefined}
                end={e.farmhands[t.assignee].role}
                onClick={() => e.openTask(t.id)}
                taskId={t.id}
                testId={`plan-${t.id}`}
              />
            </li>
          )
        })}
      </ul>
      <Slow />
      <button className="btn primary full" disabled={!e.planReady} onClick={() => e.approvePlan()} data-testid="approve">
        Approve and start
      </button>
    </>
  )
}

// Grow: nothing to do unless an agent asks. With nothing waiting it says so in one line,
// and folds into the rail once the last thing that needed you is done.
function GrowNow() {
  const e = useEngine()
  const needs = !!e.activeAsk || e.replan?.status === 'open' || (e.replan?.status === 'applied' && !e.flags.has('seedSaved')) || e.harvestReady
  const was = useRef(needs)
  useEffect(() => {
    const before = was.current
    was.current = needs
    if (!before || needs) return
    const id = setTimeout(() => {
      if (e.phase === 'grow' && !e.nav.length && e.panelOpen && !e.activeAsk) e.setPanel(false)
    }, 1600)
    return () => clearTimeout(id)
  }, [needs, e])
  if (needs) return null
  const rows = e.growRows()
  const n = (g: string) => rows.filter((r) => r.group === g).length
  const parts = [n('working') && `${n('working')} working`, n('done') && `${n('done')} done`].filter(Boolean).join(', ')
  return (
    <>
      <p className="grow-line" data-testid="grow-line">
        {parts ? `${parts.charAt(0).toUpperCase()}${parts.slice(1)}. ` : ''}Nothing needs you.
      </p>
    </>
  )
}

function HarvestNow() {
  const e = useEngine()
  if (e.harvestStage === 'map')
    return (
      <>
        <p className="quiet">The crew is carrying the crops in.</p>
        <button className="linkish" onClick={() => e.skipHarvestMap()}>
          Skip
        </button>
      </>
    )
  return (
    <>
      <p className="headline" data-testid="harvest-headline">
        {e.harvestHeadline}
      </p>
      <div className={`outbox mergebox ${e.sendState === 'sent' ? 'sent' : ''}`}>
        <ul className="rows">
          <li>
            <Row mark={<span className="kind pr">PR</span>} label={`Pull request #${OUTPUT.pr}`} sub={`${OUTPUT.files} files, +${OUTPUT.added} −${OUTPUT.removed}`} onClick={() => e.go({ kind: 'out', id: 'pr' })} testId="out-pr" />
          </li>
        </ul>
        {e.gateFailed && <MergeControls />}
        <ul className="rows">
          {GATE_ORDER.map((g) => {
            const r = e.harvestGates[g]
            const cs = CHECKS.filter((c) => c.gate === g)
            const n = cs.filter((c) => e.ticked.has(c.id)).length
            let end = 'Passed'
            let tone = 'done'
            let mark: 'pass' | 'fail' | 'run' | 'look' = 'pass'
            if (r.state === 'fail') [end, tone, mark] = ['Failed', 'fail', 'fail']
            else if (r.state === 'run' || r.state === 'wait') [end, tone, mark] = ['Running', '', 'run']
            else if (cs.length && n < cs.length) [end, tone, mark] = [`Look, ${n} of ${cs.length}`, '', 'look']
            return (
              <li key={g}>
                <Row mark={<GateMark s={mark} />} label={GATES[g].name} sub={r.text} end={end} tone={tone} onClick={() => e.go({ kind: 'out', id: g })} testId={`gate-${g}`} />
              </li>
            )
          })}
        </ul>
        {!e.gateFailed && <MergeControls />}
      </div>
      <StaysWithYou />
    </>
  )
}

// What stays after the run: your decisions, lessons and the energy used.
export function StaysWithYou() {
  const e = useEngine()
  return (
    <>
    <ul className="rows">
      <li>
        <Row label="Your decisions" end={String(e.decisions.length)} onClick={() => e.go({ kind: 'out', id: 'decisions' })} />
      </li>
      <li>
        <Row label="Lessons saved" end={String(e.seeds.filter((s) => s.isNew).length + e.pendingSeeds.length)} onClick={() => e.go({ kind: 'out', id: 'lessons' })} />
      </li>
    </ul>
    <details className="fine">
      <summary>Energy and calls</summary>
      <p>
        {fmtK(e.energyUsed)} of {fmtK(e.budget)} tokens, about ${e.usd.toFixed(2)}. {e.liveCalls ? `${e.liveCalls} live model calls and ` : ''}
        {e.simSteps + e.replayCalls} simulated steps.
      </p>
    </details>
    <button className="linkish" onClick={() => e.reset()} data-testid="restart">
      Start over
    </button>
    </>
  )
}

// Approving and merging are two decisions. Approve merges nothing. Merging is an ordinary step;
// deploying to production, later in the harvest, is the one that reaches users.
export function MergeControls() {
  const e = useEngine()
  const left = CHECKS.filter((c) => !e.ticked.has(c.id)).length
  const who = e.farmhands[e.task(HARVEST_FAIL.taskId).assignee].role
  if (e.gateFailed)
    return (
      <div className="send">
        <p className="quiet" data-testid="gate-failed-note">
          {e.asks.some((a) => a.id === 'hold' && a.status !== 'resolved') ? `${who} needs your answer above. Nothing merges until every gate passes.` : 'Nothing merges until every gate passes.'}
        </p>
      </div>
    )
  if (e.gatesRunning)
    return (
      <div className="send">
        <button className="btn primary full" disabled>
          Approve
        </button>
      </div>
    )
  if (e.sendState === 'sent') return <p className="out-done">Merged into {OUTPUT.base}.</p>
  if (!e.approved)
    return (
      <div className="send">
        <button className="btn primary full" disabled={!e.canApprove} onClick={() => e.approveHarvest()} data-testid="approve-harvest">
          Approve
        </button>
        {left > 0 && <p className="quiet">{left} more to look at</p>}
      </div>
    )
  return (
    <div className="send">
      <button className="btn primary full" onClick={() => e.merge()} data-testid="send">
        Merge PR #{OUTPUT.pr} into {OUTPUT.base}
      </button>
    </div>
  )
}
