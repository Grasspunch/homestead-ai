// Folds a run log into the state shown on screen at time t.
import { checkCost, soloFromRun } from './compare'
import type { ActivityLine, Ask, FarmerId, FarmerRun, RunEvent, RunState, TaskState } from './types'

export function emptyState(): RunState {
  return {
    t: 0,
    goal: '',
    farmers: { planner: undefined, builder: undefined, designer: undefined, tester: undefined, deployer: undefined },
    tasks: [],
    asks: [],
    autoFixes: [],
    disagreements: [],
    usage: { usd: 0, tokens: 0, byKind: { read: { usd: 0, tokens: 0 }, write: { usd: 0, tokens: 0 }, retry: { usd: 0, tokens: 0 } } },
    deploy: [],
    monitor: [],
    replans: [],
    activity: [],
    actions: 0,
  }
}

export function parseLog(text: string): RunEvent[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunEvent)
    .sort((a, b) => a.t - b.t)
}

// viewerAnswers: answers the person watching gave on replay, by ask id.
// replayAll: read the recorded answers as given (a plan preview, a test); on a watched run only your answers count.
export function reduce(events: RunEvent[], t: number, viewerAnswers: Record<string, string> = {}, replayAll = false): RunState {
  const s = emptyState()
  s.t = t
  const task = (id?: string) => (id ? s.tasks.find((x) => x.id === id) : undefined)
  const farmer = (id?: FarmerId) => (id ? s.farmers[id] : undefined)
  const log = (line: Omit<ActivityLine, 't'>, at: number) => s.activity.push({ ...line, t: at })

  for (const e of events) {
    if (e.t > t) break
    switch (e.type) {
      case 'goal':
        s.goal = e.text
        break
      case 'farmer': {
        const { t: _t, type: _ty, ...setup } = e
        const f: FarmerRun = { ...setup, state: 'idle', usd: 0, tokens: 0 }
        s.farmers[e.id] = f
        break
      }
      case 'plan':
        s.tasks = e.tasks.map<TaskState>((p) => ({ ...p, status: 'waiting', progress: 0, usd: 0, tokens: 0, checks: [], evidence: [] }))
        s.estimate = e.estimate
        s.singleAgentEstimate = e.singleAgentEstimate
        break
      case 'task_start': {
        const k = task(e.task)
        if (k) {
          k.status = 'growing'
          k.farmer = e.farmer
        }
        const f = farmer(e.farmer)
        if (f) {
          f.state = 'working'
          f.task = e.task
        }
        break
      }
      case 'tool': {
        s.actions++
        const f = farmer(e.farmer)
        if (f) {
          f.lastTool = e.summary
          if (f.state === 'idle' || f.state === 'done') f.state = 'working'
          if (e.task) f.task = e.task
        }
        log({ farmer: e.farmer, task: e.task, text: e.summary, kind: 'tool' }, e.t)
        break
      }
      case 'usage': {
        const tokens = e.tokensIn + e.tokensOut
        s.usage.usd += e.usd
        s.usage.tokens += tokens
        const kind = e.kind ?? 'write'
        s.usage.byKind[kind].usd += e.usd
        s.usage.byKind[kind].tokens += tokens
        const f = farmer(e.farmer)
        if (f) {
          f.usd += e.usd
          f.tokens += tokens
        }
        const k = task(e.task)
        if (k) {
          k.usd += e.usd
          k.tokens += tokens
        }
        break
      }
      case 'progress': {
        const k = task(e.task)
        if (k) k.progress = Math.max(0, Math.min(1, e.value))
        break
      }
      case 'task_built': {
        const k = task(e.task)
        if (k) {
          k.status = 'checking'
          k.progress = Math.max(k.progress, 0.9)
        }
        break
      }
      case 'check': {
        const k = task(e.task)
        if (k) {
          k.checks.push({ by: e.by, pass: e.pass, notes: e.notes, evidence: e.evidence ?? [], proof: e.proof, t: e.t })
          if (!e.pass) {
            k.status = 'wilted'
            k.progress = Math.min(k.progress, 0.6)
          }
        }
        log({ farmer: e.by, task: e.task, text: e.notes, kind: 'check' }, e.t)
        break
      }
      case 'auto_fix':
        {
          const m = /^The (\w+) reached its .* raised it to \$(\d+)/.exec(e.what)
          const lf = m ? Object.values(s.farmers).find((x) => x?.label === m[1]) : undefined
          if (lf && m) lf.limits = { ...lf.limits, usd: Number(m[2]) }
        }
        s.autoFixes.push({ t: e.t, task: e.task, what: e.what })
        {
          const k = task(e.task)
          if (k && k.status === 'wilted') k.status = 'growing'
        }
        log({ task: e.task, text: e.what, kind: 'fix' }, e.t)
        break
      case 'disagree':
        s.disagreements.push({ t: e.t, task: e.task, sides: e.sides })
        log({ task: e.task, text: 'Two farmers disagree', kind: 'disagree' }, e.t)
        break
      case 'ask': {
        const a: Ask = {
          id: e.id,
          farmer: e.farmer,
          task: e.task,
          reason: e.reason,
          question: e.question,
          impact: e.impact,
          suggested: e.suggested,
          alternatives: e.alternatives ?? [],
          touches: e.touches,
          files: e.files,
          limitFor: e.limitFor,
          talk: e.talk,
          limitTo: e.limitTo,
          confidence: e.confidence,
          basis: e.basis,
          t: e.t,
        }
        s.asks.push(a)
        const f = farmer(e.farmer)
        if (f) f.state = 'needs'
        log({ farmer: e.farmer, task: e.task, text: e.question, kind: 'ask' }, e.t)
        break
      }
      case 'answer': {
        const a = s.asks.find((x) => x.id === e.id)
        // Only an answer you gave counts as yours: a recorded answer you never saw is left unanswered.
        if (a && (viewerAnswers[e.id] || e.by === 'session' || replayAll)) {
          const viewer = viewerAnswers[e.id]
          a.answer = viewer ? { choice: viewer, by: 'viewer', t: e.t } : { choice: e.choice, by: e.by, t: e.t }
          const f = farmer(a.farmer)
          if (f && f.state === 'needs') f.state = 'working'
          // A raised spend limit.
          const lf = farmer(a.limitFor)
          if (lf && a.limitTo && /^raise/i.test(a.answer.choice)) lf.limits = { ...lf.limits, usd: a.limitTo }
          log({ text: a.answer.choice, kind: 'answer' }, e.t)
        }
        break
      }
      case 'task_ripe': {
        const k = task(e.task)
        if (k) {
          k.status = 'ripe'
          k.progress = 1
          k.evidence = e.evidence ?? k.evidence
          k.summary = e.summary
          if (e.change) k.changes = [...(k.changes ?? []), e.change]
        }
        const f = farmer(k?.farmer)
        if (f && f.task === e.task) f.state = 'idle'
        log({ task: e.task, text: e.summary ?? 'Done and checked', kind: 'ripe' }, e.t)
        break
      }
      case 'accept': {
        const k = task(e.task)
        if (k && k.status === 'ripe') {
          // Committed: the checker's pass puts it in the pull request.
          k.status = 'accepted'
          k.acceptedBy = e.by
        }
        break
      }
      case 'verify': {
        const k = task(e.task)
        if (k) k.verified = e.pass
        break
      }
      case 'deploy':
        s.deploy.push({ stage: e.stage, t: e.t, url: e.url, reason: e.reason, metrics: e.metrics })
        log({ farmer: 'deployer', text: e.stage === 'rollback' ? (e.reason === 'Rolled back by you' ? e.reason : `Rolled back: ${e.reason ?? ''}`.trim()) : `Live for ${e.stage === '100%' ? 'everyone' : '10% of users'}`, kind: 'deploy' }, e.t)
        break
      case 'monitor':
        s.monitor.push({ t: e.t, stage: e.stage, metrics: e.metrics })
        break
      case 'reshape': {
        const gone = new Set(e.removed)
        s.tasks = s.tasks.filter((k) => !gone.has(k.id)).map((k) => ({ ...k, name: e.renamed?.[k.id] ?? k.name, doneWhen: e.doneWhen[k.id] ?? k.doneWhen, farmer: e.owner[k.id] ?? k.farmer }))
        for (const f of e.off) s.farmers[f] = undefined
        s.reshape = { titles: e.titles, skipped: e.skipped, synthetics: e.synthetics, everyone: e.everyone, noReview: e.noReview, off: e.off }
        break
      }
      case 'replan': {
        const before = new Map(s.tasks.map((k) => [k.id, k]))
        s.tasks = e.tasks.map<TaskState>((p) => {
          const old = before.get(p.id)
          return old ? { ...old, ...p } : { ...p, status: 'waiting', progress: 0, usd: 0, tokens: 0, checks: [], evidence: [] }
        })
        const added = e.tasks.filter((p) => !before.has(p.id)).map((p) => p.id)
        const removed = [...before.keys()].filter((id) => !e.tasks.some((p) => p.id === id))
        s.replans.push({ t: e.t, reason: e.reason, added, removed })
        log({ farmer: 'planner', text: e.reason, kind: 'info' }, e.t)
        break
      }
      case 'stop': {
        const k = task(e.task)
        if (k) k.stopped = e.reason
        // Its farmer stops working on it.
        for (const f of Object.values(s.farmers)) if (f && f.task === e.task && f.state === 'working') f.state = 'idle'
        log({ task: e.task, text: e.reason, kind: 'info' }, e.t)
        break
      }
      case 'done':
        s.done = { usd: e.usd, minutes: e.minutes, asks: e.asks, autoFixes: e.autoFixes, actions: e.actions }
        s.soloActual = soloFromRun(events)
        s.checkUsd = checkCost(events)
        for (const f of Object.values(s.farmers)) if (f) f.state = 'done'
        break
    }
  }

  // A farmer whose task wilted is stuck until the fix lands.
  for (const f of Object.values(s.farmers)) {
    if (!f || f.state === 'needs' || f.state === 'done') continue
    const k = task(f.task)
    if (k && k.status === 'wilted' && !k.stopped) f.state = 'stuck'
  }

  return s
}

// The next ask in the log that has no answer by time t: the replay pauses on it.
export function pendingAsk(events: RunEvent[], t: number, viewerAnswers: Record<string, string>): string | null {
  const asked = new Set<string>()
  for (const e of events) {
    if (e.t > t) break
    if (e.type === 'ask') asked.add(e.id)
    if (e.type === 'answer') asked.delete(e.id)
  }
  for (const id of asked) if (!viewerAnswers[id]) return id
  return null
}

export function duration(events: RunEvent[]) {
  return events.length ? events[events.length - 1].t : 0
}
