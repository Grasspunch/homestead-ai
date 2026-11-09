// Each level of the map is its own page with its own address, so Back works:
//   /                      Valleys: every project in the organisation
//   /v/<project>           a valley: one project, its farmstead and a field per agent
//   /v/<project>/<agent>   a farm: one agent's field and its plots
import type { Engine } from './engine'
import { FARM, NEIGHBOUR, OTHER_FARMS } from './scenario'
import type { RoleId } from './types'

export type Page = { kind: 'region' } | { kind: 'valley'; id: string } | { kind: 'field'; valley: string; id: RoleId }

const VALLEYS = () => [FARM.name, NEIGHBOUR.name, ...OTHER_FARMS.map((f) => f.name)]
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function pageOf(e: Engine): Page {
  if (e.view === 'valley') return { kind: 'region' }
  if (e.peekName) return { kind: 'valley', id: e.peekName }
  if (e.fieldPage) return { kind: 'field', valley: FARM.name, id: e.fieldPage }
  return { kind: 'valley', id: FARM.name }
}

export function pathOf(p: Page): string {
  if (p.kind === 'region') return '/'
  if (p.kind === 'valley') return `/v/${slug(p.id)}`
  return `/v/${slug(p.valley)}/${p.id}`
}

export function parsePath(path: string, e: Engine): Page | null {
  const parts = path.split('/').filter(Boolean)
  if (!parts.length) return { kind: 'region' }
  if (parts[0] !== 'v' || !parts[1]) return null
  const valley = VALLEYS().find((v) => slug(v) === parts[1])
  if (!valley) return null
  if (parts[2] && valley === FARM.name && parts[2] in e.farmhands) return { kind: 'field', valley, id: parts[2] as RoleId }
  return { kind: 'valley', id: valley }
}

export function goPage(e: Engine, p: Page) {
  if (p.kind === 'region') return e.setView('valley')
  if (p.kind === 'field') return e.openField(p.id)
  if (p.id === FARM.name) return e.setView('farm')
  e.peekFarm(p.id)
}

// Every page names its parents, for the breadcrumb.
export function crumbsOf(e: Engine, p: Page): { label: string; page: Page }[] {
  const out: { label: string; page: Page }[] = [{ label: 'Valleys', page: { kind: 'region' } }]
  if (p.kind === 'region') return out
  const valley = p.kind === 'valley' ? p.id : p.valley
  out.push({ label: valley, page: { kind: 'valley', id: valley } })
  if (p.kind === 'field') out.push({ label: e.farmhands[p.id]?.role ?? p.id, page: p })
  return out
}
