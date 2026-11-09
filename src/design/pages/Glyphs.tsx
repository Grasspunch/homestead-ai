import { useState } from 'react'
import { Farmhand, FieldGlyph, FieldLine, Plot, REASONS, Sprite, type Reason } from '../../ds'
import { PageHead, Section } from '../Doc'
import { GroundPicker, Stage, type Ground } from '../Stage'

export function GlyphsPage(_: { arg?: string }) {
  const [ground, setGround] = useState<Ground>('grass')
  return (
    <>
      <PageHead title="Field glyphs">
        What the farm shows about the work. One glyph over each farmhand’s head, a one-line label under it, and the plot beside
        it. Everything here is drawn at the farm’s 3x and sits on a light plate so it reads on any ground.
      </PageHead>

      <div className="gl-tools">
        <GroundPicker value={ground} onChange={setGround} />
      </div>

      <Section title="State glyphs" note="One at a time. Working is a small animation; asking shows the reason’s shape; done is the sleep emote. Shape carries the meaning, so it reads without colour.">
        <Stage ground={ground}>
          <div className="gl-row">
            <figure>
              <FieldGlyph state={{ kind: 'working' }} />
              <figcaption>Working</figcaption>
            </figure>
            {(Object.keys(REASONS) as Reason[]).map((r) => (
              <figure key={r}>
                <FieldGlyph state={{ kind: 'ask', reason: r }} />
                <figcaption>{REASONS[r].label}</figcaption>
              </figure>
            ))}
            <figure>
              <FieldGlyph state={{ kind: 'done' }} />
              <figcaption>Done</figcaption>
            </figure>
          </div>
        </Stage>
        <p className="ds-note gl-after">
          Red plate only on Failed, blue plate only on Reaches people. The envelope is our own pixel art in{' '}
          <code className="ds-code">art/authored</code>, drawn with the Sprout Lands palette.
        </p>
      </Section>

      <Section title="Farmhand, glyph and line" note="The three read as one unit. Done farmhands drop to 60% so the active ones stand out.">
        <Stage ground={ground} pad={40}>
          <div className="gl-hands">
            <Farmhand glyph={{ kind: 'ask', reason: 'failure' }} role="Tests" state="needs you" />
            <Farmhand glyph={{ kind: 'working' }} role="Frontend" state="2 of 3" frame="char_walk_down_1" />
            <Farmhand glyph={{ kind: 'working' }} role="Backend" state="1 of 2" frame="char_water_right_1" />
            <Farmhand glyph={{ kind: 'done' }} role="Docs" state="done" dim />
          </div>
        </Stage>
      </Section>

      <Section title="Plots" note="Beds keep a one-tile rim so crops sit inside. The sign carries the progress bar; a crate appears when a draft is ready, one per plot.">
        <Stage ground={ground} pad={56}>
          <div className="gl-plots">
            <figure>
              <Plot crop="carrot" stage={1} progress={0.3} />
              <figcaption>Growing</figcaption>
            </figure>
            <figure>
              <Plot crop="wheat" stage={2} wet progress={0.7} />
              <figcaption>Watered, nearly there</figcaption>
            </figure>
            <figure>
              <Plot crop="cabbage" stage={3} progress={1} crate />
              <figcaption>Ripe, draft ready</figcaption>
            </figure>
          </div>
        </Stage>
      </Section>

      <Section title="Labels on the field" note="Sans, on a plate, one line. The role in bold, then the state. They replace the pixel-font name tags.">
        <Stage ground={ground}>
          <div className="gl-row">
            <FieldLine role="Tests" state="needs you" />
            <FieldLine role="Frontend" state="2 of 3" />
            <FieldLine role="Docs" state="done" />
          </div>
        </Stage>
      </Section>

      <Section title="Do and don’t">
        <div className="ds-dodont">
          <div>
            <Stage ground={ground}>
              <div className="gl-row">
                <FieldGlyph state={{ kind: 'ask', reason: 'cost' }} />
              </div>
            </Stage>
            <p>
              <b>Do</b> draw the glyph at 32px on its plate.
            </p>
          </div>
          <div>
            <Stage ground={ground}>
              <div className="gl-row gl-bad">
                <Sprite name="emote_alert" scale={1} />
                <span className="gl-bad-chip">!</span>
              </div>
            </Stage>
            <p>
              <b>Don’t</b> shrink art below its size, or put a coloured chip with no shape on the grass.
            </p>
          </div>
        </div>
      </Section>
    </>
  )
}
