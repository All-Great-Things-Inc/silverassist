// Internal database operations. Callers must authorize membership/role before use (S04).
export type RecordScope = { workspaceId: string; engagementId: string; workstreamId: string }
export type WorkstreamRow = {
  id: string; title: string; version: number; archived_at: string | null; visibility: 'private' | 'shared'
}
export class EditConflict extends Error {
  constructor() { super('The record changed or is unavailable. Reload before saving.') }
}
export function getWorkstream(db: D1Database, scope: RecordScope) {
  return db.prepare('SELECT id,title,version,archived_at,visibility FROM workstreams WHERE workspace_id=? AND engagement_id=? AND id=?')
    .bind(scope.workspaceId, scope.engagementId, scope.workstreamId).first<WorkstreamRow>()
}
export function activityStatement(db: D1Database, input: {
  id: string; scope: RecordScope; actorId: string; action: string; mutationId: string
}) {
  // INSERT SELECT ties audit to this exact mutation; a stale/no-op edit creates no audit.
  return db.prepare(`INSERT INTO activity_events(id,workspace_id,engagement_id,workstream_id,actor_kind,actor_id,action)
    SELECT ?,workspace_id,engagement_id,id,'user',?,? FROM workstreams
    WHERE workspace_id=? AND engagement_id=? AND id=? AND last_mutation_id=?`)
    .bind(input.id, input.actorId, input.action, input.scope.workspaceId, input.scope.engagementId, input.scope.workstreamId, input.mutationId)
}
async function mutate(db: D1Database, scope: RecordScope, actorId: string, expectedVersion: number,
  action: string, assignment: string, value: string | null) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Invalid record version')
  const mutationId = crypto.randomUUID()
  const results = await db.batch([
    db.prepare(`UPDATE workstreams SET ${assignment},version=version+1,last_mutation_id=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE workspace_id=? AND engagement_id=? AND id=? AND version=?`)
      .bind(value, mutationId, actorId, scope.workspaceId, scope.engagementId, scope.workstreamId, expectedVersion),
    activityStatement(db, { id: crypto.randomUUID(), scope, actorId, action, mutationId }),
  ])
  if (results[0].meta.changes !== 1) throw new EditConflict()
  return getWorkstream(db, scope)
}
export function renameWorkstream(db: D1Database, scope: RecordScope, actorId: string, expectedVersion: number, title: string) {
  if (!title.trim() || title.length > 200) throw new Error('Enter a title of 1–200 characters')
  return mutate(db, scope, actorId, expectedVersion, 'workstream.updated', 'title=?', title.trim())
}
export function setWorkstreamArchived(db: D1Database, scope: RecordScope, actorId: string, expectedVersion: number, archived: boolean) {
  return mutate(db, scope, actorId, expectedVersion, archived ? 'workstream.archived' : 'workstream.restored', 'archived_at=?', archived ? new Date().toISOString() : null)
}
