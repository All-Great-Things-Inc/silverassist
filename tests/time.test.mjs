import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { initialSettings, validateSettings } from '../.local/time-tests/worker/time/settings.js'
import { classify, splitDays, calculate, pace, block } from '../.local/time-tests/worker/time/logic.js'
import { encrypt, decrypt, fetchEvents, connect, callback } from '../.local/time-tests/worker/time/calendar.js'
import { invoiceSnapshot, ledger } from '../.local/time-tests/worker/time/invoice-logic.js'
import { timeRoutes } from '../.local/time-tests/worker/time/routes.js'
const settings=structuredClone(initialSettings), epoch=s=>Date.parse(s)
const event=(start,end,extra={})=>({id:crypto.randomUUID(),summary:'SilverAssist Strategy',start:{dateTime:start},end:{dateTime:end},...extra})
export function fixture() {
 const sql=new DatabaseSync(':memory:')
 for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+f,'utf8'))
 sql.exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Owner','owner@example.test',1,0,0),('viewer','Viewer','viewer@example.test',1,0,0);
 INSERT INTO workspaces(id,slug,name) VALUES ('ws','ws','Workspace');
 INSERT INTO memberships(id,workspace_id,user_id,role) VALUES ('mo','ws','owner','owner'),('mv','ws','viewer','viewer');`)
 const db={
  prepare(query) {
   let args=[]
   const wrapper={
    bind(...values){args=values;return wrapper},
    async first(){return sql.prepare(query).get(...args)??null},
    async all(){return {results:sql.prepare(query).all(...args)}},
    async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}},
   };return wrapper
  },
  async batch(queries){sql.exec('BEGIN');try{const r=[];for(const q of queries)r.push(await q.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}
 }

 return {sql,env:{DB:db,AUTH_BASE_URL:'http://localhost:5173',TIME_TOKEN_KEY:'a'.repeat(64),GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'}}
}
test('whole title words and configurable prefix; ambiguity excluded',()=>{
 assert.equal(classify('SilverAssist + Strategy',settings),'silverassist');assert.equal(classify('silverassist meeting',settings),'silverassist')
 for(const t of ['SilverAssistance','Personal SilverAssist','Unrelated'])assert.equal(classify(t,settings),'unassigned')
 const s=structuredClone(settings);s.buckets.push({...s.buckets[0],key:'other'});assert.equal(classify('SilverAssist meeting',s),'ambiguous')
 assert.equal(validateSettings(settings).termsDays,30)
})
test('local midnight and DST preserve elapsed duration',()=>{
 assert.deepEqual(splitDays(epoch('2026-10-06T23:00:00-05:00'),epoch('2026-10-07T02:00:00-05:00'),'America/Chicago'),{'2026-10-06':1,'2026-10-07':2})
 assert.deepEqual(splitDays(epoch('2026-03-08T00:00:00-06:00'),epoch('2026-03-09T00:00:00-05:00'),'America/Chicago'),{'2026-03-08':23})
 assert.deepEqual(splitDays(epoch('2026-11-01T00:00:00-05:00'),epoch('2026-11-02T00:00:00-06:00'),'America/Chicago'),{'2026-11-01':25})
})
test('declined, cancelled, future, all-day excluded; progress and start date clipped; deduped',()=>{
 const e=event('2026-10-07T10:00:00-05:00','2026-10-07T12:00:00-05:00')
 const result=calculate([e,e,event('2026-10-08T10:00:00-05:00','2026-10-08T11:00:00-05:00'),{summary:'SilverAssist',start:{date:'2026-10-07'},end:{date:'2026-10-08'}},event('2026-10-07T08:00:00-05:00','2026-10-07T09:00:00-05:00',{status:'cancelled'}),event('2026-10-07T08:00:00-05:00','2026-10-07T09:00:00-05:00',{attendees:[{self:true,responseStatus:'declined'}]})],settings,epoch('2026-10-07T11:00:00-05:00'))
 assert.equal(result.total,1);assert.equal(result.daily['2026-10-07'],1)
 assert.equal(calculate([event('2026-10-04T23:00:00-05:00','2026-10-05T01:00:00-05:00')],settings,epoch('2026-10-07T11:00:00-05:00')).total,1)
})
test('unexpected overlap flagged; optional merge prevents double counting',()=>{
 const events=[event('2026-10-07T10:00:00-05:00','2026-10-07T12:00:00-05:00'),event('2026-10-07T11:00:00-05:00','2026-10-07T13:00:00-05:00')]
 const r=calculate(events,settings,epoch('2026-10-07T14:00:00-05:00'));assert.equal(r.total,4);assert.equal(r.attention[0].kind,'overlap')
 assert.equal(calculate(events,{...settings,overlapPolicy:'merge'},epoch('2026-10-07T14:00:00-05:00')).total,3)
})
test('pace and optional blocks',()=>{assert.equal(pace(10,'2026-10','2026-10-07','2026-10-05',null,settings).projected,90);assert.equal(block(60,10,50).ready,true);assert.equal(block(50,10,50).ready,false);assert.equal(block(100,0,null).ready,false)})
test('AES ciphertext bound to owner/workspace; never exposes plaintext',async()=>{const {env}=fixture();const c=await encrypt('synthetic-refresh',env,'ws:owner');assert.ok(!c.includes('synthetic-refresh'));assert.equal(await decrypt(c,env,'ws:owner'),'synthetic-refresh');await assert.rejects(decrypt(c,env,'other:owner'))})
test('fetch follows every page and rejects partial/error payloads',async()=>{
 const requests=[];const events=await fetchEvents('synthetic-access','primary',epoch('2026-10-05'),epoch('2026-10-07'),async(url)=>{requests.push(url);return Response.json(requests.length===1?{items:[{id:'a'}],nextPageToken:'next'}:{items:[{id:'b'}]})})
 assert.equal(events.length,2);assert.ok(requests[1].includes('pageToken=next'))
 await assert.rejects(fetchEvents('x','primary',epoch('2026-10-05'),epoch('2026-10-07'),async()=>Response.json({error:'no'},{status:503})))
})
test('all time/billing methods server-gated 401/403; disconnected is not zero',async()=>{
 const {env}=fixture()
 for(const section of ['hours','settings','calendar','connect','disconnect','invoices','invoices/any','invoices/any/pdf'])for(const method of ['GET','POST','PATCH','DELETE']){
  const request=new Request(env.AUTH_BASE_URL+'/api/workspaces/ws/time/'+section,{method,headers:{Origin:env.AUTH_BASE_URL}})
  assert.equal((await timeRoutes(request,env,null,'session')).status,401)
  assert.equal((await timeRoutes(request,env,{id:'viewer',emailVerified:true},'session')).status,403)
 }
 const r=await timeRoutes(new Request(env.AUTH_BASE_URL+'/api/workspaces/ws/time/hours'),env,{id:'owner',emailVerified:true},'session');assert.equal(r.status,409);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal((await r.json()).total,undefined)
})

test('OAuth state is random, session-bound, expiring and one-use; scope read-only',async()=>{
 const {env,sql}=fixture()
 const start=await connect(env,'ws','owner','session-one'),url=new URL((await start.json()).url),state=url.searchParams.get('state')
 assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/calendar.readonly')
 assert.equal(url.searchParams.get('code_challenge_method'),'S256')
 const r=new Request(env.AUTH_BASE_URL+'/api/time/calendar/callback?error=access_denied&state='+state)
 await assert.rejects(callback(r,env,'owner','session-two'))
 assert.equal((await callback(r,env,'owner','session-one')).status,303)
 await assert.rejects(callback(r,env,'owner','session-one'))
 assert.equal(sql.prepare('SELECT used FROM time_oauth_states').get().used,1)
})
test('provider failure returns 502/no-store and never writes a zero cache; success cache hit',async()=>{
 const {env,sql}=fixture(),original=globalThis.fetch
 const cipher=await encrypt('synthetic-refresh',env,'ws:owner')
 sql.prepare("INSERT INTO time_connections VALUES ('ws','connection','owner','owner@example.test',?,'connected','now')").run(cipher)
 try {
  let calls=0;globalThis.fetch=async(url)=>{calls++;return String(url).includes('/token')?Response.json({access_token:'synthetic-access'}):Response.json({items:[event('2026-10-06T10:00:00-05:00','2026-10-06T11:00:00-05:00')]})}
  let r=await timeRoutes(new Request(env.AUTH_BASE_URL+'/api/workspaces/ws/time/hours'),env,{id:'owner',emailVerified:true},'session');assert.equal(r.status,200);assert.ok((await r.json()).generatedAt)
  const before=calls;await timeRoutes(new Request(env.AUTH_BASE_URL+'/api/workspaces/ws/time/hours'),env,{id:'owner',emailVerified:true},'session');assert.equal(calls,before)
  const previous=sql.prepare('SELECT payload_json FROM time_hours_cache').get().payload_json
  globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503})
  r=await timeRoutes(new Request(env.AUTH_BASE_URL+'/api/workspaces/ws/time/hours',{method:'POST',headers:{Origin:env.AUTH_BASE_URL}}),env,{id:'owner',emailVerified:true},'session')
  assert.equal(r.status,502);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal((await r.json()).total,undefined)
  assert.equal(sql.prepare('SELECT payload_json FROM time_hours_cache').get().payload_json,previous)
 }finally{globalThis.fetch=original}
})

test('monthly invoice totals, immutable snapshots, numbering, paid/void ledger and audit',async()=>{
 const {env,sql}=fixture(),original=globalThis.fetch
 const s=structuredClone(settings);s.billFrom='Test Advisor';s.billTo='Test Client';s.buckets[0].startDate='2026-09-01';s.buckets[0].rates[0].from='2026-09-01';s.buckets[0].caps[0].from='2026-09-01'
 sql.prepare('INSERT INTO time_settings VALUES (?,?,1,?)').run('ws',JSON.stringify(s),'now')
 sql.prepare("INSERT INTO time_connections VALUES ('ws','connection','owner','owner@example.test',?,'connected','now')").run(await encrypt('synthetic-refresh',env,'ws:owner'))
 const call=async(path,method='GET',body)=>timeRoutes(new Request(env.AUTH_BASE_URL+'/api/workspaces/ws/time/'+path,{method,headers:{Origin:env.AUTH_BASE_URL,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,{id:'owner',emailVerified:true},'session')
 try {
  globalThis.fetch=async(url)=>String(url).includes('/token')?Response.json({access_token:'synthetic-access'}):Response.json({items:[event('2026-09-30T23:00:00-05:00','2026-10-01T02:00:00-05:00')]})
  let response=await call('invoices','POST',{bucket:'silverassist',month:'2026-09'});assert.equal(response.status,201,JSON.stringify(await response.clone().json()))
  const {invoice}=await response.json();assert.equal(invoice.snapshot.hours,1);assert.equal(invoice.snapshot.totalMinor,30000);assert.equal(invoice.number,'INV-001')
  const settingsBefore=sql.prepare('SELECT config_json FROM time_settings').get().config_json
  response=await call('invoices','POST',{bucket:'silverassist',month:'2026-09'});assert.equal(response.status,409);assert.equal(sql.prepare('SELECT config_json FROM time_settings').get().config_json,settingsBefore)
  response=await call('invoices/'+invoice.id,'PATCH',{version:1,status:'paid'});assert.equal(response.status,200);const paid=(await response.json()).invoice;assert.equal(paid.status,'paid')
  assert.equal(sql.prepare('SELECT count(*) AS n FROM time_invoice_audit').get().n,2)
  response=await call('invoices/'+invoice.id,'PATCH',{version:1,status:'invoiced'});assert.equal(response.status,409)
  s.billFrom='Changed';s.buckets[0].rates[0].value=999;sql.prepare('UPDATE time_settings SET config_json=?').run(JSON.stringify(s))
  assert.equal((await (await call('invoices/'+invoice.id)).json()).invoice.snapshot.billFrom,'Test Advisor')
  assert.throws(()=>sql.prepare('UPDATE time_invoices SET snapshot_json=?').run('{}'))
  response=await call('invoices/'+invoice.id,'DELETE',{version:2,reason:'Synthetic correction'});assert.equal(response.status,200);assert.equal((await response.json()).invoice.status,'void')
  assert.equal(sql.prepare('SELECT count(*) AS n FROM time_invoice_audit').get().n,3)
  response=await call('invoices','POST',{bucket:'silverassist',month:'2026-10'});assert.equal(response.status,400)
 }finally{globalThis.fetch=original}
})

test('invoice totals aggregate time before rounding, preserve rate history and separate extras',()=>{
 const s=structuredClone(settings);s.taxPercent=10;s.buckets[0].rates.push({from:'2026-10-06',value:400})
 const data={dailyByWorkspace:{silverassist:{'2026-10-05':0.5,'2026-10-06':1}},generatedAt:'test'}
 const snapshot=invoiceSnapshot(data,s,'silverassist','2026-10',[{description:'Additional service',hours:0.25,rate:100}])
 assert.equal(snapshot.hours,1.5);assert.equal(snapshot.subtotalMinor,57500);assert.equal(snapshot.taxMinor,5750);assert.equal(snapshot.totalMinor,63250);assert.equal(snapshot.lines.at(-1).tracked,false)
 assert.deepEqual(ledger([{status:'invoiced',snapshot},{status:'paid',snapshot},{status:'void',snapshot}]),{USD:{invoiced:1265,paid:632.5,outstanding:632.5}})
})
