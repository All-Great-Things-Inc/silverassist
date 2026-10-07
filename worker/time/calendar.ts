import type { CalendarEvent } from '../../shared/time'
import { PortalError, hashToken, ownerGuard } from '../policy'
import type { Env } from '../auth'
import { calculate, midnight } from './logic'
import { readSettings } from './settings'
export const scope='https://www.googleapis.com/auth/calendar.readonly'
export const callbackPath='/api/time/calendar/callback'
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}})
export function randomToken() {return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
function config(env:Env) {if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.TIME_TOKEN_KEY)throw new PortalError(503,'Calendar connection is not configured. Contact your administrator.')}
async function key(env:Env) {
 if(!env.TIME_TOKEN_KEY || !/^[a-f0-9]{64}$/i.test(env.TIME_TOKEN_KEY))throw new PortalError(503,'Calendar encryption is not configured.')
 return crypto.subtle.importKey('raw',Uint8Array.from(env.TIME_TOKEN_KEY.match(/../g)!,v=>parseInt(v,16)),{name:'AES-GCM'},false,['encrypt','decrypt'])
}
export async function encrypt(value:string,env:Env,aad:string) {
 const iv=crypto.getRandomValues(new Uint8Array(12)), data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},await key(env),new TextEncoder().encode(value))
 return JSON.stringify({iv:Array.from(iv),data:Array.from(new Uint8Array(data))})
}
export async function decrypt(value:string,env:Env,aad:string) {
 const {iv,data}=JSON.parse(value)
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:new TextEncoder().encode(aad)},await key(env),new Uint8Array(data))
 return new TextDecoder().decode(plain)
}
export async function google(url:string,init:RequestInit={},fetcher:typeof fetch=fetch):Promise<Record<string,unknown>> {
 let response:Response
 try {response=await fetcher(url,{...init,signal:AbortSignal.timeout(20000)})}catch {throw new PortalError(502,'Calendar hours unavailable. Retry shortly.')}
 let body:Record<string,unknown>
 try {body=await response.json() as Record<string,unknown>}catch {throw new PortalError(502,'Calendar returned an invalid response.')}
 if(!response.ok)throw new PortalError(502,body.error==='invalid_grant'?'Calendar disconnected. Reconnect your Google account.':'Calendar hours unavailable. Check your connection and retry.')
 return body
}
async function exchange(env:Env,body:Record<string,string>) {
 config(env)
 return google('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!})})
}
export async function connect(env:Env,workspaceId:string,userId:string,sessionId:string) {
 config(env);const {settings}=await readSettings(env.DB,workspaceId),state=randomToken(),verifier=randomToken()
 const hash=await hashToken(state),cipher=await encrypt(verifier,env,hash)
 await env.DB.prepare('DELETE FROM time_oauth_states WHERE expires_at<?').bind(Date.now()).run()
 await env.DB.prepare(`INSERT INTO time_oauth_states(state_hash,workspace_id,user_id,session_hash,verifier_cipher,expires_at)
  SELECT ?,?,?,?,?,? WHERE ${ownerGuard}`).bind(hash,workspaceId,userId,await hashToken(sessionId),cipher,Date.now()+600000,workspaceId,userId).run()
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))
 const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth')
 url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,redirect_uri:env.AUTH_BASE_URL+callbackPath,response_type:'code',scope,access_type:'offline',prompt:'consent',state,login_hint:settings.expectedEmail,code_challenge:challenge,code_challenge_method:'S256'}).toString()
 return json({url:url.toString()})
}
export async function callback(request:Request,env:Env,userId:string,sessionId:string) {
 const query=new URL(request.url).searchParams, state=query.get('state')
 if(!state||!/^[a-f0-9]{64}$/.test(state))throw new PortalError(400,'Invalid Calendar authorization state.')
 const hash=await hashToken(state)
 const row=await env.DB.prepare(`UPDATE time_oauth_states SET used=1 WHERE used=0 AND state_hash=? AND user_id=? AND session_hash=? AND expires_at>?
  AND EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=time_oauth_states.workspace_id AND m.user_id=? AND m.role='owner' AND m.status='active' AND w.archived_at IS NULL)
  RETURNING workspace_id,verifier_cipher`).bind(hash,userId,await hashToken(sessionId),Date.now(),userId).first<{workspace_id:string;verifier_cipher:string}>()
 if(!row)throw new PortalError(403,'Calendar authorization expired or access was removed. Start again.')
 if(query.has('error'))return new Response(null,{status:303,headers:{Location:env.AUTH_BASE_URL+'/time#calendar-denied','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
 const code=query.get('code');if(!code)throw new PortalError(400,'Missing Calendar authorization code.')
 const tokens=await exchange(env,{code,grant_type:'authorization_code',redirect_uri:env.AUTH_BASE_URL+callbackPath,code_verifier:await decrypt(row.verifier_cipher,env,hash)})
 if(typeof tokens.refresh_token!=='string'||typeof tokens.access_token!=='string'||typeof tokens.scope!=='string'||!tokens.scope.split(' ').includes(scope))throw new PortalError(502,'Read-only offline Calendar permission is required. Reconnect.')
 // Primary calendar ID identifies the consenting Google account without requesting identity scopes.
 const account=await google('https://www.googleapis.com/calendar/v3/calendars/primary',{headers:{Authorization:'Bearer '+tokens.access_token}})
 const {settings}=await readSettings(env.DB,row.workspace_id)
 if(typeof account.id!=='string'||account.id.toLowerCase()!==settings.expectedEmail.toLowerCase())throw new PortalError(403,'Connect the Google account specified in Time settings.')
 const cipher=await encrypt(tokens.refresh_token,env,row.workspace_id+':'+userId)
 const saved=await env.DB.batch([
  env.DB.prepare(`INSERT INTO time_connections(workspace_id,id,user_id,account_email,token_cipher,status,updated_at)
   SELECT ?,?,?,?,?,'connected',? WHERE ${ownerGuard} AND EXISTS (SELECT 1 FROM time_oauth_states WHERE state_hash=? AND used=1)
   ON CONFLICT(workspace_id) DO UPDATE SET id=excluded.id,user_id=excluded.user_id,account_email=excluded.account_email,token_cipher=excluded.token_cipher,status='connected',updated_at=excluded.updated_at`).bind(row.workspace_id,crypto.randomUUID(),userId,account.id,cipher,new Date().toISOString(),row.workspace_id,userId,hash),
  env.DB.prepare('DELETE FROM time_hours_cache WHERE workspace_id=?').bind(row.workspace_id),
 ])
 await env.DB.prepare('DELETE FROM time_oauth_states WHERE state_hash=?').bind(hash).run()
 if(saved[0].meta.changes!==1)throw new PortalError(409,'Calendar connection changed. Start again.')
 return new Response(null,{status:303,headers:{Location:env.AUTH_BASE_URL+'/time#calendar-connected','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
}
export async function connectionStatus(env:Env,workspaceId:string) {
 const row=await env.DB.prepare('SELECT account_email,status FROM time_connections WHERE workspace_id=?').bind(workspaceId).first()
 return {connection:row,configured:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.TIME_TOKEN_KEY)}
}
export async function disconnect(env:Env,workspaceId:string,userId:string) {
 await env.DB.batch([
  env.DB.prepare(`DELETE FROM time_connections WHERE workspace_id=? AND ${ownerGuard}`).bind(workspaceId,workspaceId,userId),
  env.DB.prepare(`DELETE FROM time_oauth_states WHERE workspace_id=? AND ${ownerGuard}`).bind(workspaceId,workspaceId,userId),
  env.DB.prepare(`DELETE FROM time_hours_cache WHERE workspace_id=? AND ${ownerGuard}`).bind(workspaceId,workspaceId,userId),
 ])
 return json({disconnected:true})
}
export async function fetchEvents(token:string,calendarId:string,start:number,now:number,fetcher:typeof fetch=fetch) {
 const events:CalendarEvent[]=[],seen=new Set<string>();let pageToken=''
 do {
  const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events')
  url.search=new URLSearchParams({singleEvents:'true',orderBy:'startTime',maxResults:'2500',timeMin:new Date(start).toISOString(),timeMax:new Date(now).toISOString(),showDeleted:'false',...(pageToken?{pageToken}:{})}).toString()
  const body=await google(url.toString(),{headers:{Authorization:'Bearer '+token}},fetcher)
  if(!Array.isArray(body.items))throw new PortalError(502,'Calendar returned incomplete event data.')
  events.push(...body.items as CalendarEvent[])
  if(body.nextPageToken!==undefined&&typeof body.nextPageToken!=='string')throw new PortalError(502,'Calendar returned invalid paging data.')
  pageToken=body.nextPageToken as string||''
  if(pageToken&&seen.has(pageToken))throw new PortalError(502,'Calendar paging did not complete.')
  seen.add(pageToken)
 }while(pageToken)
 return events
}
export async function hours(env:Env,workspaceId:string,userId:string,refresh=false) {
 const {settings,version}=await readSettings(env.DB,workspaceId)
 const row=await env.DB.prepare('SELECT id,user_id,token_cipher,status FROM time_connections WHERE workspace_id=?').bind(workspaceId).first<{id:string;user_id:string;token_cipher:string;status:string}>()
 if(!row||row.status!=='connected'||row.user_id!==userId)throw new PortalError(409,'Calendar disconnected. Connect your Google account.')
 const now=Date.now()
 if(!refresh){const cache=await env.DB.prepare('SELECT payload_json FROM time_hours_cache WHERE workspace_id=? AND connection_id=? AND settings_version=? AND expires_at>?').bind(workspaceId,row.id,version,now).first<{payload_json:string}>();if(cache)return json(JSON.parse(cache.payload_json))}
 let tokens:Record<string,unknown>
 try {tokens=await exchange(env,{grant_type:'refresh_token',refresh_token:await decrypt(row.token_cipher,env,workspaceId+':'+userId)})}
 catch(error){if(error instanceof PortalError&&error.message.includes('disconnected'))await env.DB.prepare("UPDATE time_connections SET status='reconnect' WHERE workspace_id=? AND id=?").bind(workspaceId,row.id).run();throw error}
 if(typeof tokens.access_token!=='string')throw new PortalError(502,'Calendar returned an invalid access grant.')
 const start=midnight(settings.buckets.map(b=>b.startDate).sort()[0],settings.timezone)
 const events=start>=now?[]:await fetchEvents(tokens.access_token,settings.calendarId,start,now)
 const result=calculate(events,settings,now)
 // Conditional cache write prevents disconnected/stale configuration fetches from overwriting current results.
 await env.DB.prepare(`INSERT INTO time_hours_cache(workspace_id,connection_id,settings_version,payload_json,expires_at)
 SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM time_connections WHERE workspace_id=? AND id=? AND status='connected')
 AND COALESCE((SELECT version FROM time_settings WHERE workspace_id=?),0)=? AND ${ownerGuard}
 ON CONFLICT(workspace_id) DO UPDATE SET connection_id=excluded.connection_id,settings_version=excluded.settings_version,payload_json=excluded.payload_json,expires_at=excluded.expires_at
 WHERE excluded.expires_at>time_hours_cache.expires_at`).bind(workspaceId,row.id,version,JSON.stringify(result),now+settings.cacheSeconds*1000,workspaceId,row.id,workspaceId,version,workspaceId,userId).run()
 const valid=await env.DB.prepare(`SELECT id FROM time_connections WHERE workspace_id=? AND id=? AND status='connected' AND ${ownerGuard}`).bind(workspaceId,row.id,workspaceId,userId).first()
 if(!valid)throw new PortalError(403,'Calendar connection or workspace access changed. Refresh.')
 return json(result)
}
