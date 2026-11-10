// The parts of the screen you can ask the Planner to hide or bring back: "remove the pull request button",
// "hide the check pop-ups", "show the spend counter again". Each has the words people use for it.

export type UiId = 'pr' | 'inbox' | 'spend' | 'skip' | 'home' | 'sampleTag' | 'chips' | 'progress' | 'proofPops' | 'bubbles' | 'plotLabels' | 'chickens'

export interface UiPart {
  id: UiId
  name: string // as the change card says it: "Hide the pull request button"
  words: RegExp // matched against the normalised request
  instead?: string // where it still is, when you hide it
}

export const UI_PARTS: UiPart[] = [
  { id: 'pr', name: 'pull request button', words: /\b(pull request|pr) (button|link|tab)\b|\bpull request\b(?= (at|in|on) the top)|\bpr button\b/, instead: 'The chest on the farm still opens the pull request' },
  { id: 'inbox', name: 'inbox button', words: /\b(inbox|mail|mailbox|envelope|letters?)\b/, instead: 'The mailbox on the farm still opens it, and asks still pop up' },
  { id: 'spend', name: 'spend counter', words: /\b(spend|spent|cost|costs|coin|coins|money|dollars?|price|usage) ?(counter|button|badge|total|meter)?\b/, instead: 'The coins on the farm still open your spend' },
  { id: 'skip', name: 'skip button', words: /\bskip (button|icon|ahead button|forward)\b|\bfast ?forward\b/ },
  { id: 'home', name: 'home button', words: /\bhome (button|icon)\b|\bhouse (button|icon)\b/, instead: 'Escape, then the farms list, still takes you home' },
  { id: 'sampleTag', name: 'simulated tag', words: /\b(simulated|sample|demo) (tag|label|badge|pill)\b/ },
  { id: 'chips', name: 'change chips', words: /\b(change|mode|incident|reshape) (chips?|tags?|pills?)\b/, instead: 'Settings still lists Your flow' },
  { id: 'progress', name: 'task count', words: /\b(task count|tasks done|progress|of \d+ tasks|subtitle)\b/ },
  { id: 'proofPops', name: 'check pop-ups', words: /\b(check|proof|test|result|done)s? ?(pop ?ups?|popups?|bubbles?|cards?|toasts?)\b|\bpop ?ups?\b/, instead: 'Each plot’s label still shows how it went' },
  { id: 'bubbles', name: 'speech bubbles over the farmers', words: /\b(speech|emote|emoji|thought) ?(bubbles?|icons?)\b|\bbubbles?\b/ },
  { id: 'plotLabels', name: 'plot labels', words: /\b(plot|task|crop) (labels?|names?|signs?|tags?)\b/ },
  { id: 'chickens', name: 'chickens', words: /\b(chickens?|hens?|animals?)\b/ },
]

export const uiPart = (id: string) => UI_PARTS.find((x) => x.id === id)

const HIDE = /\b(remove|hide|get rid of|take away|take out|drop|lose|ditch|turn off|switch off|kill|delete|dont show|do not show|dont need|dont want|no more|without|stop showing)\b/
const SHOW = /\b(show|bring back|add back|put back|restore|unhide|turn on|switch on|i want|i need|give me) (the )?/
// Words that say a request is about the screen, not the run.
export const SCREEN = /\b(button|buttons|icon|icons|tag|tags|badge|badges|counter|pop ?ups?|popups?|bubbles?|labels?|chips?|pills?|bar|top|corner|header|screen|ui|interface|panel|menu|link|tab|display)\b/

// The screen changes in one clause, or null when it names no part of the screen.
export function uiChangesIn(c: string): { el: UiId; show: boolean }[] | null {
  const hits = UI_PARTS.filter((p) => p.words.test(c))
  if (!hits.length) return null
  // A part named only by a word the run also uses ("cost", "progress"), with nothing else about the screen, is the run's.
  const screenish = SCREEN.test(c) || hits.some((h) => ['chickens', 'proofPops', 'bubbles'].includes(h.id))
  if (!screenish) return null
  const show = SHOW.test(c) && !HIDE.test(c)
  const hide = HIDE.test(c)
  if (!show && !hide) return null
  // The most specific part wins: "check pop-ups" over "pop-ups", "pull request button" over "button".
  const best = hits.filter((h) => !(h.id === 'spend' && hits.some((o) => o.id === 'pr')))
  return best.map((h) => ({ el: h.id, show }))
}
