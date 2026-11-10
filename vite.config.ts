import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Local stand-in for the server route on Lovable: POST /api/agent runs the same prompts (src/agent/agents.ts)
// with ANTHROPIC_API_KEY for Claude models and OPENAI_API_KEY for the Codex models, from .env.local.
// GET says which keys are set, yes or no, never their values.
function agentApi(): Plugin {
  return {
    name: 'homestead-agent-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      server.middlewares.use('/api/agent', async (req, res) => {
        const anthropic = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
        const openai = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET') return res.end(JSON.stringify({ live: !!anthropic, keys: { anthropic: !!anthropic, openai: !!openai } }))
        try {
          let body = ''
          for await (const chunk of req) body += chunk
          const { task, input } = JSON.parse(body)
          const { runAgent, MissingKey } = await server.ssrLoadModule('/src/agent/agents.ts')
          let claude
          if (anthropic) {
            const { default: Anthropic } = await import('@anthropic-ai/sdk')
            claude = new Anthropic({ apiKey: anthropic })
          }
          try {
            const out = await runAgent({ claude, openai: openai ? { key: openai } : undefined }, task, input)
            res.end(JSON.stringify(out))
          } catch (e) {
            if (e instanceof MissingKey) {
              res.statusCode = 503
              return res.end(JSON.stringify({ error: e.message, missing: e.provider }))
            }
            throw e
          }
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), agentApi()],
})
