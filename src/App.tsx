import './fonts'
import './hud/kit.css'
import './hud/hud.css'
import './hud/panel.css'
import { useEffect, useRef, useState } from 'react'
import { FarmView, cropOf } from './farm/FarmView'
import { Home } from './hud/Home'
import { Ico, LimitField, Mark, Portrait, Quiet, Sign, SimTag, Swatch, mins, usd, type IconName } from './hud/bits'
import { FarmerPage } from './hud/FarmerPage'
import { PrView } from './hud/PrView'
import { Rollout } from './hud/Proof'
import { ControlPanel, InboxPanel, LevelPicker, TaskPanel, UsagePanel, caughtLine, outcome } from './hud/Side'
import { discuss, getLiveMode, isFallbackNote, reshapeRead, route, setLiveMode } from './run/agent'
import type { Scope } from './run/reshape'
import { planInto } from './run/planning'
import { shortDate } from './run/recorded'
import { ExportButtons } from './hud/Export'
import { scenario } from './run/simPlan'
import { pendingAsk } from './run/reduce'
import { clip, store, useStore, type Project } from './run/store'
import { isUi, type UiId } from './run/ui'
import { SEND_BACK } from './run/simulate'
import { BY_YOU } from './run/rollback'
import { lessonLine } from './run/learn'
import { scaleLine } from './run/scale'
import { doneLead } from './run/done'
import type { Ask, FarmerId, RunState } from './run/types'
import { FARMER_ORDER } from './run/types'
import { MODELS, MODEL_GROUPS, applyEdit } from './run/kit'

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
    // A save from another tab of this app, and a last save when the page closes.
    const other = (e: StorageEvent) => {
      if (e.key === 'homestead.v3.farms') store.fromOtherTab(e.newValue)
    }
    const leave = () => store.persist()
    window.addEventListener('keydown', key)
    window.addEventListener('storage', other)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('storage', other)
      window.removeEventListener('pagehide', leave)
    }
  }, [])

  return (
    <div className="stage">
      {st.screen.kind === 'home' ? <Home /> : <Farm />}
      {st.settingsOpen && <Settings />}
      {st.toast && (
        <div key={st.toast.id} className={`toast paper${st.toast.undo ? ' with-undo' : ''}`} role="status">
          {st.toast.text}
          {st.toast.undo && (
            <button className="toast-undo" onClick={() => store.undoChanges(st.toast!.undo!)}>
              Undo
            </button>
          )}
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
        run={`${p.id}:${p.run?.seq ?? 0}`}
        planning={!p.approved}
        side={side}
        selected={sel}
        openAsk={ask}
        onTask={(id) => store.setDrawer(d?.kind === 'task' && d.id === id ? null : { kind: 'task', id })}
        onFarmer={(id) => store.setDrawer(d?.kind === 'farmer' && d.id === id ? null : { kind: 'farmer', id })}
        onMail={() => store.setDrawer({ kind: 'inbox' })}
        onCoins={() => store.setDrawer({ kind: 'usage' })}
        onChest={() => store.setDrawer({ kind: 'summary' })}
        hide={{ proofPops: st.uiHidden('proofPops'), bubbles: st.uiHidden('bubbles'), plotLabels: st.uiHidden('plotLabels'), chickens: st.uiHidden('chickens') }}
        size={{ proofPops: st.uiLook(p).size.proofPops, bubbles: st.uiLook(p).size.bubbles, plotLabels: st.uiLook(p).size.plotLabels }}
      />
      <Top p={p} s={s} />
      <InboxYields win={st.settingsOpen ? 'settings' : st.pending?.pid === p.id ? 'change' : ask ? `ask:${ask.id}` : rolled ? `rollback:${rolled.t}` : trust ? 'trust' : null} />
      {d?.kind === 'task' && <TaskPanel p={p} s={s} id={d.id} />}
      {d?.kind === 'farmer' && <FarmerPage p={p} s={s} id={d.id} />}
      {d?.kind === 'inbox' && <InboxPanel s={s} />}
      {d?.kind === 'usage' && <UsagePanel s={s} />}
      {d?.kind === 'summary' && <PrView s={s} p={p} />}
      {d?.kind === 'control' && <ControlPanel p={p} />}
      {!p.approved ? (
        <PlanDialogue p={p} s={s} side={side} />
      ) : st.pending?.pid === p.id ? (
        <ChangeCard side={side} />
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

// The inbox is a glance, so it steps aside when a window opens that wants you: an ask, a change card, a rollback, the trust offer or settings.
function InboxYields({ win }: { win: string | null }) {
  const last = useRef(win)
  useEffect(() => {
    if (win && win !== last.current && store.drawer?.kind === 'inbox') store.setDrawer(null)
    last.current = win
  }, [win])
  return null
}

function Top({ p, s }: { p: Project; s: RunState }) {
  const st = useStore()
  const open = s.asks.filter((a) => !a.answer).length
  // Every plot on the farm, the release included, so the count matches what you see.
  const work = s.tasks
  const workDone = work.filter((t) => t.status === 'ripe' || t.status === 'accepted').length
  const left = work.filter((t) => t.status !== 'accepted').length
  const where = ({ '100%': 'Live', '10%': 'Live for 10%', rollback: 'Rolled back' } as Record<string, string>)[s.deploy[s.deploy.length - 1]?.stage ?? ''] ?? 'Not shipped'
  const sub = !p.approved ? (p.planning ? 'Planning' : 'Plan, not started') : s.done ? (left ? `${where}, ${work.length - left} of ${work.length} tasks` : `Done, ${where.toLowerCase()}`) : `${workDone} of ${work.length} tasks done`
  const look = st.uiLook(p)
  // A button you asked the Planner to change: its colour from the HUD's own buttons, its size in whole steps,
  // and its name, which the aria-label follows.
  const cls = (id: UiId, extra = '') => `btn ${look.color[id] ?? 'white'} top-ico${look.size[id] ? ` s${look.size[id]}` : ''}${look.label[id] ? ' named' : ''}${extra ? ` ${extra}` : ''}`
  const ico = (id: UiId) => ICO_SIZE[(look.size[id] ?? 0) + 2]
  const named = (id: UiId) => look.label[id] && <span className="top-name">{look.label[id]}</span>
  const runAgain = p.approved && s.done && (
    <button key="again" className="btn white top-ico top-pr" onClick={() => store.runAgain()}>
      Run again
    </button>
  )
  const parts: Partial<Record<UiId, React.ReactNode>> = {
    home: (
      <button key="home" className={cls('home')} onClick={() => store.home()} aria-label={look.label.home ?? 'Your projects'}>
        <Ico name="home" size={ico('home')} />
        {named('home')}
      </button>
    ),
    settings: (
      <button
        key="settings"
        className={cls('settings')}
        aria-label={look.label.settings ?? 'Settings'}
        onClick={() => {
          store.settingsOpen = !store.settingsOpen
          store.notify()
        }}
      >
        <Ico name="gear" size={ico('settings')} />
        {named('settings')}
      </button>
    ),
  }
  if (p.approved) {
    parts.pr = (
      <button key="pr" className={cls('pr', 'top-pr')} onClick={() => store.setDrawer({ kind: 'summary' })}>
        {look.label.pr ?? 'Pull request'}
      </button>
    )
    parts.inbox = (
      <button key="inbox" className={cls('inbox', 'inbox-btn')} onClick={() => store.setDrawer({ kind: 'inbox' })} aria-label={`${look.label.inbox ?? 'Inbox'}${open ? `, ${open} need you` : ''}`}>
        <i className="mail-ico" />
        {named('inbox')}
        {open > 0 && <span className="badge">{open}</span>}
      </button>
    )
    parts.spend = (
      <button key="spend" className={cls('spend', 'top-coin')} onClick={() => store.setDrawer({ kind: 'usage' })} aria-label={`${look.label.spend ?? 'Spend so far'}, ${usd(s.usage.usd)}`}>
        <i className="coin" />
        {named('spend')}
        <b>{usd(s.usage.usd)}</b>
      </button>
    )
    parts.play = (
      <button key="play" className={cls('play')} disabled={!!s.done} onClick={() => store.togglePlay()} aria-label={st.playing ? 'Pause' : 'Play'}>
        <Ico name={st.playing ? 'pause' : 'play'} size={ico('play')} />
      </button>
    )
    // Always in the same place, so Play/Pause never moves under the cursor.
    parts.skip = (
      <button key="skip" className={cls('skip')} disabled={!st.canSkip(p)} onClick={() => store.skipToNext()} aria-label={look.label.skip ?? 'Skip to the next thing that needs you'} title={look.label.skip ?? 'Skip to the next thing that needs you'}>
        <Ico name="skip" size={ico('skip')} />
        {named('skip')}
      </button>
    )
  }
  const shown = (id: UiId) => (look.hidden.includes(id) ? null : parts[id] ?? null)
  const at = look.order.indexOf('title')
  const leftSide = look.order.slice(0, at) as UiId[]
  const rightSide = look.order.slice(at + 1) as UiId[]
  // Run again has its own place, never the one Play or skip was in, so a fast click can't restart the run:
  // just left of Pull request, or first on the right when that isn't there.
  const prRight = rightSide.includes('pr') && !!shown('pr')
  return (
    <header className="top">
      {leftSide.map(shown)}
      <div className="title paper">
        <b>{p.name}</b>
        {!look.hidden.includes('progress') && <span>{sub}</span>}
        {p.approved && !s.done && !st.playing && !pendingAsk(p.events, st.clock, st.viewerAnswers) && !st.openRollback(p) && (
          <span className="tag paused" title="You paused the run. Play carries on.">
            <i aria-hidden />
            Paused
          </span>
        )}
        {p.approved && !!p.reshapes?.length && !look.hidden.includes('chips') && (
          <div className="reshapes">
            {/* A screen-only change shows its chip only while it carries Undo: the screen itself shows it. */}
            {p.reshapes.filter((r) => !r.changes.every(isUi) || (st.fresh?.id === r.id && Date.now() < st.fresh.until)).map((r) => (
              <span key={r.id} className={`tag gold reshape-chip${st.fresh?.id === r.id && Date.now() < st.fresh.until ? ' fresh' : ''}`} title={r.changes.length + ' changes you asked for: ' + r.request}>
                {r.title}
                {st.fresh?.id === r.id && Date.now() < st.fresh.until ? (
                  <button className="chip-undo" onClick={() => store.undoChanges(r.id)}>
                    Undo
                  </button>
                ) : (
                  <button onClick={() => store.undoChanges(r.id)} aria-label={`Turn off ${r.title}`}>
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {look.hidden.includes('sampleTag') ? null : p.owner ? (
          <SimTag title={`A teammate's project in the simulated team: ${p.owner}'s`}>Simulated team</SimTag>
        ) : p.kind === 'sample' ? (
          <SimTag title="No real AI calls: a scripted sample that plays out the same way every time">Simulated sample</SimTag>
        ) : p.plannedLive ? (
          <SimTag title="The plan came from a live call; the run itself is simulated">Simulated run</SimTag>
        ) : (
          <DemoTag goal={p.goal} />
        )}
      </div>
      <div className="spacer" />
      {!prRight && runAgain}
      {rightSide.flatMap((id) => (id === 'pr' && prRight ? [runAgain, shown(id)] : [shown(id)]))}
    </header>
  )
}

// The top bar's icons by size step, -2 to 2: whole pixel scales of the 16px icons.
const ICO_SIZE = [16, 16, 32, 32, 48]

// The pixel font is for labels of three words or fewer; a longer answer reads better in the text face.
const long = (label: string) => (label.trim().split(/\s+/).length > 3 ? ' long' : '')

// dock: the plan stands on the left, full height, so the whole farm shows beside it. The Planner sits above it.
function Dialogue({ farmer, side, dock = false, className = '', children }: { farmer: FarmerId; side: boolean; dock?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section className={`dlg${side && !dock ? ' with-side' : ''}${dock ? ' dock' : ''}${className ? ` ${className}` : ''}`}>
      <div className="portrait">
        <Portrait farmer={farmer} size={dock ? 48 : 108} />
      </div>
      <div className="body paper bubble" data-tail={dock ? 'up' : 'left'}>
        {children}
      </div>
    </section>
  )
}

// Every simulated plan acts out one of a few scripted scenarios. Say which, or that none matched.
function DemoTag({ goal }: { goal: string }) {
  const sc = scenario(goal)
  return (
    <SimTag title={sc.matched ? `No real AI calls: a scripted ${sc.name.toLowerCase()} run` : 'No real AI calls: no script matches your goal, so the agents build a generic app'} />
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
          Splitting this into tasks and picking agents <i />
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
        <Quiet tone="bad" icon="cross" title="The Planner couldn’t split this goal into tasks.">
          {p.error}
        </Quiet>
        <p className="impact">{p.goal}</p>
        <div className="row">
          <button className="btn" onClick={() => planInto(p)}>
            Try again
          </button>
        </div>
      </Dialogue>
    )
  const ids = FARMER_ORDER.filter((x) => s.farmers[x])
  // The run itself, simulated on its default path with your current farmers and rules: the plan and the run agree.
  const edits = st.kit[p.id] ?? {}
  const setupOf = (id: FarmerId) => applyEdit(s.farmers[id]!, edits[id])
  const fc = st.forecast(p)
  const est = fc?.crew
  const one = fc?.solo
  const setCrew = (next: FarmerId[]) => planInto(p, next)
  const missing = FARMER_ORDER.filter((x) => !s.farmers[x])
  // No key for the Planner's provider: the plan is simulated, and the tag says which key.
  const noKey = isFallbackNote(p.liveNote)
  const pl = s.farmers.planner ? setupOf('planner') : undefined
  return (
    <Dialogue farmer="planner" side={side} dock>
      <div className="who">
        <b>Planner</b>
        <span className="tag grey">Plan</span>
        {p.plannedLive && !p.plannedEarlier && (
          <span className="tag sky" title={`This plan came from a live call to ${pl?.model ?? 'Claude Opus 5.5'}`}>
            Planned live{p.liveSource ? `: ${p.liveSource}` : ''}
          </span>
        )}
        {p.plannedEarlier && (
          <span className="tag sky" title={`A live plan for this goal, made on ${shortDate(p.plannedEarlier)}${p.liveSource ? ` through ${p.liveSource}` : ''}`}>
            Planned live earlier
          </span>
        )}
        {!p.plannedLive && noKey && <SimTag>{p.liveNote}</SimTag>}
        {!p.plannedLive && p.liveNote && !noKey && <span className="tag red">Live call failed</span>}
        {!p.plannedLive && !p.liveNote && <DemoTag goal={p.goal} />}
      </div>
      {!p.plannedLive && p.liveNote && !noKey && (
        <Quiet tone="bad" icon="cross" title="The live call failed, so this plan is simulated.">
          {p.liveNote}
        </Quiet>
      )}
      {p.plannedLive && (
        <p className="plan-live">
          {p.plannedEarlier ? `Live call failed: this is the live plan from ${shortDate(p.plannedEarlier)}. ` : 'Live: the crew, limits and done-whens. '}
          Simulated: the run.
        </p>
      )}
      {p.reshapes?.find((r) => r.flow)?.flow && <p className="plan-flow">With your flow: {p.reshapes.find((r) => r.flow)!.flow!.join(', ')}.</p>}
      <p className="plan-lead">
        {ids.length > 1 ? (
          <>
            About <b>{est && mins(est.minutes)}</b> and <b>{est && usd(est.usd)}</b> with {ids.length} AI agents.
            {one && est && (
              <>
                {' '}One Sonnet 5 agent alone would{' '}
                {one.minutes > est.minutes ? <>take <b className="gain">{mins(one.minutes - est.minutes)} longer</b></> : <>finish <b>{mins(est.minutes - one.minutes)} sooner</b></>}
                {Math.abs(est.usd - one.usd) < 0.5 ? ' for the same cost' : est.usd > one.usd ? <> and cost <b>{usd(est.usd - one.usd)} less</b></> : <> and cost <b>{usd(one.usd - est.usd)} more</b></>}
                {s.farmers.tester ? ', with no one checking its work' : ''}.
              </>
            )}
          </>
        ) : (
          <>
            One agent, one task at a time: <b>{est && mins(est.minutes)}</b> for <b>{est && usd(est.usd)}</b>.
          </>
        )}
      </p>
      <div className="crew-scroll">
      <div className="crew" role="table" aria-label="AI agents">
        <div className="crew-head" role="row">
          <span role="columnheader">AI agent</span>
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
                {MODEL_GROUPS.map((g) => (
                  <optgroup key={g.provider} label={g.label}>
                    {MODELS.filter((m) => m.provider === g.provider).map((m) => (
                      <option key={m.model} value={m.model}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <LimitField unit="$" label={`${f.label}'s spend limit`} value={f.limits.usd} onChange={(v) => store.editKit(p.id, id, (k) => (k.limits = { ...f.limits, usd: v }))} />
              {id !== 'builder' ? (
                <button className="crew-x" aria-label={`Drop the ${f.label}`} onClick={() => setCrew(ids.filter((x) => x !== id))}>
                  <i className="mark no" />
                </button>
              ) : (
                <span className="crew-x locked" title="Every team needs a Builder, since it writes the code" aria-label="The Builder can't be dropped">
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
        <LevelPicker p={p} compact />
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
  // Judged by synthetic tests: the failing reading, said as the card's own measure.
  const synthFail = /synthetic test failed/i.test(s.deploy[i]?.reason ?? '') ? /(\d+ of \d+ passing)/.exec(s.deploy[i]?.reason ?? '')?.[1] : undefined
  // Your rollback: the reading when you rolled it back, the same one the chart's numbers show.
  const atRollback = [...s.monitor].reverse().find((m) => m.t <= t && (!before || m.t >= before.t))?.metrics.errorRate ?? before?.metrics?.errorRate ?? 0
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
        {mine ? (
          <>Rolled back as you asked, with errors at <b>{(atRollback * 100).toFixed(1)}%</b>.</>
        ) : synthFail ? (
          <>A synthetic test failed, <b>{synthFail}</b>, so I rolled back by myself.</>
        ) : (
          <>Errors reached <b>{(peak * 100).toFixed(1)}%</b>, so I rolled back by myself.</>
        )}{' '}
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
      <p>Three clean runs in a row. Merge future pull requests by itself when every check passes?</p>
      <p className="impact">A failed check still asks you, and a rollback turns this off.</p>
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
  anomaly: { label: 'A check failed', urgency: 'red', icon: 'alert' },
  cost: { label: 'Over budget', urgency: 'honey', icon: 'coin' },
  big: { label: 'Big change', urgency: 'honey', icon: 'star' },
  irreversible: { label: 'Reaches real users', urgency: 'honey', icon: 'play' },
  risk: { label: 'Ship again', urgency: 'honey', icon: 'play' },
  disagree: { label: 'Agents disagree', urgency: 'calm', icon: 'chat' },
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
  const work = s.tasks.filter((t) => !t.gate)
  const out = work.filter((t) => t.stopped && t.status !== 'accepted')
  const ready = out.length
    ? `The pull request has ${list.length} of ${work.length} tasks, ${n} commit${n === 1 ? '' : 's'}, and every check passed. ${out.length} stopped task${out.length === 1 ? '' : 's'} stay${out.length === 1 ? 's' : ''} out.`
    : `${/again/.test(ask.question) ? 'The pull request is ready again' : 'The pull request is ready'}: ${n} commit${n === 1 ? '' : 's'}, and every check passed.`
  const merge = ask.suggested
  const rest = ask.alternatives.filter((a) => a !== SEND_BACK)
  return (
    <>
      <div className="who">
        <b>{s.farmers[ask.farmer]?.label ?? 'The crew'} needs you</b>
        <span className={`urgency ${r.urgency}`}>
          <Ico name={r.icon} tone="light" />
          Review the pull request
        </span>
      </div>
      <p>{holding ? 'Holding. Nothing merges until you say so.' : ready}</p>
      {!holding && <Sureness ask={ask} />}
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
        {out.map((t) => (
          <button key={t.id} onClick={() => store.setDrawer({ kind: 'task', id: t.id })}>
            <Mark pass={false} />
            <span className="grow">
              {t.name}
              <span className="sub">Stopped, left out of this pull request</span>
            </span>
          </button>
        ))}
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
  // Money asks come before the step that would go over, so most are heading over, not over yet.
  const r = ask.reason === 'cost' && !/has passed/.test(ask.question) ? { ...REASON.cost, label: 'Heading over budget' } : REASON[ask.reason]
  const task = s.tasks.find((t) => t.id === ask.task)
  const dis = ask.reason === 'disagree' ? s.disagreements.filter((x) => x.task === ask.task).slice(-1)[0] : undefined
  const pick = (choice: string) => {
    if (/^not yet/i.test(choice)) {
      setHolding(true)
      return
    }
    // Looking isn't deciding: open the farmer's context, or the task with its failing tests, and the ask stays open.
    if (/^show me .*context$/i.test(choice)) {
      store.setDrawer({ kind: 'farmer', id: ask.farmer })
      return
    }
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
        <InWords ask={ask} onHold={() => setHolding(true)} />
      </Dialogue>
    )
  return (
    <Dialogue farmer={ask.farmer} side={side}>
      <div className="who">
        {/* Who stopped, and why, before anything else: the portrait alone doesn't name them. */}
        <b>{s.farmers[ask.farmer]?.label ?? 'An agent'} needs you</b>
        <span className={`urgency ${r.urgency}`}>
          <Ico name={r.icon} tone="light" />
          {r.label}
        </span>
        {task && (
          <button className="plot-chip" onClick={() => store.setDrawer({ kind: 'task', id: task.id })} title="Open this task">
            <Sign crop={cropOf(s.tasks, task.id)} />
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
          <Sureness ask={ask} />
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
      <InWords ask={ask} onHold={() => setHolding(true)} />
    </Dialogue>
  )
}

// How sure the agent is of its suggestion, and what that rests on.
const SURE = { high: 'Confidence: high.', medium: 'Confidence: medium.', low: 'Confidence: low.' } as const
function Sureness({ ask }: { ask: Ask }) {
  if (!ask.confidence) return null
  return (
    <p className={`sureness ${ask.confidence}`}>
      <b>{SURE[ask.confidence]}</b> {ask.basis}
    </p>
  )
}

// Answer in your own words: the Planner reads it as one of the options, or says it can't and the ask stays open.
function InWords({ ask, onHold }: { ask: Ask; onHold: () => void }) {
  const st = useStore()
  const [text, setText] = useState('')
  const [miss, setMiss] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ text: string; choice: string; ask?: string } | null>(null)
  const p = st.project()
  const talk = p?.talks?.[ask.id] ?? []
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const msg = text.trim()
    if (!msg || busy) return
    const r = store.answerInWords(ask.id, msg)
    // A question about a disagreement: the side it's about answers, and the ask stays open.
    if (r.kind === 'discuss' && ask.talk && p) {
      setMiss('')
      setText('')
      setBusy(true)
      const s = st.state(p)
      const a = await discuss(msg, ask.talk, (f) => s?.farmers[f as FarmerId]?.model)
      setBusy(false)
      store.talkOn(ask.id, msg, a.data)
      if (a.error) store.say(a.error)
      return
    }
    const why =
      r.kind !== 'none'
        ? ''
        : r.why === 'no'
          ? 'Got it, not that. Which of these instead?'
          : r.why === 'question'
            ? 'That sounds like a question, so I haven’t changed anything. Pick an option or tell me which.'
            : r.why === 'amount'
              ? `${r.amount} isn’t one of these options, so nothing has changed. Pick one, or tell me which.`
              : `I can’t match “${clip(msg)}” to one of these options, so this stays open. Pick one, or tell me again.`
    setMiss(why)
    if (r.kind === 'none' || r.kind === 'discuss') return
    setText('')
    if (r.kind === 'confirm') setConfirm({ text: msg, choice: r.choice, ask: r.ask })
    if (r.kind === 'hold') onHold()
  }
  if (confirm)
    return (
      <div className="row in-words confirm">
        <p className="said grow">{confirm.ask ?? `I read that as “${confirm.choice}”. Go ahead?`}</p>
        <button className="btn long" onClick={() => store.confirmInWords(ask.id, confirm.text, confirm.choice)}>
          <Ico name="check" />
          Yes
        </button>
        <button className="btn tan long" onClick={() => setConfirm(null)}>
          No
        </button>
      </div>
    )
  return (
    <>
      {talk.length > 0 && (
        <div className="said talk ask-talk" aria-label="Talking it through">
          {talk.map((l, i) =>
            l.from === 'you' ? (
              <span key={i} className="you">
                You: {l.text}
              </span>
            ) : (
              <span key={i} className="side-line">
                <Swatch farmer={l.from} />
                <span>
                  <b>{p && st.state(p)?.farmers[l.from]?.label}</b> {l.text}
                </span>
              </span>
            ),
          )}
        </div>
      )}
      {miss && <p className="said">{miss}</p>}
      <form className="row grow-form in-words" onSubmit={send}>
        <span className="field">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={ask.reason === 'disagree' ? 'Ask about either way, think it through, or suggest your own' : 'Or answer in your own words'} aria-label="Answer in your own words" />
        </span>
        <button className="btn tan" type="submit" disabled={!text.trim() || busy}>
          <Ico name="chat" />
          Send
        </button>
      </form>
    </>
  )
}

// What the changes you asked for left out of this run, said plainly at the end.
function skippedLine(s: RunState) {
  const r = s.reshape
  if (!r) return ''
  const out = [...r.skipped.map((n) => `“${n}”`), ...(r.noReview ? ['the pull request review'] : []), ...(r.everyone ? ['the 10% stage'] : []), ...(r.off.includes('deployer') ? ['the Deployer'] : [])]
  const list = out.length > 1 ? `${out.slice(0, -1).join(', ')} and ${out[out.length - 1]}` : out[0]
  return [out.length ? `Skipped, as you asked: ${list}.` : '', r.synthetics ? 'The rollout was judged by synthetic tests.' : ''].filter(Boolean).join(' ')
}

// Your request, read into changes: one row each, all on, and you take off any you want kept as it is.
function ChangeCard({ side }: { side: boolean }) {
  const st = useStore()
  const pd = st.pending!
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(pd.proposal.rows.map((r) => [r.id, true])))
  const [scope, setScope] = useState<Record<string, Scope>>(() => Object.fromEntries(pd.proposal.rows.map((r) => [r.id, r.scope])))
  const [busy, setBusy] = useState(false)
  const n = pd.proposal.rows.filter((r) => on[r.id]).length
  return (
    <Dialogue farmer="planner" side={side}>
      <div className="who">
        <b>Planner</b>
        <span className="urgency honey">
          <Ico name="star" tone="light" />
          {pd.proposal.title}
        </span>
      </div>
      <p>{pd.denied ? 'Notifications are blocked in this browser, so each stage will show here instead.' : `Make ${pd.proposal.rows.length === 1 ? 'this change' : `these ${pd.proposal.rows.length} changes`} to this project?`}</p>
      {pd.proposal.note && <p className="sureness">{pd.proposal.note}</p>}
      <ul className="change-rows" aria-label="Changes">
        {pd.proposal.rows.map((r) => (
          <li key={r.id} className={on[r.id] ? 'on' : ''}>
            <label>
              <input type="checkbox" checked={!!on[r.id]} disabled={pd.denied} onChange={(e) => setOn({ ...on, [r.id]: e.target.checked })} />
              <span className="what">{r.label}</span>
              {r.loss && <span className={r.change.kind === 'ui' ? 'loss still' : 'loss'}>{r.loss}</span>}
            </label>
            <span className="scope" role="radiogroup" aria-label={`How long: ${r.label}`}>
              {(['farm', 'every'] as const).map((k) => (
                <button key={k} role="radio" aria-checked={scope[r.id] === k} className={scope[r.id] === k ? 'on' : ''} disabled={!on[r.id]} onClick={() => setScope({ ...scope, [r.id]: k })}>
                  {k === 'farm' ? 'This project' : 'Every project'}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          className="btn"
          disabled={!n || busy}
          autoFocus
          onClick={async () => {
            setBusy(true)
            await store.applyChanges(
              pd.proposal.rows.filter((r) => on[r.id]).map((r) => r.id),
              scope,
            )
            setBusy(false)
          }}
        >
          <Ico name="check" />
          {pd.denied ? `Apply with in-app messages` : `Apply ${n} change${n === 1 ? '' : 's'}`}
        </button>
        <button className="btn tan" onClick={() => store.cancelChanges()}>
          Cancel
        </button>
      </div>
    </Dialogue>
  )
}

function PlannerDialogue({ p, s, side }: { p: Project; s: RunState; side: boolean }) {
  const st = useStore()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const lines = (st.chat[p.id] ?? []).slice(-2)
  // Live calls run on the Planner's own model: Claude, or Codex if you switched it.
  const plannerModel = s.farmers.planner ? applyEdit(s.farmers.planner, st.kit[p.id]?.planner).model : undefined
  const input = useRef<HTMLInputElement>(null)
  const send = async (offer?: string) => {
    const msg = (offer ?? text).trim()
    if (!msg) return
    if (offer === undefined) setText('')
    setBusy(true)
    // A request to change the farm gets the change card; anything else goes to the crew as a note.
    const asked = await store.proposeChanges(p.id, msg, (t, c) => reshapeRead(t, c, plannerModel))
    if (asked) {
      setBusy(false)
      return
    }
    store.chatTo(p.id, { from: 'you', text: msg })
    const farmers = Object.values(s.farmers).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ id: f.id, label: f.label }))
    const r = await route({ message: msg, farmers, tasks: s.tasks.map((t) => ({ id: t.id, name: t.name, farmer: t.farmer })) }, plannerModel)
    setBusy(false)
    store.noteFor(p.id, r.data.to, msg)
    store.chatTo(p.id, { from: 'planner', text: r.data.reply, to: r.data.to })
    if (r.error) store.say(r.error)
  }
  return (
    <Dialogue farmer="planner" side={side} className={s.done ? 'done' : ''}>
      <div className="who">
        <b>Planner</b>
        {s.done ? <span className="tag green">Done</span> : <span className="tag grey">Message the agents</span>}
      </div>
      {s.done ? (
        <div className="done-text">
          <p>
            {doneLead(s)} {usd(s.done.usd)} in {mins(s.done.minutes)}. {caughtLine(s)}, and you made {s.asks.filter((a) => a.answer).length} call{s.asks.filter((a) => a.answer).length === 1 ? '' : 's'}.
          </p>
          {skippedLine(s) && <p className="impact">{skippedLine(s)}</p>}
          {outcome(s) && <p className="impact gain-line">{outcome(s)!.value}</p>}
          {p.run?.lesson && <p className="impact learned-line">{lessonLine(p.run.lesson, p.events, true)}</p>}
          {scaleLine(s) && (
            <p className="impact scale-line">
              <SimTag>Projection</SimTag> {scaleLine(s)}
            </p>
          )}
        </div>
      ) : null}
      {!s.done && (
        lines.length > 0 && (
          <div className="said talk">
            {lines.map((l, i) => (
              <span key={i} className={l.from === 'you' ? 'you' : ''}>
                {l.from === 'you' ? `You: ${l.text}` : l.text}
                {l.closest && <span className="closest">{l.closest}</span>}
                {l.chips && i === lines.length - 1 && (
                  <span className="offers">
                    {l.chips.map((c) => (
                      <button key={c.label} className="tag-btn" disabled={busy} onClick={() => send(c.request)}>
                        {c.label}
                      </button>
                    ))}
                  </span>
                )}
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
            <button className="btn tan" onClick={() => store.runAgain()}>
              Run again
            </button>
            <ExportButtons p={p} s={s} />
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
              <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell the agents something, or ask the Planner to change this project" aria-label="Message the agents" />
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
          <small>On, the agents call real AI models. Off, it’s simulated and free.</small>
        </span>
      </button>
      <button className="toggle" onClick={() => store.enableNotifications(!st.notifications)}>
        <span className={`switch${st.notifications ? ' on' : ''}`} />
        <span>
          Desktop notifications
          <small>When an agent needs you and this tab is in the background.</small>
        </span>
      </button>
      {!!st.flow.length && (
        <div className="flow" aria-label="Your flow">
          <h4 className="px-s">Your flow</h4>
          {st.flow.map((f) => (
            <div key={f.id} className="flow-item">
              <button className="toggle" onClick={() => store.setFlowOn(f.id, !f.on)} aria-pressed={f.on}>
                <span className={`switch${f.on ? ' on' : ''}`} />
                <span>{f.label}</span>
              </button>
              <button className="flow-remove" onClick={() => store.removeFlow(f.id)} aria-label={`Remove ${f.label} from your flow`}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
