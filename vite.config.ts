import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sproutLands } from './scripts/vite-sprout-lands'

// Local stand-in for the server route on Lovable: POST /api/agent runs the same
// prompts (src/agent/agents.ts) with ANTHROPIC_API_KEY from .env.local.
function agentApi(): Plugin {
  return {
    name: 'homestead-agent-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      server.middlewares.use('/api/agent', async (req, res) => {
        const key = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET') return res.end(JSON.stringify({ live: !!key }))
        if (!key) {
          res.statusCode = 503
          return res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set' }))
        }
        try {
          let body = ''
          for await (const chunk of req) body += chunk
          const { task, input } = JSON.parse(body)
          const { default: Anthropic } = await import('@anthropic-ai/sdk')
          const { runAgent } = await server.ssrLoadModule('/src/agent/agents.ts')
          const out = await runAgent(new Anthropic({ apiKey: key }), task, input)
          res.end(JSON.stringify(out))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), agentApi(), sproutLands()],
  build: {
    rollupOptions: {
      // The app, plus the design system library (npm run design).
      input: { main: 'index.html', design: 'design.html' },
    },
  },
})
