// Records a live plan for each demo goal into src/run/recorded-plans.json, so a live demo whose call fails on the
// day still shows a real plan, tagged "Planned live earlier". Run it against a server that can call the Planner:
//   npx vite --port 5173 &   (with LOVABLE_API_KEY or ANTHROPIC_API_KEY in .env.local)
//   node scripts/record-plans.mjs http://localhost:5173/api/agent
// or against the published app's /api/agent. One plan call per goal; a goal that fails keeps its old entry.
import { readFileSync, writeFileSync } from 'node:fs'

const endpoint = process.argv[2]
if (!endpoint) {
  console.error('Usage: node scripts/record-plans.mjs <url of /api/agent>')
  process.exit(1)
}
const SOURCE = { lovable: 'Lovable AI', anthropic: 'your Anthropic key', openai: 'your OpenAI key' }
const file = new URL('../src/run/recorded-plans.json', import.meta.url)
const data = JSON.parse(readFileSync(file, 'utf8'))
for (const goal of data.goals) {
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'plan', input: { goal } }) })
    const body = await res.json()
    if (!res.ok || !body.data) throw new Error(body.error ?? `HTTP ${res.status}`)
    data.plans[goal] = { plan: body.data, at: new Date().toISOString(), source: SOURCE[body.source] ?? body.source, model: body.model }
    console.log(`ok  ${goal.slice(0, 60)}  (${body.tokens ?? '?'} tokens)`)
  } catch (e) {
    console.error(`err ${goal.slice(0, 60)}: ${e.message}`)
  }
}
writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
