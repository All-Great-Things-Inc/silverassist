import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { drizzle } from 'drizzle-orm/d1'
import type { D1Database } from '@cloudflare/workers-types'
import * as schema from '../worker/db/auth-schema'

// Schema generation only: no database connection or real secret is needed.
export const auth = betterAuth({
  baseURL: 'http://localhost:5173',
  database: drizzleAdapter(drizzle({} as D1Database, { schema }), {
    provider: 'sqlite', transaction: false, schema,
  }),
  emailAndPassword: { enabled: true },
})
