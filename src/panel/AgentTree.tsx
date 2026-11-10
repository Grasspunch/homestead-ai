// Tab opens the agent tree: the region, its valleys (one per project), and in ours each agent's
// field with its glyph and state, then the field's plots (its tasks).
// Arrow keys or J and K move, Enter jumps there, Esc closes.
import './tree.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FARM, NEIGHBOUR, OTHER_FARMS, VALLEY_STATS } from '../sim/scenario'
import { STEP_LABEL, stepOf } from '../sim/steps'
import type { Farmhand, ReasonLabel } from '../sim/types'
import { useEngine } from '../ui'

export type GlyphState = { kind: 'work' } | { kind: 'ask'; reason: ReasonLabel } | { kind: 'done' } | null

const ASK_MARK: Record<ReasonLabel, string> = { Anomaly: '?', Failure: '×', Risk: '!', Cost: '$', Irreversible: '' }

// The same shapes the map draws over a farmhand. Red only on Failure, blue only on the envelope.
export function Glyph({ g }: { g: GlyphState }) {
  if (!g) return <span className="glyph none" aria-hidden />
  if (g.kind === 'work')
    return (
      <span className="glyph work" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    )
  if (g.kind === 'done')
    return (
      <span className="glyph done" aria-hidden>
        ♪
      </span>
    )
  if (g.reason === 'Irreversible')
    return (
      <span className="glyph ask out" aria-hidden>
        <svg width="12" height="9" viewBox="0 0 16 12">
          <rect x="0.75" y="0.75" width="14.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M1.5 1.8 8 6.6l6.5-4.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </span>
    )
  if (g.reason === 'Cost')
    return (
      <span className="glyph ask coin" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="6" cy="6" r="2" fill="currentColor" />
        </svg>
      </span>
    )
  return (
    <span className={`glyph ask ${g.reason === 'Failure' ? 'fail' : ''}`} aria-hidden>
      {ASK_MARK[g.reason]}
    </span>
  )
}

// Rows slide to their new place when their order changes, and only then, so nothing
// reshuffles on a tick. Under reduced motion they just move.
export function useSlide(order: string) {
  const items = useRef(new Map<string, HTMLElement>())
  const last = useRef(new Map<string, number>())
  const prevOrder = useRef(order)
  useLayoutEffect(() => {
    const now = new Map<string, number>()
    items.current.forEach((el, id) => now.set(id, el.getBoundingClientRect().top))
    const moved = prevOrder.current !== order
    prevOrder.current = order
    const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (moved && !still)
      items.current.forEach((el, id) => {
        const was = last.current.get(id)
        const is = now.get(id)
        if (was === undefined || is === undefined || was === is) return
        el.animate([{ transform: `translateY(${was - is}px)` }, { transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.3,1)' })
      })
    last.current = now
  })
  return (id: string) => (el: HTMLElement | null) => {
    if (el) items.current.set(id, el)
    else items.current.delete(id)
  }
}

// Needs you, then Working, then Done. Within a group the crew's own order holds.
export function crewOrder(crew: Farmhand[]) {
  // Resting (done, or idle with nothing to do, like the Reviewer before the harvest) sorts last.
  const rank = (fh: Farmhand) => (fh.status === 'asking' ? 0 : fh.status === 'done' || fh.status === 'idle' ? 2 : 1)
  return crew.map((fh, i) => ({ fh, i })).sort((a, b) => rank(a.fh) - rank(b.fh) || a.i - b.i).map((x) => x.fh)
}

interface TreeRow {
  id: string
  depth: number
  label: string
  sub: string
  glyph?: GlyphState
  go: () => void
}

export function AgentTree() {
  const e = useEngine()
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const back = useRef<Element | null>(null)
  const open = e.treeOpen
  const slide = useSlide(crewOrder(Object.values(e.farmhands)).map((f) => f.id).join(','))

  useEffect(() => {
    if (!open) return
    back.current = document.activeElement
    setSel(1) // our valley
    setTimeout(() => list.current?.focus(), 0)
    return () => {
      const b = back.current as HTMLElement | null
      if (b && b !== document.body && b.isConnected) b.focus?.()
    }
  }, [open])

  if (!open) return null

  const close = () => e.setTree(false)
  const jump = (fn: () => void) => () => {
    fn()
    close()
  }
  const farmSub = (name: string) => {
    const s = VALLEY_STATS[name]
    return `${s.agents} agents, ${s.waiting} waiting on you`
  }
  const step = stepOf(e.phase)
  const ourSub = step === 'grow' && e.growCounts ? e.growCounts : step === 'plant' ? (e.phase === 'brief' ? 'Waiting for your goal' : 'Planting') : STEP_LABEL[step]
  const headAsk = e.activeAsk?.from === 'head' ? e.activeAsk : null
  const headGlyph: GlyphState = headAsk ? { kind: 'ask', reason: headAsk.label } : e.headThinking > 0 ? { kind: 'work' } : null
  const headSub = headAsk ? 'Needs you' : e.headThinking > 0 ? 'Thinking' : e.phase === 'plan' && !e.planReady ? 'Tilling a patch per task' : 'Watching the crew'

  const rows: TreeRow[] = [
    { id: 'region', depth: 0, label: 'Valleys', sub: `${2 + OTHER_FARMS.length} projects`, go: jump(() => e.setView('valley')) },
    {
      id: 'valley',
      depth: 1,
      label: FARM.name,
      sub: ourSub,
      go: jump(() => {
        e.setView('farm')
        e.setPanel(true)
        e.setNav([])
      }),
    },
    {
      id: 'head',
      depth: 2,
      label: 'Head farmer',
      sub: headSub,
      glyph: headGlyph,
      go: jump(() => {
        e.setView('farm')
        e.setPanel(true)
        e.setNav([])
      }),
    },
    // Each agent's field, Needs you first, then its plots.
    ...crewOrder(Object.values(e.farmhands)).flatMap((fh): TreeRow[] => {
      const g = e.glyphOf(fh)
      const plots = e.tasks.filter((t) => t.assignee === fh.id)
      return [
        {
          id: fh.id,
          depth: 2,
          label: fh.role,
          sub: fh.status === 'asking' ? 'Needs you' : e.fhStatus(fh),
          glyph: g && (g.kind === 'ask' ? { kind: 'ask' as const, reason: g.reason } : g),
          go: jump(() => e.openField(fh.id)),
        },
        ...plots.map((t) => ({
          id: `plot-${t.id}`,
          depth: 3,
          label: t.name,
          sub: stepOf(e.phase) === 'plant' ? 'Planned' : e.taskStatus(t).text,
          go: jump(() => {
            e.openField(t.assignee)
            e.openTask(t.id)
          }),
        })),
      ]
    }),
    { id: 'neighbour', depth: 1, label: NEIGHBOUR.name, sub: farmSub(NEIGHBOUR.name), go: jump(() => e.peekFarm(NEIGHBOUR.name)) },
    ...OTHER_FARMS.map((f) => ({ id: f.name, depth: 1, label: f.name, sub: farmSub(f.name), go: jump(() => e.peekFarm(f.name)) })),
  ]
  const at = Math.min(sel, rows.length - 1)

  const onKey = (ev: React.KeyboardEvent) => {
    const k = ev.key
    if (k === 'Escape' || (k === 'Tab' && !ev.shiftKey)) {
      ev.preventDefault()
      return close()
    }
    if (k === 'ArrowDown' || k === 'j' || k === 'J') {
      ev.preventDefault()
      setSel(Math.min(rows.length - 1, at + 1))
    } else if (k === 'ArrowUp' || k === 'k' || k === 'K') {
      ev.preventDefault()
      setSel(Math.max(0, at - 1))
    } else if (k === 'Home') {
      ev.preventDefault()
      setSel(0)
    } else if (k === 'End') {
      ev.preventDefault()
      setSel(rows.length - 1)
    } else if (k === 'Enter' || k === ' ') {
      ev.preventDefault()
      rows[at].go()
    }
  }

  return (
    <div className="tree-veil" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="agent-tree" role="dialog" aria-label="Agent tree" data-testid="agent-tree">
        <div ref={list} className="tree-list" role="tree" aria-label="Region, valleys, fields and plots" tabIndex={0} aria-activedescendant={`tree-${rows[at].id}`} onKeyDown={onKey}>
          {rows.map((r, i) => (
            <div
              key={r.id}
              ref={slide(r.id)}
              id={`tree-${r.id}`}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-selected={i === at}
              className={`tree-row d${r.depth} ${i === at ? 'on' : ''} ${r.glyph?.kind === 'ask' ? 'asking' : ''}`}
              onPointerEnter={() => setSel(i)}
              onClick={() => r.go()}
              data-testid={`tree-row-${r.id}`}
            >
              {r.depth === 2 ? <Glyph g={r.glyph ?? null} /> : <span className="glyph none" aria-hidden />}
              <span className="tree-label">{r.label}</span>
              <span className="tree-sub">{r.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
