// The lead's view on Home: spend against each area's budget, and the few projects worth a look.
// Teammates' projects are simulated; what you see is spend and outliers. Opening one is view only: their asks are theirs.
import { Fragment } from 'react'
import { store, useStore } from '../run/store'
import { BUDGET, buildTeam, spentOf, type Outlier, type TeamFarm } from '../run/team'
import { Ico, LimitField, Quiet, Ticks, usd, type IconName } from './bits'

// The same urgency tags an ask leads with: honey for money, bark for the rest.
const KIND: Record<Outlier['kind'], { label: string; urgency: 'honey' | 'calm'; icon: IconName }> = {
  spike: { label: 'Cost spike', urgency: 'honey', icon: 'coin' },
  twice: { label: 'Same work twice', urgency: 'calm', icon: 'star' },
  conflict: { label: 'Agents disagree', urgency: 'calm', icon: 'chat' },
}

const whose = (f: TeamFarm) => (f.mine ? 'yours' : f.owner)
const openFarm = (f: TeamFarm) => (f.mine ? store.open(f.id) : store.openTeam(f.id))
const openLabel = (f: TeamFarm) => (f.mine ? 'Open yours' : `Open ${f.owner}’s`)

export function TeamPanel() {
  const st = useStore()
  const team = buildTeam(st.projects, st.budgets)
  return (
    <section className="team paper" aria-label="Your team">
      <div className="team-head">
        <p>
          <b>{team.people.length} people</b> run <b>{team.agents} agents</b> on {team.projects} projects, {usd(team.spent)} spent so far.
        </p>
      </div>

      <h2 className="team-sec">Worth a look</h2>
      {team.outliers.length ? (
        <ul className="outliers">
          {team.outliers.map((o) => {
            const k = KIND[o.kind]
            return (
              <li key={o.kind} className="outlier">
                <span className={`urgency ${k.urgency}`}>
                  <Ico name={k.icon} tone="light" />
                  {k.label}
                </span>
                <div className="what">
                  <b>{o.farm.name}</b> <span className="who-ran">({whose(o.farm)})</span>
                  {o.kind === 'twice' && (
                    <>
                      {' and '}
                      <b>{o.other.name}</b> <span className="who-ran">({whose(o.other)})</span>
                    </>
                  )}
                  <p>{o.text}</p>
                </div>
                {o.kind === 'twice' ? (
                  // Both projects in the pair, each opening its own farm.
                  <span className="outlier-open">
                    {[o.farm, o.other].map((f) => (
                      <button key={f.id} className="btn tan xs" onClick={() => openFarm(f)} aria-label={`${openLabel(f)}: ${f.name}`}>
                        {openLabel(f)}
                      </button>
                    ))}
                  </span>
                ) : (
                  <button className="btn tan xs" onClick={() => openFarm(o.farm)} aria-label={`Open ${o.farm.name}`}>
                    Open
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <Quiet icon="check" title="Nothing stands out.">No cost spikes, repeated work or disagreements across the team.</Quiet>
      )}

      <div className="team-sec-row">
        <h2 className="team-sec">Budgets</h2>
        <span className="team-meta">A new project starts with its area’s budget as its spend limit.</span>
      </div>
      <div className="budgets" role="table" aria-label="Spend against each area's budget">
        {team.areas.map((a) => (
          <Fragment key={a.id}>
            <div className="area-row" role="row">
              <b role="rowheader">{a.name}</b>
              <span className="team-meta" role="cell">
                Budget per project
              </span>
              <span role="cell">
                <LimitField value={a.budget} unit="$" min={BUDGET.min} max={BUDGET.max} label={`${a.name}: budget per project`} onChange={(v) => store.setBudget(a.id, v)} />
              </span>
            </div>
            {a.farms.map((f) => (
              <div key={f.id} className="farm-row" role="row">
                <button className="farm-name" role="cell" onClick={() => openFarm(f)}>
                  {f.name}
                </button>
                <span className="team-meta" role="cell">
                  {f.mine ? 'You' : f.owner}, {f.agents} agents
                </span>
                <span role="cell" className={`spend${f.spent > f.limit ? ' over' : ''}`}>
                  <Ticks used={f.spent} total={f.limit} n={12} />
                  <span>
                    <b>{spentOf(f.spent, f.limit).spent}</b> of {spentOf(f.spent, f.limit).limit}
                  </span>
                </span>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  )
}
