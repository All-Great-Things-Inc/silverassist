import type { CalendarEvent, TimeSettings, Hours, HistoryValue } from '../../shared/time'
export function dayKey(ms: number, timezone: string) {
 const parts = new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms)
 return ['year','month','day'].map(key=>parts.find(p=>p.type===key)!.value).join('-')
}
export function addDays(day: string, days: number) { const d=new Date(day+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10) }
// Find the first instant in a local date, including 23/25-hour days. Never add 24h to a zoned midnight.
export function midnight(day: string, timezone: string) {
 const anchor=Date.parse(day+'T00:00:00Z'); let lo=anchor-48*3600000,hi=anchor+48*3600000
 while (hi-lo>1) {const m=Math.floor((lo+hi)/2);if(dayKey(m,timezone)<day)lo=m;else hi=m}
 return hi
}
export function splitDays(start: number, end: number, timezone: string): Record<string,number> {
 const days: Record<string,number>={}
 for (let cursor=start;cursor<end;) {
  const day=dayKey(cursor,timezone), boundary=midnight(addDays(day,1),timezone), next=Math.min(end,boundary)
  if(next<=cursor)throw new Error('Invalid timezone boundary')
  days[day]=(days[day]??0)+(next-cursor)/3600000;cursor=next
 }
 return days
}
export function classify(title: string, settings: TimeSettings): string | 'ambiguous' | 'unassigned' {
 const hits=settings.buckets.filter(b=>{
  const keyword=b.keyword.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  return new RegExp(b.match==='prefix'?`^\\s*${keyword}(?![\\p{L}\\p{N}_])`:`(?<![\\p{L}\\p{N}_])${keyword}(?![\\p{L}\\p{N}_])`,'iu').test(title)
 })
 return hits.length===1?hits[0].key:hits.length?'ambiguous':'unassigned'
}
export function effective(history: HistoryValue[], day: string) { return history.filter(v=>v.from<=day).at(-1)?.value ?? null }
export function monthlyCap(bucket: TimeSettings['buckets'][number], month: string) {
 const first=month+'-01',last=addDays(month+'-01',32).slice(0,7)+'-01'
 const days=(Date.parse(last)-Date.parse(first))/86400000
 let cap=0, any=false
 for(let d=first;d<last;d=addDays(d,1)) {if(d<bucket.startDate)continue;const v=effective(bucket.caps,d);if(v===null)return null;any=true;cap+=v/days}
 return any?cap:null
}
export function pace(hours: number, month: string, today: string, startDate: string, cap: number | null, settings: TimeSettings) {
 const first=month+'-01', next=addDays(first,32).slice(0,7)+'-01', active=first>startDate?first:startDate
 const totalDays=Math.max(0,(Date.parse(next)-Date.parse(active))/86400000)
 const elapsedDays=Math.max(0,Math.min(totalDays,(Date.parse(today)-Date.parse(active))/86400000+1))
 const projected=elapsedDays?hours/elapsedDays*totalDays:0
 return {projected,label:cap===null?'No monthly cap':projected>cap*settings.paceHigh?'Trending over cap':projected<cap*settings.paceLow?'Room to add more':'On track'}
}
export function block(logged: number, invoiced: number, blockHours: number|null) {const uninvoiced=Math.max(0,logged-invoiced);return {uninvoiced,ready:blockHours!==null&&uninvoiced>=blockHours,progress:blockHours===null?null:Math.min(1,uninvoiced/blockHours)}}
export function calculate(events: CalendarEvent[], settings: TimeSettings, now: number): Hours {
 const today=dayKey(now,settings.timezone),monthStart=today.slice(0,7)+'-01'
 const dow=new Date(today+'T12:00:00Z').getUTCDay(), weekStart=addDays(today,-((dow+(settings.weekStart==='monday'?6:0))%7))
 const dailyByWorkspace:Hours['dailyByWorkspace']={},attention:Hours['attention']=[], seen=new Set<string>()
 const intervals:{start:number;end:number;bucket:string;title:string}[]=[]
 let unassigned=0,ambiguous=0,count=0
 for(const b of settings.buckets)dailyByWorkspace[b.key]={}
 for(const e of events) {
  if(e.id&&seen.has(e.id))continue;if(e.id)seen.add(e.id)
  if(e.status==='cancelled'||!e.start?.dateTime||!e.end?.dateTime||e.attendees?.some(a=>a.self&&a.responseStatus==='declined')||(!settings.countFree&&e.transparency==='transparent')||(!settings.countOutOfOffice&&e.eventType==='outOfOffice'))continue
  if(!settings.countTentative&&e.attendees?.some(a=>a.self&&a.responseStatus==='tentative'))continue
  const start=Date.parse(e.start.dateTime),end=Math.min(Date.parse(e.end.dateTime),now)
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue
  const key=classify(e.summary??'',settings)
  if(key==='unassigned'||key==='ambiguous') {
   if(key==='unassigned')unassigned++;else ambiguous++
   if(attention.length<100)attention.push({kind:key,title:key==='unassigned'?'Unmatched event':(e.summary??'').slice(0,200),day:dayKey(start,settings.timezone)})
   continue
  }
  const b=settings.buckets.find(b=>b.key===key)!, clipped=Math.max(start,midnight(b.startDate,settings.timezone))
  if(end<=clipped)continue
  intervals.push({start:clipped,end,bucket:key,title:(e.summary??'').slice(0,200)});count++
 }
 intervals.sort((a,b)=>a.start-b.start)
 const prior:typeof intervals=[]
 for(const item of intervals) {
  const overlapping=prior.filter(p=>p.end>item.start)
  if(overlapping.length&&attention.length<100)attention.push({kind:'overlap',title:item.title,day:dayKey(item.start,settings.timezone)})
  let pieces=[{start:item.start,end:item.end}]
  if(settings.overlapPolicy==='merge')for(const p of overlapping)pieces=pieces.flatMap(v=>p.end<=v.start||p.start>=v.end?[v]:[...(p.start>v.start?[{start:v.start,end:p.start}]:[]),...(p.end<v.end?[{start:p.end,end:v.end}]:[])])
  for(const piece of pieces)for(const [d,h] of Object.entries(splitDays(piece.start,piece.end,settings.timezone)))dailyByWorkspace[item.bucket][d]=(dailyByWorkspace[item.bucket][d]??0)+h
  prior.push(item)
 }
 const daily:Record<string,number>={},byWorkspace:Hours['byWorkspace']={}
 const roll=(days:Record<string,number>)=>({week:Object.entries(days).filter(([d])=>d>=weekStart).reduce((s,[,h])=>s+h,0),month:Object.entries(days).filter(([d])=>d>=monthStart).reduce((s,[,h])=>s+h,0),total:Object.values(days).reduce((s,h)=>s+h,0),daily:days})
 for(const [key,days] of Object.entries(dailyByWorkspace)){byWorkspace[key]=roll(days);for(const [d,h] of Object.entries(days))daily[d]=(daily[d]??0)+h}
 return {...roll(daily),dailyByWorkspace,byWorkspace,today,weekStart,monthStart,timezone:settings.timezone,generatedAt:new Date(now).toISOString(),events_count:count,unassigned_events:unassigned,ambiguous_events:ambiguous,attention}
}
