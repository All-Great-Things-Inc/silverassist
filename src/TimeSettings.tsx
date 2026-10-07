import { useEffect, useState } from 'react'
import type { TimeSettings as Settings, Bucket } from '../shared/time'
import { timeRequest } from './Time'
export function TimeSettings({workspaceId}:{workspaceId:string}) {
 const base=`/api/workspaces/${workspaceId}/time`,[settings,setSettings]=useState<Settings|null>(null),[version,setVersion]=useState(0),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false)
 async function load(){setBusy(true);try{const result=await timeRequest(base,'settings');setSettings(result.settings);setVersion(result.version);setDirty(false);setError('')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{void load()},[base])
 useEffect(()=>{
  const navigate=(e:Event)=>{if(dirty&&!window.confirm('Leave without saving Time settings?'))e.preventDefault()}
  const unload=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue=''}}
  window.addEventListener('portal:navigate',navigate);window.addEventListener('beforeunload',unload)
  return ()=>{window.removeEventListener('portal:navigate',navigate);window.removeEventListener('beforeunload',unload)}
 },[dirty])
 function edit<K extends keyof Settings>(key:K,value:Settings[K]) {setSettings(s=>s?{...s,[key]:value}:s);setDirty(true);setMessage('')}
 function bucketEdit(index:number,change:Partial<Bucket>) {if(settings)edit('buckets',settings.buckets.map((b,i)=>i===index?{...b,...change}:b))}
 async function save(){setBusy(true);setError('');try{const result=await timeRequest(base,'settings','PATCH',{settings,version});setSettings(result.settings);setVersion(result.version);setDirty(false);setMessage('Time settings saved. Existing invoice details are unchanged.')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="time-page time-settings"><h1>Time settings</h1><p className="lede">Calendar rules and billing settings · owner only</p>
  {error&&<p className="time-error" role="alert">{error} Unsaved changes are retained.</p>}{message&&<p role="status">{message}</p>}
  {!settings?<p>Loading settings…</p>:<form onSubmit={e=>{e.preventDefault();void save()}}>
   <fieldset className="ds-data-card"><legend>Calendar and reporting</legend>
    <label>Google account<input type="email" required value={settings.expectedEmail} onChange={e=>edit('expectedEmail',e.target.value)}/></label>
    <label>Calendar ID<input required value={settings.calendarId} onChange={e=>edit('calendarId',e.target.value)}/><span>Use “primary” for your main calendar, or its Google Calendar ID.</span></label>
    <label>IANA timezone<input required value={settings.timezone} onChange={e=>edit('timezone',e.target.value)}/></label>
    <label>Week starts<select value={settings.weekStart} onChange={e=>edit('weekStart',e.target.value as Settings['weekStart'])}><option value="sunday">Sunday</option><option value="monday">Monday</option></select></label>
    <label>Unexpected overlaps<select value={settings.overlapPolicy} onChange={e=>edit('overlapPolicy',e.target.value as Settings['overlapPolicy'])}><option value="flag">Sum and flag for review</option><option value="merge">Count overlapping minutes once and flag</option></select></label>
    <p>All-day, future, cancelled, and declined events are always excluded. In-progress events count elapsed time only. Change calendar/timezone/matching rules carefully: historical graphs recalculate, while issued invoices stay frozen.</p>
    {(['countFree','countOutOfOffice','countTentative'] as const).map((key,i)=><label key={key} className="time-check"><input type="checkbox" checked={settings[key]} onChange={e=>edit(key,e.target.checked)}/>{['Count events marked free','Count out-of-office events with matching titles','Count tentative matching events'][i]}</label>)}
   </fieldset>
   <fieldset className="ds-data-card"><legend>Clients and matching rules</legend>{settings.buckets.map((b,index)=><div className="time-settings-bucket" key={index}>
    <h2>{b.label}</h2><label>Stable client key<input required value={b.key} onChange={e=>bucketEdit(index,{key:e.target.value})}/></label>
    <label>Client label<input required value={b.label} onChange={e=>bucketEdit(index,{label:e.target.value})}/></label>
    <label>Event-title keyword<input required value={b.keyword} onChange={e=>bucketEdit(index,{keyword:e.target.value})}/></label>
    <label>Match rule<select value={b.match} onChange={e=>bucketEdit(index,{match:e.target.value as Bucket['match']})}><option value="prefix">Title begins with keyword</option><option value="word">Keyword anywhere as a whole word</option></select></label>
    <label>Engagement start<input type="date" required value={b.startDate} onChange={e=>bucketEdit(index,{startDate:e.target.value})}/></label>
    {(['rates','caps'] as const).map(history=><div key={history}><h3>{history==='rates'?'Hourly rate history':'Monthly cap history'}</h3><p>Dates must be in ascending order and cover the engagement start.{history==='caps'?' Leave a cap empty for no cap.':''}</p>{b[history].map((h,hi)=><div className="time-history-row" key={hi}>
     <label>Effective from<input type="date" required value={h.from} onChange={e=>bucketEdit(index,{[history]:b[history].map((v,i)=>i===hi?{...v,from:e.target.value}:v)})}/></label>
     <label>{history==='rates'?'Hourly rate':'Monthly hours (empty = no cap)'}<input type="number" step="any" min="0" required={history==='rates'} value={h.value??''} onChange={e=>bucketEdit(index,{[history]:b[history].map((v,i)=>i===hi?{...v,value:e.target.value===''?null:Number(e.target.value)}:v)})}/></label>
     {b[history].length>1&&<button type="button" className="text-button" onClick={()=>bucketEdit(index,{[history]:b[history].filter((_,i)=>i!==hi)})}>Remove change</button>}
    </div>)}<button type="button" className="outline-button" onClick={()=>bucketEdit(index,{[history]:[...b[history],{from:'',value:b[history].at(-1)!.value}]})}>Add effective-date change</button></div>)}
    {settings.buckets.length>1&&<button type="button" className="text-button" onClick={()=>edit('buckets',settings.buckets.filter((_,i)=>i!==index))}>Remove client rule</button>}
   </div>)}<button type="button" className="outline-button" onClick={()=>edit('buckets',[...settings.buckets,{...structuredClone(settings.buckets[0]),key:'',label:'',keyword:''}])}>Add client bucket</button></fieldset>
   <fieldset className="ds-data-card"><legend>Billing and PDF</legend>
    <p>Billing is monthly, for the full completed calendar month. An optional block threshold adds an in-page alert.</p>
    <label>Block size in hours (empty = no block)<input type="number" min="0" step="any" value={settings.blockHours??''} onChange={e=>edit('blockHours',e.target.value===''?null:Number(e.target.value))}/></label>
    <label>Currency code<input required value={settings.currency} onChange={e=>edit('currency',e.target.value.toUpperCase())}/></label>
    <label>Tax percentage<input type="number" min="0" max="100" step="any" value={settings.taxPercent} onChange={e=>edit('taxPercent',Number(e.target.value))}/></label>
    {(['termsDays','normalPaymentDays','invoicePadding','nextNumber'] as const).map((key,i)=><label key={key}>{['Payment due after days','Flag unpaid invoices after days','Invoice number padding','Next invoice sequence'][i]}<input type="number" step="1" value={settings[key]} onChange={e=>edit(key,Number(e.target.value))}/></label>)}
    {(['invoicePrefix','filenamePattern','description'] as const).map((key,i)=><label key={key}>{['Invoice number prefix','PDF filename pattern ({number}, {client}, {month})','Service description'][i]}<input value={settings[key]} onChange={e=>edit(key,e.target.value)}/></label>)}
    {(['billFrom','billTo','terms','paymentInstructions'] as const).map((key,i)=><label key={key}>{['Bill from (name and address)','Bill to (name and address)','Payment terms printed on PDF ({termsDays} uses the due-days setting)','Payment instructions'][i]}<textarea rows={3} value={settings[key]} onChange={e=>edit(key,e.target.value)}/></label>)}
   </fieldset>
   <details className="ds-data-card"><summary>Advanced reporting settings</summary>{(['paceLow','paceHigh','cacheSeconds'] as const).map((key,i)=><label key={key}>{['Pace lower cap ratio','Pace upper cap ratio','Successful-hours cache seconds (0–900)'][i]}<input type="number" step="any" value={settings[key]} onChange={e=>edit(key,Number(e.target.value))}/></label>)}{settings.heatThresholds.map((v,i)=><label key={i}>Heatmap hour threshold {i+1}<input type="number" step="any" value={v} onChange={e=>edit('heatThresholds',settings.heatThresholds.map((n,j)=>i===j?Number(e.target.value):n))}/></label>)}</details>
   <div className="time-actions"><button className="primary-button" disabled={busy||!dirty}>{busy?'Saving…':'Save settings'}</button><button type="button" className="outline-button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Discard unsaved settings and reload?'))void load()}}>Reload saved settings</button></div>
  </form>}
 </div>
}
