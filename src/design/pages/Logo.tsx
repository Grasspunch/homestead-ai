import { PageHead, Section } from '../Doc'
import { Stage, type Ground } from '../Stage'

const LOCKUPS = [
  { file: 'homestead-ai-logo-b-barn-lockup', title: 'Barn lockup', use: 'The default. README, the intro card, the library.' },
  { file: 'homestead-ai-logo-a-sign', title: 'Farm sign', use: 'Option A, a wooden sign. Kept for reference.' },
  { file: 'homestead-ai-logo-c-farmhouse', title: 'Farmhouse', use: 'Option C. Kept for reference.' },
]

const ICONS = [
  { file: 'barn-sticker.svg', size: 64, title: 'Barn sticker', use: 'Sidebar mark, app headers' },
  { file: 'app-icon.svg', size: 64, title: 'App icon', use: 'Home screen, PWA' },
  { file: 'icon-192.png', size: 96, title: 'icon-192', use: 'Android' },
  { file: 'favicon-48.png', size: 48, title: 'favicon-48', use: 'Browser tab' },
  { file: 'favicon-32.png', size: 32, title: 'favicon-32', use: 'Browser tab' },
  { file: 'favicon-16.png', size: 16, title: 'favicon-16', use: 'Browser tab' },
]

const ON: Ground[] = ['sheet', 'grass', 'water']

export function LogoPage(_: { arg?: string }) {
  return (
    <>
      <PageHead title="Logo and icons">
        A pixel barn drawn on the same grid as the farm, so it sits next to Sprout Lands art without looking pasted on. All files
        are in <code className="ds-code">public/brand</code>; the source scripts are in the project folder under logo/source.
      </PageHead>

      <Section title="Lockups" note="Draw the SVG, or the PNG at whole multiples of its pixel size. Never blur it with a non-integer scale.">
        <div className="logo-lockups">
          {LOCKUPS.map((l, i) => (
            <div key={l.file} className={i === 0 ? 'logo-main' : ''}>
              <div className="logo-grounds">
                {(i === 0 ? ON : ['sheet' as Ground]).map((g) => (
                  <Stage key={g} ground={g} pad={i === 0 ? 40 : 28}>
                    <img src={`/brand/${l.file}.svg`} alt={l.title} className="logo-img" style={{ height: i === 0 ? 80 : 56 }} />
                  </Stage>
                ))}
              </div>
              <div className="ds-cap">
                <b>{l.title}</b>
                <span>{l.use}</span>
                <code>{l.file}.svg</code>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Icons and favicons">
        <div className="ds-grid" style={{ ['--cell' as string]: '150px' }}>
          {ICONS.map((ic) => (
            <div key={ic.file}>
              <Stage ground="checker" pad={16} className="logo-icon">
                <img src={`/brand/${ic.file}`} alt={ic.title} width={ic.size} height={ic.size} className="logo-img" />
              </Stage>
              <div className="ds-cap">
                <b>{ic.title}</b>
                <span>{ic.use}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Credit" note="The logo is our own pixel art. The farm art is Sprout Lands by Cup Nooble and must be credited wherever the app ships.">
        <p className="logo-credit">
          Assets from <a href="https://cupnooble.itch.io/sprout-lands-asset-pack">Sprout Lands</a> by Cup Nooble.
        </p>
      </Section>
    </>
  )
}
