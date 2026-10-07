export { PortalError } from '../shared/errors'
import { PortalError } from '../shared/errors'
export type Member = { workspace_id: string; user_id: string; role: 'owner' | 'editor' | 'viewer' }
export async function membership(db: D1Database, workspaceId: string, userId: string) {
  const member = await db.prepare(`SELECT m.workspace_id,m.user_id,m.role FROM memberships m
    JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=?
    AND m.status='active' AND w.archived_at IS NULL`).bind(workspaceId,userId).first<Member>()
  if (!member) throw new PortalError(403,'Workspace access required.')
  return member
}
export function owner(member: Member) {
  if (member.role !== 'owner') throw new PortalError(403,'Only the workspace owner can do that.')
}
export function canRead(member: Member, visibility: string) { return member.role === 'owner' || visibility === 'shared' }
// SQL guards run inside each write batch so revocation cannot race a preflight check.
export const ownerGuard = `EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
  WHERE m.workspace_id=? AND m.user_id=? AND m.role='owner' AND m.status='active' AND w.archived_at IS NULL)`
export function text(value: unknown, label: string, max = 200, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new PortalError(400,`${label} must be ${required ? '1' : '0'}–${max} characters.`)
  return value.trim()
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new PortalError(400,'A valid record version is required.')
  return Number(value)
}
export function changed(result: D1Result) {
  if (result.meta.changes !== 1) throw new PortalError(409,'This record changed or access was removed. Reload before saving.')
}
export function rejectExtra(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new PortalError(400,'Unsupported fields in request.')
}
export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('')
}
