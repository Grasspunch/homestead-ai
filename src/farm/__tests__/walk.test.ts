import { describe, expect, it } from 'vitest'
import { stepWalker, type Dir, type Walker } from '../walk'

const walk = (w: Walker, tx: number, ty: number, frames = 400) => {
  const dirs: Dir[] = []
  for (let i = 0; i < frames; i++) {
    const d = stepWalker(w, tx, ty, 0.07)
    if (!d) break
    if (dirs[dirs.length - 1] !== d) dirs.push(d)
  }
  return dirs
}

describe('a farmer walking', () => {
  it('takes the longer leg first and turns once, even when the legs are about equal', () => {
    expect(walk({ x: 0, y: 0, dir: 'down' }, 3, 2.9)).toEqual(['right', 'down'])
    expect(walk({ x: 5, y: 5, dir: 'down' }, 2, 1)).toEqual(['up', 'left'])
  })
  it('faces the way it moves', () => {
    const w: Walker = { x: 0, y: 4, dir: 'down' }
    const y0 = w.y
    expect(stepWalker(w, 0, 0, 0.07)).toBe('up')
    expect(w.y).toBeLessThan(y0)
  })
  it('follows a spot that drifts a little without walking', () => {
    const w: Walker = { x: 2, y: 2, dir: 'down' }
    for (let i = 0; i < 100; i++) expect(stepWalker(w, 2 + Math.sin(i / 20) * 0.5, 2, 0.07)).toBeNull()
  })
  it('ends exactly on the spot', () => {
    const w: Walker = { x: 0, y: 0, dir: 'down' }
    walk(w, 1.23, 4.56)
    expect([w.x, w.y]).toEqual([1.23, 4.56])
  })
})
