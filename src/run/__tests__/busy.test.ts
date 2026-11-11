import { describe, expect, it } from 'vitest'
import { busyCount, waitingOn } from '../busy'

// Under jsdom the class on <html> is checked; under node, the count it follows.
const busy = () => (typeof document !== 'undefined' ? document.documentElement.classList.contains('hs-busy') : busyCount() > 0)

describe('the busy paw', () => {
  it('shows while any agent call is out, and only then', async () => {
    let endA!: () => void
    let endB!: () => void
    const a = waitingOn(new Promise<void>((r) => (endA = r)))
    const b = waitingOn(new Promise<void>((r) => (endB = r)))
    expect(busyCount()).toBe(2)
    expect(busy()).toBe(true)
    endA()
    await a
    expect(busy()).toBe(true) // the other call is still out
    endB()
    await b
    expect(busyCount()).toBe(0)
    expect(busy()).toBe(false)
  })

  it('clears when a call fails', async () => {
    await expect(waitingOn(Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(busy()).toBe(false)
  })
})
