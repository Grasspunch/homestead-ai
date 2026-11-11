// Where Home draws your farms: beside the Planner, as big as fits, centred in the room left.
export const PX = 16
// A farm takes 9 tiles across and 7 down; its name tag hangs under it in screen pixels.
export const CELL = { w: 9, h: 7, tag: 56 }
export interface Layout {
  s: number // pixel scale
  cols: number
  x: number // the grid's top left, in screen pixels
  y: number
}
// The largest pixel scale, and the columns, that fit every farm and the new-farm plot in the box beside the
// Planner, centred in it so a wide screen has no empty half.
export function fitLayout(box: { x: number; y: number; w: number; h: number }, farms: number): Layout {
  const slots = farms + 1
  const size = (s: number, cols: number) => {
    const rows = Math.ceil(slots / cols)
    return { w: (cols * CELL.w - 0.6) * PX * s, h: ((rows - 1) * CELL.h + 4.85) * PX * s + CELL.tag }
  }
  // Largest scale first; at each scale, the most columns that fit (fewer rows).
  let pick = { s: 1, cols: Math.min(4, slots) }
  search: for (const s of [3, 2.5, 2, 1.75, 1.5, 1.25, 1])
    for (let cols = Math.min(4, slots); cols >= 1; cols--) {
      const z = size(s, cols)
      if (z.w <= box.w && z.h <= box.h) {
        pick = { s, cols }
        break search
      }
    }
  const z = size(pick.s, pick.cols)
  // Whole source pixels, so the art stays crisp.
  const x = Math.round(Math.max(box.x, box.x + (box.w - z.w) / 2) / pick.s) * pick.s
  const y = Math.round(Math.max(box.y, box.y + (box.h - z.h) / 2) / pick.s) * pick.s
  return { ...pick, x, y }
}
