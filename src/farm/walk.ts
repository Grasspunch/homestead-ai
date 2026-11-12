// How a farmer walks to where it should be: along rows and columns, one leg at a time. The longer leg goes first and
// is kept until it's done, so a farmer never flickers between two directions when the legs are about equal, and it
// always faces the way it moves.

export type Dir = 'down' | 'up' | 'left' | 'right'

export interface Walker {
  x: number
  y: number
  dir: Dir
  leg?: 'x' | 'y'
}

const NEAR = 0.05
const DRIFT = 0.25

// Moves `w` up to `step` tiles toward (tx, ty). Returns the direction it walked, or null when it's already there.
export function stepWalker(w: Walker, tx: number, ty: number, step: number): Dir | null {
  let dx = tx - w.x
  let dy = ty - w.y
  // Standing at a spot that drifts, like a farmer swaying along its row: follow it without breaking into a walk.
  if (Math.abs(dx) <= NEAR && Math.abs(dy) <= NEAR || (!w.leg && Math.hypot(dx, dy) <= DRIFT)) {
    w.x = tx
    w.y = ty
    w.leg = undefined
    return null
  }
  // Pick a leg when there is none, or when the one in hand is done.
  if (!w.leg || (w.leg === 'x' && Math.abs(dx) <= NEAR) || (w.leg === 'y' && Math.abs(dy) <= NEAR)) {
    w.leg = Math.abs(dx) <= NEAR ? 'y' : Math.abs(dy) <= NEAR ? 'x' : !w.leg ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : w.leg === 'x' ? 'y' : 'x'
  }
  if (w.leg === 'x') {
    const m = Math.min(step, Math.abs(dx))
    w.x += Math.sign(dx) * m
    if (Math.abs(tx - w.x) <= NEAR) w.x = tx
    w.dir = dx > 0 ? 'right' : 'left'
  } else {
    const m = Math.min(step, Math.abs(dy))
    w.y += Math.sign(dy) * m
    if (Math.abs(ty - w.y) <= NEAR) w.y = ty
    w.dir = dy > 0 ? 'down' : 'up'
  }
  return w.dir
}
