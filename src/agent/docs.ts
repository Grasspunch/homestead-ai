// Synthetic source documents. The agents read these; the demo never types a conclusion
// the model is supposed to reach. Shared by the browser (for display) and the API (as model input).

export const DOCS: Record<string, string> = {
  'product-brief-relay-v2.pdf': `Relay v2: product brief (excerpt)

What ships
- Faster sync: changes reach every open copy of a doc sooner. Internal testing suggests up to 3x faster sync.
- Single sign-on through the new Auth SDK (Okta, Google Workspace, Entra ID).
- Admin audit log export.

Audience: the 6 pilot customers first, everyone else a month later.
Tone: plain, specific, no hype words.`,

  'customer-call-notes.md': `# Pilot customer calls

## Jan 28: Acme (ops lead, 3 PMs)
- Biggest pain: "which version is this?" in every standup.
- We told Acme they would have v2 by March 12.
- OK to quote the ops lead by role, not by name.

## Feb 1: Northwind (IT admin)
- Needs SSO before rolling out to 400 seats.`,

  'benchmarks-q4.xlsx': `Sheet: sync latency, Q4 run (p50, seconds)
row 12 | open doc       | v1 0.8 | v2 0.7
row 13 | first edit     | v1 1.1 | v2 0.6
row 14 | sync to peers  | v1 1.9 | v2 0.6   (3.2x faster)
row 15 | large doc load | v1 4.2 | v2 3.9`,

  'brand-voice.md': `# Brand voice (almanac page from the brand team)
- Lead with what changes for the reader.
- Numbers need a source.
- No "revolutionary", "game-changing", "seamless".`,

  'eng-standup-notes/2026-01-20.md': `# Eng standup, Jan 20 (platform team, Auth SDK v2)
- Relay v2 on track for March 12.
- OIDC library upgrade starts this week; risk is the upstream release.
- Kai on call until Jan 27.`,

  'eng-standup-notes/2026-02-03.md': `# Eng standup, Feb 3 (platform team, Auth SDK v2)
- Auth SDK dependency (upstream OIDC library) slips two weeks.
- v2 release moves to March 26. Release v2.0 plot blocked until then.
- Load tests green.`,

  'auth-sdk/release-checklist.md': `# Release v2.0 checklist (Auth SDK v2)
- [x] Load tests green
- [x] Okta and Google Workspace sign-in verified
- [ ] Entra ID sign-in verified (waits on OIDC library 4.2)
- [ ] Security review sign-off
Release date: see the latest standup notes.`,

  'auth-sdk/oncall-rota.md': `# On-call rota, March
- March 2 to March 8: Kai
- March 9 to March 15: platform team
- March 16 to March 22: Dev
- March 23 to March 29: Kai (release week)`,

  'auth-sdk/api-changelog.md': `# Auth SDK changelog
## 2.0.0-rc.3 (Feb 2)
- Entra ID provider behind a flag.
## 2.0.0-rc.2 (Jan 19)
- Session refresh is now silent.`,

  'pilot-customers.csv': `company,contacts
Acme,12
Northwind,9
Globex,7
Initech,6
Umbrella Health,5
Hooli,3`,
}

// What the neighbouring farm (the platform team's Auth SDK crew) shares with other farms.
export const NEIGHBOUR_DOCS = [
  'eng-standup-notes/2026-01-20.md',
  'eng-standup-notes/2026-02-03.md',
  'auth-sdk/release-checklist.md',
  'auth-sdk/oncall-rota.md',
  'auth-sdk/api-changelog.md',
]

// A signpost can be a single file or a folder; a folder expands to every document inside it.
export function expandSignposts(names: string[]) {
  const out: string[] = []
  for (const n of names) {
    const hits = n.endsWith('/') ? Object.keys(DOCS).filter((k) => k.startsWith(n)) : DOCS[n] ? [n] : []
    for (const h of hits) if (!out.includes(h)) out.push(h)
  }
  return out
}
