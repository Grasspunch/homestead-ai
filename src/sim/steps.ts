// Three steps in the UI. The engine keeps finer phases; the UI only ever shows these.
import type { Phase } from './types'

export type Step = 'plant' | 'grow' | 'harvest'
export const STEPS: Step[] = ['plant', 'grow', 'harvest']
export const STEP_LABEL: Record<Step, string> = { plant: 'Plant', grow: 'Grow', harvest: 'Harvest' }

// Brief, clarify and plan are Plant. Harvest and everything after the merge (CI, deploy, canary) are Harvest.
export function stepOf(p: Phase): Step {
  if (p === 'brief' || p === 'clarify' || p === 'plan') return 'plant'
  if (p === 'grow') return 'grow'
  return 'harvest'
}
