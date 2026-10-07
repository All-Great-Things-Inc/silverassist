import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/auth-schema'
import { validPassword, passwordPolicyMessage } from '../../shared/password-policy'
import { authRateStorage } from './rate-limit'
import { localAccessPlugin } from './local-access'
import { emailAllowed, accessDeniedMessage } from './allowlist'

export interface Env {
  DB: D1Database
  MAIL_OUTBOX: R2Bucket
  AUTH_SECRET: string
  AUTH_BASE_URL: string
  APP_ENV: string
  AUTH_ALLOWED_EMAILS?: string
}

export function isLocalSpike(request: Request, env: Env): boolean {
  return import.meta.env.DEV && env.APP_ENV === 'local' &&
    new URL(request.url).origin === 'http://localhost:5173'
}

export function createAuth(env: Env, request: Request, ctx: ExecutionContext) {
  const saveLocalMail = (kind: string, email: string, url: string) => {
    if (!isLocalSpike(request, env)) throw new Error('Email delivery is not configured')
    ctx.waitUntil(env.MAIL_OUTBOX.put(`${crypto.randomUUID()}.json`, JSON.stringify({
      kind, email, url, createdAt: new Date().toISOString(),
    })))
  }
  return betterAuth({
    appName: 'SilverAssist Advisory',
    baseURL: env.AUTH_BASE_URL,
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.AUTH_BASE_URL],
    plugins: import.meta.env.DEV && env.APP_ENV === 'local' ? [localAccessPlugin(env)] : [],
    // Local requests share a bucket; supplied forwarding headers cannot bypass it.
    // Hosted Cloudflare uses only the header supplied by its edge. Verify at S17.
    advanced: { ipAddress: { ipAddressHeaders: env.APP_ENV === 'local' ? [] : ['cf-connecting-ip'] } },
    rateLimit: {
      enabled: true, window: 60, max: 120,
      customStorage: authRateStorage(env.DB),
      customRules: {
        '/sign-up/email': { window: 60, max: 10 },
        '/sign-in/email': { window: 60, max: 20 },
        '/request-password-reset': { window: 60, max: 10 },
        '/send-verification-email': { window: 60, max: 10 },
        '/reset-password': { window: 60, max: 20 },
        '/change-password': { window: 60, max: 10 },
        '/local-owner-access': { window: 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async context => {
        if (['/sign-up/email', '/sign-in/email'].includes(context.path)) {
          if (!emailAllowed(context.body?.email, env.AUTH_ALLOWED_EMAILS)) {
            throw new APIError('FORBIDDEN', { message: accessDeniedMessage })
          }
          context.body.email = context.body.email.trim().toLowerCase()
        }
        const field = context.path === '/sign-up/email' ? 'password' :
          ['/reset-password', '/change-password', '/set-password'].includes(context.path) ? 'newPassword' : null
        if (field && !validPassword(context.body?.[field])) {
          throw new APIError('BAD_REQUEST', { message: passwordPolicyMessage })
        }
        if (context.path === '/change-password') {
          // Direct API callers must revoke other sessions too.
          context.body.revokeOtherSessions = true
        }
      }),
    },
    databaseHooks: {
      user: { create: {
        before: async user => {
          if (!emailAllowed(user.email, env.AUTH_ALLOWED_EMAILS)) {
            throw new APIError('FORBIDDEN', { message: accessDeniedMessage })
          }
          // Hosted mail is not configured. The allowlist is the access gate.
          if (env.APP_ENV !== 'local') return { data: { ...user, emailVerified: true } }
        },
        after: async user => {
          if (env.APP_ENV === 'local') return
          const existing = await env.DB.prepare('SELECT id FROM workspaces LIMIT 1').first()
          if (existing) return
          const workspaceId = crypto.randomUUID()
          await env.DB.batch([
            env.DB.prepare('INSERT INTO workspaces (id, slug, name, is_demo) VALUES (?, ?, ?, 0)')
              .bind(workspaceId, 'silverassist', 'SilverAssist Advisory'),
            env.DB.prepare(`INSERT INTO memberships (id, workspace_id, user_id, role, status) VALUES (?, ?, ?, 'owner', 'active')`)
              .bind(crypto.randomUUID(), workspaceId, user.id),
          ])
        },
      } },
      session: { create: { before: async session => {
        const user = await env.DB.prepare('SELECT email FROM user WHERE id=?')
          .bind(session.userId).first<{ email: string }>()
        if (!emailAllowed(user?.email, env.AUTH_ALLOWED_EMAILS)) {
          throw new APIError('FORBIDDEN', { message: accessDeniedMessage })
        }
      } } },
    },
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: 'sqlite', schema, transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: env.APP_ENV === 'local',
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => saveLocalMail('reset', user.email, url),
    },
    emailVerification: {
      sendOnSignUp: env.APP_ENV === 'local',
      sendVerificationEmail: async ({ user, url }) => saveLocalMail('verification', user.email, url),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    logger: { level: 'error', disabled: true },
  })
}
