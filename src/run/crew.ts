// How each farmer looks: one shirt colour per role, used on the map, the portraits and the panel.
import type { FarmerId } from './types'

export interface Tint {
  body: string
  shade: string
}

// null keeps the sprite's own cream shirt (the Planner).
export const TINT: Record<FarmerId, Tint | undefined> = {
  planner: undefined,
  builder: { body: '#bfe0f2', shade: '#98c2dc' },
  designer: { body: '#dcc8f2', shade: '#bba3dd' },
  tester: { body: '#cfe9b0', shade: '#a9cf86' },
  deployer: { body: '#f8d9a6', shade: '#e3b679' },
}

// The swatch shown beside a farmer's name in the panel.
export const SWATCH: Record<FarmerId, Tint> = {
  planner: { body: '#f3f2c0', shade: '#d8c98e' },
  builder: TINT.builder!,
  designer: TINT.designer!,
  tester: TINT.tester!,
  deployer: TINT.deployer!,
}
