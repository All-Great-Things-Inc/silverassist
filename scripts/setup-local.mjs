import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

try {
  await writeFile('.dev.vars', `AUTH_SECRET=${randomBytes(48).toString('hex')}\n`, { flag: 'wx', mode: 0o600 })
  console.log('Created ignored local authentication configuration.')
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  console.log('Existing local configuration preserved.')
}
