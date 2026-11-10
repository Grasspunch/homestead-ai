import './fonts'
import './hud/hud.css'
import './hud/panel.css'
import { useEffect, useRef, useState } from 'react'
import { FarmView } from './farm/FarmView'
import { Home } from './hud/Home'
import { Ico, LimitField, Portrait, Swatch, mins, usd } from './hud/bits'
import { FarmerPage } from './hud/FarmerPage'
import { ControlPanel, HarvestPanel, InboxPanel, LevelPicker, TaskPanel, UsagePanel, setMoment } from './hud/Side'
import { getLiveMode, route, setLiveMode } from './run/agent'
import { planInto } from './run/planning'
import { pendingAsk } from './run/reduce'
import { store, useStore, type Project } from './run/store'
import type { Ask, FarmerId, RunState } from './run/types'
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
      {!p.approved ? <PlanDialogue p={p} s={s} side={side} /> : ask ? <AskDialogue key={ask.id} s={s} ask={ask} side={side} /> : <PlannerDialogue p={p} s={s} side={side} />}
    </>
  )
}

function Top({ p, s }: { p: Project; s: RunState }) {
  const st = useStore()
  const open = s.asks.filter((a) => !a.answer).length
  const done = s.tasks.filter((t) => t.status === 'ripe' || t.status === 'accepted').length
  const sub = !p.approved ? (p.planning ? 'Planning' : 'Plan, not started') : s.done ? 'Done and live' : `${done} of ${s.tasks.length} tasks done`
  return (
    <header className="top">
      <button className="btn white sm" onClick={() => store.home()} aria-label="Your farms">
        <Ico name="home" size={20} />
      </button>
      <div className="title paper">
        <b>{p.name}</b>
        <span>{sub}</span>
      </div>
      <div className="spacer" />
      {p.approved && (
        <>
          <button className="pill paper" onClick={() => store.setDrawer({ kind: 'inbox' })} aria-label={`Inbox, ${open} need you`}>
            <i className={`mail${open ? ' on' : ''}`} />
            {open > 0 ? <span className="badge">{open}</span> : <span className="pill-word">Inbox</span>}
          </button>
          <button className="pill paper" onClick={() => store.setDrawer({ kind: 'usage' })} aria-label="Spend">
            <i className="coin" />
            <b>{usd(s.usage.usd)}</b>
          </button>
          <button className="btn white sm" onClick={() => store.togglePlay()} aria-label={st.playing ? 'Pause' : 'Play'}>
            <Ico name={st.playing ? 'pause' : 'play'} size={20} />
          </button>
        </>
      )}
      <button
        className="btn white sm"
        aria-label="Settings"
        onClick={() => {
          store.settingsOpen = !store.settingsOpen
          store.notify()
        }}
      >
        <Ico name="gear" size={20} />
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
      <div className="body paper">{children}</div>
    </section>
  )
}

function PlanDialogue({ p, s, side }: { p: Project; s: RunState; side: boolean }) {
  const [text, setText] = useState('')
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
  return (
    <Dialogue farmer="planner" side={side}>
      <div className="who">
        <b>Planner</b>
        <span className="tag grey">Plan</span>
        <span className="aside">Nothing runs until you approve</span>
      </div>
      <p className="plan-lead">
        {ids.length > 1 ? (
          <>
            I’d use this crew of <b>{ids.length}</b>: <b>{est && mins(est.minutes)}</b> for <b>{est && usd(est.usd)}</b>.
            {one && est && <> One agent alone takes {mins(one.minutes)} for {usd(one.usd)}, with nobody checking its work.</>}
          </>
        ) : (
          <>
            One agent, everything in a row: <b>{est && mins(est.minutes)}</b> for <b>{est && usd(est.usd)}</b>.
          </>
        )}
      </p>
      <div className="plan-grid">
        <section>
          <h4>Crew</h4>
          <div className="crew-list">
            {ids.map((id) => {
              const f = setupOf(id)
              return (
                <div key={id} className="crew-row">
                  <button className="crew-name" onClick={() => store.setDrawer({ kind: 'farmer', id })} title="Everything it carries">
                    <Swatch farmer={id} />
                    <b>{f.label}</b>
                  </button>
                  <select
                    className="pick"
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
                      <Ico name="cross" size={14} />
                    </button>
                  ) : (
                    <span className="crew-x" />
                  )}
                  {f.why && <span className="why">{f.why}</span>}
                </div>
              )
            })}
            {FARMER_ORDER.filter((x) => !s.farmers[x]).map((id) => (
              <button key={id} className="crew-add" onClick={() => setCrew([...ids, id])}>
                <Ico name="plus" size={14} />
                Add the {id.charAt(0).toUpperCase() + id.slice(1)}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h4>Tasks, and when each is done</h4>
          <div className="task-list">
            {s.tasks.map((t) => (
              <div key={t.id} className="task-row">
                <div className="task-top">
                  <button className="task-name" onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
                    {t.name}
                  </button>
                  <select
                    className="pick"
                    value={t.farmer}
                    aria-label={`Who does ${t.name}`}
                    onChange={(e) =>
                      store.editPlan(p.id, (tasks) => {
                        const x = tasks.find((k) => k.id === t.id)
                        if (x) x.farmer = e.target.value as FarmerId
                      })
                    }
                  >
                    {ids.map((x) => (
                      <option key={x} value={x}>
                        {s.farmers[x]!.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="done-when">
                  <span>Done when</span>
                  <input
                    defaultValue={t.doneWhen}
                    key={t.doneWhen}
                    aria-label={`${t.name} is done when`}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v && v !== t.doneWhen)
                        store.editPlan(p.id, (tasks) => {
                          const x = tasks.find((k) => k.id === t.id)
                          if (x) x.doneWhen = v
                        })
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="row plan-row">
        <div className="stops">
          Stops for you
          <LevelPicker p={p} compact />
        </div>
        <button className="toggle review-toggle" onClick={() => setMoment(p, 'review', p.autonomy.review === 'ask' ? 'auto' : 'ask')}>
          <span className={`switch${p.autonomy.review === 'ask' ? ' on' : ''}`} />
          <span>I accept finished work</span>
        </button>
        <form
          className="field paper grow-form-field"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            planInto(p, ids, text.trim())
            setText('')
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or tell me, for example: I have the screens already" aria-label="Change the plan" />
        </form>
        <button
          className="btn"
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

const REASON: Record<Ask['reason'], { label: string; cls: string }> = {
  cost: { label: 'Over budget', cls: 'gold' },
  disagree: { label: 'Disagreement', cls: 'grey' },
  irreversible: { label: 'Reaches real users', cls: 'sky' },
  anomaly: { label: 'Failed check', cls: 'red' },
  risk: { label: 'Ship again', cls: 'sky' },
  big: { label: 'Big change', cls: '' },
}

function AskDialogue({ s, ask, side }: { s: RunState; ask: Ask; side: boolean }) {
  const [holding, setHolding] = useState(false)
  const f = s.farmers[ask.farmer]
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
        <b>{f?.label ?? 'Farmer'}</b>
        <span className={`tag ${r.cls}`}>{r.label}</span>
        {task && (
          <button className="aside link" onClick={() => store.setDrawer({ kind: 'task', id: task.id })}>
            {task.name}
          </button>
        )}
      </div>
      {holding ? (
        <p>Holding. Nothing ships until you say so.</p>
      ) : (
        <>
          <p>{ask.question}</p>
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
        <span className="end aside-note">The crew waits for you</span>
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
  const last = s.activity[s.activity.length - 1]
  return (
    <Dialogue farmer="planner" side={side}>
      <div className="who">
        <b>Planner</b>
        {s.done ? <span className="tag green">Done</span> : <span className="tag grey">Talk to the crew</span>}
        {!s.done && last && <span className="aside">{last.text}</span>}
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
            <span className="field paper">
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
