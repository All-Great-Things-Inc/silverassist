import { spawn } from 'node:child_process'
import { once } from 'node:events'

if (process.argv.length !== 2) throw new Error('This command accepts no options and is local-only.')
const child = spawn(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB',
  '--config', 'wrangler.local.jsonc', '--local',
], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
const [code] = await once(child, 'exit')
process.exitCode = code ?? 1
