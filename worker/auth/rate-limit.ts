export function authRateStorage(db: D1Database) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const now = Date.now()
      const expires = now + rule.window * 1000
      // A single SQLite write checks and increments, including concurrent requests.
      const results = await db.batch([
        db.prepare('DELETE FROM auth_rate_limits WHERE expires_at < ?').bind(now - 86400000),
        db.prepare(`INSERT INTO auth_rate_limits(key_hash,count,expires_at) VALUES (?,1,?)
          ON CONFLICT(key_hash) DO UPDATE SET
            count = CASE WHEN expires_at <= ? THEN 1 ELSE min(count + 1, ?) END,
            expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
          RETURNING count,expires_at`).bind(hash, expires, now, rule.max + 1, now),
      ])
      const row = results[1].results[0] as { count: number; expires_at: number }
      return { allowed: row.count <= rule.max,
        retryAfter: row.count <= rule.max ? null : Math.max(1, Math.ceil((row.expires_at - now) / 1000)) }
    },
  }
}
