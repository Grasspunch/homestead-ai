import { describe, expect, it } from 'vitest'
import { CELL, PX, fitLayout } from '../../hud/homeLayout'

describe('Home fits its farms', () => {
  // The box right of the Planner at 1280x720, 1366x768 and 1920x1080 (as Home measures it).
  const box = (W: number, H: number) => {
    const side = Math.min(640, Math.max(580, W * 0.42))
    const pad = Math.max(24, (W - 1680) / 2)
    const x = pad + side + 24
    return { x, y: 24, w: W - x - pad, h: H - 48 }
  }
  it.each([
    [1280, 720],
    [1366, 768],
    [1920, 1080],
  ])('at %ix%i, every farm and the new plot fit, for up to 6 farms', (W, H) => {
    for (let n = 1; n <= 6; n++) {
      const b = box(W, H)
      const L = fitLayout(b, n)
      const rows = Math.ceil((n + 1) / L.cols)
      const w = (L.cols * CELL.w - 0.6) * PX * L.s
      const h = ((rows - 1) * CELL.h + 4.85) * PX * L.s + CELL.tag
      expect(L.x).toBeGreaterThanOrEqual(b.x - L.s)
      expect(L.x + w).toBeLessThanOrEqual(b.x + b.w + L.s)
      expect(L.y + h).toBeLessThanOrEqual(b.y + b.h + L.s)
    }
  })
  it('centres the farms on a wide screen', () => {
    const b = box(1920, 1080)
    const L = fitLayout(b, 1)
    const w = (L.cols * CELL.w - 0.6) * PX * L.s
    expect(Math.abs(L.x - b.x - (b.x + b.w - (L.x + w)))).toBeLessThanOrEqual(2 * L.s)
  })
})
