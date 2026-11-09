import type { ReactNode } from 'react'
import generatedMd from '../../../GENERATED.md?raw'
import { Code, PageHead, Rule, Rules, Section } from '../Doc'
import '../workflow.css'

// `code` spans in a line of markdown become <Code>. Nothing else in GENERATED.md needs rendering.
function inline(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <Code key={i}>{part}</Code> : part))
}

// GENERATED.md is the one copy of the generated-files table. This page reads it, so the two can't drift.
function readGenerated(md: string) {
  const lines = md.split('\n')
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
  const table = lines.filter((l) => l.trim().startsWith('|')).map(cells)
  const [head = [], , ...rows] = table
  const notesAt = lines.findIndex((l) => /^##\s+Notes/.test(l))
  const notes = notesAt < 0 ? [] : lines.slice(notesAt + 1).filter((l) => l.startsWith('- ')).map((l) => l.slice(2))
  return { head, rows, notes }
}

const GENERATED = readGenerated(generatedMd)

function Commands({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="wf-cmds">
      {items.map(([cmd, what]) => (
        <div key={cmd}>
          <dt>
            <Code>{cmd}</Code>
          </dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  )
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="wf-steps">{children}</ol>
}

const CHECKLIST: [string, ReactNode][] = [
  ['A stranger would name it', 'With no context, someone would call each new element what it is meant to be.'],
  ['Visibly different from the last try', 'The crop script counts the changed pixels. Zero means the edit never reached the page.'],
  ['Big enough at the farm’s scale', 'Every part that carries meaning is at least 2 art px, about 5 screen px.'],
  ['Distinct from its neighbours', 'Its colour and outline differ from the grass, soil, fences and glyphs beside it.'],
  ['Alive', 'It has idle frames, a state change, or a reaction to a click.'],
  ['On the palette', <><Code>npm run art:check</Code> passes.</>],
  ['Text stays legible', <>Text on a plate or chip still passes <Code>npm run contrast</Code>. Quieter text is smaller or a lighter weight, never fainter.</>],
]

export function WorkflowPage(_: { arg?: string }) {
  return (
    <div className="wf-page">
      <PageHead title="How art gets in">
        The farm is drawn from the Sprout Lands packs and from pixel art we draw ourselves. This is the route from a zip to a frame on the farm, and the
        checks that keep it right.
      </PageHead>

      <Section title="Get the packs" note="The packs are licensed for use, not for sharing, so each person imports their own copy. Nothing from them is committed except the frames the app draws.">
        <Commands
          items={[
            [
              'npm run assets -- <folder>',
              <>
                Unzips the four packs from your itch.io downloads into <Code>public/assets/sprout-lands/</Code>. The folder can hold the zips or the
                packs already unzipped.
              </>,
            ],
          ]}
        />
        <p className="wf-after">The Art pages in this library and the atlas build both read from that folder. If an Art page is empty, run this first.</p>
      </Section>

      <Section title="Add a frame the app draws" note="The app never reads the packs. It reads one atlas, cut from the packs by a list of frames.">
        <Steps>
          <li>
            Find the frame on its pack’s Art page and note the sheet, and its tile or rectangle.
          </li>
          <li>
            Add it to <Code>art/manifest.json</Code> under its group, as <Code>{'{ name, tile: [col, row] }'}</Code> or{' '}
            <Code>{'{ name, rect: [x, y, w, h] }'}</Code>.
          </li>
          <li>
            Run <Code>npm run art:atlas</Code>. It rewrites <Code>public/sprites/atlas.png</Code> and <Code>src/map/atlas.json</Code>.
          </li>
          <li>
            Run <Code>npm run art:check</Code>. It fails if the atlas no longer matches the manifest, or if our own art is off the palette.
          </li>
          <li>Check it on Used by the app, on the ground it will sit on. Commit the manifest and both atlas files together.</li>
        </Steps>
      </Section>

      <Section title="Draw new pixel art" note="Art we draw ourselves is ours, so it is committed, and it has to sit beside the packs without looking borrowed.">
        <Rules>
          <Rule>
            Put it in <Code>art/authored/</Code> as PNG.
          </Rule>
          <Rule>
            Use only the Sprout Lands palette in <Code>art/palette.json</Code>. A translucent pixel must be the palette’s shadow colour.
          </Rule>
          <Rule>Keep the packs’ grid: 16 px tiles, 48 px character cells.</Rule>
          <Rule>
            Draw at 1x. The farm shows it at whole multiples of <Code>--px</Code> (3 px), never in between.
          </Rule>
          <Rule>
            <Code>npm run art:check</Code> lists every pixel off the palette and where it is.
          </Rule>
        </Rules>
      </Section>

      <Section
        title="Polish loop"
        note={
          <>
            When a sprite, glyph, plate or pixel control needs to look better, the <Code>polish-art</Code> skill runs this loop. Ask Claude to polish it, or
            follow <Code>.claude/skills/polish-art/SKILL.md</Code> by hand.
          </>
        }
      >
        <Steps>
          <li>Change the art, then rebuild the atlas if it came from the packs.</li>
          <li>
            Open it in this library with <Code>npm run design</Code>.
          </li>
          <li>
            Crop it at 3x: <Code>{"node scripts/crop-shot.mjs '#/glyphs' --el '<selector>' --name <name>"}</Code>.
          </li>
          <li>Fill in the checklist below. Fix anything that fails and try again.</li>
          <li>Send the crop with the checklist to the person who asked. They have the last word.</li>
          <li>Commit with the number of tries and one line for each rejected try, saying why it lost.</li>
        </Steps>
        <h3>Before sending a crop</h3>
        <table className="wf-table wf-checks">
          <thead>
            <tr>
              <th scope="col">Check</th>
              <th scope="col">Passes when</th>
            </tr>
          </thead>
          <tbody>
            {CHECKLIST.map(([check, when]) => (
              <tr key={check}>
                <th scope="row">{check}</th>
                <td>{when}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="wf-after">Each row gets ✅, ⚠️ or ❌ in the message. A ⚠️ names its trade-off. Nothing ships with a ❌.</p>
      </Section>

      <Section
        title="Screenshots and look changes"
        note={
          <>
            Every state worth guarding is listed in <Code>scripts/shots/states.json</Code>: a library page, or an app state reached by clicks and keys. Shots
            come out the same on every run, so any changed pixel is a real change.
          </>
        }
      >
        <Commands
          items={[
            ['npm run shots', <>Makes every state into <Code>shots/out/</Code>, including the app states used as media.</>],
            [
              'npm run shots:check',
              <>
                Compares the reference states with <Code>shots/ref/</Code>, writes the changed pixels in red to <Code>shots/diff/</Code>, and fails on any
                change.
              </>,
            ],
            ['npm run shots -- --update', <>Copies new references into <Code>shots/ref/</Code>. Only on purpose.</>],
          ]}
        />
        <Rules>
          <Rule>A change that alters the look will fail the check. That is the check working.</Rule>
          <Rule>Land the change first. Refresh the references in a commit of their own, so the review sees the before and after.</Rule>
          <Rule>Never refresh references to make an unexplained failure go away. Open the diff and find out what moved.</Rule>
        </Rules>
      </Section>

      <Section title="Generated files" note="Edit the source, then run the command. An edit to the output is lost the next time someone runs it.">
        <table className="wf-table wf-generated">
          <thead>
            <tr>
              {GENERATED.head.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GENERATED.rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th scope="row" key={i}>
                      {inline(cell)}
                    </th>
                  ) : (
                    <td key={i} data-label={GENERATED.head[i]}>
                      {inline(cell)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {GENERATED.notes.length > 0 && (
          <>
            <h3>What no check catches</h3>
            <Rules>
              {GENERATED.notes.map((n) => (
                <Rule key={n}>{inline(n)}</Rule>
              ))}
            </Rules>
          </>
        )}
        <p className="wf-after">
          This table is read from <Code>GENERATED.md</Code> at the repo root. Change it there.
        </p>
      </Section>

      <Section title="Credit and license">
        <Rules>
          <Rule>
            The farm’s art is Sprout Lands by Cup Nooble. Credit is required wherever the art is used, including this library and the app.
          </Rule>
          <Rule>The packs are never committed: not the zips, not the unzipped folders. Only the frames the app draws go into the atlas.</Rule>
          <Rule>The license rules out NFTs and training AI on the art.</Rule>
          <Rule>
            Art in <Code>art/authored/</Code> is ours.
          </Rule>
        </Rules>
      </Section>
    </div>
  )
}
