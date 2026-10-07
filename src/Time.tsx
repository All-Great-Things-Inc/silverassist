import { TimeBilling } from './TimeBilling'
import { useCallback, useEffect, useState } from 'react'
import type { Hours, TimeSettings } from '../shared/time'
import { addDays, monthlyCap, pace, effective } from '../worker/time/logic'
export async function timeRequest(base:string,path:string,method='GET',body?:unknown) {
 const response=await fetch(base+'/'+path,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
 const result=await response.json()
 if(!response.ok)throw new Error(result.error??'Time data unavailable. Please retry.')
 return result
}
export const hoursLabel=(n:number)=>n.toFixed(1)+' h'
export function Time({workspaceId}:{workspaceId:string}) {
 const base=`/api/workspaces/${workspaceId}/time`
 const [data,setData]=useState<Hours|null>(null),[settings,setSettings]=useState<TimeSettings|null>(null)
 const [connection,setConnection]=useState<{account_email:string;status:string}|null>(null)
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(()=>location.hash==='#calendar-connected'?'Calendar connected.':location.hash==='#calendar-denied'?'Calendar permission was declined.':'')
 const load=useCallback(async(refresh=false)=>{
  setBusy(true);setError('')
  try {
   const [config,status]=await Promise.all([timeRequest(base,'settings'),timeRequest(base,'calendar')]);setSettings(config.settings);setConnection(status.connection)
   const next=await timeRequest(base,'hours',refresh?'POST':'GET')
   if(!next.generatedAt)throw new Error('Calendar hours unavailable: missing update time.')
   setData(next)
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 },[base])
 useEffect(()=>{void load();return ()=>{}},[load])
 async function connect() {setBusy(true);setError('');try{const result=await timeRequest(base,'connect','POST');location.assign(result.url)}catch(e){setError((e as Error).message);setBusy(false)}}
 async function disconnect() {setBusy(true);setError('');try{await timeRequest(base,'disconnect','POST');setConnection(null);setData(null);setNotice('Calendar disconnected.');}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:settings!.currency}).format(n)
 const value=(range:'week'|'month'|'total')=>settings&&data?settings.buckets.reduce((sum,b)=>sum+Object.entries(data.dailyByWorkspace[b.key]??{}).filter(([d])=>range==='total'||d>=(range==='week'?data.weekStart:data.monthStart)).reduce((v,[d,h])=>v+h*(effective(b.rates,d)??0),0),0):0
 return <div className="time-page">
  <div className="time-heading"><div><h1>Time</h1><p className="lede">Calendar-recorded effort · owner only</p></div><div className="time-actions">
   <button className="outline-button" disabled={busy} onClick={()=>void load(true)}>{busy?'Loading…':'Refresh hours'}</button>
   <button className="primary-button" disabled={busy} onClick={()=>void connect()}>{connection?'Reconnect Calendar':'Connect Google Calendar'}</button>
   {connection&&<button className="text-button" disabled={busy} onClick={()=>void disconnect()}>Disconnect</button>}
  </div></div>
  <p>{connection?`Connected as ${connection.account_email}${connection.status==='reconnect'?' · reconnect required':''}`:'Calendar not connected.'} {settings&&`Reporting in ${settings.timezone}.`}</p>
  {notice&&<p role="status">{notice}</p>}
  {error&&<div className="time-error" role="alert"><strong>Calendar hours unavailable.</strong> {error} {data&&'Previous successful totals are shown below and may be stale.'}</div>}
  {!data&&<p role="status">{busy?'Loading Calendar hours…':'Connect Calendar to view tracked hours.'}</p>}
  {data&&settings&&<>
   <p className="time-updated">{error?'Last successful update':'Updated'} {new Date(data.generatedAt).toLocaleString('en-US',{timeZone:settings.timezone})}</p>
   <div className="time-rollups">{(['week','month','total'] as const).map((range,i)=><section className="ds-metric-card" key={range}><h2>{['This week','This month','Total logged'][i]}</h2><p className="metric-value">{hoursLabel(data[range])}</p><p>Estimated value {money(value(range))}</p></section>)}</div>
   <section className="ds-data-card"><h2>This month by client</h2>{settings.buckets.map(b=>{
    const h=data.byWorkspace[b.key]?.month??0,cap=monthlyCap(b,data.today.slice(0,7)),p=pace(h,data.today.slice(0,7),data.today,b.startDate,cap,settings)
    return <div className="time-bucket" key={b.key}><div className="time-bar-label"><strong>{b.label}</strong><span>{hoursLabel(h)}{cap===null?' · No monthly cap':` / ${hoursLabel(cap)}`}</span></div>
     {cap!==null&&<div className="ds-data-bar" role="meter" aria-label={`${b.label} monthly cap`} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(h,cap)}><i style={{width:Math.min(100,cap?h/cap*100:100)+'%'}}/></div>}
     <p>Monthly pace: <strong>{hoursLabel(p.projected)}</strong> projected · {p.label}</p>
    </div>
   })}</section>
   <section className="ds-data-card"><h2>Hours by month</h2><MonthBars data={data} settings={settings}/></section>
   <section className="ds-data-card"><h2>Daily hours</h2><Heatmap data={data} settings={settings}/><p>Hover or focus a day for hours. Details are also available below.</p><details><summary>Daily hours table</summary><div className="time-table-wrap"><table><thead><tr><th>Date</th>{settings.buckets.map(b=><th key={b.key}>{b.label}</th>)}<th>Total</th></tr></thead><tbody>{Object.keys(data.daily).sort().map(d=><tr key={d}><th>{d}</th>{settings.buckets.map(b=><td key={b.key}>{hoursLabel(data.dailyByWorkspace[b.key]?.[d]??0)}</td>)}<td>{hoursLabel(data.daily[d])}</td></tr>)}</tbody></table></div></details></section>
   <section className="ds-data-card"><h2>Needs attention</h2><p>{data.unassigned_events} unmatched · {data.ambiguous_events} ambiguous. Unmatched personal event titles are not retained.</p>
    {data.attention.length?<ul>{data.attention.map((a,i)=><li key={i}><strong>{a.kind}</strong> · {a.day} · {a.title}</li>)}</ul>:<p>No matching events need attention.</p>}
    {data.attention.length>=100&&<p>Showing the first 100 items.</p>}
   </section>
  </>}
  {settings&&<TimeBilling base={base} data={data} settings={settings} calendarError={!!error} onChange={()=>void load()}/>}
 </div>
}
function MonthBars({data,settings}:{data:Hours;settings:TimeSettings}) {
 const first=settings.buckets.map(b=>b.startDate.slice(0,7)).sort()[0],months:string[]=[]
 for(let m=first+'-01';m<=data.today;m=addDays(m,32).slice(0,7)+'-01')months.push(m.slice(0,7))
 const values=months.map(m=>Object.entries(data.daily).filter(([d])=>d.startsWith(m)).reduce((s,[,h])=>s+h,0)),max=Math.max(1,...values)
 return <div className="time-months">{months.map((m,i)=>{
  const caps=settings.buckets.map(b=>monthlyCap(b,m)),cap=caps.some(c=>c===null)?null:caps.reduce<number>((s,c)=>s+(c??0),0)
  return <div key={m}><div className="time-bar-label"><strong>{m}</strong><span>{hoursLabel(values[i])}{cap!==null&&` / ${hoursLabel(cap)}`}</span></div><div className="ds-data-bar" data-over={cap!==null&&values[i]>cap}><i style={{width:values[i]/max*100+'%'}}/></div></div>
 })}</div>
}
function Heatmap({data,settings}:{data:Hours;settings:TimeSettings}) {
 const first=settings.buckets.map(b=>b.startDate).sort()[0],dow=new Date(first+'T12:00:00Z').getUTCDay(),start=addDays(first,-dow),cells:string[]=[]
 for(let day=start;day<=data.today;day=addDays(day,1))cells.push(day)
 const level=(h:number)=>h<=0?0:h<1?1:h<2?2:h<4?3:4
 return <div className="time-heatmap-scroll"><div className="time-heatmap" aria-label="Daily hours, Sunday through Saturday rows">{cells.map(d=>{
  const h=data.daily[d]??0,active=settings.buckets.map((b,i)=>({b,i,h:data.dailyByWorkspace[b.key]?.[d]??0})).filter(v=>v.h>0)
  const text=settings.buckets.map(b=>`${b.label} ${hoursLabel(data.dailyByWorkspace[b.key]?.[d]??0)}`).join(' · ')+` · Total ${hoursLabel(h)} · ${d}`
  const gradient=active.length>1?`linear-gradient(to right, ${active.map((v,i)=>`var(--time-series-${v.i%2}) ${i/active.length*100}% ${(i+1)/active.length*100}%`).join(', ')})`:undefined
  return <span key={d} className="ds-data-heatmap-cell" data-level={level(h)} tabIndex={0} title={text} aria-label={text} style={{background:gradient}}/>
 })}</div></div>
}
