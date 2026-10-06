import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { Env } from './index'
import { isLocalSpike } from './index'

// A CLI-issued, short-lived capability opens an existing verified owner's
// normal library session. No password/account/membership is changed here.
export function localAccessPlugin(env: Env) {
  return {
    id: 'silverassist-local-access',
    endpoints: {
      localOwnerAccess: createAuthEndpoint('/local-owner-access', { method: 'POST' }, async context => {
        const request = context.request
        if (!request || !isLocalSpike(request, env)) throw new APIError('NOT_FOUND', { message: 'Not found' })
        if (request.headers.get('Origin') !== 'http://localhost:5173') throw new APIError('FORBIDDEN', { message: 'Local same-origin access required.' })
        if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new APIError('BAD_REQUEST', { message: 'JSON required.' })
        const token = (context.body as { token?: unknown } | undefined)?.token
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new APIError('BAD_REQUEST', { message: 'This local access link is invalid or expired.' })
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
        const identifier = `local-owner-access:${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')}`
        // DELETE RETURNING makes concurrent/repeated redemption single-use.
        // Ownership/verification is checked again at redemption, not just issue.
        const grant = await env.DB.prepare(`DELETE FROM verification WHERE identifier=? AND expires_at>?
          AND EXISTS (SELECT 1 FROM user u JOIN memberships m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id
          WHERE u.id=verification.value AND u.email_verified=1 AND m.role='owner' AND m.status='active'
          AND w.is_demo=0 AND w.archived_at IS NULL) RETURNING value`).bind(identifier, Date.now()).first<{value:string}>()
        if (!grant) throw new APIError('BAD_REQUEST', { message: 'This local access link is invalid, expired or already used.' })
        const user = await context.context.internalAdapter.findUserById(grant.value)
        if (!user?.emailVerified) throw new APIError('FORBIDDEN', { message: 'Verified owner required.' })
        const session = await context.context.internalAdapter.createSession(user.id)
        if (!session) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Unable to open a local session.' })
        await setSessionCookie(context, { session, user })
        return context.json({ localDevelopmentAccess: true })
      }),
    },
  }
}
