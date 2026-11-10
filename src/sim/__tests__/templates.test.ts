import { describe, expect, it } from 'vitest'
import { AGENT_TEMPLATES, DEFAULT_TEAM, TEAM_TEMPLATES, UPSTREAM, agentFile, agentTemplate, fieldsFor, teamFile, teamPath } from '../templates'
import { ROLE_ORDER } from '../scenario'
import { freshEngine } from './helpers'

describe('Agent and team templates', () => {
  it('every team member and every staffed role resolves to an agent template', () => {
    for (const t of TEAM_TEMPLATES) {
      for (const m of t.members) expect(agentTemplate(m.agent), `${t.name}: ${m.agent}`).toBeDefined()
      for (const [r, id] of Object.entries(t.staffs)) expect(agentTemplate(id), `${t.name} staffs ${r}`).toBeDefined()
    }
    // The default crew staffs every role in the engine's crew.
    const def = TEAM_TEMPLATES.find((t) => t.id === DEFAULT_TEAM)!
    for (const r of ROLE_ORDER) expect(def.staffs[r], `default crew staffs ${r}`).toBeDefined()
  })

  it('agent template ids are unique and each file has settings on top and instructions below', () => {
    expect(new Set(AGENT_TEMPLATES.map((a) => a.id)).size).toBe(AGENT_TEMPLATES.length)
    for (const a of AGENT_TEMPLATES) {
      const f = agentFile(a)
      expect(f.startsWith('+++')).toBe(true)
      expect(f.trim().endsWith(a.instructions)).toBe(true)
    }
  })

  it('the four built-in crews, with the Feature crew as the default', () => {
    expect(TEAM_TEMPLATES.map((t) => t.name)).toEqual(['Feature crew', 'Full-cycle crew', 'Bug fix', 'Design pass'])
    expect(DEFAULT_TEAM).toBe('feature')
    const e = freshEngine()
    expect(e.crew).toBe(DEFAULT_TEAM)
    expect(e.team.name).toBe('Feature crew')
  })

  it('the full-cycle crew names its upstream pack only in its line, file name and licence notice', () => {
    const t = TEAM_TEMPLATES.find((x) => x.id === 'gstack')!
    expect(t.line).toContain('Based on gstack.')
    expect(teamPath(t)).toBe('.homestead/teams/gstack.toml')
    expect(teamFile(t)).toContain(UPSTREAM.notice)
    expect(t.name).not.toMatch(/gstack/i)
    for (const m of t.members) expect(agentTemplate(m.agent)!.name).not.toMatch(/gstack/i)
  })

  it('choosing a crew in the Brief updates the Crew row, and it locks once the work starts', () => {
    const e = freshEngine()
    e.setCrew('gstack')
    expect(e.team.name).toBe('Full-cycle crew')
    e.setCrew('no-such-crew')
    expect(e.crew).toBe('gstack')
    e.setCrew(DEFAULT_TEAM)
    expect(e.team.name).toBe('Feature crew')
    e.phase = 'grow'
    e.setCrew('bug-fix')
    expect(e.crew).toBe(DEFAULT_TEAM)
  })

  it('every agent with a task gets a field, and Settings lists the whole crew', () => {
    for (const id of ['feature', 'gstack', 'bug-fix', 'design-pass']) {
      const e = freshEngine()
      e.setCrew(id)
      e.relayout()
      const agents = new Set(e.team.members.map((m) => m.agent).filter((a) => a !== 'head-farmer'))
      const busy = new Set(e.tasks.map((t) => e.team.staffs[t.assignee]))
      expect(new Set(e.fields.map((f) => f.id)), id).toEqual(new Set([...agents].filter((a) => busy.has(a))))
      expect(e.crewAgentKeys.length, id).toBe(agents.size + 1)
      for (const k of e.crewAgentKeys) expect(e.settings.agents[k], `${id} ${k}`).toBeDefined()
    }
  })

  it('saving the crew adds a team template that can be picked', () => {
    const e = freshEngine()
    const t = e.saveCrewAsTemplate()
    expect(e.customTeams).toHaveLength(1)
    const name = `${e.questTitle} crew`
    expect(t.name).toBe(name)
    expect(teamPath(t)).toBe(`.homestead/teams/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.toml`)
    e.setCrew(t.id)
    expect(e.team.name).toBe(name)
  })

  it('a team is a valley layout: its fields in order, each with a style', () => {
    const feature = fieldsFor('feature')
    // The demo's valley: a field for every agent but the head farmer, who works from the farmstead.
    expect(feature.map((f) => f.agent.name)).toEqual(['Frontend', 'Backend', 'Messaging', 'Tests', 'Reviewer'])
    expect(feature.map((f) => f.index)).toEqual([0, 1, 2, 3, 4])
    const full = TEAM_TEMPLATES.find((t) => t.id === 'gstack')!
    expect(fieldsFor('gstack')).toHaveLength(full.members.length - 1)
    for (const a of AGENT_TEMPLATES) {
      expect(a.style.fence).toMatch(/^#[0-9a-f]{6}$/)
      expect(a.style.body).toMatch(/^#[0-9a-f]{6}$/)
      expect(['wheat', 'carrot', 'cabbage', 'tulip', 'pumpkin']).toContain(a.style.crop)
    }
    expect(fieldsFor('no-such-team').map((f) => f.agent.id)).toEqual(['frontend', 'backend', 'messaging', 'tests', 'reviewer'])
  })
})
