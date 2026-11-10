import { PageHead, Section } from '../Doc'
import { Stage } from '../Stage'
import { Sprite } from '../../ds'

const SPACE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16]

export function ShapePage(_: { arg?: string }) {
  return (
    <>
      <PageHead title="Space and shape">
        A 4px grid for the sheet, a 3x pixel grid for the farm. Small radii, no pill shapes, and one depth move reserved for the
        thing that needs you.
      </PageHead>

      <Section title="Spacing" note="Group tightly, then leave real air between groups. Inside a row: 8 to 12. Between groups: 24 to 32.">
        <ul className="shape-space">
          {SPACE.map((n) => (
            <li key={n}>
              <code>--s-{n}</code>
              <span>{n * 4}px</span>
              <i style={{ width: n * 4 }} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Radius" note="Small for controls, medium for cards. Nested corners follow outer = inner + padding.">
        <div className="shape-radii">
          {[
            ['--r-1', '4px', 'Keycaps, checkboxes, plates'],
            ['--r-2', '6px', 'Buttons, inputs, rows'],
            ['--r-3', '10px', 'Cards, the ask, specimens'],
          ].map(([v, px, use]) => (
            <div key={v}>
              <i style={{ borderRadius: `var(${v})` }} />
              <code>{v}</code>
              <span>
                {px}, {use}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Depth" note="Flat by default. The pixel line with a lip says “you act on this”, so only controls and the one card that needs you get it.">
        <div className="shape-depth">
          <div className="shape-flat">
            <b>Flat row</b>
            <span>Rules and white space</span>
          </div>
          <div className="shape-float">
            <b>Floating</b>
            <span>Menus and tooltips: a ring and a soft drop</span>
          </div>
          <div className="shape-raised">
            <b>Raised</b>
            <span>The ask card and the controls</span>
          </div>
        </div>
      </Section>

      <Section title="The pixel grid" note="The farm is drawn at a whole-number scale, --px: 3px. A 16px tile is 48 screen pixels. Never scale pixel art by 1.5 or 0.5: pixels smear.">
        <div className="shape-px">
          <Stage ground="grass" pad={24}>
            <div className="shape-px-row">
              {[1, 2, 3, 4].map((k) => (
                <div key={k}>
                  <Sprite name="crop_carrot_3" scale={k} />
                  <code>{k}x</code>
                </div>
              ))}
            </div>
          </Stage>
          <p className="ds-note">
            A farmhand should be 48 to 64 screen pixels tall while you work (3x to 4x). Anything under about 5 screen pixels
            reads as noise, so a detail that small can’t carry meaning: refine shape and colour instead.
          </p>
        </div>
      </Section>
    </>
  )
}
