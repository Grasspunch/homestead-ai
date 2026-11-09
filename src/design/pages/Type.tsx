import { PageHead, Section } from '../Doc'

const ROLES = [
  { v: '--hero', name: 'Hero', spec: '44 / 48, 800, −0.02em', use: 'The harvest headline only', sample: 'The crew needed you twice' },
  { v: '--display', name: 'Display', spec: '28 / 34, 800, −0.02em', use: 'Page and panel titles', sample: 'Google sign-in for the web app' },
  { v: '--heading', name: 'Heading', spec: '20 / 26, 800, −0.01em', use: 'Sections inside a step', sample: 'What the crew will do' },
  { v: '--title', name: 'Title', spec: '16 / 22, 700', use: 'The ask question, card titles', sample: 'Use the /v2 session endpoint?' },
  { v: '--label', name: 'Label', spec: '14 / 20, 700', use: 'Row titles, buttons, field labels', sample: 'Backend' },
  { v: '--body', name: 'Body', spec: '14 / 20, 400', use: 'Everything else', sample: 'The API docs from March say sessions moved to /v2.' },
  { v: '--caption', name: 'Caption', spec: '12 / 16, 400', use: 'Row details, hints, field lines on the map', sample: 'Edited 3 files, 2 minutes ago' },
  { v: '--mono', name: 'Mono', spec: '13 / 18, JetBrains Mono', use: 'Files, counts, tokens, timestamps only', sample: 'src/auth/session.ts  +42 −7  12.4k tokens' },
]

export function TypePage(_: { arg?: string }) {
  return (
    <>
      <PageHead title="Type">
        One sans for everything you read, Atkinson Hyperlegible Next, chosen because its letters can’t be mistaken for each
        other. Mono only where characters line up. The Sprout Lands pixel font only on the map.
      </PageHead>

      <Section title="Roles" note="Use the role, not a size. Each is a font shorthand in tokens.css, so a role is one line of CSS: font: var(--label).">
        <ul className="type-roles">
          {ROLES.map((r) => (
            <li key={r.v}>
              <div className="type-meta">
                <b>{r.name}</b>
                <code>{r.v}</code>
                <span>{r.spec}</span>
                <span>{r.use}</span>
              </div>
              <p style={{ font: `var(${r.v})`, letterSpacing: r.v === '--hero' || r.v === '--display' ? 'var(--track-display)' : r.v === '--heading' ? 'var(--track-heading)' : undefined }}>{r.sample}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Three tiers at one size" note="Weight and ink tier do the hierarchy work inside a row, so a row never needs three sizes.">
        <div className="type-tiers">
          <span style={{ font: 'var(--label)', color: 'var(--ink)' }}>Backend</span>
          <span style={{ font: 'var(--body)', color: 'var(--ink-2)' }}>Writing the session handler</span>
          <span style={{ font: 'var(--body)', color: 'var(--ink-3)' }}>2 minutes ago</span>
        </div>
      </Section>

      <Section title="Pixel font" note="Only on the map: farm signs and the replay caption. Drawn at whole multiples of its 16px grid.">
        <div className="type-pixel">
          <span style={{ fontSize: 16 }}>Northwind web app</span>
          <span style={{ fontSize: 32 }}>Northwind web app</span>
        </div>
      </Section>

      <Section title="Numbers" note="Every number that changes uses tabular figures so it doesn’t shift as it counts.">
        <div className="type-nums">
          <span>
            <b>38%</b> energy left
          </span>
          <span>
            <b>12,400</b> users
          </span>
          <span className="type-mono">00:42</span>
        </div>
      </Section>

      <Section title="Copy" note="Plain words a person would say. Lead with the decision, then the reason.">
        <div className="ds-dodont">
          <div>
            <div className="type-copy good">Use the /v2 session endpoint? The API docs from March moved it.</div>
            <p>
              <b>Do</b> ask the question first, in one line.
            </p>
          </div>
          <div>
            <div className="type-copy bad">AGENT INSIGHT · Potential endpoint discrepancy detected — review recommended</div>
            <p>
              <b>Don’t</b> use eyebrows, middot chains, em dashes or alarm words.
            </p>
          </div>
        </div>
      </Section>
    </>
  )
}
