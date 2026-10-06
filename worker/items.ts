import { PortalError,type Member,owner,text,version,changed,rejectExtra } from './policy'
import { getStream } from './workstreams'
import { richJson } from './rich-text'
export type Item={id:string;workspace_id:string;engagement_id:string;workstream_id:string;title:string;details:string;details_doc_json:string|null;status:string;priority:number|null;assignee_name:string|null;due_date:string|null;visibility:string;version:number;completed_at:string|null;archived_at:string|null;updated_by:string|null;created_at:string;updated_at:string}
const fields='t.id,t.workspace_id,t.engagement_id,t.workstream_id,t.title,t.details,t.details_doc_json,t.status,t.priority,t.assignee_name,t.due_date,t.visibility,t.version,t.completed_at,t.archived_at,t.updated_by,t.created_at,t.updated_at'
const states=['draft','open','in_progress','blocked','completed','cancelled']
const liveParent=`EXISTS (SELECT 1 FROM workstreams s JOIN engagements e ON e.id=s.engagement_id AND e.workspace_id=s.workspace_id WHERE s.id=t.workstream_id AND s.workspace_id=t.workspace_id AND s.archived_at IS NULL AND e.archived_at IS NULL AND (?=1 OR s.visibility='shared'))`
const writer=`EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=t.workspace_id AND m.user_id=? AND m.status='active' AND w.archived_at IS NULL AND (m.role='owner' OR (m.role='editor' AND t.visibility='shared' AND t.archived_at IS NULL)))`
export async function getItem(db:D1Database,member:Member,id:string) {
  const row=await db.prepare(`SELECT ${fields} FROM tasks t JOIN workstreams s ON s.id=t.workstream_id AND s.workspace_id=t.workspace_id JOIN engagements e ON e.id=t.engagement_id AND e.workspace_id=t.workspace_id WHERE t.workspace_id=? AND t.id=? AND e.archived_at IS NULL AND (?=1 OR (t.visibility='shared' AND t.archived_at IS NULL AND s.visibility='shared' AND s.archived_at IS NULL))`).bind(member.workspace_id,id,member.role==='owner'?1:0).first<Item>()
  if(!row)throw new PortalError(404,'Item not found.')
  return row
}
export async function listItems(db:D1Database,member:Member,streamId:string,url:URL) {
  const parent=await getStream(db,member,streamId,member.role==='owner')
  const status=url.searchParams.get('status')??'',query=(url.searchParams.get('q')??'').slice(0,200),contact=(url.searchParams.get('owner')??'').slice(0,200)
  if(status&&!states.includes(status))throw new PortalError(400,'Invalid item status.')
  const escaped=(value:string)=>`%${value.replace(/[\\%_]/g,'\\$&')}%`
  const zone=(await db.prepare('SELECT e.timezone FROM engagements e JOIN workstreams s ON s.engagement_id=e.id AND s.workspace_id=e.workspace_id WHERE s.id=? AND s.workspace_id=?').bind(streamId,member.workspace_id).first<{timezone:string}>())!.timezone
  const dateParts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const part=(key:string)=>dateParts.find(value=>value.type===key)!.value
  const today=`${part('year')}-${part('month')}-${part('day')}`
  const rows=await db.prepare(`SELECT ${fields}
    FROM tasks t JOIN workstreams s ON s.id=t.workstream_id AND s.workspace_id=t.workspace_id JOIN engagements e ON e.id=t.engagement_id AND e.workspace_id=t.workspace_id
    WHERE t.workspace_id=? AND t.workstream_id=? AND e.archived_at IS NULL AND (?=1 OR (t.visibility='shared' AND s.visibility='shared'))
    AND (?=1 OR (t.archived_at IS NULL AND s.archived_at IS NULL)) AND (?='' OR t.status=?)
    AND (t.title LIKE ? ESCAPE '\\' OR t.details LIKE ? ESCAPE '\\') AND COALESCE(t.assignee_name,'') LIKE ? ESCAPE '\\'
    AND (?=0 OR (t.due_date<? AND t.status NOT IN ('completed','cancelled') AND t.archived_at IS NULL AND s.archived_at IS NULL))
    ORDER BY CASE WHEN t.status IN ('completed','cancelled') THEN 1 ELSE 0 END,t.priority IS NULL,t.priority,t.due_date IS NULL,t.due_date,t.created_at,t.id LIMIT 201`)
    .bind(member.workspace_id,streamId,member.role==='owner'?1:0,member.role==='owner'&&url.searchParams.get('archived')==='1'?1:0,status,status,escaped(query),escaped(query),escaped(contact),url.searchParams.get('overdue')==='1'?1:0,today).all<Item>()
  const items=rows.results.slice(0,200).map(item=>({...item,overdue:!!item.due_date&&item.due_date<today&&!['completed','cancelled'].includes(item.status)&&!item.archived_at&&!parent.archived_at}))
  return {items,hasMore:rows.results.length>200,today,timezone:zone}
}
function validated(body:Record<string,unknown>) {
  const title=text(body.title,'Item title',300,true),details=text(body.details??'','Item details',20000),status=String(body.status??'open'),visibility=String(body.visibility??'private')
  if(!states.includes(status)||!['private','shared'].includes(visibility))throw new PortalError(400,'Invalid item status or visibility.')
  if(body.priority!=null&&(!Number.isInteger(body.priority)||Number(body.priority)<1||Number(body.priority)>5))throw new PortalError(400,'Priority must be 1–5 or unset.')
  const contact=body.ownerName==null?'':text(body.ownerName,'Item owner or contact',200),date=body.dueDate==null?'':text(body.dueDate,'Due date',10)
  if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new PortalError(400,'Use a valid due date or leave it unset.')
  const plain=typeof body.details==='string'?body.details:details,doc=richJson(body.detailsDoc,plain,20000)
  return {title,details:plain,doc,status,visibility,contact:contact||null,date:date||null,priority:body.priority as number|null??null}
}
function snapshot(db:D1Database,member:Member,id:string,nonce:string,action:string) {
  return [db.prepare(`INSERT INTO task_revisions(id,workspace_id,engagement_id,task_id,revision_number,body_json,authored_by)
    SELECT ?,t.workspace_id,t.engagement_id,t.id,t.version,json_object('title',t.title,'details',t.details,'detailsDoc',json(t.details_doc_json),'status',t.status,'priority',t.priority,'ownerName',t.assignee_name,'dueDate',t.due_date,'visibility',t.visibility,'completedAt',t.completed_at,'archivedAt',t.archived_at),? FROM tasks t WHERE t.id=? AND t.last_mutation_id=?`).bind(crypto.randomUUID(),member.user_id,id,nonce),
    db.prepare(`INSERT INTO activity_events(id,workspace_id,engagement_id,workstream_id,task_id,actor_kind,actor_id,action) SELECT ?,workspace_id,engagement_id,workstream_id,id,'user',?,? FROM tasks WHERE id=? AND last_mutation_id=?`).bind(crypto.randomUUID(),member.user_id,action,id,nonce)]
}
export async function createItem(db:D1Database,member:Member,streamId:string,body:Record<string,unknown>) {
  if(member.role==='viewer')throw new PortalError(403,'Editing access required.')
  rejectExtra(body,['title','details','detailsDoc','status','priority','ownerName','dueDate','visibility'])
  const stream=await getStream(db,member,streamId),v=validated(body)
  if(v.visibility==='shared'&&stream.visibility!=='shared')throw new PortalError(400,'Share the workstream before sharing an item.')
  if(member.role==='editor'&&v.visibility!=='shared')throw new PortalError(403,'Editors may create shared items only.')
  const id=crypto.randomUUID(),nonce=crypto.randomUUID(),now=new Date().toISOString()
  const result=await db.batch([db.prepare(`INSERT INTO tasks(id,workspace_id,engagement_id,workstream_id,title,details,details_doc_json,status,priority,assignee_name,due_date,visibility,updated_by,completed_at,last_mutation_id)
    SELECT ?,s.workspace_id,s.engagement_id,s.id,?,?,?,?,?,?,?,?,?,?,? FROM workstreams s JOIN engagements e ON e.id=s.engagement_id AND e.workspace_id=s.workspace_id JOIN workspaces w ON w.id=s.workspace_id
    WHERE s.workspace_id=? AND s.id=? AND s.archived_at IS NULL AND e.archived_at IS NULL AND w.archived_at IS NULL AND (?='private' OR s.visibility='shared') AND EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=s.workspace_id AND m.user_id=? AND m.status='active' AND (m.role='owner' OR (m.role='editor' AND s.visibility='shared' AND ?='shared')))`)
    .bind(id,v.title,v.details,v.doc,v.status,v.priority,v.contact,v.date,v.visibility,member.user_id,v.status==='completed'?now:null,nonce,member.workspace_id,streamId,v.visibility,member.user_id,v.visibility),...snapshot(db,member,id,nonce,'item.created')])
  changed(result[0]);return getItem(db,member,id)
}
export async function editItem(db:D1Database,member:Member,id:string,body:Record<string,unknown>) {
  rejectExtra(body,['version','title','details','detailsDoc','status','priority','ownerName','dueDate','visibility','archived'])
  const n=await getItem(db,member,id)
  if(member.role==='viewer'||member.role==='editor'&&Object.keys(body).some(key=>['visibility','archived'].includes(key)))throw new PortalError(403,'Only the owner can share or archive an item.')
  if('archived'in body&&typeof body.archived!=='boolean')throw new PortalError(400,'Invalid archive state.')
  if(n.archived_at&&Object.keys(body).some(key=>!['version','archived'].includes(key)))throw new PortalError(400,'Restore the item before editing it.')
  const expected=version(body.version),v=validated({title:body.title??n.title,details:body.details??n.details,detailsDoc:'detailsDoc'in body?body.detailsDoc:'details'in body?null:n.details_doc_json?JSON.parse(n.details_doc_json):null,status:body.status??n.status,priority:'priority'in body?body.priority:n.priority,ownerName:'ownerName'in body?body.ownerName:n.assignee_name,dueDate:'dueDate'in body?body.dueDate:n.due_date,visibility:body.visibility??n.visibility})
  const stream=await getStream(db,member,n.workstream_id,member.role==='owner')
  if(body.visibility==='shared'&&stream.visibility!=='shared')throw new PortalError(400,'Share the workstream before sharing an item.')
  const nonce=crypto.randomUUID(),now=new Date().toISOString(),completed=v.status==='completed'?(n.status==='completed'?n.completed_at:now):null
  const parentGuard=body.archived===true&&Object.keys(body).every(key=>['version','archived'].includes(key))?"EXISTS (SELECT 1 FROM engagements e WHERE e.id=t.engagement_id AND e.workspace_id=t.workspace_id AND e.archived_at IS NULL)":liveParent
  const parentValues=parentGuard===liveParent?[member.role==='owner'?1:0]:[]
  const result=await db.batch([db.prepare(`UPDATE tasks AS t SET title=?,details=?,details_doc_json=?,status=?,priority=?,assignee_name=?,due_date=?,visibility=?,completed_at=?,archived_at=?,updated_by=?,updated_at=?,last_mutation_id=?,version=version+1 WHERE t.workspace_id=? AND t.id=? AND t.version=? AND ${writer} AND ${parentGuard} AND (?=0 OR EXISTS(SELECT 1 FROM workstreams s WHERE s.id=t.workstream_id AND s.workspace_id=t.workspace_id AND s.visibility='shared'))`)
    .bind(v.title,v.details,v.doc,v.status,v.priority,v.contact,v.date,v.visibility,completed,'archived'in body?body.archived?now:null:n.archived_at,member.user_id,now,nonce,member.workspace_id,id,expected,member.user_id,...parentValues,body.visibility==='shared'?1:0),
    db.prepare(`INSERT OR IGNORE INTO task_revisions(id,workspace_id,engagement_id,task_id,revision_number,body_json,authored_by) SELECT ?,workspace_id,engagement_id,id,?,?,? FROM tasks WHERE id=? AND last_mutation_id=?`).bind(crypto.randomUUID(),n.version,JSON.stringify({title:n.title,details:n.details,detailsDoc:n.details_doc_json?JSON.parse(n.details_doc_json):null,status:n.status,priority:n.priority,ownerName:n.assignee_name,dueDate:n.due_date,visibility:n.visibility,completedAt:n.completed_at,archivedAt:n.archived_at}),n.updated_by??member.user_id,id,nonce),...snapshot(db,member,id,nonce,'item.updated')])
  changed(result[0]);return getItem(db,member,id)
}
export async function itemDetail(db:D1Database,member:Member,id:string,preview=false) {
  const item=await getItem(db,member,id)
  if(preview){owner(member);const parent=await getStream(db,member,item.workstream_id,true);return {item,shareable:parent.visibility==='shared'&&!parent.archived_at&&!item.archived_at}}
  if(member.role!=='owner')return {item}
  const revisions=(await db.prepare('SELECT revision_number,body_json,created_at FROM task_revisions WHERE task_id=? AND workspace_id=? ORDER BY revision_number DESC').bind(id,member.workspace_id).all()).results
  return {item,revisions}
}
