import { PortalError, type Member, owner, canRead, ownerGuard, text, version, changed, rejectExtra } from './policy'
import { richJson } from './rich-text'
export type Stream = { id:string; workspace_id:string; engagement_id:string; code:string; title:string; purpose:string; purpose_doc_json:string|null; status:string;
  priority:number|null; owner_name:string|null; sort_order:number; visibility:string; version:number; archived_at:string|null }
const fields='s.id,s.workspace_id,s.engagement_id,s.code,s.title,s.purpose,s.purpose_doc_json,s.status,s.priority,s.owner_name,s.sort_order,s.visibility,s.version,s.archived_at'
export async function listWorkstreams(db:D1Database, member:Member, archived=false, preview=false) {
  if (preview) owner(member)
  const result=await db.prepare(`SELECT ${fields} FROM workstreams s JOIN engagements e ON e.id=s.engagement_id AND e.workspace_id=s.workspace_id
    WHERE s.workspace_id=? AND e.archived_at IS NULL AND (?=1 OR s.visibility='shared')
    AND (?=1 OR s.archived_at IS NULL) ORDER BY s.sort_order,s.created_at,s.id`)
    .bind(member.workspace_id,member.role==='owner'&&!preview?1:0,member.role==='owner'&&archived&&!preview?1:0).all<Stream>()
  return result.results
}
export async function getStream(db:D1Database,member:Member,id:string,includeArchived=false) {
  const row=await db.prepare(`SELECT ${fields} FROM workstreams s JOIN engagements e ON e.id=s.engagement_id AND e.workspace_id=s.workspace_id
    WHERE s.workspace_id=? AND s.id=? AND e.archived_at IS NULL`).bind(member.workspace_id,id).first<Stream>()
  if(!row||!canRead(member,row.visibility)||(row.archived_at&&!(member.role==='owner'&&includeArchived))) throw new PortalError(404,'Workstream not found.')
  return row
}
function audit(db:D1Database,member:Member,id:string,nonce:string,action:string) {
  return db.prepare(`INSERT INTO activity_events(id,workspace_id,engagement_id,workstream_id,actor_kind,actor_id,action)
    SELECT ?,workspace_id,engagement_id,id,'user',?,? FROM workstreams WHERE workspace_id=? AND id=? AND last_mutation_id=?`)
    .bind(crypto.randomUUID(),member.user_id,action,member.workspace_id,id,nonce)
}
export async function createStream(db:D1Database,member:Member,body:Record<string,unknown>) {
  owner(member); rejectExtra(body,['engagementId','title','purpose','purposeDoc'])
  let purpose=text(body.purpose??'','Purpose',5000);if(body.purposeDoc!=null&&typeof body.purpose==='string')purpose=body.purpose
  const doc=richJson(body.purposeDoc,purpose,5000)
  const id=crypto.randomUUID(), nonce=crypto.randomUUID()
  const result=await db.batch([
    db.prepare(`INSERT INTO workstreams(id,workspace_id,engagement_id,code,title,purpose,purpose_doc_json,updated_by,last_mutation_id,sort_order)
      SELECT ?,workspace_id,id,?,?,?,?,?,?,COALESCE((SELECT max(sort_order)+1 FROM workstreams WHERE engagement_id=e.id),0)
      FROM engagements e WHERE e.workspace_id=? AND e.id=? AND e.archived_at IS NULL AND ${ownerGuard}`)
      .bind(id,`W-${id.slice(0,8)}`,text(body.title,'Title',200,true),purpose,doc,member.user_id,nonce,member.workspace_id,text(body.engagementId,'Engagement',200,true),member.workspace_id,member.user_id),
    audit(db,member,id,nonce,'workstream.created'),
  ])
  changed(result[0]); return getStream(db,member,id)
}
export async function editStream(db:D1Database,member:Member,id:string,body:Record<string,unknown>) {
  rejectExtra(body,['version','title','purpose','purposeDoc','status','priority','ownerName','sortOrder','archived','visibility'])
  const stream=await getStream(db,member,id,true)
  if(member.role==='viewer') throw new PortalError(403,'Viewers cannot edit records.')
  if(member.role!=='owner'&&(stream.visibility!=='shared'||Object.keys(body).some(k=>!['version','title','purpose','purposeDoc'].includes(k)))) throw new PortalError(403,'Only the owner can change scope, sharing, or archive state.')
  const assignments:string[]=[],values:(string|number|null)[]=[]
  if('title'in body){assignments.push('title=?');values.push(text(body.title,'Title',200,true))}
  if('purpose'in body||'purposeDoc'in body){let purpose='purpose'in body?text(body.purpose,'Purpose',5000):stream.purpose;if(body.purposeDoc!=null&&typeof body.purpose==='string')purpose=body.purpose;assignments.push('purpose=?','purpose_doc_json=?');values.push(purpose,richJson(body.purposeDoc,purpose,5000))}
  if('status'in body){if(!['proposed','needs_scoping','active','on_hold','completed'].includes(String(body.status)))throw new PortalError(400,'Invalid status.');assignments.push('status=?');values.push(String(body.status))}
  if('priority'in body){if(body.priority!==null&&(!Number.isInteger(body.priority)||Number(body.priority)<1||Number(body.priority)>5))throw new PortalError(400,'Priority must be 1–5 or unset.');assignments.push('priority=?');values.push(body.priority as number|null)}
  if('ownerName'in body){assignments.push('owner_name=?');values.push(body.ownerName===null?null:text(body.ownerName,'Owner',200))}
  if('sortOrder'in body){if(!Number.isSafeInteger(body.sortOrder)||Number(body.sortOrder)<0)throw new PortalError(400,'Invalid sort order.');assignments.push('sort_order=?');values.push(Number(body.sortOrder))}
  if('archived'in body){if(typeof body.archived!=='boolean')throw new PortalError(400,'Invalid archive state.');assignments.push('archived_at=?');values.push(body.archived?new Date().toISOString():null)}
  if('visibility'in body){if(!['private','shared'].includes(String(body.visibility)))throw new PortalError(400,'Invalid visibility.');assignments.push('visibility=?');values.push(String(body.visibility))}
  if(!assignments.length)throw new PortalError(400,'No changes supplied.')
  const nonce=crypto.randomUUID()
  const result=await db.batch([
    db.prepare(`UPDATE workstreams SET ${assignments.join(',')},version=version+1,last_mutation_id=?,updated_by=?,updated_at=?
      WHERE workspace_id=? AND id=? AND version=? AND EXISTS (SELECT 1 FROM engagements e WHERE e.id=workstreams.engagement_id AND e.workspace_id=workstreams.workspace_id AND e.archived_at IS NULL)
      AND EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=workstreams.workspace_id
        AND m.user_id=? AND m.status='active' AND w.archived_at IS NULL AND (m.role='owner' OR (m.role='editor' AND workstreams.visibility='shared' AND workstreams.archived_at IS NULL)))`)
      .bind(...values,nonce,member.user_id,new Date().toISOString(),member.workspace_id,id,version(body.version),member.user_id),
    audit(db,member,id,nonce,'workstream.updated'),
  ])
  changed(result[0]); return getStream(db,member,id,true)
}
export async function streamDetail(db:D1Database,member:Member,id:string,preview=false) {
  if(preview)owner(member)
  const stream=await getStream(db,member,id,member.role==='owner')
  if(preview&&stream.archived_at)throw new PortalError(404,'Archived workstreams are not shared.')
  const effective=preview?{...member,role:'viewer' as const}:member
  const revisions=await db.prepare(`SELECT id,revision_number,body_json,change_summary,agreement_state,agreement_source,visibility,created_at
    FROM scope_revisions WHERE workspace_id=? AND workstream_id=? AND (?=1 OR visibility='shared') ORDER BY revision_number DESC`)
    .bind(member.workspace_id,id,effective.role==='owner'?1:0).all()
  const draft=effective.role==='owner'?await db.prepare('SELECT body_json,version FROM scope_drafts WHERE workspace_id=? AND workstream_id=?').bind(member.workspace_id,id).first():null
  // Owner audit and drafts never enter the simulated/shared response.
  const openTasks=member.role==='owner'&&!preview?(await db.prepare("SELECT count(*) AS n FROM tasks WHERE workspace_id=? AND workstream_id=? AND archived_at IS NULL AND status IN ('open','in_progress','blocked')").bind(member.workspace_id,id).first<{n:number}>())?.n:undefined
  return {stream:preview?{...stream,visibility:'shared'}:stream,revisions:revisions.results,...(openTasks!==undefined?{openTasks}:{}),...(effective.role==='owner'?{draft}: {})}
}
