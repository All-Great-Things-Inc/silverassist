import { useCallback, useEffect, useState } from 'react'
import type { Hours, Invoice, TimeSettings } from '../shared/time'
import { ledger, periodEnd } from '../worker/time/invoice-logic'
import { block, dayKey } from '../worker/time/logic'
import { hoursLabel, timeRequest } from './Time'
export function TimeBilling({base,data,settings,calendarError,onChange}:{base:string;data:Hours|null;settings:TimeSettings;calendarError:boolean;onChange:()=>void}) {
 const [invoices,setInvoices]=useState<Invoice[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [bucket,setBucket]=useState(settings.buckets[0].key),[month,setMonth]=useState(()=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7)})
 const load=useCallback(async()=>{try{setInvoices((await timeRequest(base,'invoices')).invoices);setError('')}catch(e){setError((e as Error).message)}},[base])
 useEffect(()=>{void load()},[load])
 async function mutate(path:string,method:string,body:unknown) {setBusy(true);setError('');try{await timeRequest(base,path,method,body);await load();onChange()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const money=(n:number,currency=settings.currency)=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(n)
 const active=invoices?.filter(i=>i.bucket_key===bucket&&i.status!=='void')??[],b=settings.buckets.find(b=>b.key===bucket)
 const uninvoiced=data?block(data.byWorkspace[bucket]?.total??0,active.reduce((s,i)=>s+i.snapshot.hours,0),settings.blockHours):null
 const closedMonths:string[]=[]
 if(data&&b)for(let m=b.startDate.slice(0,7);periodEnd(m)<=data.today;m=periodEnd(m).slice(0,7))if(!active.some(i=>i.period_start.startsWith(m))&&Object.entries(data.dailyByWorkspace[bucket]??{}).some(([d,h])=>d.startsWith(m)&&h>0))closedMonths.push(m)
 return <section className="ds-data-card time-billing"><h2>Invoices</h2><p>Invoice each completed calendar month. Issued billing details are frozen; corrections use void and reissue.</p>
  {error&&<p className="time-error" role="alert">{error}</p>}
  {invoices===null?<p>Loading invoice ledger…</p>:<>
   <div className="time-rollups">{Object.entries(ledger(invoices)).map(([currency,t])=><section key={currency} className="ds-metric-card"><h3>{currency}</h3><p>Invoiced <strong>{money(t.invoiced,currency)}</strong></p><p>Paid <strong>{money(t.paid,currency)}</strong></p><p>Outstanding <strong>{money(t.outstanding,currency)}</strong></p></section>)}</div>
   {!invoices.length&&<p>No invoices issued yet.</p>}
   {data&&!calendarError&&<div className="ds-data-alert"><strong>{closedMonths.length?'Time to invoice':'Monthly billing'}</strong><p>{closedMonths.length?`Un-invoiced completed months: ${closedMonths.join(', ')}`:'No completed month is awaiting an invoice.'}</p><p>{hoursLabel(uninvoiced?.uninvoiced??0)} un-invoiced across all time.{uninvoiced?.ready?' Configured billing block reached.':''}</p>{uninvoiced?.progress!==null&&uninvoiced?.progress!==undefined&&<progress aria-label="Progress to invoice block" max={1} value={uninvoiced.progress}/>}</div>}
   <form className="time-invoice-form" onSubmit={e=>{e.preventDefault();void mutate('invoices','POST',{bucket,month})}}>
    <label>Client<select value={bucket} onChange={e=>setBucket(e.target.value)}>{settings.buckets.map(b=><option key={b.key} value={b.key}>{b.label}</option>)}</select></label>
    <label>Full billing month<input type="month" required value={month} onChange={e=>setMonth(e.target.value)}/></label>
    <button className="primary-button" disabled={busy||calendarError||!data}>Create invoice</button>
   </form>
   <div className="time-table-wrap"><table><thead><tr><th>Invoice / period</th><th>Hours</th><th>Total</th><th>Status / due</th><th>Actions</th></tr></thead><tbody>{invoices.map(i=><tr key={i.id}><td>{i.number}<br/>{i.period_start.slice(0,7)} · {i.snapshot.clientLabel}</td><td>{hoursLabel(i.snapshot.hours)}</td><td>{money(i.snapshot.totalMinor/10**i.snapshot.minorDigits,i.snapshot.currency)}</td><td className={i.status==='invoiced'&&(Date.parse(dayKey(Date.now(),i.snapshot.timezone))-Date.parse(i.invoiced_on))/86400000>settings.normalPaymentDays?'time-overdue':undefined}>{i.status}{i.status==='paid'?` · ${i.paid_on}`:i.status==='invoiced'?` · Due ${i.due_on}`:''}</td><td><div className="time-actions">
    {i.status==='invoiced'&&<button className="small-button" disabled={busy} onClick={()=>void mutate('invoices/'+i.id,'PATCH',{version:i.version,status:'paid'})}>Mark paid</button>}
    {i.status==='paid'&&<button className="small-button" disabled={busy} onClick={()=>void mutate('invoices/'+i.id,'PATCH',{version:i.version,status:'invoiced'})}>Undo paid</button>}
    {i.status!=='void'&&<button className="text-button" disabled={busy} onClick={()=>{const reason=window.prompt('Reason for voiding this invoice (history is retained):');if(reason)void mutate('invoices/'+i.id,'DELETE',{version:i.version,reason})}}>Void</button>}
   </div></td></tr>)}</tbody></table></div>
  </>}
 </section>
}
