import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Choice, Farmhand, Kbd, Plot, Portrait, Row, Rows, Seed, Sprite, StepBar, TextArea, type GlyphState } from '../../ds'
import '../plant.css'
import { PageHead, Rule, Rules, Section } from '../Doc'
import { Stage } from '../Stage'

/* The Plant step's questions: what the head farmer asks before anything is planted. A working demo on
   the library's own controls, so the team can try the flow before the app's panel is rebuilt with it. */

type Opt = { title: string; detail: string }
type Q = { id: string; q: string; why: ReactNode; options: Opt[]; crop: string }

const QUESTIONS: Q[] = [
  {
    id: 'email',
    q: 'Keep email and password sign-in?',
    why: (
      <>
        <code className="ds-code">auth-spec.md</code> shows both on one page, but doesn’t say whether email sign-in stays.
      </>
    ),
    options: [
      { title: 'Yes, keep both', detail: 'Google goes beside it. Nothing is taken away.' },
      { title: 'No, Google only', detail: 'Email accounts get a one-time link to move over.' },
    ],
    crop: 'carrot',
  },
  {
    id: 'rollout',
    q: 'Who gets it first?',
    why: <>Friday’s deploy reaches every user unless it goes behind a flag.</>,
    options: [
      { title: 'Staff first, behind a flag', detail: 'Backend adds the flag. Everyone else gets it a week later.' },
      { title: 'Everyone, in Friday’s deploy', detail: 'No flag. Rolls back on its own if sign-in drops.' },
    ],
    crop: 'cabbage',
  },
  {
    id: 'landing',
    q: 'Where does sign-in take people?',
    why: (
      <>
        The brief says “back where they were”, but <code className="ds-code">routes.ts</code> always sends them to the dashboard.
      </>
    ),
    options: [
      { title: 'Back to the page they were on', detail: 'Backend adds a return path. One more step in its plot.' },
      { title: 'The dashboard', detail: 'What routes.ts does today' },
    ],
    crop: 'wheat',
  },
]

const OWN = 'own'
type Phase = 'reading' | 'asking' | 'planning'

// One tilled bed, before anything is sown in it.
function Bed({ cols = 3, rows = 2 }: { cols?: number; rows?: number }) {
  const tiles: ReactNode[] = []
  for (let y = 0; y < rows + 2; y++)
    for (let x = 0; x < cols + 2; x++) {
      const cx = x === 0 ? 0 : x === cols + 1 ? 2 : 1
      const cy = y === 0 ? 0 : y === rows + 1 ? 2 : 1
      tiles.push(<Sprite key={`${x}-${y}`} name={`bed_dry_${cx}${cy}`} scale={3} style={{ position: 'absolute', left: x * 48, top: y * 48 }} />)
    }
  return (
    <span className="hs-plot" style={{ width: (cols + 2) * 48, height: (rows + 2) * 48 }}>
      {tiles}
    </span>
  )
}

/* Progress without a count: one patch of soil per question. A question you answered has sprouted. */
function SeedRow({ answered, current, onOpen }: { answered: Record<string, string>; current: number | null; onOpen?: (i: number) => void }) {
  return (
    <ol className="pl-seeds" aria-label="Questions">
      {QUESTIONS.map((q, i) => {
        const done = !!answered[q.id]
        const label = `${q.q} ${done ? 'Answered' : i === current ? 'Asking now' : 'Not answered yet'}`
        return (
          <li key={q.id} className={i === current ? 'now' : ''}>
            <button type="button" aria-label={label} title={q.q} onClick={() => onOpen?.(i)} disabled={!onOpen}>
              <Sprite name="bed_dry_11" scale={3} />
              {done && <Sprite name={`crop_${q.crop}_1`} scale={3} />}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function answerText(a: string | undefined) {
  if (!a) return undefined
  return a.startsWith(`${OWN}:`) ? `“${a.slice(OWN.length + 1)}”` : a
}

function Status({ title, detail, busy }: { title: ReactNode; detail: ReactNode; busy?: boolean }) {
  return (
    <header className="pl-status">
      <Portrait body="#c0d470" shade="#8db15d" size={40} />
      <div>
        <b>{title}</b>
        <small>
          {busy && <Seed />}
          {detail}
        </small>
      </div>
    </header>
  )
}

const STEPS = [
  { id: 'plant', label: 'Plant', state: 'now' as const },
  { id: 'grow', label: 'Grow', state: 'next' as const },
  { id: 'harvest', label: 'Harvest', state: 'next' as const },
]

function Panel({
  phase,
  answers,
  open,
  writing,
  draft,
  onPick,
  onOpen,
  onWrite,
  onDraft,
  onSkip,
  onContinue,
}: {
  phase: Phase
  answers: Record<string, string>
  open: number | null
  writing: boolean
  draft: string
  onPick: (q: Q, value: string) => void
  onOpen: (i: number) => void
  onWrite: (on: boolean) => void
  onDraft: (v: string) => void
  onSkip: () => void
  onContinue: () => void
}) {
  const firstOpen = QUESTIONS.findIndex((q) => !answers[q.id])
  const cur = open ?? (firstOpen >= 0 ? firstOpen : null)
  const q = cur === null ? null : QUESTIONS[cur]

  const onKey = (ev: KeyboardEvent) => {
    if (phase !== 'asking' || ev.target instanceof HTMLTextAreaElement) return
    if (q && ['1', '2'].includes(ev.key)) {
      ev.preventDefault()
      onPick(q, q.options[Number(ev.key) - 1].title)
    } else if (q && ev.key === '3') {
      ev.preventDefault()
      onWrite(true)
    } else if (!q && ev.key === 'Enter') {
      ev.preventDefault()
      onContinue()
    }
  }

  return (
    <div className="pl-panel" onKeyDown={onKey}>
      <StepBar steps={STEPS} />

      {phase === 'reading' && <Status busy title="The head farmer is reading your brief" detail="Your goal and 6 files, skills and tools" />}

      {phase === 'planning' && (
        <>
          <Status busy title="The head farmer is planning" detail="Laying out plots from your answers" />
          <SeedRow answered={answers} current={null} />
          <Rows label="Your answers">
            {QUESTIONS.map((x) => (
              <Row key={x.id} title={x.q} detail={answerText(answers[x.id])} />
            ))}
          </Rows>
        </>
      )}

      {phase === 'asking' && (
        <>
          <Status
            title={q ? 'The head farmer has a few questions' : 'Answered. Ready to plan.'}
            detail={q ? 'Nothing is planted until you’re done.' : 'You can still change an answer.'}
          />
          <SeedRow answered={answers} current={cur} onOpen={onOpen} />

          {q && (
            <section className="pl-q" aria-label="Question" key={q.id}>
              <h3>{q.q}</h3>
              <p className="pl-why">{q.why}</p>
              <div className="pl-opts">
                {q.options.map((o, i) => (
                  <Choice
                    key={o.title}
                    keycap={String(i + 1)}
                    title={o.title}
                    detail={o.detail}
                    selected={answers[q.id] === o.title}
                    assumed={i === 0 && !answers[q.id]}
                    onClick={() => onPick(q, o.title)}
                  />
                ))}
                {writing ? (
                  <form
                    className="pl-own"
                    onSubmit={(ev) => {
                      ev.preventDefault()
                      if (draft.trim()) onPick(q, `${OWN}:${draft.trim()}`)
                    }}
                  >
                    <TextArea
                      autoFocus
                      rows={2}
                      value={draft}
                      placeholder="Say it your way"
                      aria-label="Your answer"
                      onChange={(ev) => onDraft(ev.target.value)}
                      onKeyDown={(ev) => {
                        // Enter answers, Shift+Enter starts a new line, Escape goes back to the options
                        if (ev.key === 'Enter' && !ev.shiftKey) {
                          ev.preventDefault()
                          ev.currentTarget.form?.requestSubmit()
                        } else if (ev.key === 'Escape') onWrite(false)
                      }}
                    />
                    <div className="pl-row">
                      <Button kind="sprout" size="sm" type="submit" keycap="↵" disabled={!draft.trim()}>
                        Answer
                      </Button>
                      <Button kind="quiet" size="sm" onClick={() => onWrite(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Choice keycap="3" title="Answer in my own words" onClick={() => onWrite(true)} />
                )}
              </div>
            </section>
          )}

          <Rows label="Questions">
            {QUESTIONS.map((x, i) =>
              i === cur ? null : (
                <Row
                  key={x.id}
                  title={x.q}
                  detail={answerText(answers[x.id]) ?? 'Not answered yet'}
                  trail={answers[x.id] ? <span className="pl-change">Change</span> : undefined}
                  onClick={() => onOpen(i)}
                />
              ),
            )}
          </Rows>

          <footer className="pl-foot">
            {q ? (
              <>
                <Button kind="quiet" size="sm" onClick={onSkip}>
                  Skip the rest
                </Button>
                <span className="pl-hint">Skipped questions keep the dashed answer.</span>
              </>
            ) : (
              <Button kind="sprout" keycap="↵" onClick={onContinue} className="pl-go">
                Plan the plots
              </Button>
            )}
          </footer>
        </>
      )}
    </div>
  )
}

function Field({ phase, answers }: { phase: Phase; answers: Record<string, string> }) {
  const glyph: GlyphState = phase === 'asking' ? { kind: 'ask', reason: 'anomaly' } : { kind: 'working' }
  const state = phase === 'reading' ? 'reading' : phase === 'asking' ? 'needs you' : 'planning'
  return (
    <Stage ground="grass" className="pl-field" pad={0}>
      <div className="pl-beds">
        {QUESTIONS.map((q) => (phase === 'planning' && answers[q.id] ? <Plot key={q.id} crop={q.crop} stage={0} cols={2} rows={1} /> : <Bed key={q.id} cols={2} rows={1} />))}
      </div>
      <div className="pl-head">
        <Farmhand glyph={glyph} role="Head farmer" state={state} frame={phase === 'planning' ? 'char_till_left_2' : 'char_idle_left_0'} />
      </div>
    </Stage>
  )
}

export function PlantPage(_: { arg?: string }) {
  const [phase, setPhase] = useState<Phase>('asking')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<number | null>(null)
  const [writing, setWriting] = useState(false)
  const [draft, setDraft] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const reset = (to: Phase) => {
    clearTimeout(timer.current)
    setAnswers({})
    setOpen(null)
    setWriting(false)
    setDraft('')
    setPhase(to)
    if (to === 'reading') timer.current = setTimeout(() => setPhase('asking'), 1800)
  }

  const pick = (q: Q, value: string) => {
    setAnswers((a) => ({ ...a, [q.id]: value }))
    setWriting(false)
    setDraft('')
    // Hold the pick on screen for a beat, then move to the next open question.
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(null), 220)
  }

  const skip = () => {
    setAnswers((a) => Object.fromEntries(QUESTIONS.map((q) => [q.id, a[q.id] ?? q.options[0].title])))
    setOpen(null)
    setWriting(false)
  }

  return (
    <>
      <PageHead title="Plant questions">
        Before anything is planted, the head farmer asks what the brief leaves open. The questions come one at a time in the panel, and
        the farm waits. Try it: click an option or press its number.
      </PageHead>

      <Section title="The flow" note="The field shows the head farmer waiting by the empty beds. The panel holds the question, and the seed row shows how many are left without a count. Answer them all and the beds are sown.">
        <div className="pl-tools">
          <Button size="sm" onClick={() => reset('reading')}>
            Start from the brief
          </Button>
          <Button kind="quiet" size="sm" onClick={() => reset('asking')}>
            Clear answers
          </Button>
        </div>
        <div className="pl-demo">
          <Field phase={phase} answers={answers} />
          <Panel
            phase={phase}
            answers={answers}
            open={open}
            writing={writing}
            draft={draft}
            onPick={pick}
            onOpen={(i) => {
              setOpen(i)
              setWriting(false)
            }}
            onWrite={setWriting}
            onDraft={setDraft}
            onSkip={skip}
            onContinue={() => setPhase('planning')}
          />
        </div>
      </Section>

      <Section title="How it asks" note="What holds for every question in the Plant step.">
        <Rules>
          <Rule>One question at a time. The ones you answered fold into rows you can reopen until Grow starts.</Rule>
          <Rule>
            The head farmer’s own pick is the first option, with a dashed edge until you choose. Skipping keeps it, so skipping is
            never a guess.
          </Rule>
          <Rule>Each question says why it’s asking, and names the file it read when there is one.</Rule>
          <Rule>
            Numbers pick, <Kbd>3</Kbd> writes your own answer, and <Kbd>↵</Kbd> moves on once everything is answered.
          </Rule>
          <Rule>Progress is the seed row, never a count. A question you answered has sprouted.</Rule>
          <Rule>The step stays Plant until you press Plan the plots. No farmhand starts work before then.</Rule>
        </Rules>
      </Section>
    </>
  )
}
