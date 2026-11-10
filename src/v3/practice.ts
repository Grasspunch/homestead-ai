// Practice mode: what the farm uses when no AI key is connected.
// It follows the same shapes as the live agents so every screen can be tried, and every
// piece of text it writes says it is practice text.

import type { PlanOut, PlanTask, ReviewIn, ReviewOut, StepIn, StepOut, TalkOut, TemplateIn } from '../agent/agents'

const NOTE = '_Practice text. No AI is connected, so this stands in for real work._'

const titleOf = (goal: string) => {
  const words = goal.replace(/[.!?].*$/s, '').trim().split(/\s+/).slice(0, 5)
  const t = words.join(' ')
  return t ? t[0].toUpperCase() + t.slice(1) : 'New project'
}

const pick = (templates: TemplateIn[], id: string) => (templates.some((t) => t.id === id) ? id : (templates[0]?.id ?? id))

export function practicePlan(input: { goal: string; templates: TemplateIn[]; answer: string | null; note: string | null }): PlanOut {
  const t = input.templates
  const vague = input.goal.trim().split(/\s+/).length < 5
  const tasks: PlanTask[] = [
    {
      id: 'research',
      name: 'Research the background',
      brief: 'Collect the facts, numbers and examples the rest of the work needs.',
      kind: 'research',
      farmer: pick(t, 'researcher'),
      needs: [],
      steps: ['Read what we have', 'List the key facts'],
      irreversible: null,
      costly: null,
      reviews: null,
    },
    {
      id: 'write',
      name: 'Write the first version',
      brief: 'Turn the research into a finished draft that fits the goal.',
      kind: 'writing',
      farmer: pick(t, 'writer'),
      needs: ['research'],
      steps: ['Outline', 'First draft', 'Tighten'],
      irreversible: null,
      costly: null,
      reviews: null,
    },
    {
      id: 'review',
      name: 'Review the draft',
      brief: 'Check the draft against the research and the goal.',
      kind: 'review',
      farmer: pick(t, 'reviewer'),
      needs: ['write'],
      steps: ['Check every claim'],
      irreversible: null,
      costly: null,
      reviews: 'write',
    },
    {
      id: 'send',
      name: 'Send it out',
      brief: 'Prepare the final version and the list of who gets it, then send.',
      kind: 'scheduling',
      farmer: pick(t, 'scheduler'),
      needs: ['review'],
      steps: ['Prepare the send', 'Final check'],
      irreversible: { action: 'send the finished piece', audience: 'People outside your team' },
      costly: null,
      reviews: null,
    },
  ]
  return {
    title: titleOf(input.goal),
    question:
      vague && !input.answer
        ? { q: 'What should the finished result be?', why: 'The goal is short, so the shape of the result is open.', options: ['A written document', 'A plan with dates', 'A short summary'] }
        : null,
    tasks,
    recurring: [],
    estimate: 'nothing in practice mode',
  }
}

export function practiceTalk(input: { message: string; templates: TemplateIn[] }): TalkOut {
  const name = input.message.replace(/[.!?]+$/, '').trim()
  const short = name.split(/\s+/).slice(0, 5).join(' ')
  return {
    reply: `I've added "${short}" as a new task.`,
    tasks: [
      {
        id: 't' + Math.random().toString(36).slice(2, 7),
        name: short[0].toUpperCase() + short.slice(1),
        brief: name,
        kind: 'other',
        farmer: pick(input.templates, 'writer'),
        needs: [],
        steps: ['Work it out', 'Write it up'],
        irreversible: null,
        costly: null,
        reviews: null,
      },
    ],
  }
}

export function practiceStep(i: StepIn): StepOut {
  const last = i.stepIndex === i.stepCount - 1
  const lines = [
    `## ${last ? i.task.name : i.step}`,
    '',
    NOTE,
    '',
    `Goal: ${i.goal}`,
    '',
    last ? `This is where the ${i.farmer.name}'s finished work for "${i.task.name}" would be.` : `This is where the result of the step "${i.step}" would be.`,
  ]
  if (i.inputs.length) lines.push('', `It starts from: ${i.inputs.map((x) => `${x.name} (by the ${x.by})`).join(', ')}.`)
  if (i.files.length) lines.push('', `Files it can see: ${i.files.map((f) => f.name).join(', ')}.`)
  if (i.notes.length) lines.push('', `Your latest note: "${i.notes[i.notes.length - 1]}"`)
  return { summary: last ? `Finished ${i.task.name.toLowerCase()} (practice text).` : `${i.step} done (practice text).`, content: lines.join('\n'), concern: null }
}

export function practiceReview(i: ReviewIn): ReviewOut {
  return {
    verdict: 'changes',
    summary: 'One claim has no source (practice review).',
    issues: [{ quote: i.work.name, problem: 'In practice mode the Reviewer always finds one thing, so you can try a disagreement.', fix: 'Send it back to be revised, or keep it as it is.' }],
    report: `## Review of ${i.work.name}\n\n${NOTE}\n\nThe Reviewer would list what it checked here, with each problem and its fix.`,
  }
}
