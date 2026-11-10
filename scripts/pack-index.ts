// Prints the Sprout Lands pack list (what virtual:sprout-lands serves) as JSON, with file URLs under
// the given base. scripts/sync-lovable-design.sh --with-packs uses it for the hosted design library,
// which shows the art only: images and fonts, no source files (.aseprite) or text.
// Run: node --experimental-strip-types scripts/pack-index.ts <url base>
import { scan } from './vite-sprout-lands.ts'

const SHOWN = new Set(['png', 'gif', 'font'])
const base = process.argv[2] ?? '/assets/sprout-lands/'
const data = scan(process.cwd(), false, base)
const files = data.files.filter((f) => SHOWN.has(f.kind))
const packs = data.packs.map((p) => ({ ...p, count: files.filter((f) => f.pack === p.id).length }))
process.stdout.write(JSON.stringify({ ...data, packs, files }))
