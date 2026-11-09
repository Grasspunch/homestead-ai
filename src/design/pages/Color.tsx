import { useEffect, useState } from 'react'
import { contrast, token } from '../contrast'
import { PageHead, Section } from '../Doc'

// The palette file comes from the art pipeline (art/palette.json). The page works without it.
const paletteModules = import.meta.glob('/art/palette.json', { eager: true, import: 'default' }) as Record<string, unknown>
const PALETTE = (() => {
  const p = Object.values(paletteModules)[0] as { colors?: string[] } | string[] | undefined
  if (!p) return []
  return Array.isArray(p) ? p : (p.colors ?? [])
})()

function useTokens(names: string[]) {
  const [vals, setVals] = useState<Record<string, string>>({})
  useEffect(() => {
    setVals(Object.fromEntries(names.map((n) => [n, token(n)])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join()])
  return vals
}

function Ratio({ fg, bg, ground, min = 4.5 }: { fg: string; bg: string; ground?: string; min?: number }) {
  if (!fg || !bg) return null
  const r = contrast(fg, bg, ground)
  const pass = r >= min
  return (
    <span className={`clr-ratio ${pass ? 'pass' : 'fail'}`}>
      {r.toFixed(1)}:1 {pass ? (r >= 7 ? 'AAA' : 'AA') : 'fails'}
    </span>
  )
}

type Sw = { name: string; use: string; text?: boolean }

const SHEET: Sw[] = [
  { name: '--sheet', use: 'The panel, cards, inputs on focus' },
  { name: '--sheet-hover', use: 'Row and button hover' },
  { name: '--sheet-sunk', use: 'Inputs at rest, selected row, code' },
  { name: '--sheet-press', use: 'Pressed quiet buttons, empty bar track' },
]

const INK: Sw[] = [
  { name: '--ink', use: 'Titles, values, body text', text: true },
  { name: '--ink-2', use: 'Supporting text, quiet buttons', text: true },
  { name: '--ink-3', use: 'Metadata, hints, disabled text. The quietest text allowed.', text: true },
]

const ACCENTS: { name: string; title: string; rule: string }[] = [
  { name: 'sprout', title: 'Sprout', rule: 'The one action colour: the main button, done steps, progress. Never decoration.' },
  { name: 'out', title: 'Out', rule: 'Only for what reaches people outside the team: deploy, send, the envelope.' },
  { name: 'fail', title: 'Fail', rule: 'Only when something failed: a red check, a failed call. Never emphasis, never “low”.' },
]

const GROUNDS: Sw[] = [
  { name: '--grass', use: 'Field' },
  { name: '--grass-deep', use: 'Field shade' },
  { name: '--soil', use: 'Dry bed' },
  { name: '--soil-wet', use: 'Watered bed' },
  { name: '--water', use: 'Pond' },
  { name: '--sky', use: 'Portrait backdrop' },
]

export function ColorPage(_: { arg?: string }) {
  const names = [
    ...SHEET.map((s) => s.name),
    ...INK.map((s) => s.name),
    ...ACCENTS.flatMap((a) => [`--${a.name}-soft`, `--${a.name}`, `--${a.name}-strong`, `--${a.name}-deep`, `--on-${a.name}`]),
    ...GROUNDS.map((g) => g.name),
    '--plate',
    '--rule-soft',
    '--rule',
    '--rule-strong',
  ]
  const v = useTokens(names)

  return (
    <>
      <PageHead title="Color">
        The farm carries the colour; the sheet stays white and neutral so the farm can. Three accents each mean one thing,
        and every text colour clears 4.5:1 on every surface it sits on.
      </PageHead>

      <Section title="Sheet and ink" note="One hue, the Sprout Lands purple-black, from the darkest ink to the lightest surface. Hierarchy comes from these steps and from weight, not from more colours.">
        <div className="clr-sheet">
          {SHEET.map((s) => (
            <div key={s.name} className="clr-surface" style={{ background: `var(${s.name})` }}>
              {INK.map((i) => (
                <div key={i.name} className="clr-ink-line" style={{ color: `var(${i.name})` }}>
                  <span>Aa</span>
                  <Ratio fg={v[i.name]} bg={v[s.name]} />
                </div>
              ))}
              <div className="clr-meta">
                <code>{s.name}</code>
                <span>{v[s.name]}</span>
                <small>{s.use}</small>
              </div>
            </div>
          ))}
        </div>
        <ul className="clr-inks">
          {INK.map((i) => (
            <li key={i.name}>
              <i style={{ background: `var(${i.name})` }} />
              <code>{i.name}</code>
              <span className="clr-hex">{v[i.name]}</span>
              <span>{i.use}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Rules" note="Hairlines are ink at low opacity, so they sit on any surface. Use the softest one that still shows the edge.">
        <div className="clr-rules">
          {['--rule-soft', '--rule', '--rule-strong'].map((r) => (
            <div key={r}>
              <i style={{ background: `var(${r})` }} />
              <code>{r}</code>
              <span>{r === '--rule-soft' ? 'Inside a group' : r === '--rule' ? 'Between rows, around the sheet' : 'Inputs, keycaps, quiet controls'}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Accents" note="Each accent has five steps: soft for a wash, base for text and fills, strong for hover, deep for the button edge, on for text placed on it.">
        <div className="clr-accents">
          {ACCENTS.map((a) => (
            <div key={a.name} className="clr-accent">
              <div className="clr-ramp">
                {(['soft', '', 'strong', 'deep'] as const).map((step) => {
                  const n = step ? `--${a.name}-${step}` : `--${a.name}`
                  return (
                    <div key={n} style={{ background: `var(${n})`, color: step === 'soft' ? `var(--${a.name})` : `var(--on-${a.name})` }}>
                      <code>{n}</code>
                      <span>{v[n]}</span>
                    </div>
                  )
                })}
              </div>
              <h3>{a.title}</h3>
              <p>{a.rule}</p>
              <div className="clr-checks">
                <span>
                  Text on sheet <Ratio fg={v[`--${a.name}`]} bg={v['--sheet']} />
                </span>
                <span>
                  White on fill <Ratio fg={v[`--on-${a.name}`]} bg={v[`--${a.name}`]} />
                </span>
                <span>
                  Text on wash <Ratio fg={v[`--${a.name}`]} bg={v[`--${a.name}-soft`]} />
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="ds-note clr-why">
          Sprout used to be <code className="ds-code">#4f8f3f</code>, which is 3.9:1 on white and fails for text and for white
          button labels under 19px bold. It is now <code className="ds-code">{v['--sprout']}</code>.
        </p>
      </Section>

      <Section title="Farm grounds and plates" note="Sampled from the Sprout Lands palette, for specimens and anything laid over the map. Text over the farm always sits on a plate.">
        <div className="clr-grounds">
          {GROUNDS.map((g) => (
            <div key={g.name} style={{ background: `var(${g.name})` }}>
              <span className="clr-plate">
                <b>Tests</b> needs you
                <Ratio fg={v['--ink']} bg={v['--plate']} ground={v[g.name]} />
              </span>
              <code>{g.name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Sprout Lands palette"
        note="Every pixel of art we draw ourselves (art/authored) must use these colours only; npm run art:check fails otherwise. The UI tokens above are separate and are never used inside pixel art."
      >
        {PALETTE.length ? (
          <div className="clr-palette">
            {PALETTE.map((c) => (
              <button key={c} type="button" title={`Copy ${c}`} style={{ background: c }} onClick={() => navigator.clipboard?.writeText(c)}>
                <span>{c}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="ds-note">The palette file isn’t generated yet. Run npm run art:check after importing the packs.</p>
        )}
      </Section>
    </>
  )
}
