import { createAuth, isLocalSpike } from './auth'
import type { Env } from './auth'
import { ownerDashboard } from './db/dashboard'
import { portal } from './portal'
import { PortalError } from './policy'
import { emailAllowed, accessDeniedMessage } from './auth/allowlist'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const json = (data: unknown, status = 200) => Response.json(data, {
      status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    })
    if (path === '/api/health') return json({ status: 'ready', runtime: navigator.userAgent })
    if (!path.startsWith('/api/')) return new Response('Not found', { status: 404 })
    const auth = createAuth(env, request, ctx)
    // Recheck existing cookies on every protected request, including auth account
    // routes. Logout remains available after removal from the list.
    const currentSession = await auth.api.getSession({ headers: request.headers })
    if (currentSession && !emailAllowed(currentSession.user.email, env.AUTH_ALLOWED_EMAILS) &&
      path !== '/api/auth/sign-out') {
      if (path === '/api/auth/get-session') return json(null)
      return json({ error: accessDeniedMessage, message: accessDeniedMessage }, 403)
    }
    if (path.startsWith('/api/auth/')) {
      const response = await auth.handler(request)
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store')
      headers.set('X-Content-Type-Options', 'nosniff')
      const retryAfter = headers.get('X-Retry-After')
      if (response.status === 429 && retryAfter) headers.set('Retry-After', retryAfter)
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }
    if (path === '/api/dashboard' && request.method === 'GET') {
      const session = currentSession
      if (!session || !session.user.emailVerified) return json({ error: 'Sign in required' }, 401)
      const dashboard = await ownerDashboard(env.DB, session.user.id)
      if (!dashboard) return json({ error: 'Workspace owner access required' }, 403)
      return json(dashboard)
    }
    if (path === '/api/workspaces' || path.startsWith('/api/workspaces/') || path === '/api/invitations/accept') {
      const session = currentSession
      if (!session) return json({ error: 'Sign in required' }, 401)
      try { return await portal(request, env, session.user) }
      catch (error) {
        if (error instanceof PortalError) return json({ error: error.message }, error.status)
        return json({ error: 'Unable to save this request. Please retry.' }, 500)
      }
    }
    if (path.startsWith('/api/dev/')) {
      if (!isLocalSpike(request, env)) return json({ error: 'Not found' }, 404)
      if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) {
        return json({ error: 'Forbidden' }, 403)
      }
      // Development mail is a loopback-only test facility, never a hosted route.
      if (path === '/api/dev/outbox' && request.method === 'GET') {
        const items = await env.MAIL_OUTBOX.list()
        const messages = await Promise.all(items.objects.map(async ({ key }) =>
          JSON.parse(await (await env.MAIL_OUTBOX.get(key))!.text())))
        return json({ developmentOnly: true, messages })
      }
      const session = currentSession
      if (!session) return json({ error: 'Sign in required' }, 401)
      if (path === '/api/dev/records') {
        if (request.method === 'GET') {
          const rows = await env.DB.prepare('SELECT id, content FROM spike_records WHERE user_id = ? ORDER BY created_at DESC')
            .bind(session.user.id).all()
          return json({ records: rows.results })
        }
        if (request.method === 'POST') {
          if (request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden' }, 403)
          const body = await request.json() as { content?: unknown }
          if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 300) {
            return json({ error: 'Enter between 1 and 300 characters' }, 400)
          }
          const id = crypto.randomUUID()
          await env.DB.batch([
            env.DB.prepare('INSERT INTO spike_records(id, user_id, content) VALUES (?, ?, ?)').bind(id, session.user.id, body.content.trim()),
            env.DB.prepare('INSERT INTO spike_audit(id, record_id, actor_id) VALUES (?, ?, ?)').bind(crypto.randomUUID(), id, session.user.id),
          ])
          return json({ id }, 201)
        }
      }
      if (path === '/api/dev/atomic-check' && request.method === 'POST') {
        if (request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden' }, 403)
        const id = crypto.randomUUID()
        let rolledBack = false
        try {
          await env.DB.batch([
            env.DB.prepare('INSERT INTO spike_records(id, user_id, content) VALUES (?, ?, ?)').bind(id, session.user.id, 'Atomic rollback fixture'),
            env.DB.prepare('INSERT INTO spike_audit(id, record_id, actor_id) VALUES (?, ?, ?)').bind(id, 'missing-record', session.user.id),
          ])
        } catch {
          const row = await env.DB.prepare('SELECT id FROM spike_records WHERE id = ?').bind(id).first()
          rolledBack = row === null
        }
        return json({ rolledBack })
      }
    }
    return json({ error: 'Not found' }, 404)
  },
} satisfies ExportedHandler<Env>
