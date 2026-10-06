import { PortalError,type Member,owner,ownerGuard,text,changed,rejectExtra } from './policy'
import { getStream } from './workstreams'
import { richJson } from './rich-text'
const keys=['outcome','included','excluded','assumptions','questions','successMeasures','owner','targetDate']
function scopeBody(value:unknown) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new PortalError(400,'Scope must be an object.')
  const body=value as Record<string,unknown>;rejectExtra(body,[...keys,'richText'])
  const result=Object.fromEntries(keys.map(key=>[key,text(body[key]??'',key,4000)]))
  if(result.targetDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(result.targetDate)||Number.isNaN(Date.parse(result.targetDate))||new Date(result.targetDate).toISOString().slice(0,10)!==result.targetDate))throw new PortalError(400,'Use a valid date or leave it unset.')
  const rich=body.richText??{}
  if(typeof rich!=='object'||Array.isArray(rich))throw new PortalError(400,'Invalid scope formatting.')
  rejectExtra(rich as Record<string,unknown>,keys.slice(0,6))
  const docs:Record<string,unknown>={}
  for(const [key,doc]of Object.entries(rich)){
    const plain=typeof body[key]==='string'?body[key] as string:result[key]
    const json=richJson(doc,plain,4000)
    if(json){result[key]=plain;docs[key]=JSON.parse(json)}
  }
  return JSON.stringify({...result,...(Object.keys(docs).length?{richText:docs}:{})})
}
function draftAudit(db:D1Database,member:Member,id:string,nonce:string,action:string) {
  return db.prepare(`INSERT INTO activity_events(id,workspace_id,engagement_id,workstream_id,actor_kind,actor_id,action)
    SELECT ?,workspace_id,engagement_id,workstream_id,'user',?,? FROM scope_drafts WHERE workspace_id=? AND workstream_id=? AND last_mutation_id=?`)
    .bind(crypto.randomUUID(),member.user_id,action,member.workspace_id,id,nonce)
}
export async function saveDraft(db:D1Database,member:Member,id:string,body:Record<string,unknown>) {
  owner(member);rejectExtra(body,['version','scope'])
  const stream=await getStream(db,member,id)
  if(!Number.isSafeInteger(body.version)||Number(body.version)<0)throw new PortalError(400,'A valid draft version is required.')
  const expected=Number(body.version),nonce=crypto.randomUUID(),json=scopeBody(body.scope)
  const result=await db.batch([
    db.prepare(`INSERT INTO scope_drafts(id,workspace_id,engagement_id,workstream_id,body_json,updated_by,last_mutation_id)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workstreams s JOIN engagements e ON e.id=s.engagement_id AND e.workspace_id=s.workspace_id WHERE s.workspace_id=? AND s.id=? AND s.archived_at IS NULL AND e.archived_at IS NULL) AND ${ownerGuard} AND (?=0 OR EXISTS (SELECT 1 FROM scope_drafts WHERE workspace_id=? AND workstream_id=?))
      ON CONFLICT(workstream_id) DO UPDATE SET body_json=excluded.body_json,version=scope_drafts.version+1,updated_by=excluded.updated_by,last_mutation_id=excluded.last_mutation_id,updated_at=?
      WHERE scope_drafts.version=? AND EXISTS (SELECT 1 FROM workstreams s JOIN engagements e ON e.id=s.engagement_id AND e.workspace_id=s.workspace_id WHERE s.workspace_id=scope_drafts.workspace_id AND s.id=scope_drafts.workstream_id AND s.archived_at IS NULL AND e.archived_at IS NULL) AND ${ownerGuard}`)
      .bind(crypto.randomUUID(),member.workspace_id,stream.engagement_id,id,json,member.user_id,nonce,member.workspace_id,id,member.workspace_id,member.user_id,expected,member.workspace_id,id,new Date().toISOString(),expected,member.workspace_id,member.user_id),
    draftAudit(db,member,id,nonce,'scope.draft_saved'),
  ])
  changed(result[0]);return db.prepare('SELECT body_json,version FROM scope_drafts WHERE workspace_id=? AND workstream_id=?').bind(member.workspace_id,id).first()
}
export async function publishScope(db:D1Database,member:Member,id:string,body:Record<string,unknown>) {
  owner(member);rejectExtra(body,['version','changeSummary','agreementState','agreementSource','visibility'])
  const stream=await getStream(db,member,id)
  const summary=text(body.changeSummary,'Change summary',2000,true),state=String(body.agreementState??'proposed'),visibility=String(body.visibility??'private')
  if(!['proposed','agreed','superseded'].includes(state)||!['private','shared'].includes(visibility))throw new PortalError(400,'Invalid scope state or visibility.')
  if(visibility==='shared'&&stream.visibility!=='shared')throw new PortalError(400,'Share the workstream before sharing a scope revision.')
  const source=text(body.agreementSource??'','Agreement source',2000,state==='agreed'),nonce=crypto.randomUUID(),revisionId=crypto.randomUUID()
  if(!Number.isSafeInteger(body.version)||Number(body.version)<1)throw new PortalError(400,'Save a draft first.')
  const result=await db.batch([
    db.prepare(`UPDATE scope_drafts SET version=version+1,last_mutation_id=?,updated_by=?,updated_at=? WHERE workspace_id=? AND workstream_id=? AND version=? AND EXISTS (SELECT 1 FROM workstreams s JOIN engagements e ON e.id=s.engagement_id AND e.workspace_id=s.workspace_id WHERE s.workspace_id=scope_drafts.workspace_id AND s.id=scope_drafts.workstream_id AND s.archived_at IS NULL AND e.archived_at IS NULL AND (?='private' OR s.visibility='shared')) AND ${ownerGuard}`)
      .bind(nonce,member.user_id,new Date().toISOString(),member.workspace_id,id,body.version,visibility,member.workspace_id,member.user_id),
    db.prepare(`INSERT INTO scope_revisions(id,workspace_id,engagement_id,workstream_id,revision_number,body_json,change_summary,agreement_state,agreement_source,visibility,authored_by)
      SELECT ?,d.workspace_id,d.engagement_id,d.workstream_id,COALESCE((SELECT max(revision_number)+1 FROM scope_revisions WHERE workstream_id=d.workstream_id),1),d.body_json,?,?,?,?,?
      FROM scope_drafts d JOIN workstreams s ON s.id=d.workstream_id AND s.workspace_id=d.workspace_id
      WHERE d.workspace_id=? AND d.workstream_id=? AND d.last_mutation_id=? AND s.archived_at IS NULL AND (?='private' OR s.visibility='shared')`)
      .bind(revisionId,summary,state,source||null,visibility,member.user_id,member.workspace_id,id,nonce,visibility),
    draftAudit(db,member,id,nonce,'scope.revision_saved'),
  ])
  changed(result[0]);changed(result[1])
  return db.prepare('SELECT id,revision_number FROM scope_revisions WHERE id=?').bind(revisionId).first()
}
