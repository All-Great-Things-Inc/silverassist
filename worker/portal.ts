import { type Env,isLocalSpike } from './auth'
import { PortalError,membership,owner,rejectExtra } from './policy'
import { createInvitation,acceptInvitation,revokeInvitation,revokeMember } from './invitations'
import { listWorkstreams,streamDetail,createStream,editStream } from './workstreams'
import { saveDraft,publishScope } from './scopes'
import { listItems,itemDetail,createItem,editItem } from './items'
import { listNotes,noteDetail,createNote,editNote } from './notes'

type User={id:string;email:string;emailVerified:boolean}
export async function portal(request:Request,env:Env,user:User) {
  const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean)
  const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
  if(!user.emailVerified)throw new PortalError(401,'Verify your email first.')
  if(!['GET','POST','PATCH'].includes(request.method))throw new PortalError(405,'Method not allowed.')
  if(request.method!=='GET'&&request.headers.get('Origin')!==env.AUTH_BASE_URL)throw new PortalError(403,'This request must come from the application.')
  const body=async()=>{
    if(!request.headers.get('Content-Type')?.includes('application/json'))throw new PortalError(400,'JSON required.')
    const raw=await request.text()
    // Six formatted scope fields include both searchable text and bounded document JSON.
    if(raw.length>256000)throw new PortalError(413,'Request too large.')
    let value
    try{value=JSON.parse(raw)}catch{throw new PortalError(400,'Invalid JSON.')}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new PortalError(400,'Object required.')
    return value as Record<string,unknown>
  }
  if(url.pathname==='/api/invitations/accept'&&request.method==='POST') {
    const data=await body();rejectExtra(data,['token'])
    return json(await acceptInvitation(env.DB,user,data.token))
  }
  if(url.pathname==='/api/workspaces'&&request.method==='GET') {
    const result=await env.DB.prepare(`SELECT w.id,w.name,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id
      WHERE m.user_id=? AND m.status='active' AND w.archived_at IS NULL ORDER BY w.created_at,w.id`).bind(user.id).all()
    return json({workspaces:result.results})
  }
  const workspaceId=parts[2]
  if(!workspaceId)throw new PortalError(404,'Not found.')
  const member=await membership(env.DB,workspaceId,user.id)
  const section=parts[3],id=parts[4],action=parts[5]
  if(section==='engagements'&&request.method==='GET'&&!id) {
    const result=await env.DB.prepare(`SELECT id,title FROM engagements WHERE workspace_id=? AND archived_at IS NULL ORDER BY created_at,id`).bind(workspaceId).all()
    return json({engagements:result.results})
  }
  if(section==='workstreams') {
    if(id&&action==='decisions') {
      const effective=url.searchParams.get('preview')==='1'?(owner(member),{...member,role:'viewer' as const}):member
      const parent=await streamDetail(env.DB,effective,id)
      if(request.method==='GET') {
        const state=url.searchParams.get('state')??''
        if(state&&!['awaiting','decided','superseded'].includes(state))throw new PortalError(400,'Invalid decision status filter.')
        const notes=await listNotes(env.DB,effective,url.searchParams.get('archived')==='1',(url.searchParams.get('q')??'').slice(0,200),id,state)
        return json({notes:notes.slice(0,100),count:Math.min(notes.length,100),hasMore:notes.length>100})
      }
      if(request.method==='POST') {
        owner(member)
        const data=await body();rejectExtra(data,['title','body','bodyDoc','sourceUrl','workstreamIds','decisionState','decisionOutcome','decisionContact','supersededReason'])
        const links=data.workstreamIds??[]
        if(!Array.isArray(links)||links.some(v=>typeof v!=='string')||links.length>29)throw new PortalError(400,'Choose up to 29 additional workstreams.')
        return json(await createNote(env.DB,member,{...data,decisionState:'decisionState'in data?data.decisionState:'awaiting',kind:'agreed_decision',visibility:'private',engagementId:parent.stream.engagement_id,workstreamIds:[...new Set([id,...links])]}),201)
      }
      throw new PortalError(405,'Method not allowed.')
    }
    if(id&&action==='items') {
      if(request.method==='GET'){
        const effective=url.searchParams.get('preview')==='1'?(owner(member),{...member,role:'viewer' as const}):member
        return json(await listItems(env.DB,effective,id,url))
      }
      if(request.method==='POST')return json({item:await createItem(env.DB,member,id,await body())},201)
    }
    if(request.method==='GET') {
      if(id){
        if(url.searchParams.get('preview')==='1'){owner(member);return json(await streamDetail(env.DB,{...member,role:'viewer'},id))}
        return json(await streamDetail(env.DB,member,id,action==='share-preview'))
      }
      const streams=await listWorkstreams(env.DB,member,url.searchParams.get('archived')==='1',url.searchParams.get('preview')==='1')
      return json({workstreams:streams,count:streams.length,preview:url.searchParams.get('preview')==='1'})
    }
    if(request.method==='POST'&&id&&action==='draft')return json(await saveDraft(env.DB,member,id,await body()))
    if(request.method==='POST'&&id&&action==='revisions')return json(await publishScope(env.DB,member,id,await body()),201)
    if(request.method==='POST'&&!id)return json(await createStream(env.DB,member,await body()),201)
    if(request.method==='PATCH'&&id&&!action)return json({stream:await editStream(env.DB,member,id,await body())})
  }
  if(section==='items') {
    if(request.method==='GET'&&id){const effective=url.searchParams.get('preview')==='1'?(owner(member),{...member,role:'viewer' as const}):member;return json(await itemDetail(env.DB,effective,id,action==='share-preview'))}
    if(request.method==='PATCH'&&id&&!action)return json({item:await editItem(env.DB,member,id,await body())})
  }
  if(section==='notes') {
    if(request.method==='GET') {
      if(id){const effective=url.searchParams.get('preview')==='1'?(owner(member),{...member,role:'viewer' as const}):member;return json(await noteDetail(env.DB,effective,id,action==='share-preview'))}
      const notes=await listNotes(env.DB,member,url.searchParams.get('archived')==='1',(url.searchParams.get('q')??'').slice(0,200))
      return json({notes,count:notes.length})
    }
    if(request.method==='POST'&&!id)return json(await createNote(env.DB,member,await body()),201)
    if(request.method==='PATCH'&&id&&!action)return json(await editNote(env.DB,member,id,await body()))
  }
  if(section==='members') {
    owner(member)
    if(request.method==='GET'&&!id) {
      const result=await env.DB.prepare(`SELECT m.user_id,m.role,m.status,u.name,u.email FROM memberships m JOIN user u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at`).bind(workspaceId).all()
      return json({members:result.results})
    }
    if(request.method==='POST'&&id&&action==='revoke'){rejectExtra(await body(),[]);await revokeMember(env.DB,member,id);return json({revoked:true})}
  }
  if(section==='invitations') {
    owner(member)
    if(request.method==='GET'&&!id){const result=await env.DB.prepare(`SELECT id,email,role,expires_at,accepted_at,revoked_at FROM invitations WHERE workspace_id=? ORDER BY created_at DESC`).bind(workspaceId).all();return json({invitations:result.results})}
    if(request.method==='POST'&&!id) {
      if(!isLocalSpike(request,env))throw new PortalError(503,'Invitation email delivery is not configured.')
      const invite=await createInvitation(env.DB,member,await body())
      await env.MAIL_OUTBOX.put(`${crypto.randomUUID()}.json`,JSON.stringify({kind:'invitation',invitationId:invite.id,email:invite.email,url:`${env.AUTH_BASE_URL}/accept-invitation?token=${invite.token}`,createdAt:new Date().toISOString()}))
      const {token: _token,...safe}=invite
      return json({...safe,delivery:'development-outbox'},201)
    }
    if(request.method==='POST'&&id&&action==='revoke'){rejectExtra(await body(),[]);await revokeInvitation(env.DB,member,id);return json({revoked:true})}
  }
  if(section==='activity'&&request.method==='GET'&&!id){owner(member);const result=await env.DB.prepare('SELECT id,action,created_at FROM activity_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').bind(workspaceId).all();return json({activity:result.results})}
  throw new PortalError(404,'Not found.')
}
