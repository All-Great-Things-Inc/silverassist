import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ command }) => ({
  plugins: [react(), cloudflare({
    configPath: process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH ??
      (command === 'serve' ? 'wrangler.local.jsonc' : 'wrangler.jsonc'),
    persistState: { path: process.env.SILVERASSIST_STATE_PATH ?? '.wrangler/state' },
    remoteBindings: false,
    inspectorPort: false,
  })],
  server: { host: 'localhost', port: 5173, strictPort: true },
}))
