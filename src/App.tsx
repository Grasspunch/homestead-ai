import './fonts'
import './hud/kit.css'
import './hud/hud.css'
import './hud/panel.css'
import { useEffect, useRef, useState } from 'react'
import { FarmView, cropOf } from './farm/FarmView'
import { Home } from './hud/Home'
import { Ico, LimitField, Mark, Portrait, Sign, Swatch, mins, usd, type IconName } from './hud/bits'
import { FarmerPage } from './hud/FarmerPage'
import { Rollout } from './hud/Proof'
import { ControlPanel, HarvestPanel, InboxPanel, LevelPicker, TaskPanel, UsagePanel, caughtLine, outcome } from './hud/Side'
import { getLiveMode, route, setLiveMode } from './run/agent'
import { planInto } from './run/planning'
import { scenario } from './run/simPlan'
import { pendingAsk } from './run/reduce'
import { store, useStore, type Project } from './run/store'
import { SEND_BACK } from './run/simulate'
import { BY_YOU } from './run/rollback'
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
  // After a clean merge you made yourself, the Planner offers once to merge future pull requests by itself.
  // After three clean runs in a row (no rollback, nothing sent back or stopped), the Planner offers once to merge by itself.
  // Not with May deploy off: then every release asks you anyway.
  const deployOff = st.kit[p.id]?.deployer?.rules.deploy === false
  const trust = p.approved && !!s.done && !p.trust && !deployOff && !p.everSentBack && p.autonomy.ship === 'ask' && (p.cleanRuns ?? 0) >= 3 && cleanMerge(s)
  // A rollback is a moment of its own until the next release goes out, or until you carry on.
  const lastDeploy = s.deploy[s.deploy.length - 1]
  const rolled = lastDeploy?.stage === 'rollback' && !st.seen.has(`${p.id}:${lastDeploy.t}`) ? lastDeploy : null
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
      ) : ask ? (
        <AskDialogue key={ask.id} s={s} ask={ask} side={side} />
      ) : rolled ? (
        <RollbackDialogue key={rolled.t} s={s} side={side} t={rolled.t} />
      ) : trust ? (
        <TrustDialogue side={side} />
      ) : (
        <PlannerDialogue p={p} s={s} side={side} />
      )}
    </>
  )
}

function Top({ p, s }: { p: Project; s: RunState }) {
  const st = useStore()
  const open = s.asks.filter((a) => !a.answer).length
  const done = s.tasks.filter((t) => t.status === 'ripe' || t.status === 'accepted').length
  const sub = !p.approved ? (p.planning ? 'Planning' : 'Plan, not started') : s.done ? (s.deploy[s.deploy.length - 1]?.stage === 'rollback' ? 'Done, rolled back' : 'Done and live') : `${done} of ${s.tasks.length} tasks done`
  return (
    <header className="top">
      <button className="btn white top-ico" onClick={() => store.home()} aria-label="Your farms">
        <Ico name="home" size={32} />
      </button>
      <div className="title paper">
        <b>{p.name}</b>
        <span>{sub}</span>
        {p.approved && (
          <span className="tag grey" title="Every farmer, cost and check in this run is simulated">
            Simulated run
          </span>
        )}
        {!scenario(p.goal).matched && (
          <span className="tag gold" title="Your goal matches none of the sample projects, so the farmers act out a generic app">
            Demo scenario
          </span>
        )}
      </div>
      <div className="spacer" />
      {p.approved && (
        <>
          <button className="btn white top-ico top-pr" onClick={() => store.setDrawer({ kind: 'summary' })}>
            Pull request
          </button>
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

// The pixel font is for labels of three words or fewer; a longer answer reads better in the text face.
const long = (label: string) => (label.trim().split(/\s+/).length > 3 ? ' long' : '')

// dock: the plan stands on the left, full height, so the whole farm shows beside it. The Planner sits above it.
function Dialogue({ farmer, side, dock = false, children }: { farmer: FarmerId; side: boolean; dock?: boolean; children: React.ReactNode }) {
  return (
    <section className={`dlg${side && !dock ? ' with-side' : ''}${dock ? ' dock' : ''}`}>
      <div className="portrait">
        <Portrait farmer={farmer} size={dock ? 48 : 108} />
      </div>
      <div className="body paper bubble" data-tail={dock ? 'up' : 'left'}>
        {children}
      </div>
    </section>
  )
}

function PlanDialogue({ p, s, side }: { p: Project; s: RunState; side: boolean }) {
  const st = useStore()
  if (p.planning)
    return (
      <Dialogue farmer="planner" side={side} dock>
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
      <Dialogue farmer="planner" side={side} dock>
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
    <Dialogue farmer="planner" side={side} dock>
      <div className="who">
        <b>Planner</b>
        <span className="tag grey">Plan</span>
        {p.plannedLive && (
          <span className="tag sky" title="This plan came from a live call to Claude Opus 5.5">
            Planned live by Claude
          </span>
        )}
        {!p.plannedLive && p.liveNote && <span className="tag red">Live call failed</span>}
        {!p.plannedLive && !p.liveNote && !scenario(p.goal).matched && (
          <span className="tag gold" title="Your goal matches none of the sample projects, so the farmers act out a generic app">
            Demo scenario
          </span>
        )}
      </div>
      {!p.plannedLive && p.liveNote && <p className="impact">This plan is simulated, because the live call failed: {p.liveNote}</p>}
      <p className="plan-lead">
        {ids.length > 1 ? (
          <>
            This crew of {ids.length} takes about <b>{est && mins(est.minutes)}</b> for <b>{est && usd(est.usd)}</b>
            {one && est ? (
              <>
                , against one Sonnet agent alone:{' '}
                {one.minutes > est.minutes ? <b className="gain">{mins(one.minutes - est.minutes)} sooner</b> : <b>{mins(est.minutes - one.minutes)} slower</b>}
                {Math.abs(est.usd - one.usd) < 1 ? ', at the same cost' : est.usd > one.usd ? <>, and <b>{usd(est.usd - one.usd)} more</b></> : <>, and <b>{usd(one.usd - est.usd)} less</b></>}
                {s.farmers.tester ? ', with every task checked by someone else' : ''}.
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
      <div className="crew-scroll">
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
              <span className="why" title={f.why}>
                {f.why}
              </span>
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

// The release went bad and rolled itself back: what happened, who saw it, and what's being done.
function RollbackDialogue({ s, side, t }: { s: RunState; side: boolean; t: number }) {
  const p = store.project()!
  const i = s.deploy.findIndex((d) => d.t === t)
  const before = s.deploy[i - 1]
  const everyone = before?.stage === '100%'
  const live = before ? Math.max(1, Math.round((t - before.t) / 60_000)) : 0
  // This release only: its own launch numbers and every reading until the rollback.
  const peak = Math.max(before?.metrics?.errorRate ?? 0, ...s.monitor.filter((m) => m.t <= t && (!before || m.t >= before.t)).map((m) => m.metrics.errorRate ?? 0))
  const cause = s.activity.find((a) => a.t > t && a.kind !== 'ask' && /error|time out|timeout/i.test(a.text))
  const shipper = (s.tasks.find((x) => x.gate)?.farmer ?? 'deployer') as FarmerId
  const mine = s.deploy[i]?.reason === BY_YOU
  const done = () => {
    store.seen.add(`${p.id}:${t}`)
    store.play()
  }
  useEffect(() => {
    store.pause()
  }, [])
  return (
    <Dialogue farmer={shipper} side={side}>
      <div className="who">
        <b>{s.farmers[shipper]?.label ?? 'Deployer'}</b>
        <span className="urgency red">
          <Ico name="alert" tone="light" />
          Rolled back
        </span>
      </div>
      <p>
        {mine ? <>Rolled back as you asked, with errors at <b>{(peak * 100).toFixed(1)}%</b>.</> : <>Errors reached <b>{(peak * 100).toFixed(1)}%</b>, so I rolled back by myself.</>}{' '}
        {mine ? <>It was live for {everyone ? 'every user' : '1 in 10 users'} for {live} min.</> : everyone ? <>Every user saw it for {live} min.</> : <>1 in 10 users saw it for {live} min. Nobody else did.</>}
      </p>
      {cause && !mine && <p className="impact">{cause.text}</p>}
      <div className="rb-chart">
        <Rollout state={s} compact />
      </div>
      <div className="row">
        <button className="btn" onClick={done} autoFocus>
          <Ico name="play" />
          Carry on
        </button>
        <button
          className="btn tan"
          onClick={() => {
            store.seen.add(`${p.id}:${t}`)
            store.setDrawer({ kind: 'summary' })
          }}
        >
          See the pull request
        </button>
      </div>
    </Dialogue>
  )
}

// Offered once, after you merged a pull request with nothing sent back. It applies from the next run.
function TrustDialogue({ side }: { side: boolean }) {
  return (
    <Dialogue farmer="planner" side={side}>
      <div className="who">
        <b>Planner</b>
      </div>
      <p>Three clean runs in a row: no rollback, nothing sent back. Merge future pull requests by itself when every check passes?</p>
      <p className="impact">A failed check always asks you, and a rollback takes this back.</p>
      <div className="row">
        <button className="btn" onClick={() => store.answerTrust(true)} autoFocus>
          <Ico name="check" />
          Let it merge
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

const isShipAsk = (a: Ask) => a.reason === 'irreversible' && /merge/i.test(a.suggested)
// You merged it yourself, sent nothing back, and stopped nothing.
const cleanMerge = (s: RunState) =>
  s.asks.some((a) => isShipAsk(a) && a.answer && /^merge/i.test(a.answer.choice)) &&
  !s.deploy.some((d) => d.stage === 'rollback') &&
  !s.asks.some((a) => a.answer?.choice === SEND_BACK) &&
  !s.tasks.some((t) => t.stopped && t.status !== 'accepted')

// The pull request review: every commit with the check that let it in. Merge it, or send one task back with a note.
function PrReview({ s, ask, holding, hold }: { s: RunState; ask: Ask; holding: boolean; hold: () => void }) {
  const list = s.tasks.filter((t) => t.status === 'accepted' && !t.gate)
  const [writing, setWriting] = useState(false)
  const [task, setTask] = useState(list[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [all, setAll] = useState(false)
  const r = REASON[ask.reason]
  const n = list.reduce((k, t) => k + 1 + (t.changes?.length ?? 0), 0)
  const shown = all ? list : list.slice(0, 3)
  const merge = ask.suggested
  const rest = ask.alternatives.filter((a) => a !== SEND_BACK)
  return (
    <>
      <div className="who">
        <b>Pull request</b>
        <span className={`urgency ${r.urgency}`}>
          <Ico name={r.icon} tone="light" />
          Your review
        </span>
      </div>
      <p>{holding ? 'Holding. Nothing merges until you say so.' : `${/again/.test(ask.question) ? 'The pull request is ready again' : 'The pull request is ready'}: ${n} commit${n === 1 ? '' : 's'}, and every check passed.`}</p>
      <div className="list pr-commits">
        {shown.map((t) => {
          const check = [...t.checks].reverse().find((c) => c.pass)
          return (
            <button key={t.id} className={writing && task === t.id ? 'picked' : ''} onClick={() => (writing ? setTask(t.id) : store.setDrawer({ kind: 'task', id: t.id }))}>
              <Mark pass />
              <span className="grow">
                {t.name}
                {t.changes?.length ? <span className="tag grey">Changed</span> : null}
                <span className="sub">{check ? `${s.farmers[check.by]?.label ?? check.by}: ${check.notes}` : t.doneWhen}</span>
              </span>
            </button>
          )
        })}
        {!all && list.length > shown.length && (
          <button className="more" onClick={() => setAll(true)}>
            <span className="grow">+{list.length - shown.length} more</span>
          </button>
        )}
      </div>
      {writing ? (
        <form
          className="row send-back"
          onSubmit={(e) => {
            e.preventDefault()
            if (!note.trim() || !task) return
            store.sendBack(ask.id, task, note.trim())
          }}
        >
          <select className="field-box" value={task} onChange={(e) => setTask(e.target.value)} aria-label="Which task">
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="field">
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" aria-label="What should change" />
          </span>
          <button className="btn" type="submit" disabled={!note.trim()}>
            Send back
          </button>
          <button className="btn tan" type="button" onClick={() => setWriting(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="row">
          <button className={`btn${long(merge)}`} onClick={() => store.answer(ask.id, merge)} autoFocus>
            <Ico name="check" />
            {merge}
          </button>
          <button className="btn tan" onClick={() => setWriting(true)}>
            {SEND_BACK}
          </button>
          {rest
            .filter((a) => !(holding && /^not yet/i.test(a)))
            .map((a) => (
              <button key={a} className={`btn tan${long(a)}`} onClick={() => (/^not yet/i.test(a) ? hold() : store.answer(ask.id, a))}>
                {a}
              </button>
            ))}
        </div>
      )}
    </>
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
    // Looking isn't deciding: open the task with its failing tests, and the ask stays open.
    if (/^show me/i.test(choice) && ask.task) {
      store.setDrawer({ kind: 'task', id: ask.task })
      return
    }
    store.answer(ask.id, choice)
  }
  if (isShipAsk(ask))
    return (
      <Dialogue farmer={ask.farmer} side={side}>
        <PrReview s={s} ask={ask} holding={holding} hold={() => setHolding(true)} />
      </Dialogue>
    )
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
        <button className={`btn${long(ask.suggested)}`} onClick={() => store.answer(ask.id, ask.suggested)} autoFocus>
          <Ico name="check" />
          {ask.suggested}
        </button>
        {ask.alternatives
          .filter((a) => !(holding && /^not yet/i.test(a)))
          .map((a) => (
            <button key={a} className={`btn tan${long(a)}`} onClick={() => pick(a)}>
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
          {s.deploy[s.deploy.length - 1]?.stage === 'rollback' ? 'Everything is merged, and you rolled it back, so nothing is live.' : 'Everything is in and live for everyone.'} {usd(s.done.usd)} in {mins(s.done.minutes)}. {caughtLine(s)}, and you made {s.asks.filter((a) => a.answer).length} call{s.asks.filter((a) => a.answer).length === 1 ? '' : 's'}.
        </p>
      ) : null}
      {s.done && outcome(s) && <p className="impact gain-line">{outcome(s)!.value}</p>}
      {!s.done && (
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
              See the pull request
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
