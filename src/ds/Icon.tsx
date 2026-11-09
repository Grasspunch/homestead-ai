import { Sprite } from './Sprite'

// Two icon families, each drawn only at whole multiples of its native size:
// Emoji: 32px art from the UI pack's emoji sheet (public/ui/emoji.png), drawn at 32 or 64.
// UiIcon: 16px art from the UI pack's icon sheet (atlas frames icon_*), drawn at 16, 32 or 48.
const SHEET: Record<string, [number, number]> = {
  check: [0, 7],
  cross: [1, 7],
  alert: [2, 7],
  question: [3, 7],
  sleep: [4, 7],
  note: [0, 8],
  coin: [1, 8],
  hearts: [2, 8],
  heart: [3, 8],
  star: [4, 8],
  like: [0, 9],
  skull: [2, 1],
  sprout: [0, 12],
  tulip: [1, 12],
  clover: [2, 12],
  mushroom: [3, 12],
  apple: [0, 13],
  wheat: [1, 13],
  tomato: [2, 13],
  corn: [3, 13],
  carrot: [4, 13],
  tree: [0, 14],
  bush: [1, 14],
  leaf: [2, 14],
  stick: [3, 14],
  stone: [4, 14],
  hammer: [0, 16],
  pickaxe: [1, 16],
  can: [2, 16],
  chick: [0, 17],
  cow: [2, 17],
  sun: [0, 18],
  cloud: [1, 18],
  rain: [2, 18],
  dawn: [3, 18],
  moon: [4, 18],
}

export const EMOJI_NAMES = Object.keys(SHEET)

export function Emoji({ name, size = 32, title }: { name: string; size?: 32 | 64; title?: string }) {
  const cell = SHEET[name]
  if (!cell) return null
  const [c, r] = cell
  const k = size / 32
  return (
    <span
      className="hs-icon"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ width: size, height: size, backgroundSize: `${160 * k}px ${608 * k}px`, backgroundPosition: `${-c * size}px ${-r * size}px` }}
    />
  )
}

export const UI_ICON_NAMES = [
  'gear', 'question', 'star', 'podium', 'trophy', 'crown', 'slash', 'check', 'cross', 'no', 'music', 'forward', 'play',
  'pause', 'music_off', 'heart', 'branch', 'fork', 'note', 'gamepad', 'chat', 'skull', 'sound_off', 'alert', 'coin',
  'cart', 'sound', 'plus', 'minus', 'house', 'mute', 'power', 'enter', 'exit', 'back', 'paw', 'back_plus',
]

export function UiIcon({ name, size = 16, title }: { name: string; size?: 16 | 32 | 48; title?: string }) {
  return <Sprite name={`icon_${name}`} scale={size / 16} title={title} className="hs-uiicon" />
}
