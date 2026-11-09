// Brief → Clarify → Quest plan. The owner sets direction once; after that agents only ask when it matters.
import { CLARIFY, ROLE_ORDER } from '../sim/scenario'
import type { RoleId } from '../sim/types'
import { Avatar, fmtK, Kbd, Sprite, Term, useEngine } from '../ui'

const KIND_GLYPH: Record<string, string> = { file: 'PDF', doc: 'MD', sheet: 'XLS', folder: 'DIR', almanac: 'ALM' }

export function Brief() {
  const e = useEngine()
  const selected = e.attachments.filter((a) => a.selected).length
  return (
    <>
      <div className="voice">
        <Avatar />
        <div className="bubble">
          <div className="who">Head farmer</div>
          What should this farm grow? Write the goal in your own words, pick what I may read, and set the energy budget.
        </div>
      </div>

      <div className="section-title">Goal</div>
      <textarea className="goal" value={e.goal} onChange={(ev) => e.setGoal(ev.target.value)} aria-label="Goal" />

      <div className="section-title">
        <span>Context for the crew</span>
        <span>{selected} of {e.attachments.length} attached</span>
      </div>
      <div className="picker" role="group" aria-label="Context picker">
        {e.attachments.map((a) => (
          <button key={a.id} className="pick" role="checkbox" aria-checked={a.selected} onClick={() => e.toggleAttachment(a.id)}>
            <span className="box">{a.selected ? '✓' : ''}</span>
            <span>
              <code>{a.name}</code>
              <div className="note">{a.note}</div>
            </span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{KIND_GLYPH[a.kind]}</span>
          </button>
        ))}
      </div>

      <div className="section-title">
        <Term w="Energy" m="token budget" />
        <span>suggested 120k</span>
      </div>
      <div className="budget">
        <input type="range" min={40_000} max={240_000} step={10_000} value={e.budget} onChange={(ev) => e.setBudget(Number(ev.target.value))} aria-label="Energy budget" />
        <b>{fmtK(e.budget)}</b>
      </div>
      <p className="hint">Suggested from the brief: about 5 tasks of 6k to 30k each, plus room for re-plans.</p>
    </>
  )
}

export function Clarify() {
  const e = useEngine()
  if (e.headThinking > 0)
    return (
      <div className="voice">
        <Avatar />
        <div className="bubble">
          <div className="who">Head farmer</div>
          Reading the brief and {e.attachments.filter((a) => a.selected).length} files <span className="dots"><i /><i /><i /></span>
        </div>
      </div>
    )
  return (
    <>
      <div className="voice">
        <Avatar />
        <div className="bubble">
          <div className="who">Head farmer</div>
          Three things I can’t work out from the brief. Answer or skip; I’ll assume the first option for anything you skip.
        </div>
      </div>
      {CLARIFY.map((q, i) => (
        <div className="q" key={q.id} style={{ animationDelay: `${i * 80}ms` }}>
          <h3>{q.q}</h3>
          <p>{q.why}</p>
          <div className="opts">
            {q.options.map((o) => (
              <button key={o} className="opt" aria-pressed={e.clarifyAnswers[q.id] === o} onClick={() => e.answerClarify(q.id, o)}>
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
  if (e.headThinking > 0)
    return (
      <div className="voice">
        <Avatar />
        <div className="bubble">
          <div className="who">Head farmer</div>
          Laying out the quest plan and recruiting a crew <span className="dots"><i /><i /><i /></span>
        </div>
      </div>
    )
  const total = e.tasks.reduce((s, t) => s + t.budget, 0)
  return (
    <>
      <div className="voice">
        <Avatar />
        <div className="bubble">
          <div className="who">Head farmer</div>
          Here’s the plan: 5 tasks, a crew of 4 and {fmtK(total)} of {fmtK(e.budget)} energy. Change anything, then approve. Nothing is planted before you do.
        </div>
      </div>

      <div className="section-title">
        <span>Quest plan · {e.goal.split('.')[0].slice(0, 32)}…</span>
        <span>in order</span>
      </div>
      {e.tasks.map((t, i) => {
        const changed = t.assignee !== t.proposedAssignee
        return (
          <div key={t.id} className={`plan-task ${changed ? 'changed' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
            <Sprite name={`crop_${t.crop}_3`} className="crop-icon" />
            <div>
              <h3>
                <span>
                  {i + 1}. {t.name}
                </span>
                <span className="mono">{fmtK(t.budget)}</span>
              </h3>
              <ul>
                {t.subtasks.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
              <div className="assign">
                <Term w="Farmhand" m="agent" />
                <select value={t.assignee} onChange={(ev) => e.reassign(t.id, ev.target.value as RoleId)} aria-label={`Assign ${t.name}`}>
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {e.farmhands[r].role}
                    </option>
                  ))}
                </select>
                {t.proposalNote && !changed && <span className="flag">{t.proposalNote}</span>}
                {changed && <span className="flag" style={{ color: 'var(--sprout-deep)', background: 'var(--sprout-wash)' }}>Changed by you</span>}
              </div>
            </div>
          </div>
        )
      })}

      <div className="section-title">
        <span>Crew</span>
        <span>each sees only its signposts</span>
      </div>
      <div className="crew-grid">
        {ROLE_ORDER.map((r) => {
          const f = e.farmhands[r]
          return (
            <div key={r} className="hand" style={{ ['--c' as string]: f.color }}>
              <div className="role">
                {f.role} <span>{f.name}</span>
              </div>
              <div className="meta">{f.tools.join(' · ')}</div>
              <div className="meta">
                {f.context.length} files{f.almanac.length ? ` · almanac: ${f.almanac.join(', ')}` : ''}
              </div>
              {f.seeds.length > 0 && <div className="meta" style={{ color: 'var(--sprout-deep)' }}>Saved seed: {f.seeds[0]}</div>}
            </div>
          )
        })}
      </div>
    </>
  )
}

export function SetupFooter() {
  const e = useEngine()
  if (e.phase === 'brief')
    return (
      <button className="btn primary grow" onClick={() => e.submitBrief()}>
        Send to the head farmer <Kbd>⌘⏎</Kbd>
      </button>
    )
  if (e.phase === 'clarify')
    return (
      <>
        <button className="btn ghost" disabled={e.headThinking > 0} onClick={() => e.finishClarify()}>
          Skip all
        </button>
        <button className="btn primary grow" disabled={e.headThinking > 0} onClick={() => e.finishClarify()}>
          Continue <Kbd>⏎</Kbd>
        </button>
      </>
    )
  if (e.phase === 'plan')
    return (
      <button className="btn primary grow" disabled={e.headThinking > 0} onClick={() => e.approvePlan()}>
        Approve and start <Kbd>⏎</Kbd>
      </button>
    )
  return null
}
