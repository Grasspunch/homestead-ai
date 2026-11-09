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

  'eng-standup-notes/2026-02-03.md': `# Eng standup, Feb 3 (Priya's crew, Auth SDK v2)
- Auth SDK dependency (upstream OIDC library) slips two weeks.
- v2 release moves to March 26. Release v2.0 plot blocked until then.
- Load tests green.`,

  'pilot-customers.csv': `company,contacts
Acme,12
Northwind,9
Globex,7
Initech,6
Umbrella Health,5
Hooli,3`,
}
