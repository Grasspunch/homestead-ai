import './fonts'
import './hud/kit.css'
import './hud/hud.css'
import './hud/panel.css'
import { useEffect, useRef, useState } from 'react'
import { FarmView, cropOf } from './farm/FarmView'
import { Home } from './hud/Home'
import { Ico, LimitField, Portrait, Sign, Swatch, mins, usd, type IconName } from './hud/bits'
import { FarmerPage } from './hud/FarmerPage'
import { ControlPanel, HarvestPanel, InboxPanel, LevelPicker, TaskPanel, UsagePanel, setMoment } from './hud/Side'
import { getLiveMode, route, setLiveMode } from './run/agent'
import { planInto } from './run/planning'
import { pendingAsk } from './run/reduce'
import { store, useStore, type Project } from './run/store'
import type { Ask, FarmerId, RunState, TaskState } from './run/types'
import { FARMER_ORDER } from './run/types'
import { MODELS, applyEdit } from './run/kit'

export function App() {
  const st = useStore()
  useEffect(() => {
    if (!st.projects.length) st.loadSample()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (store.settingsOpen) {
          store.settingsOpen = false
          store.notify()
        } else if (store.drawer) store.setDrawer(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  return (
    <div className="stage">
      {st.screen.kind === 'home' ? <Home /> : <Farm />}
      {st.settingsOpen && <Settings />}
      {st.toast && (
        <div key={st.toast.id} className="toast paper" role="status">
          {st.toast.text}
        </div>
      )}
    </div>
  )
}

// ---- the farm screen --------------------------------------------------------------

function Farm() {
  const st = useStore()
  const p = st.project()
  const s = st.state(p)
  if (!p || !s) return null
  const pending = p.approved ? pendingAsk(p.events, st.clock, st.viewerAnswers) : null
  const ask = pending ? s.asks.find((a) => a.id === pending) ?? null : null
  // Finished work waiting for you. While any waits, the ship ask can't be answered.
  const toReview = p.approved ? s.tasks.filter((t) => t.status === 'ripe' && !t.gate) : []
  const review = toReview[0]
  const d = st.drawer
  const sel = d?.kind === 'task' ? { kind: 'task' as const, id: d.id } : d?.kind === 'farmer' ? { kind: 'farmer' as const, id: d.id } : null
  const side = !!d && d.kind !== 'chat' && d.kind !== 'farmer' && d.kind !== 'ask' && d.kind !== 'summary' ? true : d?.kind === 'summary'
  return (
    <>
      <FarmView
        state={s}
        planning={!p.approved}
        side={side}
        selected={sel}
        openAsk={ask}
        onTask={(id) => store.setDrawer(d?.kind === 'task' && d.id === id ? null : { kind: 'task', id })}
        onFarmer={(id) => store.setDrawer(d?.kind === 'farmer' && d.id === id ? null : { kind: 'farmer', id })}
        onMail={() => store.setDrawer({ kind: 'inbox' })}
        onCoins={() => store.setDrawer({ kind: 'usage' })}
        onChest={() => store.setDrawer({ kind: 'summary' })}
      />
      <Top p={p} s={s} />
      {d?.kind === 'task' && <TaskPanel p={p} s={s} id={d.id} />}
      {d?.kind === 'farmer' && <FarmerPage p={p} s={s} id={d.id} />}
      {d?.kind === 'inbox' && <InboxPanel s={s} />}
      {d?.kind === 'usage' && <UsagePanel s={s} />}
      {d?.kind === 'summary' && <HarvestPanel s={s} p={p} />}
      {d?.kind === 'control' && <ControlPanel p={p} />}
      {!p.approved ? (
        <PlanDialogue p={p} s={s} side={side} />
      ) : ask && !(review && isShipAsk(ask)) ? (
        <AskDialogue key={ask.id} s={s} ask={ask} side={side} />
      ) : st.trustOffer === p.id ? (
        <TrustDialogue s={s} side={side} />
      ) : review ? (
        <ReviewDialogue key={review.id} s={s} t={review} side={side} waiting={toReview.length} />
      ) : (
        <PlannerDialogue p={p} s={s} side={side} />
      )}
    </>
  )
}

function Top({ p, s }: { p: Project; s: RunState }) {
  const st = useStore()
  const open = s.asks.filter((a) => !a.answer).length + s.tasks.filter((t) => t.status === 'ripe' && !t.gate).length
  const done = s.tasks.filter((t) => t.status === 'ripe' || t.status === 'accepted').length
  const sub = !p.approved ? (p.planning ? 'Planning' : 'Plan, not started') : s.done ? 'Done and live' : `${done} of ${s.tasks.length} tasks done`
  return (
    <header className="top">
      <button className="btn white top-ico" onClick={() => store.home()} aria-label="Your farms">
        <Ico name="home" size={32} />
      </button>
      <div className="title paper">
        <b>{p.name}</b>
        <span>{sub}</span>
      </div>
      <div className="spacer" />
      {p.approved && (
        <>
          <button className="btn white top-ico inbox-btn" onClick={() => store.setDrawer({ kind: 'inbox' })} aria-label={open ? `Inbox, ${open} need you` : 'Inbox'}>
            <i className="mail-ico" />
            {open > 0 && <span className="badge">{open}</span>}
          </button>
          <button className="btn white top-ico top-coin" onClick={() => store.setDrawer({ kind: 'usage' })} aria-label={`Spend so far, ${usd(s.usage.usd)}`}>
            <i className="coin" />
            <b>{usd(s.usage.usd)}</b>
          </button>
          <button className="btn white top-ico" onClick={() => store.togglePlay()} aria-label={st.playing ? 'Pause' : 'Play'}>
            <Ico name={st.playing ? 'pause' : 'play'} size={32} />
          </button>
        </>
      )}
      <button
        className="btn white top-ico"
        aria-label="Settings"
        onClick={() => {
          store.settingsOpen = !store.settingsOpen
          store.notify()
        }}
      >
        <Ico name="gear" size={32} />
      </button>
    </header>
  )
}

function Dialogue({ farmer, side, children }: { farmer: FarmerId; side: boolean; children: React.ReactNode }) {
  return (
    <section className={`dlg${side ? ' with-side' : ''}`}>
      <div className="portrait">
        <Portrait farmer={farmer} />
      </div>
      <div className="body paper bubble" data-tail="left">{children}</div>
    </section>
  )
}

function PlanDialogue({ p, s, side }: { p: Project; s: RunState; side: boolean }) {
  const st = useStore()
  if (p.planning)
    return (
      <Dialogue farmer="planner" side={side}>
        <div className="who">
          <b>Planner</b>
        </div>
        <p className="thinking">
          Laying out a farm for this <i />
          <i />
          <i />
        </p>
        <p className="impact">{p.goal}</p>
      </Dialogue>
    )
  if (p.error)
    return (
      <Dialogue farmer="planner" side={side}>
        <div className="who">
          <b>Planner</b>
          <span className="tag red">Couldn’t plan</span>
        </div>
        <p>{p.error}</p>
        <div className="row">
          <button className="btn" onClick={() => planInto(p)}>
            Try again
          </button>
        </div>
      </Dialogue>
    )
  const one = s.singleAgentEstimate
  const ids = FARMER_ORDER.filter((x) => s.farmers[x])
  const edits = st.kit[p.id] ?? {}
  const setupOf = (id: FarmerId) => applyEdit(s.farmers[id]!, edits[id])
  // Your model choices move the price: each farmer's share scales with its model's rate.
  const rate = (m: string) => MODELS.find((x) => x.model === m)?.rate ?? 1
  const est = s.estimate && {
    minutes: s.estimate.minutes,
    usd: ids.reduce((n, id) => n + (s.farmers[id]!.limits.usd / 1.3) * (rate(setupOf(id).model) / rate(s.farmers[id]!.model) - 1), s.estimate.usd),
  }
  const setCrew = (next: FarmerId[]) => planInto(p, next)
  const missing = FARMER_ORDER.filter((x) => !s.farmers[x])
  return (
    <Dialogue farmer="planner" side={side}>
      <div className="who">
        <b>Planner</b>
        <span className="tag grey">Plan</span>
      </div>
      <p className="plan-lead">
        {ids.length > 1 ? (
          <>
            This crew of {ids.length} takes about <b>{est && mins(est.minutes)}</b> for <b>{est && usd(est.usd)}</b>
            {one && est && one.minutes > est.minutes ? (
              <>
                : <b className="gain">{mins(one.minutes - est.minutes)} sooner</b> than one agent alone
                {one.usd - est.usd > 0.5 ? <>, and {usd(one.usd - est.usd)} less</> : null}{s.farmers.tester ? ", with the Tester checking every task" : ""}.
              </>
            ) : (
              '.'
            )}
          </>
        ) : (
          <>
            One agent, everything in a row: <b>{est && mins(est.minutes)}</b> for <b>{est && usd(est.usd)}</b>.
          </>
        )}
      </p>
      <div className="crew" role="table" aria-label="Crew">
        <div className="crew-head" role="row">
          <span role="columnheader">Farmer</span>
          <span role="columnheader">Why</span>
          <span role="columnheader">Model</span>
          <span role="columnheader">Limit</span>
          <span />
        </div>
        {ids.map((id) => {
          const f = setupOf(id)
          return (
            <div key={id} className="crew-row" role="row">
              <button className="crew-name" onClick={() => store.setDrawer({ kind: 'farmer', id })}>
                <Swatch farmer={id} />
                {f.label}
              </button>
              <span className="why">{f.why}</span>
              <select
                className="field-box"
                value={f.model}
                aria-label={`${f.label}'s model`}
                onChange={(e) => {
                  const m = MODELS.find((x) => x.model === e.target.value)!
                  store.editKit(p.id, id, (k) => {
                    const base = s.farmers[id]!
                    k.model = m.model === base.model ? undefined : m.model
                    k.agent = m.model === base.model ? undefined : m.agent
                  })
                }}
              >
                {MODELS.map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.label}
                  </option>
                ))}
              </select>
              <LimitField unit="$" label={`${f.label}'s spend limit`} value={f.limits.usd} onChange={(v) => store.editKit(p.id, id, (k) => (k.limits = { ...f.limits, usd: v }))} />
              {id !== 'builder' ? (
                <button className="crew-x" aria-label={`Drop the ${f.label}`} onClick={() => setCrew(ids.filter((x) => x !== id))}>
                  <i className="mark no" />
                </button>
              ) : (
                <span className="crew-x locked" title="Every crew needs a Builder, since it writes the code" aria-label="The Builder can't be dropped">
                  <i className="mark no" />
                </span>
              )}
            </div>
          )
        })}
      </div>
      {missing.length > 0 && (
        <div className="plan-note">
          {missing.map((id) => (
            <button key={id} className="link" onClick={() => setCrew([...ids, id])}>
              Add the {id.charAt(0).toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
      )}
      <div className="plan-foot">
        <div className="plan-setting">
          <span>Stops for you</span>
          <LevelPicker p={p} compact />
        </div>
        <button className="plan-setting" onClick={() => setMoment(p, 'review', p.autonomy.review === 'ask' ? 'auto' : 'ask')} aria-pressed={p.autonomy.review === 'ask'}>
          <span>I accept finished work</span>
          <span className={`switch${p.autonomy.review === 'ask' ? ' on' : ''}`} />
        </button>
        <button
          className="btn approve"
          onClick={() => {
            store.enableNotifications(true)
            store.approve(p.id)
          }}
        >
          <Ico name="play" />
          Approve
          {est && <small>{usd(est.usd)}</small>}
        </button>
      </div>
    </Dialogue>
  )
}

// Offered once, after five accepts with nothing sent back.
function TrustDialogue({ s, side }: { s: RunState; side: boolean }) {
  const checker = s.farmers.tester ? 'Tester' : 'Planner'
  return (
    <Dialogue farmer="planner" side={side}>
      <div className="who">
        <b>Planner</b>
      </div>
      <p>You’ve accepted five tasks in a row without sending any back. Want the {checker} to accept finished work once its check passes?</p>
      <p className="impact">You’d still see every task in the pull request, and you can turn it back on in Stops for you.</p>
      <div className="row">
        <button className="btn" onClick={() => store.answerTrust(true)} autoFocus>
          <Ico name="check" />
          Let the {checker} accept
        </button>
        <button className="btn tan" onClick={() => store.answerTrust(false)}>
          Keep asking me
        </button>
      </div>
    </Dialogue>
  )
}

// Colour says how urgent it is; the icon says what kind of question it is.
// Red: broken and waiting on you. Honey: a decision with money or reach. Bark: your call, no rush.
const REASON: Record<Ask['reason'], { label: string; urgency: 'red' | 'honey' | 'calm'; icon: IconName }> = {
  anomaly: { label: 'Failed check', urgency: 'red', icon: 'alert' },
  cost: { label: 'Over budget', urgency: 'honey', icon: 'coin' },
  big: { label: 'Big change', urgency: 'honey', icon: 'star' },
  irreversible: { label: 'Reaches real users', urgency: 'honey', icon: 'play' },
  risk: { label: 'Ship again', urgency: 'honey', icon: 'play' },
  disagree: { label: 'Disagreement', urgency: 'calm', icon: 'chat' },
}

const isShipAsk = (a: Ask) => a.reason === 'irreversible' && /merge|ship/i.test(a.suggested)
// Commits in the pull request: one per task you (or the checker) accepted.
export const accepted = (s: RunState) => s.tasks.filter((t) => t.status === 'accepted' && !t.gate).length

// Finished work, from the farmer who made it: accept it, or send it back with what should change.
function ReviewDialogue({ s, t, side, waiting }: { s: RunState; t: TaskState; side: boolean; waiting: number }) {
  const [note, setNote] = useState('')
  const [writing, setWriting] = useState(false)
  const check = t.checks[t.checks.length - 1]
  return (
    <Dialogue farmer={t.farmer} side={side}>
      <div className="who">
        <button className="plot-chip" onClick={() => store.setDrawer({ kind: 'task', id: t.id })} title="Open this task">
          <Sign crop={cropOf(s.tasks, t.id)} />
          {t.name}
        </button>
        <span className="urgency calm">
          <Ico name="check" tone="light" />
          Ready for you
        </span>
        {waiting > 1 && <span className="aside">{waiting - 1} more after this</span>}
      </div>
      <p>
        {t.sentBack ? <>Changed as you asked: “{t.sentBack}”. </> : null}
        {check ? <>Checked by the {s.farmers[check.by]?.label ?? check.by}: {check.notes}.</> : 'Done.'}
      </p>
      {writing ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!note.trim()) return
            store.sendBack(t.id, note.trim())
            setWriting(false)
            setNote('')
          }}
        >
          <span className="field">
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" aria-label="What should change" />
          </span>
          <button className="btn" type="submit">
            Send back
          </button>
        </form>
      ) : (
        <div className="row">
          <button className="btn" onClick={() => store.accept(t.id)} autoFocus>
            <Ico name="check" />
            Accept
          </button>
          <button className="btn tan" onClick={() => setWriting(true)}>
            Send back
          </button>
        </div>
      )}
    </Dialogue>
  )
}

function AskDialogue({ s, ask, side }: { s: RunState; ask: Ask; side: boolean }) {
  const [holding, setHolding] = useState(false)
  const r = REASON[ask.reason]
  const task = s.tasks.find((t) => t.id === ask.task)
  const dis = ask.reason === 'disagree' ? s.disagreements.filter((x) => x.task === ask.task).slice(-1)[0] : undefined
  const pick = (choice: string) => {
    if (/^not yet/i.test(choice)) {
      setHolding(true)
      return
    }
    store.answer(ask.id, choice)
  }
  return (
    <Dialogue farmer={ask.farmer} side={side}>
      <div className="who">
        {task && (
          <button className="plot-chip" onClick={() => store.setDrawer({ kind: 'task', id: task.id })} title="Open this task">
            <Sign crop={cropOf(s.tasks, task.id)} />
            {task.name}
          </button>
        )}
        <span className={`urgency ${r.urgency}`}>
          <Ico name={r.icon} tone="light" />
          {r.label}
        </span>
      </div>
      {holding ? (
        <p>Holding. Nothing ships until you say so.</p>
      ) : (
        <>
          <p>{isShipAsk(ask) ? `Everything is accepted. The pull request has ${accepted(s)} commit${accepted(s) === 1 ? '' : 's'}, one per accepted task.` : ask.question}</p>
          {dis && (
            <div className="sides">
              {dis.sides.map((x) => (
                <details key={x.farmer} className="side-card">
                  <summary>
                    <Swatch farmer={x.farmer} />
                    <span className="grow">
                      <b>{s.farmers[x.farmer]?.label}</b> {x.position}
                    </span>
                    {x.why && <span className="sub why-open">Why</span>}
                  </summary>
                  {x.why && <p className="why">{x.why}</p>}
                </details>
              ))}
            </div>
          )}
          {ask.touches && ask.touches.length > 0 && (
            <div className="touches">
              <span className="sub">Reaches</span>
              {ask.touches.map((id) => (
                <button key={id} className="touch" onClick={() => store.setDrawer({ kind: 'task', id })}>
                  {s.tasks.find((t) => t.id === id)?.name ?? id}
                </button>
              ))}
              {ask.files ? <span className="mono">{ask.files} files</span> : null}
            </div>
          )}
          {ask.impact && <p className="impact">{ask.impact}</p>}
        </>
      )}
      <div className="row">
        <button className="btn" onClick={() => store.answer(ask.id, ask.suggested)} autoFocus>
          <Ico name="check" />
          {ask.suggested}
        </button>
        {!holding &&
          ask.alternatives.map((a) => (
            <button key={a} className="btn tan" onClick={() => pick(a)}>
              {a}
            </button>
          ))}
      </div>
    </Dialogue>
  )
}

function PlannerDialogue({ p, s, side }: { p: Project; s: RunState; side: boolean }) {
  const st = useStore()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const lines = (st.chat[p.id] ?? []).slice(-2)
  const input = useRef<HTMLInputElement>(null)
  const send = async () => {
    const msg = text.trim()
    if (!msg) return
    setText('')
    store.chatTo(p.id, { from: 'you', text: msg })
    setBusy(true)
    const farmers = Object.values(s.farmers).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ id: f.id, label: f.label }))
    const r = await route({ message: msg, farmers, tasks: s.tasks.map((t) => ({ id: t.id, name: t.name, farmer: t.farmer })) })
    setBusy(false)
    store.chatTo(p.id, { from: 'planner', text: r.data.reply, to: r.data.to })
  }
  return (
    <Dialogue farmer="planner" side={side}>
      <div className="who">
        <b>Planner</b>
        {s.done ? <span className="tag green">Done</span> : <span className="tag grey">Talk to the crew</span>}
      </div>
      {s.done ? (
        <p>
          Everything is in and live for everyone. {usd(s.done.usd)} in {mins(s.done.minutes)}, {s.autoFixes.length} things fixed without you, and you made {s.asks.filter((a) => a.answer).length} calls.
        </p>
      ) : (
        lines.length > 0 && (
          <div className="said">
            {lines.map((l, i) => (
              <span key={i} className={l.from === 'you' ? 'you' : ''}>
                {l.from === 'you' ? `You: ${l.text}` : l.text}
              </span>
            ))}
          </div>
        )
      )}
      <div className="row">
        {s.done ? (
          <>
            <button className="btn" onClick={() => store.setDrawer({ kind: 'summary' })}>
              <Ico name="star" />
              See the harvest
            </button>
            <button className="btn tan" onClick={() => store.setDrawer({ kind: 'usage' })}>
              Spend
            </button>
          </>
        ) : (
          <form
            className="row grow-form"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <span className="field">
              <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell the crew something, for example: make the widget friendlier" aria-label="Message the crew" />
            </span>
            <button className="btn" type="submit" disabled={busy}>
              <Ico name="chat" />
              {busy ? '...' : 'Send'}
            </button>
          </form>
        )}
      </div>
    </Dialogue>
  )
}

function Settings() {
  const st = useStore()
  const [live, setLive] = useState(getLiveMode())
  return (
    <div className="pop wood" role="dialog" aria-label="Settings">
      <h3 className="px-s">Settings</h3>
      <button
        className="toggle"
        onClick={() => {
          setLiveMode(!live)
          setLive(!live)
        }}
      >
        <span className={`switch${live ? ' on' : ''}`} />
        <span>
          Live mode
          <small>The Planner runs on Claude with the server’s API key. Off, it’s simulated and spends nothing.</small>
        </span>
      </button>
      <button className="toggle" onClick={() => store.enableNotifications(!st.notifications)}>
        <span className={`switch${st.notifications ? ' on' : ''}`} />
        <span>
          Desktop notifications
          <small>When a farmer needs you and this tab is in the background.</small>
        </span>
      </button>
    </div>
  )
}
