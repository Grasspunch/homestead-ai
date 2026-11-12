// Talking things through. Every chat in the app goes through one of two turns:
// - an ask turn: you type into a question an agent asked you. You get an answer, and the question stays open until
//   you pick. When your words clearly pick an option, it is said back to you first.
// - a Planner turn: you type into the Planner's box. A question gets an answer from the run as it stands; a request
//   to change something becomes one action, which is said back to you (or applied, when it is easy to undo).
// Nothing you decided is final: an answer can be reopened, a change turned off, and both by saying so.
// Both turns call a real model when the server can run one, and fall back to a script that reads the run itself.

import type { AskReason, Confidence, FarmerId } from './types'

export interface TalkTurn {
  from: 'you' | FarmerId
  text: string
}

// ---- Ask turn ------------------------------------------------------------------------

export interface AskTalkIn {
  ask: {
    id: string
    farmer: FarmerId
    farmerLabel: string
    reason: AskReason
    question: string
    impact?: string
    basis?: string
    confidence?: Confidence
    task?: string // the task's name
    suggested: string
    options: string[] // every option words can pick, the suggestion first
    canSendBack: boolean // a pull request ask: work can go back to an agent with a note
    sides?: { farmer: FarmerId; label: string; position: string; why: string; option: string }[] // a disagreement
  }
  history: TalkTurn[] // the talk on this ask so far, oldest first
  message: string
}

export interface AskTalkOut {
  reply: string // the answer, in one to three short sentences, from the agent that asked
  choice: string | null // an option the message clearly picks; it is confirmed before it applies
  sendBack: string | null // a pull request ask: the note to send the work back with, confirmed first
  hold: boolean // the person wants to wait: nothing moves on this until they say so
}

// ---- Planner turn --------------------------------------------------------------------

export interface DecidedAsk {
  id: string
  question: string
  choice: string
  options: string[] // what it can be changed to
  canChange: boolean
  why?: string // why it can't be changed, such as "It already shipped to everyone."
}

export interface ChatIn {
  message: string
  history: { from: 'you' | 'planner'; text: string }[] // oldest first
  status: {
    goal: string
    done: boolean
    minutes: number
    spent: number
    budget?: number
    farmers: { id: FarmerId; label: string; state: string; model?: string; task?: string }[]
    tasks: { id: string; name: string; farmer: FarmerId; status: string }[]
    openAsk?: { id: string; question: string; options: string[]; impact?: string }
    decided: DecidedAsk[]
    changesOn: { id: string; title: string; request: string }[]
    merge?: 'ask' | 'auto' // pull requests ask you before merging, or merge by themselves when checks pass
    deploy?: string // where the release is: "not shipped", "10%", "everyone", "rolled back"
    pending?: { request: string; rows: { id: string; label: string; loss?: string }[] } // a change card that's open
  }
}

// One action at most. Each is said back, or easy to undo.
export type ChatAction =
  | { kind: 'none' } // the reply is the whole answer
  | { kind: 'note'; to: FarmerId } // pass it to an agent as a note
  | { kind: 'change'; request: string } // a change to the run: read it into a change card
  | { kind: 'undo'; id: string } // turn a change off
  | { kind: 'reopen'; askId: string; choice: string | null } // change an earlier answer, to this option or asked again
  | { kind: 'adjust'; keep: string[] | null; scope: 'farm' | 'every' | null } // the open change card: keep these rows, or set how long
  | { kind: 'cancel' } // the open change card: drop it

export interface ChatOut {
  reply: string
  action: ChatAction
}
