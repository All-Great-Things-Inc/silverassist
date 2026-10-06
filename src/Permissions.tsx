import { useEffect,useState } from 'react'
export function Permissions({workspaceId}:{workspaceId:string}) {
  const [members,setMembers]=useState<{user_id:string;name:string;email:string;role:string;status:string}[]>([])
  const [invitations,setInvitations]=useState<{id:string;email:string;role:string;accepted_at:string|null;revoked_at:string|null;expires_at:string}[]>([])
  const [email,setEmail]=useState(''),[role,setRole]=useState('viewer'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [mailLinks,setMailLinks]=useState<Record<string,string>>({})
  const base=`/api/workspaces/${workspaceId}`
  async function request(path:string,body?:object) {
    const response=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
    const result=await response.json();if(!response.ok)throw new Error(result.error??'Unable to load access.');return result
  }
  async function load(){setMembers((await request('/members')).members);setInvitations((await request('/invitations')).invitations)}
  useEffect(()=>{load().catch(e=>setMessage(e.message))},[workspaceId])
  async function mutate(path:string,body:object,success:string){setBusy(true);try{await request(path,body);await load();setMessage(success)}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
  return <><h1>Workspace access</h1><p className="lede">Private records stay visible only to you. Shared members see content you explicitly share.</p>
    <section className="foundation-panel"><h2>Members</h2><ul>{members.map(m=><li key={m.user_id}><strong>{m.name}</strong> · {m.email}<p>{m.role} · {m.status}</p>{m.role!=='owner'&&m.status==='active'&&<button className="outline-button" disabled={busy} onClick={()=>mutate(`/members/${m.user_id}/revoke`,{},'Access revoked.')}>Revoke access for {m.name}</button>}</li>)}</ul></section>
    <section className="foundation-panel portal-section"><h2>Invite a member</h2><p>Development mail · local only. Invitations are captured on this computer; no email is sent to an inbox.</p>
      <form onSubmit={e=>{e.preventDefault();mutate('/invitations',{email,role},'Invitation saved to local development mail.')}}>
        <label htmlFor="invite-email">Invite email</label><input id="invite-email" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/>
        <label htmlFor="invite-role">Access role</label><select id="invite-role" value={role} onChange={e=>setRole(e.target.value)}><option value="viewer">Shared viewer</option><option value="editor">Shared editor</option></select>
        <button className="primary-button" disabled={busy}>Create local invitation</button>
      </form>
      <ul>{invitations.map(i=><li key={i.id}>{i.email} · {i.role} · {i.accepted_at?'Accepted':i.revoked_at?'Revoked':new Date(i.expires_at)<new Date()?'Expired':'Pending'}{!i.accepted_at&&!i.revoked_at&&<button className="text-button" disabled={busy} onClick={()=>mutate(`/invitations/${i.id}/revoke`,{},'Invitation revoked.')}>Revoke invitation for {i.email}</button>}{import.meta.env.DEV&&!i.accepted_at&&!i.revoked_at&&<><button className="text-button" onClick={async()=>{try{const outbox=await fetch('/api/dev/outbox').then(r=>r.json());const mail=outbox.messages?.find((m:{invitationId?:string})=>m.invitationId===i.id);if(!mail)throw new Error('Local invitation mail is unavailable.');setMailLinks({...mailLinks,[i.id]:mail.url})}catch(e){setMessage((e as Error).message)}}}>Show local invitation for {i.email}</button>{mailLinks[i.id]&&<p><a className="text-link" href={mailLinks[i.id]}>Open local invitation</a></p>}</>}</li>)}</ul>
    </section><p role="status">{message}</p></>
}
