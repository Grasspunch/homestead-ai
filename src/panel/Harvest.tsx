// The harvest report: what grew, what it cost, and every time the crew needed you.
import { INVITE_LIST } from '../sim/scenario'
import { fmtK, Reason, useEngine } from '../ui'

// Outputs a person can take away: the announcement, the calendar invite and the recipient list.
function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

// "March 24" at 10:00 PT (PDT after March 8 in 2026), as an .ics event.
function ics(title: string, date: string, description: string) {
  const m = date.match(/^(\w+) (\d+)$/)
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 3
  const day = m ? Number(m[2]) : 24
  const pad = (n: number) => String(n).padStart(2, '0')
  const utcHour = month > 3 || (month === 3 && day >= 8) ? 17 : 18
  const stamp = (h: number, min: number) => `2026${pad(month)}${pad(day)}T${pad(h)}${pad(min)}00Z`
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Homestead AI//Demo//EN',
    'BEGIN:VEVENT',
    `UID:homestead-${month}-${day}@homestead.ai`,
    `DTSTAMP:${stamp(utcHour, 0)}`,
    `DTSTART:${stamp(utcHour, 0)}`,
    `DTEND:${stamp(utcHour, 30)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

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
  const quote = e.asks.find((a) => a.id === 'quote')
  const render = (s: string) => {
    if (quote?.answer === 'paraphrase' && /^[“"]/.test(s.trim())) return 'Pilot teams told us the “which version is this?” question has gone from their standups.'
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
  const crow = e.asks.find((a) => a.id === 'crow')
  const caught = crow?.answer === 'theirs'
  const { count, audience, action } = e.irreversible
  const demo = e.demoScenario
  const announcementMd = d
    ? `# ${d.headline}\n\n${d.paragraphs
        .map((p) => {
          const r = render(p)
          return typeof r === 'string' ? r : fixDate(p).replace(/(up to )?3x faster/i, '3.2x faster in our Q4 benchmarks')
        })
        .join('\n\n')}\n`
    : ''
  return (
    <div className="harvest-veil" onClick={(ev) => ev.target === ev.currentTarget && e.closeHarvest()}>
      <div className="harvest" role="dialog" aria-label="Harvest report" data-testid="harvest">
        <div className="harvest-top">
          <div>
            {caught ? (
              <h1>
                A wrong launch date nearly went to {count} {audience}.
              </h1>
            ) : (
              <h1>{e.questTitle} is harvested.</h1>
            )}
            {caught && (
              <p className="harvest-sub">
                The draft used {original} from the call notes. Engineering had moved launch to {e.launchDate} in standup notes the crew never saw, and you fixed it before anything was sent.
              </p>
            )}
          </div>
        </div>
        <div className="harvest-stats">
          <span className="lead">
            The crew needed you <b>{e.neededYou}</b> times
          </span>
          <span title={`${e.liveCalls || e.replayCalls} ${e.liveCalls ? 'live' : 'replayed'} model calls (${fmtK(e.modelTokens)} tokens) and ${e.simSteps} simulated steps${saved ? `; ${fmtK(saved)} saved at a dry plot` : ''}`}>
            {fmtK(e.energyUsed)} of {fmtK(e.budget)} energy
          </span>
        </div>
        <div className="harvest-grid">
          <section>
            <div className="section-title">
              <span>Announcement</span>
            </div>
            <div className="doc">
              <h2>{d?.headline ?? e.questTitle}</h2>
              {d?.launch_date && <div className="dateline">{e.launchDate}</div>}
              {(d?.paragraphs ?? []).map((p, i) => (
                <p key={i}>{render(p)}</p>
              ))}
            </div>
            <div className="downloads">
              <button className="btn ghost sm" onClick={() => download('announcement.md', 'text/markdown', announcementMd)} data-testid="dl-md">
                ↓ announcement.md
              </button>
              {demo && (
                <>
                  <button
                    className="btn ghost sm"
                    onClick={() => download('webinar.ics', 'text/calendar', ics('Relay v2 launch webinar', e.webinarDate, `Relay v2 arrives ${e.launchDate}. A 30-minute walkthrough of faster sync and single sign-on.`))}
                    data-testid="dl-ics"
                  >
                    ↓ webinar.ics
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() =>
                      download('recipients.csv', 'text/csv', 'company,contacts,status\n' + INVITE_LIST.map((r) => `${r.company},${r.contacts},${sentAll || (sentAcme && r.company === 'Acme') ? 'sent' : 'queued'}`).join('\n') + '\n')
                    }
                    data-testid="dl-csv"
                  >
                    ↓ recipients.csv
                  </button>
                </>
              )}
            </div>

            <div className="section-title">
              <span>Your decisions</span>
            </div>
            <ul className="decisions">
              {decisions.map((x, i) => (
                <li key={i}>
                  <Reason label={x.label} icon={x.label === 'Plan' ? 'sprout' : undefined} />
                  <span>{x.text}</span>
                  <span>{x.answer}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            {demo ? (
              <>
                <div className="section-title">
                  <span>Webinar invites</span>
                </div>
                <p className="sent">
                  {invited ? (
                    <>
                      <b>{invited} sent</b> for {e.webinarDate}, 10:00 PT
                    </>
                  ) : (
                    'Held. Nothing was sent.'
                  )}
                </p>
              </>
            ) : (
              <>
                <div className="section-title">
                  <span>{action}</span>
                </div>
                <p className="sent">{sentAll ? <b>{count} sent</b> : 'Held. Nothing was sent.'}</p>
              </>
            )}

            <div className="section-title">
              <span>Lessons saved</span>
            </div>
            <ul className="decisions">
              {e.seeds
                .filter((s) => s.isNew || s.file.includes('launch-dates'))
                .map((s) => (
                  <li key={s.file}>
                    <code>{s.file}</code>
                  </li>
                ))}
              {e.pendingSeeds.map((s) => (
                <li key={s.file}>
                  <code>{s.file}</code>
                  <span>
                    <button className="btn ghost sm" onClick={() => e.keepPendingSeed(s.file, true)}>
                      Keep
                    </button>{' '}
                    <button className="btn ghost sm" onClick={() => e.keepPendingSeed(s.file, false)}>
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
              Back to the farm
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
