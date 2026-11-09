// Phone-size screenshots of the booking flow, for the harvest evidence.
// Drawn in HTML so they stay crisp at any zoom; each one is a single screen of the real flow.
import './booking-shots.css'

export type BookingScreen = 'pet' | 'reason' | 'vet-time' | 'confirm' | 'reminder' | 'double-booked'

export const BOOKING_FLOW: { screen: Exclude<BookingScreen, 'double-booked'>; name: string }[] = [
  { screen: 'pet', name: 'Pick a pet' },
  { screen: 'reason', name: 'Reason' },
  { screen: 'vet-time', name: 'Vet and time' },
  { screen: 'confirm', name: 'Confirmed' },
  { screen: 'reminder', name: 'Reminder text' },
]

function Phone({ children, err, label }: { children: React.ReactNode; err?: boolean; label: string }) {
  return (
    <div className={`bk-phone ${err ? 'err' : ''}`} role="img" aria-label={label}>
      <div className="bk-notch" aria-hidden />
      <div className="bk-screen">{children}</div>
    </div>
  )
}

function Bar({ back }: { back?: boolean }) {
  return (
    <div className="bk-bar">
      {back && <span className="bk-back" aria-hidden>‹</span>}
      <span className="bk-logo" aria-hidden />
      <b>Willow Lane Vets</b>
    </div>
  )
}

function Steps({ at }: { at: number }) {
  return (
    <div className="bk-steps" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < at ? 'done' : i === at ? 'now' : ''} />
      ))}
    </div>
  )
}

const DAYS = [
  { d: 'Thu 26', ok: true },
  { d: 'Fri 27', ok: true },
  { d: 'Sat 28', ok: true },
  { d: 'Mon 30', ok: true },
  { d: 'Sat 5', ok: false },
]

export function BookingShot({ screen, after, err }: { screen: BookingScreen; after?: boolean; err?: boolean }) {
  if (screen === 'pet')
    return (
      <Phone label="Pick a pet">
        <Bar />
        <Steps at={0} />
        <h5>Who is the visit for?</h5>
        <div className="bk-opt sel">
          <span className="bk-pet dog" aria-hidden />
          <span>
            <b>Biscuit</b>
            <small>Beagle, 4</small>
          </span>
        </div>
        <div className="bk-opt">
          <span className="bk-pet cat" aria-hidden />
          <span>
            <b>Miso</b>
            <small>Cat, 9</small>
          </span>
        </div>
        <div className="bk-opt ghost">Add a pet</div>
        <div className="bk-btn">Next</div>
      </Phone>
    )
  if (screen === 'reason')
    return (
      <Phone label="Reason for the visit">
        <Bar back />
        <Steps at={1} />
        <h5>What is it for?</h5>
        <div className="bk-opt sel">Checkup</div>
        <div className="bk-opt">Vaccination</div>
        <div className="bk-opt off">
          <span>Surgery</span>
          <small>Call us to book</small>
        </div>
        <div className="bk-btn">Next</div>
      </Phone>
    )
  if (screen === 'vet-time')
    return (
      <Phone label="Vet and time">
        <Bar back />
        <Steps at={2} />
        <div className="bk-vets">
          <span className="sel">Dr Patel</span>
          <span>Dr Okafor</span>
          <span>Dr Lin</span>
        </div>
        <div className="bk-days">
          {DAYS.map((x) => (
            <span key={x.d} className={`${x.d === 'Thu 26' ? 'sel' : ''} ${x.ok ? '' : 'off'}`}>
              {x.d}
            </span>
          ))}
        </div>
        <div className="bk-slots">
          {['9:00', '9:30', '10:30', '11:00', '14:00', '15:30'].map((t) => (
            <span key={t} className={t === '9:00' ? 'sel' : ''}>
              {t}
            </span>
          ))}
        </div>
        <p className="bk-note">Up to 8 weeks ahead. Closed Saturdays from 1 December.</p>
        <div className="bk-btn">Book 9:00</div>
      </Phone>
    )
  if (screen === 'confirm')
    return (
      <Phone label="Booking confirmed">
        <Bar />
        <Steps at={4} />
        <div className="bk-done" aria-hidden>
          ✓
        </div>
        <h5 className="center">You're booked</h5>
        <dl className="bk-sum">
          <dt>Pet</dt>
          <dd>Biscuit</dd>
          <dt>Visit</dt>
          <dd>Checkup</dd>
          <dt>Vet</dt>
          <dd>Dr Patel</dd>
          <dt>When</dt>
          <dd>Thu 26 Nov, 9:00</dd>
        </dl>
        <div className="bk-btn ghost">Add to calendar</div>
      </Phone>
    )
  if (screen === 'reminder')
    return (
      <Phone label="Reminder text the day before">
        <div className="bk-sms-head">
          <span className="bk-logo" aria-hidden />
          <b>WillowVets</b>
        </div>
        <p className="bk-when">Wed 25 Nov, 10:00</p>
        <div className="bk-sms">Hi Sam, a reminder that Biscuit sees Dr Patel tomorrow at 9:00 at Willow Lane Vets. Reply C to cancel.</div>
        <div className="bk-sms me">Thanks, see you then</div>
      </Phone>
    )
  // Two owners book the same slot at the same moment, and both are told yes: the failing end-to-end case.
  const owners = [
    { who: 'Sam', pet: 'Biscuit' },
    { who: 'Priya', pet: 'Pepper' },
  ]
  return (
    <div className={`bk-pair ${err ? 'err' : ''} ${after ? 'after' : ''}`}>
      {owners.map((o, i) => {
        const held = after && i === 1
        return (
          <Phone key={o.who} label={`${o.who}: ${held ? 'slot taken' : 'confirmed'}, Dr Patel at 9:00`} err={err && !held}>
            <Bar />
            <p className="bk-who">{o.who}</p>
            <div className={`bk-done ${held ? 'gone' : ''}`} aria-hidden>
              {held ? '!' : '✓'}
            </div>
            <h5 className="center">{held ? 'That time was just taken' : "You're booked"}</h5>
            <dl className="bk-sum">
              <dt>Pet</dt>
              <dd>{o.pet}</dd>
              <dt>Vet</dt>
              <dd>Dr Patel</dd>
              <dt>When</dt>
              <dd>Thu 26 Nov, 9:00</dd>
            </dl>
            {held && <div className="bk-btn">Pick another time</div>}
          </Phone>
        )
      })}
      {err && !after && <p className="bk-err">Both confirmed for the same slot</p>}
    </div>
  )
}

// The five happy-path screens side by side, scrolling sideways in the panel.
export function BookingStrip() {
  return (
    <div className="bk-strip" tabIndex={0} aria-label="Booking flow on a phone">
      {BOOKING_FLOW.map((s) => (
        <figure key={s.screen}>
          <BookingShot screen={s.screen} />
          <figcaption>{s.name}</figcaption>
        </figure>
      ))}
    </div>
  )
}
