import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './worker/db/auth-schema.ts',
  out: './migrations',
})
