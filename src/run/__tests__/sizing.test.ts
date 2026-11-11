import { describe, expect, it } from 'vitest'
import { isSmallChange, simulatePlan } from '../simPlan'
import { simulateRun } from '../simulate'
import { reduce } from '../reduce'
import { crewInstruction } from '../../agent/agents'

const crewOf = (goal: string, size?: number | Parameters<typeof simulatePlan>[1]) => simulatePlan(goal, size).farmers.map((f) => f.id).sort()

const SMALL = [
  'Change the button text from Submit to Save',
  'Fix the typo on the pricing page',
  'Update the footer year to 2026',
  'Change the headline to “Grow faster”',
  'Make the sign up button green',
  'Rename the Settings tab to Preferences',
  'A one-liner: say Hello instead of Hi',
  'Fix the typo on the checkout page',
]
const NOT_SMALL = [
  'Build an AI support assistant that answers from our help docs',
  'Stripe checkout for our pricing page',
  'A dashboard of weekly signups',
  'Add a dark mode to the settings page',
  'Change the login to use magic links',
  'Update the API to return prices in cents',
  'Fix the text on every page',
]

describe('the Planner sizes the crew to the goal', () => {
  it('reads a one-line change as small, and real features as not', () => {
    for (const g of SMALL) expect(isSmallChange(g), g).toBe(true)
    for (const g of NOT_SMALL) expect(isSmallChange(g), g).toBe(false)
  })

  it('a small change is the Builder and a light check, then the release', () => {
    const p = simulatePlan('Change the button text from Submit to Save')
    expect(p.farmers.map((f) => f.id).sort()).toEqual(['builder', 'tester'])
    expect(p.tasks.map((t) => [t.id, t.farmer])).toEqual([
      ['change', 'builder'],
      ['e2e-check', 'tester'],
      ['ship', 'builder'],
    ])
    expect(p.tasks.find((t) => t.id === 'e2e-check')!.name).toBe('Check the change')
    // Minutes and a few dollars, not the price of a feature.
    expect(p.estimate.minutes).toBeLessThan(40)
    expect(p.estimate.usd).toBeLessThan(5)
    expect(simulatePlan('Build an AI support assistant that answers from our help docs').estimate.usd).toBeGreaterThan(p.estimate.usd * 3)
  })

  it('the bigger the work, the bigger the crew', () => {
    expect(crewOf('Fix the typo on the pricing page')).toEqual(['builder', 'tester'])
    // A feature with no screens: no Designer.
    expect(crewOf('Send a weekly email digest of new orders')).toEqual(['builder', 'deployer', 'planner', 'tester'])
    // A feature people see, and the scripted products: all five.
    for (const g of ['Add a dark mode to the settings page', 'Build an AI support assistant that answers from our help docs', 'Stripe checkout for our pricing page'])
      expect(crewOf(g), g).toEqual(['builder', 'deployer', 'designer', 'planner', 'tester'])
  })

  it('you can still add anyone back: the release goes to the Deployer once it is on the crew', () => {
    const p = simulatePlan('Fix the typo on the pricing page', ['builder', 'tester', 'deployer'])
    expect(p.farmers.map((f) => f.id)).toContain('deployer')
    expect(p.tasks.find((t) => t.gate)!.farmer).toBe('deployer')
    expect(crewOf('Fix the typo on the pricing page', 5)).toHaveLength(5)
  })

  it('a small change runs clean: no money ask, no failed check, no rollback, just your merge', () => {
    const goal = 'Change the button text from Submit to Save'
    const plan = simulatePlan(goal)
    const ev = simulateRun({ goal, ...plan })
    const asks = ev.filter((e) => e.type === 'ask')
    expect(asks.map((a) => a.type === 'ask' && a.reason)).toEqual(['irreversible'])
    expect(ev.some((e) => e.type === 'check' && !e.pass)).toBe(false)
    expect(ev.some((e) => e.type === 'deploy' && e.stage === 'rollback')).toBe(false)
    const s = reduce(ev, Number.MAX_SAFE_INTEGER, {})
    expect(s.done).toBeTruthy()
    expect(s.tasks.every((t) => t.status === 'accepted')).toBe(true)
  })

  it('live: the Planner is told to size the crew, not to fill it', () => {
    const say = crewInstruction()
    expect(say).toContain('Choose the team size from the goal')
    expect(say).toMatch(/small change.*Builder and the Tester only/)
  })
})
