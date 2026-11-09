// Another project's valley, opened read-only from the Valleys page.
import { engine } from '../sim/engine'
import { FARM, NEIGHBOUR, OTHER_FARMS, VALLEY_STATS } from '../sim/scenario'
import { VALLEY_CREWS } from '../sim/templates'
import { fmtK, useEngine } from '../ui'
import './peek.css'

const STATE: Record<string, string> = { working: 'Working', idle: 'Idle', needs: 'Needs attention', done: 'Done', failed: 'Failed' }

export function FarmPeek() {
  const e = useEngine()
  const name = e.peekName
  if (!name) return null
  const f = [NEIGHBOUR, ...OTHER_FARMS].find((x) => x.name === name)
  const s = VALLEY_STATS[name]
  if (!f || !s) return null
  const crew = VALLEY_CREWS[name]
  const state = s.state ?? 'idle'
  return (
    <section className="peek" aria-label={`${name} valley`} data-testid="peek">
      <div className="peek-head">
        <h2>{name}</h2>
        <span className={`peek-state ${state}`}>{STATE[state]}</span>
      </div>
      <p className="peek-team">{f.team}. A neighbouring project.</p>
      {s.doing && <p className="peek-doing">{s.doing}</p>}
      <dl className="peek-facts">
        {crew && (
          <>
            <dt>Crew</dt>
            <dd>{crew}</dd>
          </>
        )}
        <dt>Agents</dt>
        <dd>{s.agents}</dd>
        <dt>Waiting on a human</dt>
        <dd>{s.waiting}</dd>
        <dt>Energy this week</dt>
        <dd>{fmtK(s.energyWeek)} tokens</dd>
        <dt>Harvests</dt>
        <dd>{s.harvests}</dd>
        {s.unattended && (
          <>
            <dt>Runs on its own</dt>
            <dd>{s.unattended}</dd>
          </>
        )}
      </dl>
      <p className="peek-note">You can look around. Only the {f.team} can change this project.</p>
      <button className="btn primary" onClick={() => engine.setView('farm')} data-testid="peek-back" autoFocus>
        Back to {FARM.name}
      </button>
    </section>
  )
}
