import { useEffect, useRef, useState } from 'react'
import { loadAtlas } from './atlas'
import { fitCamera, render, type Camera, type Hit } from './render'
import { engine } from '../sim/engine'
import { useEngine } from '../ui'

export function MapView() {
  const e = useEngine()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const hits = useRef<Hit[]>([])
  const cam = useRef<Camera | null>(null)
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let alive = true
    Promise.all([loadAtlas(), document.fonts.load('16px SproutLands').catch(() => null)]).then(() => {
      if (!alive) return
      setReady(true)
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
          const target = fitCamera(engine.cameraTarget(), W, H, engine.view === 'valley' ? 0 : 76)
          if (!cam.current) cam.current = target
          else {
            const k = 1 - Math.exp(-dt * 3.2)
            cam.current = {
              scale: cam.current.scale + (target.scale - cam.current.scale) * k,
              x: cam.current.x + (target.x - cam.current.x) * k,
              y: cam.current.y + (target.y - cam.current.y) * k,
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
    const order: Hit['kind'][] = ['crow', 'farmhand', 'head', 'neighbour', 'pest', 'signpost', 'seeds', 'plot', 'nplot', 'farm']
    const inside = hits.current.filter((h) => wx >= h.rect.x && wx <= h.rect.x + h.rect.w && wy >= h.rect.y && wy <= h.rect.y + h.rect.h)
    inside.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    return inside[0] ?? null
  }

  return (
    <div
      ref={wrap}
      className={`map-wrap ${e.trace ? 'replay' : ''}`}
      onMouseMove={(ev) => {
        const h = pick(ev.clientX, ev.clientY)
        const r = wrap.current!.getBoundingClientRect()
        setHover(h && !(h.kind === 'farm' && engine.view === 'farm') ? { hit: h, x: ev.clientX - r.left, y: ev.clientY - r.top } : null)
      }}
      onMouseLeave={() => setHover(null)}
      onClick={(ev) => {
        const h = pick(ev.clientX, ev.clientY)
        if (!h) return
        if (h.kind === 'farmhand') engine.select(h.id as never)
        else if (h.kind === 'plot' && engine.phase === 'grow') engine.select(engine.task(h.id).assignee)
        else if (h.kind === 'farm' && engine.view === 'valley' && h.id === 'Q1 Launch') engine.setView('farm')
      }}
    >
      <canvas ref={canvas} aria-label="Farm map" role="img" />
      {!ready && <div className="paused-veil"><span>Loading the valley…</span></div>}
      {hover && (
        <div className="tooltip" style={{ left: Math.min(hover.x + 16, (wrap.current?.clientWidth ?? 800) - 290), top: hover.y + 16 }}>
          <b>{hover.hit.title}</b>
          {hover.hit.body && <p>{hover.hit.body}</p>}
        </div>
      )}
    </div>
  )
}
