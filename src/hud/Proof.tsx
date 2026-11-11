// What a check rests on, shown rather than described: the test run, the screenshots, the rollout's numbers.
import { useEffect, useRef, type CSSProperties } from 'react'
import type { Proof, RunState, Screen, Shot, TaskState, TestResult } from '../run/types'
import { Rollout } from './Rollout'
import { Mark } from './bits'

export function Tests({ tests, kind }: { tests: TestResult[]; kind: 'unit' | 'integration' }) {
  const failed = tests.filter((t) => !t.pass)
  return (
    <div className="tests">
      <div className="tests-head">
        <span className={failed.length ? 'bad' : 'ok'}>
          <b>{tests.length - failed.length}</b> of {tests.length} {kind === 'integration' ? 'end-to-end runs' : 'tests'} pass
        </span>
        <span className="mono">{(tests.reduce((s, t) => s + t.ms, 0) / 1000).toFixed(1)} s</span>
      </div>
      <ol className="tests-list">
        {[...failed, ...tests.filter((t) => t.pass)].map((t) => (
          <li key={t.name} className={t.pass ? '' : 'fail'}>
            <Mark pass={t.pass} />
            <span className="grow">
              {t.name}
              {t.error && <span className="mono err">{t.error}</span>}
            </span>
            <span className="mono ms">{t.ms} ms</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// A screenshot of the screen the crew built, drawn here as a small mock of the product.
// Real screenshots of the built screen, cropped to what the check is about. A failed check rings the broken part.
const RING: Record<Screen, { x: number; y: number; w: number; h: number }> = {
  chat: { x: 0.068, y: 0.599, w: 0.864, h: 0.3125 },
  app: { x: 0.029, y: 0.845, w: 0.943, h: 0.117 },
  dash: { x: 0.057, y: 0.466, w: 0.336, h: 0.335 },
}

export function Screens({ shots, chat, screen, note, thumb = false }: { shots: Shot[]; chat: boolean; screen?: Screen; note?: string; thumb?: boolean }) {
  const shot = shots[shots.length - 1]
  if (!shot) return null
  const kind: Screen = screen ?? (chat ? 'chat' : 'app')
  const bad = shot.state === 'overlap'
  const r = RING[kind]
  return (
    <figure className={`shot ${kind}${thumb ? ' thumb' : ''}`}>
      <span className="shot-img">
        <img src={`/proof/${kind}-${shot.state}${thumb ? '-thumb' : ''}.png`} alt={bad ? `Screenshot: ${note ?? 'the broken part is ringed'}` : 'Screenshot of the built screen'} />
        {bad && <i className="ring" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />}
      </span>
      {!thumb && bad && note && <figcaption className="bad">{note}</figcaption>}
    </figure>
  )
}

export function ProofView({ proof, chat, note }: { proof: Proof; chat: boolean; note?: string }) {
  if (proof.kind === 'screens' && proof.shots) return <Screens shots={proof.shots} chat={chat} screen={proof.screen} note={note} />
  if (proof.tests) return <Tests tests={proof.tests} kind={proof.kind === 'integration' ? 'integration' : 'unit'} />
  return null
}

// The rollout chart lives in its own file; Side and the dialogue import it from here.
export { Rollout } from './Rollout'

type Check = TaskState['checks'][number]

const WHO: Record<string, string> = { planner: 'Planner', builder: 'Builder', designer: 'Designer', tester: 'Tester', deployer: 'Deployer' }


// A check that just happened, popped over its plot: the test seeds, the screenshots or the live line.
// It leads with the task and how it came out, then the proof, and last who checked it.
export function ProofPop({ check, task, state, style, onOpen, size }: { check: Check; task: string; state: RunState; style: CSSProperties; onOpen: () => void; size?: number }) {
  const pr = check.proof
  const chat = /support|assistant|chat/i.test(state.goal)
  const tests = pr?.tests ?? []
  const failed = tests.filter((x) => !x.pass)
  // Never under the top bar: as the camera moves, push the pop down so its top stays at least 80px from the window's.
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let raf = 0
    let dy = 0
    const tick = () => {
      const el = ref.current
      if (el) {
        const top = el.getBoundingClientRect().top - dy
        const next = Math.max(0, 80 - top)
        if (next !== dy) {
          dy = next
          el.style.marginTop = `${dy}px`
          if (dy > 0) el.removeAttribute('data-tail')
          else el.setAttribute('data-tail', 'down')
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <button
      ref={ref}
      className={`proof-pop paper bubble${check.pass ? '' : ' bad'}${size ? ` s${size}` : ''}`}
      data-tail="down"
      style={style}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      onPointerUp={(e) => e.stopPropagation()}
      aria-label={`${task}: ${check.pass ? 'done' : 'failed'}. ${check.notes}. Checked by the ${WHO[check.by]}.`}
    >
      <span className="pp-head">
        <b className="pp-task">{task}</b>
        <span className={`tag ${check.pass ? 'green' : 'red'}`}>{check.pass ? 'Done' : 'Failed'}</span>
      </span>
      {pr?.kind === 'screens' && pr.shots ? (
        <span className="pp-shot-row">
          <Screens shots={pr.shots} chat={chat} screen={pr.screen} thumb />
          <span className="pp-line">{check.notes}</span>
        </span>
      ) : pr?.kind === 'rollout' ? (
        <span className="pp-roll">
          <Rollout state={state} size="pop" />
        </span>
      ) : tests.length ? (
        <>
          <span className="seeds" aria-hidden>
            {tests.map((x, i) => (
              <i key={x.name} className={x.pass ? "ok" : "bad"} style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </span>
          <span className="pp-line">
            {failed.length ? (
              <span className="mono bad">{failed[0].error ?? failed[0].name}</span>
            ) : (
              <>
                {tests.length} of {tests.length} {pr?.kind === 'integration' ? 'end-to-end runs' : 'tests'} pass
              </>
            )}
          </span>
        </>
      ) : (
        <span className="pp-line">{check.notes}</span>
      )}
      <span className="pp-by">Checked by the {WHO[check.by]}</span>
    </button>
  )
}
