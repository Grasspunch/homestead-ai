// Shared helpers: run the engine in node with fake timers, so simulated calls resolve instantly.
import { vi } from 'vitest'
import { Engine } from '../engine'

// Tick the engine and the fake clock together until `done` holds, or fail after `max` simulated seconds.
export async function until(e: Engine, done: () => boolean, label: string, max = 300) {
  for (let i = 0; i < max * 10; i++) {
    if (done()) return
    e.tick(0.1)
    await vi.advanceTimersByTimeAsync(100)
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

// Brief, clarify and plan, up to the moment the crew starts work.
export async function toGrow(e: Engine, beforeApprove?: (e: Engine) => void) {
  e.skipIntro()
  e.submitBrief()
  await until(e, () => e.questions.length > 0 && e.headThinking === 0, 'clarify questions')
  e.finishClarify()
  await until(e, () => e.planReady, 'plan ready')
  beforeApprove?.(e)
  e.approvePlan()
  e.speed = 4
}

export function freshEngine() {
  return new Engine()
}
