// Level 1: the five steps, one line each. The step you're on is open; everything else is a click away.
import { useState, type ReactNode } from 'react'
import type { Phase, Task } from '../sim/types'
import { ANSWER_SHORT, BRIEF_SUMMARY, FARM } from '../sim/scenario'
import { CHECKS, GATE_ORDER, GATES, OUTPUT } from '../sim/review'
import { fmtK, Sprite, useEngine } from '../ui'
import { Envelope, NeedsYou } from './Cards'
import { GateMark } from './Detail'

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

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const LABEL: Record<Phase, string> = { brief: 'Brief', clarify: 'Clarify', plan: 'Plan', grow: 'Grow', harvest: 'Harvest' }
const ORDER: Phase[] = ['brief', 'clarify', 'plan', 'grow', 'harvest']

export function Overview() {
  const e = useEngine()
  const now = ORDER.indexOf(e.phase)
  const picked = e.attachments.filter((a) => a.selected)
  const changed = e.tasks.some((t) => t.assignee !== t.proposedAssignee) || e.signpostEdits.length > 0
  const crew = new Set(e.tasks.map((t) => t.assignee)).size
  const done: Record<Phase, { sub?: string; end?: string }> = {
    brief: { sub: e.demoScenario ? BRIEF_SUMMARY : e.goal.split(/[.!?]/)[0], end: `${picked.length} attached` },
    clarify: { sub: sentence(e.questions.map((q) => { const a = e.clarifyAnswers[q.id] ?? q.options[0]; return ANSWER_SHORT[a] ?? a }).join(', ')), end: `${e.questions.length} answers` },
    plan: { sub: `${e.tasks.length} tasks for ${crew} agents`, end: e.replan?.status === 'applied' ? 'Re-planned' : changed ? 'Changed by you' : undefined },
    grow: { sub: `${e.ripeCount} of ${e.tasks.length} crops ripe`, end: `Needed you ${e.neededYou}` },
    harvest: {},
  }
  return (
    <>
      <p className="repo" aria-label="Repository and branch">
        <code>{FARM.repo}</code>
        <code>{FARM.branch}</code>
      </p>
      <NeedsYou />
      <ul className="rows steps-list">
        {ORDER.map((k, i) => {
          if (i < now)
            return (
              <li key={k}>
                <Row mark={<Mark k="done" />} label={LABEL[k]} sub={done[k].sub} end={done[k].end} onClick={() => e.go({ kind: 'step', id: k })} testId={`step-${k}`} />
              </li>
            )
          if (i > now)
            return (
              <li key={k}>
                <Row mark={<Mark k="later" />} label={LABEL[k]} sub={k === 'harvest' ? `When all ${e.tasks.length} crops are ripe` : undefined} />
              </li>
            )
          return (
            <li key={k} className="step-now">
              {k === 'harvest' && e.harvestStage === 'review' ? (
                <Row mark={<GateMark s={e.gateFailed ? 'fail' : 'now'} />} label={LABEL[k]} sub={e.gateFailed ? 'Blocked by a failed gate' : e.sendState === 'sent' ? 'Merged' : e.approved ? 'Approved, not merged' : 'Look, approve, then merge'} />
              ) : (
                <Row mark={<Mark k="now" />} label={LABEL[k]} />
              )}
              <div className="step-body">
                {k === 'brief' && <BriefNow />}
                {k === 'clarify' && <ClarifyNow />}
                {k === 'plan' && <PlanNow />}
                {k === 'grow' && <GrowNow />}
                {k === 'harvest' && <HarvestNow />}
              </div>
            </li>
          )
        })}
      </ul>
    </>
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
      <textarea id="goal" className="goal" value={e.goal} readOnly={!e.liveAI} onChange={(ev) => e.setGoal(ev.target.value)} />
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
  if (e.headThinking > 0)
    return (
      <>
        <p className="quiet">Reading your goal and {n} files, skills and tools</p>
        <Slow />
      </>
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
          Continue
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
                sub={changed ? 'Changed by you' : t.proposalNote}
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
      {e.showHint('plot') && <p className="tip">Each plot is a task. Click one to see who’s on it and the gates it must pass.</p>}
      <button className="btn primary full" disabled={!e.planReady} onClick={() => e.approvePlan()} data-testid="approve">
        Approve and start
      </button>
    </>
  )
}

function GrowNow() {
  const e = useEngine()
  return (
    <>
      <ul className="rows nested">
        {e.tasks.map((t) => {
          const s = e.taskStatus(t)
          return (
            <li key={t.id}>
              <Row mark={<Crop t={t} />} label={t.name} end={s.text} tone={s.tone} onClick={() => e.openTask(t.id)} taskId={t.id} testId={`task-${t.id}`} />
            </li>
          )
        })}
      </ul>
      <ul className="rows nested">
        <li>
          <Row label="All activity" end={String(e.log.length)} onClick={() => e.go({ kind: 'log', tab: 'all' })} />
        </li>
        <li>
          <Row label="Decided without you" end={String(e.autoDecided.length)} onClick={() => e.go({ kind: 'log', tab: 'auto' })} testId="filter-auto" />
        </li>
      </ul>
      {e.showHint('auto') && <p className="tip">Everything the crew decided alone is listed here.</p>}
      {e.showHint('plot') && !e.showHint('auto') && <p className="tip">Each plot is a task. Click one to see who’s on it.</p>}
    </>
  )
}

export function OutboxHead() {
  const e = useEngine()
  return (
    <div className="out-line">
      <Envelope />
      <span>{e.gateFailed ? 'Blocked. Nothing ships until every gate passes.' : OUTPUT.audience}</span>
    </div>
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
      <div className={`outbox ${e.sendState === 'sent' ? 'sent' : ''}`}>
        <OutboxHead />
        <ul className="rows">
          <li>
            <Row mark={<span className="kind pr">PR</span>} label={`Pull request #${OUTPUT.pr}`} sub={`${OUTPUT.files} files, +${OUTPUT.added} −${OUTPUT.removed}`} onClick={() => e.go({ kind: 'out', id: 'pr' })} testId="out-pr" />
          </li>
        </ul>
        {e.gateFailed && <MergeControls />}
        <p className="sublabel">Done when</p>
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
      <h4 className="group">Stays with you</h4>
      <ul className="rows">
        <li>
          <Row label={OUTPUT.guide.title} sub={<span className="mono">{OUTPUT.guide.file}</span>} onClick={() => e.go({ kind: 'out', id: 'guide' })} />
        </li>
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

// Approving and merging are two decisions. Approve merges nothing.
export function MergeControls() {
  const e = useEngine()
  const left = CHECKS.filter((c) => !e.ticked.has(c.id)).length
  const who = e.farmhands[e.task('backend').assignee].role
  if (e.gateFailed)
    return (
      <div className="send">
        <button className="btn primary full" onClick={() => e.sendBack()} data-testid="send-back">
          Send back to {who}
        </button>
        <p className="quiet">Approve stays locked until every gate passes.</p>
      </div>
    )
  if (e.gatesRunning)
    return (
      <div className="send">
        <button className="btn primary full" disabled>
          Approve
        </button>
        <p className="quiet">Gates are running. Approve unlocks when they pass.</p>
      </div>
    )
  if (e.sendState === 'sent') return <p className="out-done">{OUTPUT.merged}</p>
  if (!e.approved)
    return (
      <div className="send">
        <button className="btn primary full" disabled={!e.canApprove} onClick={() => e.approveHarvest()} data-testid="approve-harvest">
          Approve
        </button>
        <p className="quiet">{left ? `Every gate passes. Unlocks after ${left} more check${left > 1 ? 's' : ''} by you.` : 'Every gate passes and you’ve looked. Approving merges nothing.'}</p>
      </div>
    )
  if (e.sendState === 'confirming')
    return (
      <div className="send confirm">
        <p>
          <b>Merge #{OUTPUT.pr} into {OUTPUT.base}?</b>
        </p>
        <div className="merge-list">
          <span>
            <code>{OUTPUT.branch}</code> into <code>{OUTPUT.base}</code>
          </span>
          <span>Squash {e.tasks.length} commits into 1</span>
          <span>{OUTPUT.ships}</span>
        </div>
        <p>{OUTPUT.undo}</p>
        <div className="opts">
          <button className="btn out" onClick={() => e.send()} data-testid="confirm-send">
            Merge into {OUTPUT.base}
          </button>
          <button className="btn ghost" onClick={() => e.cancelSend()}>
            Back
          </button>
        </div>
      </div>
    )
  return (
    <div className="send">
      <button className="btn out full" onClick={() => e.startSend()} data-testid="send">
        Merge PR #{OUTPUT.pr}
      </button>
    </div>
  )
}
