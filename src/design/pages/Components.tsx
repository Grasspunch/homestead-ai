import { useState, type ReactNode } from 'react'
import {
  AskCard,
  Button,
  Checkbox,
  Choice,
  CrewRow,
  Emoji,
  EMOJI_NAMES,
  Energy,
  Field,
  HoldButton,
  Kbd,
  Progress,
  ReasonLabel,
  REASONS,
  Row,
  Rows,
  StepBar,
  TextArea,
  TextInput,
  Tip,
  Toggle,
  UiIcon,
  UI_ICON_NAMES,
  type Reason,
} from '../../ds'
import { Code, PageHead, Section } from '../Doc'

function Spec({ title, children, code }: { title?: string; children: ReactNode; code?: string }) {
  return (
    <div className="cmp-spec">
      {title && <h3>{title}</h3>}
      <div className="cmp-stage">{children}</div>
      {code && <pre className="cmp-code">{code}</pre>}
    </div>
  )
}

export function ComponentsPage(_: { arg?: string }) {
  const [pick, setPick] = useState('1')
  const [chime, setChime] = useState(true)
  const [roll, setRoll] = useState(false)
  const [deployed, setDeployed] = useState(0)

  return (
    <>
      <PageHead title="Controls">
        The panel’s parts, each with every state. Import them from <Code>src/ds</Code>; the app’s remake uses these and nothing
        hand-rolled.
      </PageHead>

      <Section title="Button" note="Sprout for the one main action on a screen. Out (blue) only when the action reaches people outside: deploy, send. Plain for the rest, quiet inside rows.">
        <Spec code={`<Button kind="sprout" keycap="↵">Approve plan</Button>`}>
          <div className="cmp-row">
            <Button kind="sprout">Approve plan</Button>
            <Button kind="out">Deploy to production</Button>
            <Button>Send back</Button>
            <Button kind="quiet">Later</Button>
          </div>
        </Spec>
        <Spec title="States">
          <div className="cmp-states">
            {(['sprout', 'plain'] as const).map((k) => (
              <div key={k} className="cmp-row">
                <Button kind={k}>Default</Button>
                <Button kind={k} className="is-hover">
                  Hover
                </Button>
                <Button kind={k} className="is-active">
                  Pressed
                </Button>
                <Button kind={k} className="is-focus">
                  Focus
                </Button>
                <Button kind={k} busy>
                  Planting
                </Button>
                <Button kind={k} disabled>
                  Disabled
                </Button>
              </div>
            ))}
          </div>
        </Spec>
        <Spec title="Small, with keycap">
          <div className="cmp-row">
            <Button size="sm">Open file</Button>
            <Button kind="sprout" size="sm" keycap="↵">
              Answer
            </Button>
            <Button kind="quiet" size="sm">
              Show all 14
            </Button>
          </div>
        </Spec>
        <Spec title="Press and hold" code={`<HoldButton onHold={deploy}>Hold to deploy</HoldButton>`}>
          <div className="cmp-row">
            <HoldButton onHold={() => setDeployed((n) => n + 1)}>Hold to deploy</HoldButton>
            <span className="cmp-small">
              {deployed ? `Deployed ${deployed} time${deployed > 1 ? 's' : ''}` : 'For outbound acts that can’t be undone. Letting go early cancels.'}
            </span>
          </div>
        </Spec>
      </Section>

      <Section title="Ask card" note="The one raised object on screen: whatever needs you now. The reason leads, then the question in one line, then the options with number keys. The reasoning folds under “Why it’s asking”.">
        <Spec>
          <div className="cmp-ask">
            <AskCard
              reason="anomaly"
              who="Backend, task 2 of 4"
              question="Use the /v2 session endpoint instead of /v1?"
              why={
                <p>
                  The API docs from March say sessions moved to <code className="ds-code">/v2</code>. The plan assumed /v1. Confidence 0.62.
                </p>
              }
              onDismiss={() => {}}
            >
              <Choice keycap="1" title="Use /v2" detail="Matches the March docs. Two files change." selected={pick === '1'} onClick={() => setPick('1')} />
              <Choice keycap="2" title="Keep /v1 and add a shim" detail="What the plan assumed" assumed={pick !== '2'} selected={pick === '2'} onClick={() => setPick('2')} />
              <div className="cmp-row" style={{ marginTop: 8 }}>
                <Button kind="sprout" keycap="↵">
                  Answer
                </Button>
                <Button kind="quiet">Reply instead</Button>
              </div>
            </AskCard>
            <AskCard reason="outbound" who="Release, Harvest" question="Deploy web-app v4.18.0 to production for 12,400 users?">
              <p className="cmp-small">5% canary for 10 minutes, then everyone. Rolls back on its own if sign-in success drops under 99%.</p>
              <div className="cmp-row">
                <Button kind="out">Deploy</Button>
                <Button kind="quiet">Not yet</Button>
              </div>
            </AskCard>
          </div>
        </Spec>
        <Spec title="Reasons" code={`<ReasonLabel reason="failure" />`}>
          <ul className="cmp-reasons">
            {(Object.keys(REASONS) as Reason[]).map((r) => (
              <li key={r}>
                <ReasonLabel reason={r} />
                <span>{REASONS[r].means}</span>
              </li>
            ))}
          </ul>
        </Spec>
      </Section>

      <Section title="Choices" note="Options in an ask. Picked takes the sprout face. The default the agent assumed has a dashed line until you pick, so you can see what happens if you don’t.">
        <Spec>
          <div className="cmp-col" style={{ maxWidth: 420 }}>
            <Choice keycap="1" title="Selected" detail="The sprout face and line" selected />
            <Choice keycap="2" title="Assumed default" detail="Dashed until you choose" assumed />
            <Choice keycap="3" title="Other option" detail="Plain" />
          </div>
        </Spec>
      </Section>

      <Section title="Checkbox and switch" note="Drawn on the farm’s 3px pixel, like the buttons. The switch knob steps across in three frames. A done-when check can’t be ticked until its evidence is in.">
        <Spec>
          <div className="cmp-col" style={{ maxWidth: 420 }}>
            <Checkbox label="Unit tests pass" hint="42 passed in 3.1s" defaultChecked />
            <Checkbox label="Screenshots match the design" hint="Waiting on the QA farmhand" />
            <Checkbox label="Security review" hint="Blocked: no reviewer on this crew" disabled />
            <Toggle label="Chime when an agent asks" checked={chime} onChange={setChime} />
            <Toggle label="Roll back on its own when a check fails" hint="Only restores what was there" checked={roll} onChange={setRoll} />
          </div>
        </Spec>
      </Section>

      <Section title="Text fields" note="A sunk white well with the pixel line. The line turns blue when focused and red with an error. A plain label above; never a placeholder as the label.">
        <Spec>
          <div className="cmp-col cmp-fields" style={{ maxWidth: 480 }}>
            <Field label="Goal" hint="One sentence. The head farmer asks if anything is unclear.">
              {(id) => <TextArea id={id} defaultValue="Add Google sign-in to the web app, behind a flag, with tests." />}
            </Field>
            <Field label="Budget">{(id) => <TextInput id={id} defaultValue="120k tokens" />}</Field>
            <Field label="Reply to Backend" error="Write a reply or pick an option.">
              {(id) => <TextInput id={id} placeholder="Tell the agent what to do" />}
            </Field>
          </div>
        </Spec>
      </Section>

      <Section title="Step bar" note="Plant, Grow, Harvest. A done step opens its read-only review, so you can always go back and look.">
        <Spec>
          <StepBar
            steps={[
              { id: 'plant', label: 'Plant', state: 'done' },
              { id: 'grow', label: 'Grow', state: 'now' },
              { id: 'harvest', label: 'Harvest', state: 'next' },
            ]}
            onOpen={() => {}}
          />
        </Spec>
      </Section>

      <Section title="Rows" note="Lists are ruled, never boxed. Needs you sorts first, then working, then done. A row moves only when its state changes.">
        <Spec>
          <div style={{ maxWidth: 440 }}>
            <Rows label="Crew">
              <CrewRow role="Tests" body="#e8b5ac" shade="#d99a9a" state="needs" detail="Looks wrong: /v1 or /v2?" onClick={() => {}} />
              <CrewRow role="Frontend" body="#9bd4c3" shade="#82a884" state="working" detail="Sign-in button, 2 of 3" onClick={() => {}} />
              <CrewRow role="Backend" body="#a09dd4" shade="#867fb8" state="working" detail="Session handler" onClick={() => {}} />
              <CrewRow role="Docs" body="#f2cf8c" shade="#d79e61" state="done" detail="Setup guide written" onClick={() => {}} />
            </Rows>
          </div>
        </Spec>
        <Spec title="File and skill rows">
          <div style={{ maxWidth: 440 }}>
            <Rows>
              <Row lead={<UiIcon name="note" size={32} />} title={<span className="cmp-mono">src/auth/session.ts</span>} detail="Owned by Platform, updated today" trail="2.1k" onClick={() => {}} selected />
              <Row lead={<UiIcon name="gear" size={32} />} title="Write tests first" detail="Skill, used by Tests" trail="640" onClick={() => {}} />
            </Rows>
          </div>
        </Spec>
      </Section>

      <Section title="Meters" note="Energy is chunky pixel ticks: green ticks are what’s left. Low energy is never red, because red means failure.">
        <Spec>
          <div className="cmp-col">
            <Energy used={38} total={100} />
            <Energy used={92} total={100} />
            <div style={{ width: 240 }}>
              <Progress value={2} of={3} />
            </div>
            <div style={{ width: 240 }}>
              <Progress value={3} of={5} tone="fail" />
            </div>
          </div>
        </Spec>
      </Section>

      <Section title="Keycaps and tips">
        <Spec>
          <div className="cmp-row">
            <Kbd>1</Kbd>
            <Kbd>↵</Kbd>
            <Kbd>Esc</Kbd>
            <Kbd>Tab</Kbd>
            <span>
              A farm word with its plain meaning: <Tip tip="An agent working one task">farmhand</Tip>
            </span>
          </div>
        </Spec>
      </Section>

      <Section title="Icons" note="Two families, each at whole multiples of its own size. 16px UI icons for the panel (16, 32, 48). 32px emoji for status and the farm (32, 64). The app used to shrink emoji to 16px, which smears them.">
        <Spec title="UI icons, 16px at 2x">
          <div className="cmp-icons">
            {UI_ICON_NAMES.map((n) => (
              <span key={n} title={n}>
                <UiIcon name={n} size={32} />
                <small>{n}</small>
              </span>
            ))}
          </div>
        </Spec>
        <Spec title="Emoji, 32px at 1x">
          <div className="cmp-icons">
            {EMOJI_NAMES.map((n) => (
              <span key={n} title={n}>
                <Emoji name={n} />
                <small>{n}</small>
              </span>
            ))}
          </div>
        </Spec>
      </Section>
    </>
  )
}
