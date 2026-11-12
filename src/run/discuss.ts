// Talking a disagreement through. When two farmers disagree and you ask about it, the side you asked answers in a
// short line, and the ask stays open. When you suggest a way of your own, the Planner confirms it first, then the
// run branches like a send-back: the Designer builds your way, another farmer checks it.

import type { FarmerId } from './types'

// What a disagreement ask carries so it can be talked through without the run: both sides, and what each costs.
export interface Talk {
  topic: string
  impact?: string
  sides: { farmer: FarmerId; label: string; position: string; why: string; option: string }[]
  usd: number // either side's change: one edit by the Builder
  minutes: number
  ownUsd: number // your own way: the Designer reworks it at a retry cost, and another farmer checks it
  ownMinutes: number
  builder: FarmerId // who builds your way
  checker: FarmerId // who checks it
}

export const OWN = 'Your way: '
export const isOwnWay = (choice?: string) => !!choice && choice.startsWith(OWN)
export const ownText = (choice: string) => choice.slice(OWN.length)

export type Intent = 'why' | 'cost' | 'time' | 'compare' | 'both'

// What a question is about. Null when it isn't a question we know how to answer, and the reply restates both sides.
export function intentOf(text: string): Intent | null {
  const t = ` ${text.toLowerCase()} `
  if (/\b(cost|costs|price|pricey|cheap|cheaper|expensive|afford|money|\$|spend|dollars?)\b/.test(t)) return 'cost'
  if (/\b(how long|time|slow|slower|fast|faster|quick|quicker|minutes?|when)\b/.test(t)) return 'time'
  if (/\b(compare|difference|differ|better|worse|versus|vs|pros|cons|trade ?off|which one|which is)\b/.test(t)) return 'compare'
  if (/\b(both|either|each)\b/.test(t)) return 'both'
  if (/\b(why|reason|because|explain|point)\b/.test(t)) return 'why'
  return null
}

// A way of your own, said as a suggestion: "what about a tooltip", "let's put it in the footer", "my way: …".
// Returns the suggestion in your words, or null. A plain question about the sides is not one.
const SUGGEST = /^\s*(?:what about|how about|why not|instead[,:]?|let'?s|lets|maybe|try|i'?d (?:rather|prefer|like)|i want|my way[,:]?|my own[,:]?|i suggest|suggest|we could|could we|can we|put|move|use|make it|show)\s+(.+?)[\s.?!]*$/i
export function ownWayOf(text: string, sides: Talk['sides']): string | null {
  const m = text.replace(/[’‘´`]/g, "'").match(SUGGEST)
  if (!m) return null
  const rest = m[1].trim()
  const low = ` ${rest.toLowerCase()} `
  // Naming a side or its option is choosing it, not a way of your own.
  const words = (x: string) => x.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3)
  const names = (o: string) => {
    const w = words(o)
    return w.length > 0 && w.filter((x) => low.includes(x)).length >= Math.min(2, w.length)
  }
  if (sides.some((s) => low.includes(` ${s.label.toLowerCase()}`) || names(s.option))) return null
  // "can we afford it", "could we do it faster": a question about the sides, not a suggestion.
  if (intentOf(rest) && !/^(what about|how about|why not|let|i'?d|i want|my|put|move|use|make|show|instead|try)/i.test(text.trim())) return null
  if (rest.split(/\s+/).length < 2) return null
  return rest.charAt(0).toLowerCase() + rest.slice(1)
}

const money = (n: number) => `$${n.toFixed(2)}`
const min = (n: number) => `${Math.max(1, Math.round(n))} min`
const first = (why: string) => why.split(/(?<=\.)\s/)[0]

// The side a question names, by its label: "why does the builder want that?"
function named(text: string, sides: Talk['sides']) {
  const t = text.toLowerCase()
  return sides.filter((s) => new RegExp(`\\b${s.label.toLowerCase()}s?\\b`).test(t) || t.includes(s.option.toLowerCase()))
}

export interface TalkLine {
  from: FarmerId
  text: string
}

// The simulated answer to a question about a disagreement: the side you asked answers, or both when you asked about
// both or didn't say. One short line each.
export function discussSim(text: string, talk: Talk): TalkLine[] {
  const intent = intentOf(text)
  const asked = named(text, talk.sides)
  const who = asked.length === 1 ? asked : talk.sides
  const line = (s: Talk['sides'][number]): string => {
    switch (intent) {
      case 'why':
        return first(s.why)
      case 'cost':
        return `${s.option} is one edit by the Builder, about ${money(talk.usd)}. A way of your own is about ${money(talk.ownUsd)}, since the Designer reworks it and it’s checked again.`
      case 'time':
        return `${s.option} takes about ${min(talk.minutes)}. A way of your own takes about ${min(talk.ownMinutes)}.`
      case 'compare': {
        const other = talk.sides.find((x) => x.farmer !== s.farmer)
        return `${s.position}. ${first(s.why)}${other ? ` The ${other.label}’s way costs the same.` : ''}`
      }
      default:
        return `${s.position}. ${first(s.why)}`
    }
  }
  // Cost and time are the same for both sides, so one line says it.
  if ((intent === 'cost' || intent === 'time') && asked.length !== 1) {
    const s = talk.sides[0]
    return [{ from: s.farmer, text: intent === 'cost' ? `Either way is one edit by the Builder, about ${money(talk.usd)}. A way of your own is about ${money(talk.ownUsd)}, since the Designer reworks it and it’s checked again.` : `Either way takes about ${min(talk.minutes)}. A way of your own takes about ${min(talk.ownMinutes)}.` }]
  }
  return who.map((s) => ({ from: s.farmer, text: line(s) }))
}

// What the Planner says before building your way.
export function confirmOwn(way: string, talk: Talk, labelOf: (f: FarmerId) => string) {
  return `Go with your way: ${way}? The ${labelOf(talk.builder)} builds it and the ${labelOf(talk.checker)} checks it.`
}
