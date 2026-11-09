import { useEffect, useRef, useState } from 'react'
import { loadAtlas } from './atlas'
import { clampCamera, fitCamera, render, type Camera, type Hit } from './render'
import { engine } from '../sim/engine'
import { useEngine } from '../ui'

const ORDER: Hit['kind'][] = ['crow', 'crate', 'chicken', 'farmhand', 'helper', 'head', 'pest', 'sign', 'signpost', 'prop', 'plot', 'field', 'neighbour', 'nplot', 'farm']

export function MapView() {
  const e = useEngine()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const hits = useRef<Hit[]>([])
  const cam = useRef<Camera | null>(null)
  const drag = useRef<{ x: number; y: number; cam: Camera; moved: boolean; id: number } | null>(null)
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let alive = true
    Promise.all([
      loadAtlas(),
      document.fonts.load('400 14px "Atkinson Hyperlegible Next"').catch(() => null),
      document.fonts.load('700 14px "Atkinson Hyperlegible Next"').catch(() => null),
    ]).then(() => {
      if (!alive) return
      setReady(true)
      engine.markReady()
      const loop = (now: number) => {
        const dt = (now - last) / 1000
        last = now
        engine.tick(dt)
        const c = canvas.current
        const w = wrap.current
        if (c && w) {
          const dpr = window.devicePixelRatio || 1
          const W = w.clientWidth
          const H = w.clientHeight
          if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
            c.width = Math.round(W * dpr)
            c.height = Math.round(H * dpr)
          }
          const free = engine.freeCam
          if (free) cam.current = free
          else {
            const target = fitCamera(engine.cameraTarget(), W, H, engine.view === 'valley' || engine.intro ? 0 : 44, engine.cameraInteger)
            if (!cam.current) cam.current = target
            else {
              // The opening pans slowly; everything else, a page change included, settles in about 0.4s.
              const k = 1 - Math.exp(-dt * (engine.intro ? 1.6 : 6))
              cam.current = {
                scale: cam.current.scale + (target.scale - cam.current.scale) * k,
                x: cam.current.x + (target.x - cam.current.x) * k,
                y: cam.current.y + (target.y - cam.current.y) * k,
              }
              // Settle exactly on the target so a whole-number zoom stays whole.
              if (Math.abs(cam.current.scale - target.scale) < 0.004 && Math.abs(cam.current.x - target.x) < 0.05 && Math.abs(cam.current.y - target.y) < 0.05) cam.current = target
            }
          }
          const ctx = c.getContext('2d')!
          hits.current = render(ctx, engine, cam.current, W, H, dpr).hits
        }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [])

  const pick = (clientX: number, clientY: number): Hit | null => {
    const w = wrap.current
    const c = cam.current
    if (!w || !c) return null
    const r = w.getBoundingClientRect()
    const wx = (clientX - r.left) / c.scale + c.x
    const wy = (clientY - r.top) / c.scale + c.y
    const inside = hits.current.filter((h) => wx >= h.rect.x && wx <= h.rect.x + h.rect.w && wy >= h.rect.y && wy <= h.rect.y + h.rect.h)
    inside.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    return inside[0] ?? null
  }

  const click = (h: Hit) => {
    if (engine.intro) return
    if (engine.phase === 'harvest' && engine.harvestStage === 'map') return engine.skipHarvestMap()
    // On the valley page a field, its big character, its plots and its farmhand all open that farm's page.
    const valleyPage = engine.view === 'farm' && !engine.fieldPage
    const roleOf = (id: string) => engine.fields.find((f) => f.id === id)?.roles[0]
    switch (h.kind) {
      case 'field': {
        const role = roleOf(h.id)
        return role && valleyPage && engine.openField(role)
      }
      case 'plot':
        if (valleyPage) return engine.openField(engine.task(h.id).assignee)
        return engine.openTask(h.id)
      case 'crate':
        if (h.id === 'shipping') {
          // The shipping crate: its lid opens, and the panel shows the Grow review before the harvest, its root after.
          engine.poke('shipping')
          engine.setPanel(true)
          return engine.setNav(engine.phase === 'plan' || engine.phase === 'grow' ? [{ kind: 'step', id: 'grow' }] : [])
        }
        return engine.openDraft(h.id)
      case 'farmhand':
        if (valleyPage && engine.fieldOf(h.id as never)) return engine.openField(h.id as never)
        return engine.pokeFarmhand(h.id as never)
      case 'helper':
        return engine.openTask(h.id.split(':')[0])
      case 'pest': {
        const t = engine.tasks.find((x) => x.pests.some((p) => p.id === h.id))
        return t && engine.openTask(t.id)
      }
      case 'crow':
        if (engine.activeAsk?.id === 'crow') {
          engine.setPanel(true)
          return engine.go({ kind: 'why', id: 'crow' })
        }
        return
      case 'chicken':
      case 'prop':
      case 'sign':
        return engine.poke(h.id)
      case 'signpost':
        engine.poke(`sign:${h.id}`)
        engine.setPanel(true)
        return engine.setNav([{ kind: 'task', id: h.id.split(':')[0] }, { kind: 'lib', id: h.id.split(':').slice(1).join(':') }])
      case 'farm':
        // In the region view: ours opens as before; another project's valley opens read-only.
        if (engine.view === 'valley') engine.peekFarm(h.id)
        return
    }
  }

  const clickable = (h: Hit | null) => !!h && !(h.kind === 'farm' && engine.view === 'farm') && h.kind !== 'nplot' && h.kind !== 'neighbour' && h.kind !== 'head'

  return (
    <div
      ref={wrap}
      className={`map-wrap ${e.trace ? 'past' : ''} ${dragging ? 'dragging' : clickable(hover?.hit ?? null) ? 'can-click' : ''}`}
      onPointerDown={(ev) => {
        if (ev.button !== 0 || !cam.current || engine.intro) return
        drag.current = { x: ev.clientX, y: ev.clientY, cam: { ...cam.current }, moved: false, id: ev.pointerId }
      }}
      onPointerMove={(ev) => {
        const d = drag.current
        const w = wrap.current!
        if (d) {
          const dx = ev.clientX - d.x
          const dy = ev.clientY - d.y
          if (!d.moved && Math.hypot(dx, dy) > 5) {
            d.moved = true
            setDragging(true)
            setHover(null)
            w.setPointerCapture(d.id)
          }
          if (d.moved) {
            engine.dragCam(clampCamera({ scale: d.cam.scale, x: d.cam.x - dx / d.cam.scale, y: d.cam.y - dy / d.cam.scale }, w.clientWidth, w.clientHeight))
            return
          }
        }
        const h = pick(ev.clientX, ev.clientY)
        engine.hover(h?.kind === 'plot' ? h.id : null)
        const r = w.getBoundingClientRect()
        const tip = h && (h.kind === 'plot' || h.kind === 'farmhand' || h.kind === 'nplot' || h.kind === 'neighbour' || h.kind === 'head' || (h.kind === 'farm' && engine.view === 'valley') || h.kind === 'signpost' || h.kind === 'crow' || h.kind === 'crate' || h.kind === 'helper' || h.kind === 'field')
        setHover(h ? { hit: tip ? h : { ...h, title: '' }, x: ev.clientX - r.left, y: ev.clientY - r.top } : null)
      }}
      onPointerUp={(ev) => {
        const d = drag.current
        drag.current = null
        if (d?.moved) {
          setDragging(false)
          return
        }
        const h = pick(ev.clientX, ev.clientY)
        if (h) click(h)
        else if (engine.phase === 'harvest' && engine.harvestStage === 'map') engine.skipHarvestMap()
        // A farm page: a click outside its field goes back to the valley.
        else if (engine.view === 'farm' && engine.fieldPage && !engine.intro) engine.closeField()
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      onPointerLeave={() => {
        setHover(null)
        engine.hover(null)
      }}
      onWheel={(ev) => {
        const w = wrap.current
        const c = cam.current
        if (!w || !c || engine.intro) return
        const r = w.getBoundingClientRect()
        const mx = ev.clientX - r.left
        const my = ev.clientY - r.top
        const fit = fitCamera({ x: 0, y: 0, w: 76, h: 46 }, w.clientWidth, w.clientHeight).scale
        const scale = Math.max(fit, Math.min(6, c.scale * Math.exp(-ev.deltaY * 0.0015)))
        const wx = mx / c.scale + c.x
        const wy = my / c.scale + c.y
        engine.dragCam(clampCamera({ scale, x: wx - mx / scale, y: wy - my / scale }, w.clientWidth, w.clientHeight))
      }}
    >
      <canvas ref={canvas} aria-label="Farm map. Drag to look around." role="img" />
      {!ready && (
        <div className="paused-veil">
          <span>Loading the valley…</span>
        </div>
      )}
      {hover && hover.hit.title && !dragging && (
        <div className="tooltip" style={{ left: Math.min(hover.x + 16, (wrap.current?.clientWidth ?? 800) - 290), top: hover.y + 16 }}>
          <b>{hover.hit.title}</b>
          {hover.hit.body && <span>{hover.hit.body}</span>}
        </div>
      )}
    </div>
  )
}
