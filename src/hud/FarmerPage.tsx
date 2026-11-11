// A farmer's own page: what it is doing right now, and everything it carries, all changeable.
// Task, model, skills and connectors, the files it may read, its rules and its limits.
import { store, useStore, type Project } from '../run/store'
import { MODELS, MODEL_GROUPS, RULES, agentName, SKILLS, applyEdit, brandIn, contextName, contextTokens, defaultRules, emptyEdit, lockedPath, lockedSkill, turnPath, type KitItem } from '../run/kit'
import { scenario } from '../run/simPlan'
import type { FarmerId, RunState } from '../run/types'
import { FARMER_ORDER } from '../run/types'
import { Ico, LimitField, Portrait, Swatch, Ticks, tokens, usd } from './bits'
import { ApplyFix, fixFor, returnOf } from './Side'

// Which skill a tool line is using, so the page can light it up while it runs.
function inUse(line: string | undefined, items: KitItem[]): string | undefined {
  if (!line) return undefined
  const l = line.toLowerCase()
  const pick = (ids: string[]) => ids.find((id) => items.some((i) => i.id === id))
  if (/screenshot/.test(l)) return pick(['shots'])
  if (/deploy|release|smoke|rollout/.test(l)) return pick(['deploy'])
  if (/errors|metrics/.test(l)) return pick(['metrics'])
  if (/ran |test suite|done-when/.test(l)) return pick(['run', 'shell', 'donewhen'])
  if (/read |what .* needs/.test(l)) return pick(['search', 'split', 'style'])
  if (/test/.test(l)) return pick(['tests', 'run'])
  if (/sketch|copy|screen/.test(l)) return pick(['style', 'figma'])
  return pick(['edit', 'split', 'donewhen', 'deploy'])
}

const KIND: Record<KitItem['kind'], string> = { skill: 'S', tool: 'T', connector: 'C' }

export function FarmerPage({ p, s, id }: { p: Project; s: RunState; id: FarmerId }) {
  const st = useStore()
  const base = s.farmers[id]
  if (!base) return null
  const edit = st.kit[p.id]?.[id] ?? emptyEdit()
  const f = applyEdit(base, edit)
  const items = SKILLS[id]
  const rules = { ...defaultRules(base), ...edit.rules }
  const working = base.state === 'working' || base.state === 'stuck'
  const now = working ? inUse(base.lastTool, items) : undefined
  const task = s.tasks.find((t) => t.id === base.task)
  const mine = s.tasks.filter((t) => t.farmer === id)
  const baseRate = MODELS.find((m) => m.model === base.model)?.rate ?? 1
  const rate = MODELS.find((m) => m.model === f.model)?.rate ?? 1
  const set = (fn: Parameters<typeof store.editKit>[2]) => store.editKit(p.id, id, fn)
  // Everything in its context, the paths you switched off included, each once.
  const plan = base.planContext ?? base.context
  const seen = [...new Set([...plan, ...edit.contextOff, ...edit.contextAdd])]
  const turn = (c: string, on: boolean) => set((e) => turnPath(e, c, on, plan))
  // The task that failed its check without a file or skill you turned off, once it has.
  const failedWithout = (need: { path?: string; skill?: string }) => {
    const a = p.events.find((e) => e.type === 'ask' && e.t <= st.clock && e.need?.farmer === id && (need.path ? e.need.path === need.path : e.need.skill === need.skill))
    return a && a.type === 'ask' ? s.tasks.find((t) => t.id === a.task)?.name : undefined
  }
  // The brand guide the Designer can't see, offered here, with the check it broke when it broke one.
  const brand = id === 'designer' ? scenario(p.goal).script.brand : undefined
  // House style is the brand guide at work: on when it can see the guide, and switching it switches the guide.
  const style = brandIn(f.context) ?? brand ?? brandIn(seen)
  const skillOn = (i: KitItem) => (i.id === 'style' ? !!brandIn(f.context) : (lockedSkill(id, i.id, f.context)?.on ?? !edit.off.includes(i.id)))
  const kitTokens = items.filter(skillOn).reduce((n, i) => n + i.tokens, 0) + f.context.reduce((n, c) => n + contextTokens(c), 0)
  const brandFail = brand ? p.events.find((e) => e.type === 'check' && !e.pass && e.t <= st.clock && e.proof?.shots?.some((x) => x.state === 'offbrand')) : undefined
  const missing = brand && !seen.includes(brand) ? { path: brand, failed: brandFail && brandFail.type === 'check' ? s.tasks.find((t) => t.id === brandFail.task)?.name : undefined } : undefined
  const changed = !!(edit.model || edit.off.length || edit.contextOff.length || edit.contextAdd.length || Object.keys(edit.rules).length || edit.limits)
  const after = p.approved ? 'Changes apply from now on.' : 'Changes apply when you approve the plan.'
  const status = { idle: 'Waiting for its next task', working: base.lastTool ?? 'Working', stuck: 'Fixing a failed check', needs: 'Waiting for you', done: 'Finished its tasks' }[base.state]

  return (
    <div className="page-scrim" onClick={() => store.setDrawer(null)}>
      <section className="page wood" role="dialog" aria-label={`${f.label}'s setup`} onClick={(e) => e.stopPropagation()}>
        <header className="page-head">
          <div className="portrait big">
            <Portrait farmer={id} size={96} />
          </div>
          <div className="grow">
            <h2>{f.label}</h2>
            <div className="runs-on">
              {f.model} on {agentName(f.agent)}
            </div>
            <div className="now">
              {working && <span className="live-dot" aria-hidden />}
              <span>{p.approved ? status : 'Not started'}</span>
              {task && p.approved && base.state !== 'done' && (
                <button className="link" onClick={() => store.setDrawer({ kind: 'task', id: task.id })}>
                  on {task.name}
                </button>
              )}
            </div>
          </div>
          <div className="page-crew">
            {FARMER_ORDER.filter((x) => s.farmers[x]).map((x) => (
              <button key={x} className={x === id ? 'on' : ''} onClick={() => store.setDrawer({ kind: 'farmer', id: x })}>
                <Swatch farmer={x} />
                {s.farmers[x]!.label}
              </button>
            ))}
          </div>
          <button className="btn white xs" onClick={() => store.setDrawer(null)} aria-label="Close">
            <Ico name="cross" size={16} />
          </button>
        </header>

        <div className="page-grid">
          <div className="col">
            {(st.crewNotes[p.id]?.[id] ?? []).length > 0 && (
              <section>
                <h3>Your notes</h3>
                <div className="list">
                  {st.crewNotes[p.id]![id]!.map((n, i) => (
                    <div key={i}>
                      <span className="grow">{n}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h3>Its tasks</h3>
              <div className="list">
                {mine.map((t) => (
                  <div key={t.id} className={t.id === base.task && working ? 'row-now' : ''}>
                    <span className="grow">
                      {t.name}
                      <span className="sub">{t.doneWhen}</span>
                    </span>
                    {!p.approved ? (
                      <select
                        className="field-box"
                        value={t.farmer}
                        aria-label={`Who does ${t.name}`}
                        onChange={(e) => store.editPlan(p.id, (tasks) => {
                          const x = tasks.find((k) => k.id === t.id)
                          if (x) x.farmer = e.target.value as FarmerId
                        })}
                      >
                        {FARMER_ORDER.filter((x) => s.farmers[x]).map((x) => (
                          <option key={x} value={x}>
                            {s.farmers[x]!.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="sub">{t.status === 'ripe' || t.status === 'accepted' ? 'Done' : t.status === 'waiting' ? 'Next' : `${Math.round(t.progress * 100)}%`}</span>
                    )}
                  </div>
                ))}
                {!mine.length && <div className="sub">Checks the others’ work.</div>}
              </div>
            </section>

            <section>
              <h3>Model</h3>
              {MODEL_GROUPS.map((g) => (
                <div key={g.provider} className="model-group">
                  <h4>{g.label}</h4>
                  <div className="models" role="radiogroup" aria-label={`${g.label} models`}>
                    {MODELS.filter((m) => m.provider === g.provider).map((m) => (
                      <button
                        key={m.model}
                        role="radio"
                        aria-checked={f.model === m.model}
                        className={`model${f.model === m.model ? ' on' : ''}`}
                        onClick={() => set((e) => {
                          e.model = m.model === base.model ? undefined : m.model
                          e.agent = m.model === base.model ? undefined : m.agent
                        })}
                      >
                        <b>{m.label}</b>
                        <small>{m.about}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {rate !== baseRate && (
                <p className="fine">
                  About {usd(f.limits.usd * (rate / baseRate))} for its share, against {usd(f.limits.usd)} on {base.model}.
                </p>
              )}
            </section>

            <section>
              <h3>Limits</h3>
              <div className="limits">
                <span className="limit-pair">
                  Spend
                  <LimitField unit="$" label="Spend limit" value={f.limits.usd} onChange={(v) => set((e) => (e.limits = { ...f.limits, usd: v }))} />
                </span>
                <span className="limit-pair">
                  Time
                  <LimitField unit="min" label="Time limit" min={5} value={f.limits.minutes} onChange={(v) => set((e) => (e.limits = { ...f.limits, minutes: v }))} />
                </span>
              </div>
              {p.approved && (
                <Ticks used={base.usd} total={f.limits.usd} />
              )}
              {p.approved && (
                <p className="fine">
                  {usd(base.usd)} spent so far. {returnOf(s, id)}.
                </p>
              )}
              {p.approved && fixFor(s, id) && <ApplyFix fix={fixFor(s, id)!} />}
            </section>
          </div>

          <div className="col">
            <section>
              <h3>What it can see</h3>
              <div className="kit">
                {seen.map((c, i) => {
                  const on = f.context.includes(c)
                  const reading = working && on && i === 0
                  const name = contextName(c)
                  const lock = lockedPath(id, c, plan)
                  const failed = on ? undefined : failedWithout({ path: c })
                  const body = (
                    <>
                      <span className="kind k-file">F</span>
                      <span className={`grow${name || lock ? '' : ' mono'}`}>
                        {name ?? (lock ? <span className="mono">{c}</span> : c)}
                        {(name || reading || lock || failed) && (
                          <span className="sub">
                            {reading ? 'Reading it now' : name ? <span className="mono">{c}</span> : lock}
                            {name && lock && !reading && ` · ${lock}`}
                            {failed && <span className="miss-why"> · {failed} failed its check without it</span>}
                          </span>
                        )}
                      </span>
                      <span className="mono cost">{tokens(contextTokens(c))}</span>
                    </>
                  )
                  return lock ? (
                    <div key={c} className={`kit-item on locked${reading ? ' using' : ''}`}>
                      {body}
                      <span className="always">Always on</span>
                    </div>
                  ) : (
                    <button key={c} className={`kit-item${on ? ' on' : ''}${reading ? ' using' : ''}${failed ? ' missing' : ''}`} aria-pressed={on} onClick={() => turn(c, !on)}>
                      {body}
                      <span className={`switch${on ? ' on' : ''}`} aria-hidden />
                    </button>
                  )
                })}
                {missing && (
                  <button className="kit-item missing" aria-pressed={false} onClick={() => set((e) => (e.contextAdd = [...e.contextAdd, missing.path]))}>
                    <span className="kind k-file">F</span>
                    <span className="grow">
                      {contextName(missing.path) ?? missing.path}
                      <span className="sub">
                        <span className="mono">{missing.path}</span>
                        {missing.failed && <span className="miss-why"> · {missing.failed} failed its check without it</span>}
                      </span>
                    </span>
                    <span className="mono cost">{tokens(contextTokens(missing.path))}</span>
                    <span className="switch" aria-hidden />
                  </button>
                )}
                <form
                  className="add-file"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const input = e.currentTarget.elements.namedItem('path') as HTMLInputElement
                    const v = input.value.trim()
                    // A path you switched off comes back on; one it already sees stays as it is.
                    if (v && !f.context.includes(v)) turn(v, true)
                    input.value = ''
                  }}
                >
                  <input name="path" placeholder="Add a file or folder, for example docs/refunds.md" aria-label="Add a file or folder" />
                  <button className="btn xs" type="submit">
                    <Ico name="plus" size={14} />
                    Add
                  </button>
                </form>
              </div>
            </section>

            <section>
              <h3>Skills, tools and connectors</h3>
              <div className="kit">
                {items.map((i) => {
                  const isStyle = i.id === 'style'
                  const on = skillOn(i)
                  const lock = isStyle ? (style ? undefined : { why: 'No brand guide in its context', on: false }) : lockedSkill(id, i.id, f.context)
                  const failed = on || isStyle ? undefined : failedWithout({ skill: i.id })
                  const about = isStyle && style ? (on ? `Your colours, type and voice, from ${style}` : `Off: it can’t see ${style}`) : i.about
                  const body = (
                    <>
                      <span className={`kind k-${i.kind}`}>{KIND[i.kind]}</span>
                      <span className="grow">
                        {i.name}
                        <span className="sub">
                          {now === i.id ? 'Using it now' : lock ? lock.why : about}
                          {failed && <span className="miss-why"> · {failed} failed its check without it</span>}
                        </span>
                      </span>
                      <span className="mono cost">{tokens(i.tokens)}</span>
                    </>
                  )
                  return lock ? (
                    <div key={i.id} className={`kit-item locked${lock.on ? ' on' : ''}${now === i.id ? ' using' : ''}`}>
                      {body}
                      <span className="always">{lock.on ? 'Always on' : 'Off'}</span>
                    </div>
                  ) : (
                    <button
                      key={i.id}
                      className={`kit-item${on ? ' on' : ''}${now === i.id ? ' using' : ''}${failed ? ' missing' : ''}`}
                      aria-pressed={on}
                      onClick={() => (isStyle ? turn(style!, !on) : set((e) => (e.off = on ? [...e.off, i.id] : e.off.filter((x) => x !== i.id))))}
                    >
                      {body}
                      <span className={`switch${on ? ' on' : ''}`} aria-hidden />
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <h3>Rules</h3>
              {/* Only the rules the crew enforces: with May deploy off, the Deployer asks you before it ships. */}
              {RULES.filter((r) => r.id === 'deploy' && id === 'deployer').map((r) => (
                <button key={r.id} className="toggle rule-row" onClick={() => set((e) => (e.rules = { ...e.rules, [r.id]: !rules[r.id] }))}>
                  <span className={`switch${rules[r.id] ? ' on' : ''}`} />
                  <span>{r.label}</span>
                </button>
              ))}
              {base.constraints.map((c) => (
                <div className="rule" key={c}>
                  <Ico name="check" size={16} tone="light" />
                  {c}
                </div>
              ))}
            </section>
          </div>
        </div>

        <footer className="page-foot">
          <span>
            Each call carries about <b className="mono">{tokens(kitTokens)}</b> tokens of skills and files.
          </span>
          {changed && <span className="fine">{after}</span>}
          {changed && (
            <button className="btn tan xs" onClick={() => set((e) => Object.assign(e, emptyEdit()))}>
              Undo my changes
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
