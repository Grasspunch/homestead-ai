// WCAG contrast, for the library's live readouts. scripts/check-contrast.mjs is the gate.
function channel(v: number) {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function parseColor(s: string): [number, number, number, number] {
  s = s.trim()
  if (s.startsWith('#')) {
    const h = s.slice(1)
    const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean)
    return [+r, +g, +b, +a]
  }
  return [0, 0, 0, 1]
}

function over(fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number, number] {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}

export function luminance([r, g, b]: number[]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contrast of fg over bg, where bg may itself be translucent over `ground` (defaults to white). */
export function contrast(fg: string, bg: string, ground = '#ffffff') {
  const g = parseColor(ground)
  const b = over(parseColor(bg), g)
  const f = over(parseColor(fg), b)
  const [l1, l2] = [luminance(f), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

export function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
