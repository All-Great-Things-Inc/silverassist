import { PortalError,type Member,owner,ownerGuard,text,version,changed,rejectExtra } from './policy'
import { richJson } from './rich-text'
type Note={id:string;workspace_id:string;engagement_id:string;title:string;body:string;body_doc_json:string|null;kind:string;decision_state:string|null;decision_outcome:string|null;decision_contact:string|null;superseded_reason:string|null;source_url:string;visibility:string;version:number;archived_at:string|null;created_at:string;updated_at:string}
const fields='n.id,n.workspace_id,n.engagement_id,n.title,n.body,n.body_doc_json,n.kind,n.decision_state,n.decision_outcome,n.decision_contact,n.superseded_reason,n.source_url,n.visibility,n.version,n.archived_at,n.created_at,n.updated_at'
const hiddenParent=`EXISTS (SELECT 1 FROM note_workstreams l JOIN workstreams s ON s.id=l.workstream_id AND s.workspace_id=l.workspace_id
  WHERE l.note_id=n.id AND (s.archived_at IS NOT NULL OR (?=0 AND s.visibility!='shared')))`
export async function listNotes(db:D1Database,member:Member,archived=false,query='',workstreamId='',state='') {
  const result=await db.prepare(`SELECT ${fields} FROM strategy_notes n JOIN engagements e ON e.id=n.engagement_id AND e.workspace_id=n.workspace_id
    WHERE n.workspace_id=? AND e.archived_at IS NULL AND (?=1 OR n.visibility='shared')
    AND (?=1 OR (n.archived_at IS NULL AND NOT ${hiddenParent}))
    AND (?='' OR ((n.kind='agreed_decision' OR n.decision_state IS NOT NULL) AND EXISTS (SELECT 1 FROM note_workstreams l WHERE l.note_id=n.id AND l.workspace_id=n.workspace_id AND l.workstream_id=?)))
    AND (?='' OR COALESCE(n.decision_state,CASE WHEN n.kind='agreed_decision' THEN 'decided' END)=?)
    AND (n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\' OR COALESCE(n.decision_outcome,'') LIKE ? ESCAPE '\\' OR COALESCE(n.decision_contact,'') LIKE ? ESCAPE '\\' OR COALESCE(n.superseded_reason,'') LIKE ? ESCAPE '\\') ORDER BY n.updated_at DESC,n.id LIMIT ${workstreamId?101:100}`)
    .bind(member.workspace_id,member.role==='owner'?1:0,member.role==='owner'&&archived?1:0,member.role==='owner'?1:0,workstreamId,workstreamId,state,state,...Array(5).fill(`%${query.replace(/[\\%_]/g,'\\$&')}%`)).all<Note>()
  return result.results
}
export async function getNote(db:D1Database,member:Member,id:string,archived=false) {
  const row=await db.prepare(`SELECT ${fields} FROM strategy_notes n JOIN engagements e ON e.id=n.engagement_id AND e.workspace_id=n.workspace_id
    WHERE n.workspace_id=? AND n.id=? AND e.archived_at IS NULL AND (?=1 OR n.visibility='shared')
    AND (?=1 OR (n.archived_at IS NULL AND NOT ${hiddenParent}))`).bind(member.workspace_id,id,member.role==='owner'?1:0,member.role==='owner'&&archived?1:0,member.role==='owner'?1:0).first<Note>()
  if(!row)throw new PortalError(404,'Note not found.')
  const links=await db.prepare(`SELECT s.id,s.title,s.visibility,s.archived_at FROM note_workstreams l JOIN workstreams s ON s.id=l.workstream_id AND s.workspace_id=l.workspace_id WHERE l.note_id=? ORDER BY s.sort_order,s.id`).bind(id).all<{id:string;title:string;visibility:string;archived_at:string|null}>()
  return {note:row,links:links.results}
}
function validated(body:Record<string,unknown>,member:Member) {
  if('decisionState'in body&&body.decisionState===null)throw new PortalError(400,'Choose a decision status.')
  const state=body.decisionState??null
  if(state!==null&&!['awaiting','decided','superseded'].includes(String(state)))throw new PortalError(400,'Invalid decision status.')
  if(state===null&&['decisionOutcome','decisionContact','supersededReason'].some(key=>key in body))throw new PortalError(400,'Choose a decision status with its workflow fields.')
  if(state!==null)owner(member)
  const outcome=state===null?null:text(body.decisionOutcome??'','Decision outcome',4000,state!=='awaiting')
  const contact=state===null?null:text(body.decisionContact??'','Decision-maker or contact',200)
  const reason=state===null?null:state==='superseded'?text(body.supersededReason??'','Reason superseded',2000,true):''
  const title=text(body.title,'Note title',200,true),content=text(body.body??'','Note',20000),kind=state===null?String(body.kind??'strategy'):state==='awaiting'?'proposed_action':'agreed_decision',visibility=String(body.visibility??'private')
  if(!['strategy','reported_fact','hypothesis','proposed_action','agreed_decision'].includes(kind)||!['private','shared'].includes(visibility))throw new PortalError(400,'Invalid note type or visibility.')
  if(member.role==='viewer'||(member.role==='editor'&&(visibility!=='shared'||kind==='agreed_decision')))throw new PortalError(403,'Shared editors may create shared working notes only.')
  const source=text(body.sourceUrl??'','Source link',2000)
  if(source){let url;try{url=new URL(source)}catch{throw new PortalError(400,'Enter a full http or https source URL.')}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new PortalError(400,'Use an http or https source URL without credentials.')}
  if(!Array.isArray(body.workstreamIds??[])||(body.workstreamIds as unknown[]|undefined)?.some(v=>typeof v!=='string')||Number((body.workstreamIds as unknown[]|undefined)?.length??0)>30)throw new PortalError(400,'Choose up to 30 workstreams.')
  const plain=typeof body.body==='string'?body.body:content,doc=richJson(body.bodyDoc,plain,20000)
  const links=[...new Set((body.workstreamIds??[])as string[])];return {title,content:plain,doc,kind,visibility,source,links,state:state as string|null,outcome,contact,reason}
}
function parentsGuard(ids:string[],workspace:string,engagement:string,visibility:string) {
  if(!ids.length)return {sql:'1=1',values:[] as (string|number)[]}
  return {sql:`(SELECT count(*) FROM workstreams s WHERE s.id IN (${ids.map(()=>'?').join(',')}) AND s.workspace_id=? AND s.engagement_id=? AND s.archived_at IS NULL AND (?='private' OR s.visibility='shared'))=?`,values:[...ids,workspace,engagement,visibility,ids.length]}
}
function writer(member:Member) {
  return member.role==='owner'?ownerGuard:`EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=? AND m.role='editor' AND m.status='active' AND w.archived_at IS NULL)`
}
function history(db:D1Database,member:Member,id:string,nonce:string,action:string) {
  return [
    db.prepare(`INSERT INTO note_revisions(id,workspace_id,engagement_id,note_id,revision_number,body_json,authored_by)
      SELECT ?,n.workspace_id,n.engagement_id,n.id,n.version,json_object('title',n.title,'body',n.body,'bodyDoc',json(n.body_doc_json),'kind',n.kind,'decisionState',n.decision_state,'decisionOutcome',n.decision_outcome,'decisionContact',n.decision_contact,'supersededReason',n.superseded_reason,'sourceUrl',n.source_url,'visibility',n.visibility,'archivedAt',n.archived_at,'workstreamIds',json((SELECT json_group_array(workstream_id) FROM note_workstreams WHERE note_id=n.id))),?
      FROM strategy_notes n WHERE n.id=? AND n.last_mutation_id=?`).bind(crypto.randomUUID(),member.user_id,id,nonce),
    db.prepare(`INSERT INTO activity_events(id,workspace_id,engagement_id,actor_kind,actor_id,action,metadata_json)
      SELECT ?,workspace_id,engagement_id,'user',?,?,json_object('noteId',id) FROM strategy_notes WHERE id=? AND last_mutation_id=?`).bind(crypto.randomUUID(),member.user_id,action,id,nonce),
  ]
}
function linkWrites(db:D1Database,id:string,nonce:string,ids:string[]) {
  return [db.prepare('DELETE FROM note_workstreams WHERE note_id=? AND EXISTS(SELECT 1 FROM strategy_notes WHERE id=? AND last_mutation_id=?)').bind(id,id,nonce),
    ...ids.map(stream=>db.prepare('INSERT INTO note_workstreams(workspace_id,engagement_id,note_id,workstream_id) SELECT workspace_id,engagement_id,id,? FROM strategy_notes WHERE id=? AND last_mutation_id=?').bind(stream,id,nonce))]
}
export async function createNote(db:D1Database,member:Member,body:Record<string,unknown>) {
  rejectExtra(body,['engagementId','title','body','bodyDoc','kind','sourceUrl','visibility','workstreamIds','decisionState','decisionOutcome','decisionContact','supersededReason'])
  const v=validated(body,member),engagement=text(body.engagementId,'Engagement',200,true),id=crypto.randomUUID(),nonce=crypto.randomUUID()
  if(v.state==='superseded')throw new PortalError(400,'Record a decided outcome before superseding it.')
  const guard=parentsGuard(v.links,member.workspace_id,engagement,v.visibility)
  const result=await db.batch([
    db.prepare(`INSERT INTO strategy_notes(id,workspace_id,engagement_id,title,body,body_doc_json,kind,decision_state,decision_outcome,decision_contact,superseded_reason,source_url,visibility,updated_by,last_mutation_id)
      SELECT ?,workspace_id,id,?,?,?,?,?,?,?,?,?,?,?,? FROM engagements WHERE workspace_id=? AND id=? AND archived_at IS NULL AND ${writer(member)} AND ${guard.sql}`)
      .bind(id,v.title,v.content,v.doc,v.kind,v.state,v.outcome,v.contact,v.reason,v.source,v.visibility,member.user_id,nonce,member.workspace_id,engagement,member.workspace_id,member.user_id,...guard.values),
    ...linkWrites(db,id,nonce,v.links),...history(db,member,id,nonce,'note.created'),
  ])
  changed(result[0]);return getNote(db,member,id)
}
export async function editNote(db:D1Database,member:Member,id:string,body:Record<string,unknown>) {
  rejectExtra(body,['version','title','body','bodyDoc','kind','sourceUrl','visibility','workstreamIds','archived','decisionState','decisionOutcome','decisionContact','supersededReason'])
  if('decisionState'in body&&body.decisionState===null)throw new PortalError(400,'Choose a decision status.')
  const current=await getNote(db,member,id,member.role==='owner'),n=current.note
  if(member.role==='viewer'||(member.role==='editor'&&(n.decision_state!==null||n.kind==='agreed_decision'||Object.keys(body).some(k=>!['version','title','body','bodyDoc','sourceUrl'].includes(k)))))throw new PortalError(403,'Only the owner can change note classification, links, sharing, or archive state.')
  if('archived'in body&&typeof body.archived!=='boolean')throw new PortalError(400,'Invalid archive state.')
  const bodyDoc='bodyDoc'in body?body.bodyDoc:'body'in body?null:n.body_doc_json?JSON.parse(n.body_doc_json):null
  if('decisionState'in body&&body.decisionState==='superseded'&&(n.decision_state??(n.kind==='agreed_decision'?'decided':null))!=='decided'&&n.decision_state!=='superseded')throw new PortalError(400,'Record a decided outcome before superseding it.')
  if(n.decision_state===null&&!('decisionState'in body)&&['decisionOutcome','decisionContact','supersededReason'].some(key=>key in body))throw new PortalError(400,'Choose a decision status with its workflow fields.')
  const workflow=n.decision_state===null&&!('decisionState'in body)?{}:{decisionState:body.decisionState??n.decision_state,decisionOutcome:body.decisionOutcome??n.decision_outcome??'',decisionContact:body.decisionContact??n.decision_contact??'',supersededReason:body.supersededReason??n.superseded_reason??''}
  const v=validated({...workflow,title:body.title??n.title,body:body.body??n.body,bodyDoc,kind:body.kind??n.kind,sourceUrl:body.sourceUrl??n.source_url,visibility:body.visibility??n.visibility,workstreamIds:body.workstreamIds??current.links.map(l=>l.id)},member)
  const guard=body.archived===true&&Object.keys(body).every(k=>['version','archived'].includes(k))?{sql:'1=1',values:[]}:parentsGuard(v.links,member.workspace_id,n.engagement_id,v.visibility)
  const nonce=crypto.randomUUID(),archive='archived'in body?body.archived?new Date().toISOString():null:n.archived_at
  const result=await db.batch([
    db.prepare(`UPDATE strategy_notes AS n SET title=?,body=?,body_doc_json=?,kind=?,decision_state=?,decision_outcome=?,decision_contact=?,superseded_reason=?,source_url=?,visibility=?,archived_at=?,version=version+1,last_mutation_id=?,updated_by=?,updated_at=?
      WHERE workspace_id=? AND id=? AND version=? AND ${writer(member)} AND ${guard.sql}
      AND EXISTS (SELECT 1 FROM engagements e WHERE e.workspace_id=n.workspace_id AND e.id=n.engagement_id AND e.archived_at IS NULL)
      AND (?=1 OR (visibility='shared' AND decision_state IS NULL AND kind!='agreed_decision' AND archived_at IS NULL AND NOT ${hiddenParent}))`)
      .bind(v.title,v.content,v.doc,v.kind,v.state,v.outcome,v.contact,v.reason,v.source,v.visibility,archive,nonce,member.user_id,new Date().toISOString(),member.workspace_id,id,version(body.version),member.workspace_id,member.user_id,...guard.values,member.role==='owner'?1:0,member.role==='owner'?1:0),
    ...linkWrites(db,id,nonce,v.links),...history(db,member,id,nonce,'note.updated'),
  ])
  changed(result[0]);return getNote(db,member,id,member.role==='owner')
}
export async function noteDetail(db:D1Database,member:Member,id:string,preview=false) {
  const current=await getNote(db,member,id,member.role==='owner')
  if(preview){owner(member);const shareable=!current.note.archived_at&&current.links.every(l=>l.visibility==='shared'&&!l.archived_at);return {...current,note:{...current.note,visibility:'shared'},preview:true,shareable}}
  if(member.role!=='owner')return current
  const revisions=await db.prepare('SELECT revision_number,body_json,created_at FROM note_revisions WHERE workspace_id=? AND note_id=? ORDER BY revision_number DESC').bind(member.workspace_id,id).all()
  return {...current,revisions:revisions.results}
}
