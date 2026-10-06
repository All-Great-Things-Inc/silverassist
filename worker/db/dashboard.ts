// Initial dashboard is owner-only. Shared-role projections remain S04.
export async function ownerDashboard(db: D1Database, userId: string) {
  const membership = await db.prepare(`SELECT w.id,w.name FROM workspaces w
    JOIN memberships m ON m.workspace_id=w.id
    WHERE m.user_id=? AND m.role='owner' AND m.status='active' AND w.archived_at IS NULL
    ORDER BY w.created_at,w.id LIMIT 1`).bind(userId).first<{ id: string; name: string }>()
  if (!membership) return null
  const engagements = await db.prepare(`SELECT id,title,timezone,start_date FROM engagements
    WHERE workspace_id=? AND archived_at IS NULL ORDER BY created_at,id`).bind(membership.id).all()
  const totals = await db.prepare(`SELECT
    (SELECT count(*) FROM workstreams ws JOIN engagements e ON e.id=ws.engagement_id AND e.workspace_id=ws.workspace_id
      WHERE ws.workspace_id=? AND ws.archived_at IS NULL AND e.archived_at IS NULL) AS workstreams,
    (SELECT count(*) FROM tasks t JOIN engagements e ON e.id=t.engagement_id AND e.workspace_id=t.workspace_id
      WHERE t.workspace_id=? AND t.archived_at IS NULL AND e.archived_at IS NULL
      AND t.status IN ('open','in_progress','blocked')) AS openTasks`).bind(membership.id,membership.id).first()
  return { workspace: membership, engagements: engagements.results, totals }
}
