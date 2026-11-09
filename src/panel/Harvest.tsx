// The harvest report: what grew, what it cost, and every time the crew needed you.
import { INVITE_LIST } from '../sim/scenario'
import { fmtK, Kbd, useEngine } from '../ui'

export function Harvest() {
  const e = useEngine()
  if (!e.harvestOpen) return null
  const draft = e.out.draft
  const d = draft?.data
  const original = d?.launch_date ?? 'March 12'
  const fixDate = (s: string) => (original !== e.launchDate ? s.split(original).join(e.launchDate) : s)
  // The Reviewer's pest fix: the unsourced speed claim now cites the benchmark.
  const fixed = !!e.out.claims?.data.issues.length && e.flags.has('factcheckDone') && e.task('draft').pests.length === 0
  const SPEED = /(up to )?3x faster/i
  const render = (s: string) => {
    const text = fixDate(s)
    const m = fixed ? text.match(SPEED) : null
    if (!m || m.index === undefined) return text
    return (
      <>
        {text.slice(0, m.index)}
        <mark title="Fixed by the Reviewer: cites benchmarks-q4.xlsx row 14">3.2x faster in our Q4 benchmarks</mark>
        {text.slice(m.index + m[0].length)}
      </>
    )
  }
  const invitesAsk = e.asks.find((a) => a.id === 'invites')
  const sentAll = invitesAsk?.answer === 'approve'
  const sentAcme = invitesAsk?.answer === 'acme-first'
  const invited = sentAll ? INVITE_LIST.reduce((s, r) => s + r.contacts, 0) : sentAcme ? 12 : 0
  const decisions = [
    { label: 'Plan', text: 'Approved the quest plan', answer: e.tasks.some((t) => t.assignee !== t.proposedAssignee) ? 'With your change' : 'As proposed' },
    ...e.asks.filter((a) => a.status === 'resolved').map((a) => ({ label: a.label, text: a.question, answer: a.answerLabel ?? '' })),
  ]
  const saved = e.ledger.length ? e.energyCaught : 0
  return (
    <div className="harvest-veil" onClick={(ev) => ev.target === ev.currentTarget && e.closeHarvest()}>
      <div className="harvest" role="dialog" aria-label="Harvest report" data-testid="harvest">
        <div className="harvest-top">
          <div>
            <div className="eyebrow">Harvest report · Q1 Launch</div>
            <h1>
              Relay v2 launch comms are <em>ready to ship</em>
            </h1>
          </div>
          <span className={`prov ${draft?.provenance ?? 'replay'}`}>{draft?.provenance === 'live' ? 'Draft written live by Claude' : 'Draft from a recorded run'}</span>
        </div>
        <div className="harvest-stats">
          <div>
            <b>{e.actions}</b>
            <span>agent actions</span>
          </div>
          <div>
            <b>{e.neededYou}</b>
            <span>times the crew needed you</span>
          </div>
          <div>
            <b>{fmtK(e.energyUsed)}</b>
            <span>
              of {fmtK(e.budget)} energy{saved ? ` · ${fmtK(saved)} saved by catching a dry plot` : ''}
            </span>
          </div>
          <div>
            <b>{Object.keys(e.farmhands).length}</b>
            <span>farmhands, one head farmer</span>
          </div>
        </div>
        <div className="harvest-grid">
          <section>
            <div className="section-title">
              <span>Announcement</span>
              <span>brand-voice checked</span>
            </div>
            <div className="doc">
              <h2>{d?.headline ?? 'Relay v2 is here'}</h2>
              <div className="dateline">Launching {e.launchDate} · for the pilot customers</div>
              {(d?.paragraphs ?? []).map((p, i) => (
                <p key={i}>{render(p)}</p>
              ))}
            </div>

            <div className="section-title">
              <span>Your decisions</span>
              <span>{decisions.length}</span>
            </div>
            <ul className="decisions">
              {decisions.map((x, i) => (
                <li key={i}>
                  <span className={`reason ${x.label}`}>{x.label}</span>
                  <span>{x.text}</span>
                  <span>{x.answer}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <div className="section-title">
              <span>Webinar invites</span>
              <span>{invited ? `${invited} people invited` : 'held, nothing sent'}</span>
            </div>
            <table className="list">
              <tbody>
                {INVITE_LIST.map((r) => (
                  <tr key={r.company}>
                    <td>{r.company}</td>
                    <td>{sentAll || (sentAcme && r.company === 'Acme') ? `${r.contacts} sent` : `${r.contacts} queued`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">Simulated send. Webinar {e.webinarDate}, 10:00 PT, shown in each person’s time zone.</p>

            <div className="section-title">
              <span>Seed library</span>
              <span>{e.seeds.length} lessons</span>
            </div>
            <ul className="decisions">
              {e.seeds.slice(0, 4).map((s) => (
                <li key={s.file}>
                  <code>{s.file}</code>
                  <span>{s.isNew || s.file.includes('launch-dates') ? 'New today' : s.from}</span>
                </li>
              ))}
              {e.pendingSeeds.map((s) => (
                <li key={s.file}>
                  <code>{s.file}</code>
                  <span>
                    <button className="btn ghost" onClick={() => e.keepPendingSeed(s.file, true)}>
                      Keep
                    </button>{' '}
                    <button className="btn ghost" onClick={() => e.keepPendingSeed(s.file, false)}>
                      Discard
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="harvest-foot">
          <span className="credit">
            Art: <a href="https://cupnooble.itch.io/sprout-lands-asset-pack" target="_blank" rel="noreferrer">Sprout Lands by Cup Nooble</a>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={() => e.reset()} data-testid="restart">
              Restart demo
            </button>
            <button className="btn" onClick={() => e.closeHarvest()}>
              Back to the farm <Kbd>Esc</Kbd>
            </button>
            <button
              className="btn primary"
              onClick={() => {
                e.toast('Crew saved as “Launch crew” with 3 seeds')
                e.closeHarvest()
              }}
            >
              Save crew as “Launch crew”
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
