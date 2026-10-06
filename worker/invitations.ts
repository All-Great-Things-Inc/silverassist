import { PortalError, type Member, owner, ownerGuard, hashToken, text, rejectExtra } from './policy'
export async function createInvitation(db: D1Database, member: Member, body: Record<string, unknown>) {
  owner(member); rejectExtra(body,['email','role'])
  const email = text(body.email,'Email',254,true).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PortalError(400,'Enter a valid email address.')
  if (!['editor','viewer'].includes(String(body.role))) throw new PortalError(400,'Invitations may grant editor or viewer access only.')
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('')
  const id = crypto.randomUUID(), expires = new Date(Date.now()+7*86400000).toISOString()
  const results = await db.batch([db.prepare(`INSERT INTO invitations(id,workspace_id,email,role,token_hash,expires_at,invited_by)
    SELECT ?,?,?,?,?,?,? WHERE ${ownerGuard}`).bind(id,member.workspace_id,email,body.role,await hashToken(raw),expires,member.user_id,member.workspace_id,member.user_id),
    db.prepare(`INSERT INTO activity_events(id,workspace_id,actor_kind,actor_id,action) SELECT ?,workspace_id,'user',?,'invitation.created' FROM invitations WHERE id=?`).bind(crypto.randomUUID(),member.user_id,id),
  ])
  if (results[0].meta.changes !== 1) throw new PortalError(403,'Owner access was removed.')
  return { id, email, role: body.role, expiresAt: expires, token: raw }
}
export async function acceptInvitation(db: D1Database, user: { id: string; email: string; emailVerified: boolean }, token: unknown) {
  if (!user.emailVerified) throw new PortalError(403,'Verify your account email first.')
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new PortalError(400,'Invitation is invalid or no longer available.')
  const hash = await hashToken(token), nonce = crypto.randomUUID(), now = new Date().toISOString()
  const condition = `i.token_hash=? AND lower(i.email)=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
    AND EXISTS (SELECT 1 FROM memberships inviter JOIN workspaces w ON w.id=inviter.workspace_id
      WHERE inviter.workspace_id=i.workspace_id AND inviter.user_id=i.invited_by AND inviter.role='owner' AND inviter.status='active' AND w.archived_at IS NULL)`
  const results = await db.batch([
    db.prepare(`INSERT INTO memberships(id,workspace_id,user_id,role,last_mutation_id)
      SELECT ?,i.workspace_id,?,i.role,? FROM invitations i WHERE ${condition}
      ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active',last_mutation_id=excluded.last_mutation_id,updated_at=?
      WHERE memberships.role!='owner'`).bind(crypto.randomUUID(),user.id,nonce,hash,user.email.toLowerCase(),now,now),
    db.prepare(`UPDATE invitations SET accepted_at=?,accepted_by=? WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id=invitations.workspace_id AND m.user_id=? AND m.last_mutation_id=?)
      RETURNING workspace_id,role`).bind(now,user.id,hash,user.id,nonce),
    db.prepare(`INSERT INTO activity_events(id,workspace_id,actor_kind,actor_id,action) SELECT ?,workspace_id,'user',?,'membership.invitation_accepted' FROM memberships WHERE user_id=? AND last_mutation_id=?`).bind(crypto.randomUUID(),user.id,user.id,nonce),
  ])
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new PortalError(400,'Invitation is invalid or no longer available.')
  return results[1].results[0]
}
export async function revokeInvitation(db: D1Database, member: Member, id: string) {
  owner(member)
  const nonce=crypto.randomUUID()
  const results=await db.batch([
    db.prepare(`UPDATE invitations SET revoked_at=?,last_mutation_id=? WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND ${ownerGuard}`)
      .bind(new Date().toISOString(),nonce,id,member.workspace_id,member.workspace_id,member.user_id),
    db.prepare(`INSERT INTO activity_events(id,workspace_id,actor_kind,actor_id,action) SELECT ?,workspace_id,'user',?,'invitation.revoked' FROM invitations WHERE id=? AND last_mutation_id=?`).bind(crypto.randomUUID(),member.user_id,id,nonce),
  ])
  if (results[0].meta.changes !== 1) throw new PortalError(409,'Invitation changed or is unavailable.')
}
export async function revokeMember(db: D1Database, member: Member, userId: string) {
  owner(member)
  const nonce=crypto.randomUUID()
  const results=await db.batch([
    db.prepare(`UPDATE memberships SET status='revoked',updated_at=?,last_mutation_id=? WHERE workspace_id=? AND user_id=? AND role!='owner' AND status='active' AND ${ownerGuard}`)
      .bind(new Date().toISOString(),nonce,member.workspace_id,userId,member.workspace_id,member.user_id),
    db.prepare(`INSERT INTO activity_events(id,workspace_id,actor_kind,actor_id,action) SELECT ?,workspace_id,'user',?,'membership.revoked' FROM memberships WHERE workspace_id=? AND user_id=? AND last_mutation_id=?`).bind(crypto.randomUUID(),member.user_id,member.workspace_id,userId,nonce),
  ])
  if (results[0].meta.changes !== 1) throw new PortalError(409,'Member is unavailable; owner revocation is not supported.')
}
