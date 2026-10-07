import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
const origin='http://localhost:5173'
const mf=new Miniflare(convertV4MiniflareOptions({
 modules:[{type:'ESModule',path:resolve('dist/silverassist_advisory_staging/index.js')},...(await readdir('dist/silverassist_advisory_staging/assets')).filter(f=>f.endsWith('.js')).map(f=>({type:'ESModule',path:resolve('dist/silverassist_advisory_staging/assets/'+f)}))],modulesRoot:resolve('dist/silverassist_advisory_staging'),
 compatibilityDate:'2026-10-06',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
 bindings:{APP_ENV:'staging',AUTH_BASE_URL:origin,AUTH_SECRET:randomBytes(32).toString('hex'),AUTH_ALLOWED_EMAILS:'owner@example.test,viewer@example.test'},
}))
async function api(path,method='GET',body,cookie){
 const r=await mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)})
 return {status:r.status,headers:r.headers,body:await r.json()}
}
try {
 const db=await mf.getD1Database('DB')
 // Real workerd D1 applies all additive migrations to a completely isolated in-memory database.
 for(const f of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  const sql=await readFile('migrations/'+f,'utf8')
  // D1 exec accepts one-line statements; migration scripts may include triggers with internal semicolons.
  await db.exec(sql.replace(/--[^\n]*/g,'').replace(/\n/g,' '))
 }
 const password=randomBytes(24).toString('hex')+'Aa1!'
 for(const email of ['owner@example.test','viewer@example.test']){
  const signup=await api('/api/auth/sign-up/email','POST',{name:'Synthetic account',email,password});assert.equal(signup.status,200)
 }
 const owner=await api('/api/auth/sign-in/email','POST',{email:'owner@example.test',password}),viewer=await api('/api/auth/sign-in/email','POST',{email:'viewer@example.test',password})
 const cookie=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
 const ownerCookie=cookie(owner),viewerCookie=cookie(viewer)
 assert.ok(ownerCookie&&viewerCookie)
 const w=await db.prepare('SELECT id FROM workspaces').first(),u=await db.prepare("SELECT id FROM user WHERE email='viewer@example.test'").first()
 await db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status) VALUES (?,?,?,'viewer','active')").bind(crypto.randomUUID(),w.id,u.id).run()
 for(const section of ['hours','settings','invoices','invoices/any/pdf'])for(const method of ['GET','POST','PATCH','DELETE']){
  const path='/api/workspaces/'+w.id+'/time/'+section
  assert.equal((await api(path,method,method==='GET'?undefined:{},undefined)).status,401)
  assert.equal((await api(path,method,method==='GET'?undefined:{},viewerCookie)).status,403)
 }
 const base='/api/workspaces/'+w.id+'/time/'
 const settings=await api(base+'settings','GET',undefined,ownerCookie);assert.equal(settings.status,200)
 const saved=await api(base+'settings','PATCH',{settings:settings.body.settings,version:0},ownerCookie);assert.equal(saved.status,200)
 const hours=await api(base+'hours','GET',undefined,ownerCookie);assert.equal(hours.status,409);assert.equal(hours.body.total,undefined)
 await db.prepare("UPDATE memberships SET status='revoked' WHERE role='owner'").run()
 assert.equal((await api(base+'settings','GET',undefined,ownerCookie)).status,403)
 await mkdir('.local/time-runtime',{recursive:true});await import('node:fs/promises').then(fs=>fs.writeFile('.local/time-runtime/result.json',JSON.stringify({passed:true,checks:['all migrations on isolated workerd D1','real Better Auth signup/session','time and invoice 401/403 methods','owner settings mutation','disconnected non-200','immediate membership revocation']})))
 console.log('PASS isolated actual workerd/D1 migrations, real sessions, 401/403 billing methods, settings mutation, disconnected non-200, and membership revocation.')
}finally{await mf.dispose()}
