import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Local stand-in for the server route on Lovable: POST /api/agent runs the same prompts (src/agent/agents.ts).
// With LOVABLE_API_KEY in .env.local every model goes through Lovable's AI gateway, as on Lovable, and out of credits
// falls back to ANTHROPIC_API_KEY or OPENAI_API_KEY. Without it, those keys are used directly.
// GET says which models can run live, yes or no, never a key.
function agentApi(): Plugin {
  return {
    name: 'homestead-agent-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      server.middlewares.use('/api/agent', async (req, res) => {
        const lovable = env.LOVABLE_API_KEY || process.env.LOVABLE_API_KEY
        const anthropic = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
        const openai = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET')
          return res.end(JSON.stringify({ live: !!(lovable || anthropic || openai), gateway: !!lovable, keys: { anthropic: !!(lovable || anthropic), openai: !!(lovable || openai) }, own: { anthropic: !!anthropic, openai: !!openai } }))
        const { runAgent, errorReply } = await server.ssrLoadModule('/src/agent/agents.ts')
        try {
          let body = ''
          for await (const chunk of req) body += chunk
          const { task, input } = JSON.parse(body)
          let claude
          if (anthropic) {
            const { default: Anthropic } = await import('@anthropic-ai/sdk')
            claude = new Anthropic({ apiKey: anthropic })
          }
          res.end(JSON.stringify(await runAgent({ gateway: lovable ? { key: lovable } : undefined, claude, openai: openai ? { key: openai } : undefined }, task, input)))
        } catch (e) {
          const r = errorReply(e)
          res.statusCode = r.status
          res.end(JSON.stringify(r.body))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), agentApi()],
})
