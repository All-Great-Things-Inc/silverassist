// Explicit local demo tooling imports this module; never imported by the public Worker.
export const demoWorkspaceId = 'demo-silverassist-v1'
export const demoEngagementId = 'demo-engagement-v1'
type PlanningSeed = { formatVersion: number; workstreams: Array<{
  code: string; title: string; suppliedIntent: string; status: string
  proposedActions: string[]; openQuestions: string[]; hypotheses?: unknown[]
}> }
export async function seedDemo(db: D1Database, planning: PlanningSeed) {
  if (planning.formatVersion !== 1 || planning.workstreams.length !== 5) throw new Error('Unrecognized planning seed')
  const existing = await db.prepare('SELECT is_demo FROM workspaces WHERE id=?').bind(demoWorkspaceId).first<{ is_demo: number }>()
  if (existing && existing.is_demo !== 1) throw new Error('Refusing to seed a working workspace')
  const statements = [
    db.prepare("INSERT INTO workspaces(id,slug,name,is_demo) VALUES (?,'silverassist-demo','SilverAssist · Synthetic demo',1) ON CONFLICT(id) DO NOTHING").bind(demoWorkspaceId),
    db.prepare("INSERT INTO engagements(id,workspace_id,title,summary) VALUES (?,?,'Synthetic advisory engagement','Planning examples for review; no agreed scope or commitments.') ON CONFLICT(id) DO NOTHING").bind(demoEngagementId,demoWorkspaceId),
    db.prepare("INSERT INTO activity_events(id,workspace_id,engagement_id,actor_kind,action) VALUES ('demo-seed-event-v1',?,?,'system','demo.seeded') ON CONFLICT(id) DO NOTHING").bind(demoWorkspaceId,demoEngagementId),
  ]
  for (const [order, workstream] of planning.workstreams.entries()) {
    if (!['proposed','needs_scoping'].includes(workstream.status)) throw new Error('Seed must remain proposed')
    const id = `demo-${workstream.code}`
    statements.push(
      db.prepare(`INSERT INTO workstreams(id,workspace_id,engagement_id,code,title,purpose,status,sort_order) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
        .bind(id,demoWorkspaceId,demoEngagementId,workstream.code,workstream.title,workstream.suppliedIntent,workstream.status,order),
      db.prepare('INSERT INTO scope_drafts(id,workspace_id,engagement_id,workstream_id,body_json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
        .bind(`demo-draft-${workstream.code}`,demoWorkspaceId,demoEngagementId,id,JSON.stringify({
          synthetic: true, objectives: [workstream.suppliedIntent], included: [], excluded: [], successMeasures: [],
          proposedActions: workstream.proposedActions, questions: workstream.openQuestions, hypotheses: workstream.hypotheses ?? [],
        })),
    )
  }
  // Stable keys, insert-only semantics and atomic batch: preserve edits/archives on rerun.
  const results = await db.batch(statements)
  return { inserted: results.reduce((total,result) => total + result.meta.changes,0), workspaceId: demoWorkspaceId }
}
