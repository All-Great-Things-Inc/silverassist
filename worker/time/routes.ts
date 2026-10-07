import type { Env } from '../auth'
import { PortalError, membership, owner } from '../policy'
import { callback, connect, connectionStatus, disconnect, hours } from './calendar'
import { listInvoices, getInvoice, createInvoice, updateInvoice } from './invoices'
import { readSettings } from './settings'
export const timeJson=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
export async function timeRoutes(request:Request,env:Env,user:{id:string;emailVerified:boolean}|null,sessionId:string) {
 try {
  if(!user||!user.emailVerified)throw new PortalError(401,'Sign in required.')
  const url=new URL(request.url)
  if(url.pathname==='/api/time/calendar/callback')return await callback(request,env,user.id,sessionId)
  const parts=url.pathname.split('/').filter(Boolean),workspaceId=parts[2],section=parts[4]
  const member=await membership(env.DB,workspaceId,user.id);owner(member)
  if(request.method!=='GET'&&request.headers.get('Origin')!==env.AUTH_BASE_URL)throw new PortalError(403,'This request must come from the application.')
  const body=async()=>{
   if(!request.headers.get('Content-Type')?.includes('application/json'))throw new PortalError(400,'JSON required.')
   const raw=await request.text();if(raw.length>64000)throw new PortalError(413,'Request too large.')
   let value;try{value=JSON.parse(raw)}catch{throw new PortalError(400,'Invalid JSON.')}
   if(!value||typeof value!=='object'||Array.isArray(value))throw new PortalError(400,'Object required.')
   return value as Record<string,unknown>
  }
  if(section==='invoices') {
   const id=parts[5]
   if(request.method==='GET')return timeJson(id?{invoice:await getInvoice(env,workspaceId,id)}:{invoices:await listInvoices(env,workspaceId)})
   if(request.method==='POST'&&!id)return timeJson({invoice:await createInvoice(env,workspaceId,user.id,await body())},201)
   if(request.method==='PATCH'&&id)return timeJson({invoice:await updateInvoice(env,workspaceId,user.id,id,await body())})
   if(request.method==='DELETE'&&id)return timeJson({invoice:await updateInvoice(env,workspaceId,user.id,id,await body(),true)})
   throw new PortalError(405,'Method not allowed.')
  }
  if(section==='settings' &&request.method==='GET')return timeJson(await readSettings(env.DB,workspaceId))
  if(section==='calendar'&&request.method==='GET')return timeJson(await connectionStatus(env,workspaceId))
  if(section==='connect'&&request.method==='POST')return await connect(env,workspaceId,user.id,sessionId)
  if(section==='disconnect'&&request.method==='POST')return await disconnect(env,workspaceId,user.id)
  if(section==='hours'&&(request.method==='GET'||request.method==='POST'))return await hours(env,workspaceId,user.id,request.method==='POST')
  throw new PortalError(405,'Method not allowed.')
 }catch(error){return timeJson({error:error instanceof PortalError?error.message:'Time data unavailable. Please retry.',...(error instanceof PortalError&&error.message.includes('disconnected')?{reconnect:true}:{})},error instanceof PortalError?error.status:502)}
}
