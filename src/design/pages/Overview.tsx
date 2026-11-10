import { Button, Checkbox, Choice, Emoji, Energy, Farmhand, Kbd } from '../../ds'
import { PageHead, Rules, Section } from '../Doc'
import { Stage } from '../Stage'

const AREAS = [
  { href: '#/color', title: 'Foundations', body: 'Color, type, space, shape and motion. Every value lives in src/ds/tokens.css.' },
  { href: '#/components', title: 'Controls', body: 'The panel’s buttons, fields, choices, rows and the ask card, with every state.' },
  { href: '#/glyphs', title: 'Field glyphs', body: 'What sits on the farm: state glyphs over farmhands, their one-line labels, plots and crates.' },
  { href: '#/art/used', title: 'Art', body: 'Every file in the four Sprout Lands packs, and the frames the app draws.' },
  { href: '#/workflow', title: 'How art gets in', body: 'The manifest, the checks, the polish loop and the screenshot compare.' },
]

export function OverviewPage(_: { arg?: string }) {
  return (
    <>
      <PageHead title="Homestead design system">
        The farm is Sprout Lands pixel art and carries the status. The panel is a clean white sheet beside it that holds the
        hierarchy and opens when there is something to decide. This library is the one place both are defined, and the app
        imports its components from <code className="ds-code">src/ds</code>.
      </PageHead>

      <div className="ov-hero">
        <Stage ground="grass" pad={0} className="ov-farm">
          <div className="ov-farm-row">
            <Farmhand glyph={{ kind: 'ask', reason: 'anomaly' }} role="Tests" state="needs you" />
            <Farmhand glyph={{ kind: 'working' }} role="Frontend" state="2 of 3" frame="char_walk_down_1" />
            <Farmhand glyph={{ kind: 'done' }} role="Docs" state="done" dim />
          </div>
        </Stage>
        <div className="ov-sheet">
          <div className="ov-sheet-top">
            <Energy used={38} total={100} />
            <span className="ov-needs">
              <Emoji name="alert" /> 1 needs you
            </span>
          </div>
          <Choice keycap="1" title="Use the /v2 session endpoint" detail="Matches the API docs from March" selected />
          <Choice keycap="2" title="Keep /v1 and add a shim" detail="What the plan assumed" assumed />
          <Checkbox label="Remember this for the crew" defaultChecked />
          <div className="ov-actions">
            <Button kind="sprout" keycap="↵">
              Answer
            </Button>
            <Button kind="quiet">Later</Button>
          </div>
        </div>
      </div>

      <Section title="What’s here">
        <ul className="ov-areas">
          {AREAS.map((a) => (
            <li key={a.href}>
              <a href={a.href}>
                <b>{a.title}</b>
                <span>{a.body}</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Five rules that hold everywhere">
        <Rules>
          <li>One sans, Atkinson Hyperlegible Next, for all UI text. JetBrains Mono only for files, counts, tokens and timestamps. The pixel font only on the map.</li>
          <li>White sheet, ink text, one green for action. Blue only for what reaches people outside. Red only for failure. No beige, no eyebrows, no pills.</li>
          <li>One raised object at a time: the thing that needs you gets the pixel line and a lip, like the controls. Everything else is flat, ruled rows.</li>
          <li>Pixel art at whole-number scales only, on the farm’s grid (3x). Anything under about 5 screen pixels carries no meaning.</li>
          <li>Quieter text comes from size and weight, never from a paler grey or transparency. Every text colour passes 4.5:1.</li>
        </Rules>
      </Section>

      <Section title="Keyboard">
        <p className="ds-note">
          Options in an ask take number keys <Kbd>1</Kbd> <Kbd>2</Kbd>, <Kbd>↵</Kbd> answers, <Kbd>Esc</Kbd> goes up one level and <Kbd>Tab</Kbd> opens the agent tree. Keycaps appear only on ask options; other shortcuts live in the Shortcuts sheet.
        </p>
      </Section>
    </>
  )
}
