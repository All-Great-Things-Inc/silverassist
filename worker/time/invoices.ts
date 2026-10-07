import type { Env } from '../auth'
import type { Invoice, Hours } from '../../shared/time'
import { PortalError, ownerGuard, rejectExtra } from '../policy'
import { readSettings, dateOnly } from './settings'
import { hours } from './calendar'
import { dayKey, addDays } from './logic'
import { invoiceSnapshot, periodEnd } from './invoice-logic'
type Stored = Omit<Invoice,'snapshot'> & {snapshot_json:string}
const decoded=(row:Stored):Invoice=>{const {snapshot_json,...fields}=row;return {...fields,snapshot:JSON.parse(snapshot_json)}}
export async function listInvoices(env:Env,workspaceId:string) {
 const rows=await env.DB.prepare('SELECT * FROM time_invoices WHERE workspace_id=? ORDER BY created_at DESC,id DESC').bind(workspaceId).all<Stored>()
 return rows.results.map(decoded)
}
export async function getInvoice(env:Env,workspaceId:string,id:string) {
 const row=await env.DB.prepare('SELECT * FROM time_invoices WHERE workspace_id=? AND id=?').bind(workspaceId,id).first<Stored>()
 if(!row)throw new PortalError(404,'Invoice not found.');return decoded(row)
}
export async function createInvoice(env:Env,workspaceId:string,userId:string,body:Record<string,unknown>) {
 rejectExtra(body,['bucket','month','invoicedOn','extraItems'])
 const {settings,version}=await readSettings(env.DB,workspaceId),month=body.month
 if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!dateOnly(month+'-01'))throw new PortalError(400,'Choose a valid invoice month.')
 const today=dayKey(Date.now(),settings.timezone),end=periodEnd(month)
 if(end>today)throw new PortalError(400,'Monthly invoices can be issued after the full month has ended.')
 const issued=body.invoicedOn??today
 if(!dateOnly(issued)||issued<end||issued>today)throw new PortalError(400,'Issue date must be after the billed month and no later than today.')
 if(!settings.billFrom.trim()||!settings.billTo.trim())throw new PortalError(400,'Complete bill-from and bill-to in Time settings before issuing an invoice.')
 if(body.extraItems!==undefined&&(!Array.isArray(body.extraItems)||body.extraItems.length>30))throw new PortalError(400,'Choose up to 30 additional line items.')
 // Always fetch current source data. A partial Calendar failure cannot create an invoice.
 const response=await hours(env,workspaceId,userId,true),data=await response.json() as Hours
 if(settings.overlapPolicy==='flag'&&data.overlapDays.some(d=>d.startsWith(month)))throw new PortalError(409,'Resolve overlapping Calendar events before invoicing this month.')
 const snapshot=invoiceSnapshot(data,settings,String(body.bucket),month,(body.extraItems??[]) as {description:string;hours:number;rate:number}[])
 const id=crypto.randomUUID(),number=settings.invoicePrefix+String(settings.nextNumber).padStart(settings.invoicePadding,'0'),stamp=new Date().toISOString(),next={...settings,nextNumber:settings.nextNumber+1}
 const {invoicePdf}=await import('./pdf')
 // Validate renderability before issuing an immutable invoice.
 await invoicePdf({id,bucket_key:String(body.bucket),number,period_start:month+'-01',period_end:end,invoiced_on:issued,due_on:addDays(issued,settings.termsDays),paid_on:null,status:'invoiced',version:1,snapshot,created_at:stamp,updated_at:stamp})
 try {
  const results=await env.DB.batch([
   env.DB.prepare(`INSERT INTO time_settings(workspace_id,config_json,version,updated_at) SELECT ?,?,1,? WHERE ?=0 AND ${ownerGuard}
    ON CONFLICT(workspace_id) DO NOTHING`).bind(workspaceId,JSON.stringify(next),stamp,version,workspaceId,userId),
   env.DB.prepare(`UPDATE time_settings SET config_json=?,version=version+1,updated_at=? WHERE workspace_id=? AND version=? AND ?>0 AND ${ownerGuard}`).bind(JSON.stringify(next),stamp,workspaceId,version,version,workspaceId,userId),
   env.DB.prepare(`INSERT INTO time_invoices(id,workspace_id,bucket_key,sequence,number,period_start,period_end,invoiced_on,due_on,status,snapshot_json,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,'invoiced',?,?,? WHERE ${ownerGuard} AND EXISTS (SELECT 1 FROM time_settings WHERE workspace_id=? AND version=? AND json_extract(config_json,'$.nextNumber')=?)`).bind(id,workspaceId,String(body.bucket),settings.nextNumber,number,month+'-01',end,issued,addDays(issued,settings.termsDays),JSON.stringify(snapshot),stamp,stamp,workspaceId,userId,workspaceId,version+1,settings.nextNumber+1),
   env.DB.prepare(`INSERT INTO time_invoice_audit VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),workspaceId,id,userId,'invoice.created',JSON.stringify({number,month,sourceGeneratedAt:data.generatedAt}),stamp),
  ])
  if(results[2].meta.changes!==1)throw new PortalError(409,'Settings or access changed. Refresh before issuing.')
 }catch(error){if(error instanceof PortalError)throw error;throw new PortalError(409,'An invoice already covers this month, or settings/access changed. Refresh before issuing.')}
 return getInvoice(env,workspaceId,id)
}
export async function updateInvoice(env:Env,workspaceId:string,userId:string,id:string,body:Record<string,unknown>,voiding=false) {
 rejectExtra(body,voiding?['version','reason']:['version','status','paidOn','reason'])
 const existing=await getInvoice(env,workspaceId,id)
 if(!Number.isSafeInteger(body.version)||body.version!==existing.version)throw new PortalError(409,'Invoice changed. Refresh before saving.')
 const status=voiding?'void':body.status
 if(!['paid','invoiced','void'].includes(String(status)))throw new PortalError(400,'Invalid invoice status.')
 if(existing.status==='void')throw new PortalError(400,'Voided invoices cannot be reopened. Issue a new invoice.')
 if(status==='void'&&(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500))throw new PortalError(400,'A void reason is required.')
 const today=dayKey(Date.now(),existing.snapshot.timezone),paid=status==='paid'?(body.paidOn??today):null
 if(paid!==null&&(!dateOnly(paid)||paid<existing.invoiced_on||paid>today))throw new PortalError(400,'Invalid payment date.')
 const stamp=new Date().toISOString(),nonce=crypto.randomUUID()
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE time_invoices SET status=?,paid_on=?,version=version+1,updated_at=?,audit_nonce=? WHERE workspace_id=? AND id=? AND version=? AND ${ownerGuard}`).bind(status,paid,stamp,nonce,workspaceId,id,body.version,workspaceId,userId),
  env.DB.prepare(`INSERT INTO time_invoice_audit(id,workspace_id,invoice_id,actor_id,action,metadata_json,created_at)
   SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM time_invoices WHERE workspace_id=? AND id=? AND audit_nonce=?)`).bind(nonce,workspaceId,id,userId,'invoice.'+status,JSON.stringify({from:existing.status,to:status,paidOn:paid,reason:body.reason??null}),stamp,workspaceId,id,nonce),
 ])
 if(result[0].meta.changes!==1)throw new PortalError(409,'Invoice or access changed. Refresh before saving.')
 return getInvoice(env,workspaceId,id)
}
