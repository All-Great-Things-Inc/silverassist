import type { Env } from '../auth'
import { PortalError, ownerGuard, rejectExtra } from '../policy'
import { readSettings, validateSettings } from './settings'
export async function saveSettings(env:Env,workspaceId:string,userId:string,body:Record<string,unknown>) {
 rejectExtra(body,['settings','version'])
 const settings=validateSettings(body.settings),current=await readSettings(env.DB,workspaceId),nonce=crypto.randomUUID(),stamp=new Date().toISOString()
 if(body.version!==current.version)throw new PortalError(409,'Settings changed. Reload before saving.')
 const highest=await env.DB.prepare('SELECT MAX(sequence) AS highest FROM time_invoices WHERE workspace_id=?').bind(workspaceId).first<{highest:number|null}>()
 if(settings.nextNumber<=(highest?.highest??0))throw new PortalError(400,'Next invoice number must exceed every previously issued number.')
 const identityChanged=settings.expectedEmail!==current.settings.expectedEmail
 const calendarChanged=settings.calendarId!==current.settings.calendarId||identityChanged
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO time_settings(workspace_id,config_json,version,updated_at,mutation_id) SELECT ?,?,1,?,? WHERE ?=0 AND ${ownerGuard} ON CONFLICT(workspace_id) DO NOTHING`).bind(workspaceId,JSON.stringify(settings),stamp,nonce,current.version,workspaceId,userId),
  env.DB.prepare(`UPDATE time_settings SET config_json=?,version=version+1,updated_at=?,mutation_id=? WHERE workspace_id=? AND version=? AND ?>0 AND ${ownerGuard}`).bind(JSON.stringify(settings),stamp,nonce,workspaceId,current.version,current.version,workspaceId,userId),
  env.DB.prepare(`INSERT INTO activity_events(id,workspace_id,actor_kind,actor_id,action,metadata_json,created_at)
   SELECT ?,?,'user',?,'time.settings.updated',?,? WHERE EXISTS (SELECT 1 FROM time_settings WHERE workspace_id=? AND mutation_id=?)`).bind(nonce,workspaceId,userId,JSON.stringify({version:current.version+1}),stamp,workspaceId,nonce),
  env.DB.prepare(`DELETE FROM time_hours_cache WHERE workspace_id=? AND EXISTS (SELECT 1 FROM time_settings WHERE workspace_id=? AND mutation_id=?)`).bind(workspaceId,workspaceId,nonce),
  env.DB.prepare(`DELETE FROM time_oauth_states WHERE workspace_id=? AND ?=1 AND EXISTS (SELECT 1 FROM time_settings WHERE workspace_id=? AND mutation_id=?)`).bind(workspaceId,calendarChanged?1:0,workspaceId,nonce),
  env.DB.prepare(`UPDATE time_connections SET status='reconnect' WHERE workspace_id=? AND ?=1 AND EXISTS (SELECT 1 FROM time_settings WHERE workspace_id=? AND mutation_id=?)`).bind(workspaceId,identityChanged?1:0,workspaceId,nonce),
 ])
 if(results[0].meta.changes+results[1].meta.changes!==1)throw new PortalError(409,'Settings or access changed. Reload before saving.')
 return readSettings(env.DB,workspaceId)
}
