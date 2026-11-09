// Brief → Clarify → Quest plan. The owner sets direction once; after that agents only ask when it matters.
import { ROLE_ORDER } from '../sim/scenario'
import type { RoleId } from '../sim/types'
import { Avatar, fmtK, Sprite, Term, useEngine } from '../ui'

function Thinking({ text }: { text: string }) {
  return (
    <div className="voice">
      <Avatar />
      <div className="bubble">
        {text} <span className="dots"><i /><i /><i /></span>
      </div>
    </div>
  )
}

export function Brief() {
  const e = useEngine()
  return (
    <>
      <label className="field-label" htmlFor="goal">
        Goal
      </label>
      <textarea
        id="goal"
        className="goal"
        value={e.goal}
        readOnly={e.live === false}
        title={e.live === false ? 'Replay mode runs this goal only' : undefined}
        onChange={(ev) => e.setGoal(ev.target.value)}
      />

      <span className="field-label">Files the crew may read</span>
      <div className="picker" role="group" aria-label="Files the crew may read">
        {e.attachments.map((a) => (
          <button key={a.id} className="pick" role="checkbox" aria-checked={a.selected} onClick={() => e.toggleAttachment(a.id)} title={a.note}>
            <span className="box">{a.selected ? '✓' : ''}</span>
            <code>{a.name}</code>
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="energy">
        <Term w="Energy" m="Token budget for the whole crew" />
      </label>
      <div className="budget">
        <input id="energy" type="range" min={40_000} max={240_000} step={10_000} value={e.budget} onChange={(ev) => e.setBudget(Number(ev.target.value))} />
        <b>{fmtK(e.budget)}</b>
      </div>
    </>
  )
}

export function Clarify() {
  const e = useEngine()
  if (e.headThinking > 0) return <Thinking text={`Reading the brief and ${e.attachments.filter((a) => a.selected).length} files`} />
  return (
    <>
      {e.questions.map((q, i) => (
        <div className="q" key={q.id} style={{ animationDelay: `${i * 80}ms` }}>
          <h3>{q.q}</h3>
          <div className="opts">
            {q.options.map((o, j) => (
              <button
                key={o}
                className={`opt ${j === 0 && !e.clarifyAnswers[q.id] ? 'assumed' : ''}`}
                title={j === 0 && !e.clarifyAnswers[q.id] ? 'Used if you skip' : q.why}
                aria-pressed={e.clarifyAnswers[q.id] === o}
                onClick={() => e.answerClarify(q.id, o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export function Plan() {
  const e = useEngine()
  if (e.headThinking > 0) return <Thinking text="Laying out the plan" />
  return (
    <>
      {e.tasks.map((t, i) => {
        const changed = t.assignee !== t.proposedAssignee
        return (
          <div key={t.id} className="plan-task" style={{ animationDelay: `${i * 70}ms` }}>
            <Sprite name={`crop_${t.crop}_3`} className="crop-icon" />
            <div>
              <h3>
                <span>{t.name}</span>
                <span className="cost">{fmtK(t.budget)}</span>
              </h3>
              <div className="assign">
                <select value={t.assignee} onChange={(ev) => e.reassign(t.id, ev.target.value as RoleId)} aria-label={`Assign ${t.name}`}>
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {e.farmhands[r].role}
                    </option>
                  ))}
                </select>
                {changed ? <span className="flag ok">Changed by you</span> : t.proposalNote && <span className="flag">{t.proposalNote}</span>}
              </div>
              <div className="chips" aria-label={`Files ${t.name} may read`}>
                {t.signposts.map((p) => (
                  <span className="chip" key={p}>
                    {p}
                    <button onClick={() => e.toggleSignpost(t.id, p)} aria-label={`Remove ${p}`}>
                      ×
                    </button>
                  </span>
                ))}
                {e.attachments.some((a) => !t.signposts.includes(a.name)) && (
                  <select value="" onChange={(ev) => ev.target.value && e.toggleSignpost(t.id, ev.target.value)} aria-label={`Add a file to ${t.name}`}>
                    <option value="">+ file</option>
                    {e.attachments
                      .filter((a) => !t.signposts.includes(a.name))
                      .map((a) => (
                        <option key={a.id} value={a.name}>
                          {a.name}
                          {a.selected ? '' : ' (not attached)'}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

// Read-only look back at a finished step.
export function Review({ step }: { step: 'brief' | 'clarify' | 'plan' }) {
  const e = useEngine()
  if (step === 'brief')
    return (
      <dl className="review">
        <dt>Goal</dt>
        <dd>{e.goal}</dd>
        <dt>Files the crew may read</dt>
        <dd>
          <ul>
            {e.attachments.map((a) => (
              <li key={a.id} className="mono">
                {a.name}
                {a.selected ? '' : ' (not attached)'}
              </li>
            ))}
          </ul>
        </dd>
        <dt>Energy</dt>
        <dd>{fmtK(e.budget)}</dd>
      </dl>
    )
  if (step === 'clarify')
    return (
      <dl className="review">
        {e.questions.map((q) => (
          <span key={q.id} style={{ display: 'contents' }}>
            <dt>{q.q}</dt>
            <dd>{e.clarifyAnswers[q.id] ?? `${q.options[0]} (assumed)`}</dd>
          </span>
        ))}
      </dl>
    )
  return (
    <dl className="review">
      {e.replan?.status === 'applied' && <p className="panel-lead">Updated by the re-plan: the draft now reads eng-standup-notes/.</p>}
      {e.tasks.map((t) => (
        <span key={t.id} style={{ display: 'contents' }}>
          <dt>{t.name}</dt>
          <dd>
            {e.farmhands[t.assignee].role}, reading <span className="mono">{t.signposts.join(', ') || 'no files'}</span>
          </dd>
        </span>
      ))}
    </dl>
  )
}

export function SetupFooter() {
  const e = useEngine()
  if (e.phase === 'brief')
    return (
      <button className="btn primary grow" onClick={() => e.submitBrief()}>
        Send to the head farmer
      </button>
    )
  if (e.phase === 'clarify')
    return (
      <>
        <button className="btn ghost" disabled={e.headThinking > 0} onClick={() => e.finishClarify()}>
          Skip all
        </button>
        <button className="btn primary grow" disabled={e.headThinking > 0} onClick={() => e.finishClarify()}>
          Continue
        </button>
      </>
    )
  if (e.phase === 'plan')
    return (
      <button className="btn primary grow" disabled={e.headThinking > 0} onClick={() => e.approvePlan()}>
        Approve and start
      </button>
    )
  return null
}
