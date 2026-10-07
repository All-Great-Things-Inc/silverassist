import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'

// Serve the production frontend against a real Worker and disposable D1 database.
const origin='http://localhost:5174', evidence='.local/viewer-navigation'
await mkdir(evidence,{recursive:true})
const mf=new Miniflare(convertV4MiniflareOptions({
 modules:[{type:'ESModule',path:resolve('dist/silverassist_advisory_staging/index.js')},...(await readdir('dist/silverassist_advisory_staging/assets')).filter(f=>f.endsWith('.js')).map(f=>({type:'ESModule',path:resolve('dist/silverassist_advisory_staging/assets/'+f)}))],modulesRoot:resolve('dist/silverassist_advisory_staging'),
 compatibilityDate:'2026-10-06',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
 bindings:{APP_ENV:'staging',AUTH_BASE_URL:origin,AUTH_SECRET:randomBytes(32).toString('hex'),AUTH_ALLOWED_EMAILS:'owner@example.test,viewer@example.test,editor@example.test'},
}))
async function api(path,method='GET',body,cookie){
 const r=await mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)})
 return {status:r.status,headers:r.headers,body:await r.json()}
}
const server=createServer(async(req,res)=>{
 try {
  if(req.url.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const response=await mf.dispatchFetch(origin+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)})
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
  }else{
   const path=req.url.startsWith('/assets/')?req.url.split('?')[0]:'/index.html'
   const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html'}
   res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(resolve('dist/client'+path)))
  }
 }catch{res.writeHead(500);res.end('Local test failed')}
})
let browser
try {
 const db=await mf.getD1Database('DB')
 for(const f of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec((await readFile('migrations/'+f,'utf8')).replace(/--[^\n]*/g,'').replace(/\n/g,' '))
 const password=randomBytes(24).toString('hex')+'Aa1!',cookies={}
 for(const role of ['owner','viewer','editor']){
  assert.equal((await api('/api/auth/sign-up/email','POST',{name:`Synthetic ${role}`,email:`${role}@example.test`,password})).status,200)
  const signed=await api('/api/auth/sign-in/email','POST',{email:`${role}@example.test`,password});assert.equal(signed.status,200)
  cookies[role]=signed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
 }
 const workspace=(await api('/api/workspaces','GET',undefined,cookies.owner)).body.workspaces[0]
 for(const role of ['viewer','editor']){
  const user=(await db.prepare('SELECT id FROM user WHERE email=?').bind(role+'@example.test').first()).id
  await db.prepare('INSERT INTO memberships(id,workspace_id,user_id,role,status) VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role').bind(randomUUID(),workspace.id,user,role,'active').run()
 }
 await db.prepare("INSERT INTO engagements(id,workspace_id,title) VALUES ('synthetic-engagement',?,'Synthetic engagement')").bind(workspace.id).run()
 const base='/api/workspaces/'+workspace.id
 const create=async title=>{const r=await api(base+'/workstreams','POST',{engagementId:'synthetic-engagement',title,purpose:title+' purpose'},cookies.owner);assert.equal(r.status,201);return r.body}
 const hidden=await create('Private owner workstream'),shared=await create('Shared strategy workstream'),other=await create('Another shared workstream')
 for(const stream of [shared,other])assert.equal((await api(base+'/workstreams/'+stream.id,'PATCH',{version:stream.version,visibility:'shared'},cookies.owner)).status,200)
 for(const role of ['viewer','editor']){
  const list=await api(base+'/workstreams','GET',undefined,cookies[role]);assert.equal(list.body.count,2);assert.ok(!JSON.stringify(list.body).includes(hidden.title))
  for(const path of ['/api/dashboard',base+'/members',base+'/time/hours'])assert.equal((await api(path,'GET',undefined,cookies[role])).status,403)
  assert.equal((await api(base+'/workstreams/'+hidden.id,'GET',undefined,cookies[role])).status,404)
 }
 assert.equal((await api(base+'/workstreams/'+shared.id,'PATCH',{version:2,title:'Forbidden edit'},cookies.viewer)).status,403)
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(5174,'localhost',done)})
 browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
 for(const role of ['owner','viewer','editor']){
  const context=await browser.newContext({viewport:{width:1440,height:1000}})
  await context.addCookies(cookies[role].split('; ').map(value=>{const i=value.indexOf('=');return {name:value.slice(0,i),value:value.slice(i+1),url:origin}}))
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(origin+'/workstreams');await page.getByRole('navigation',{name:'Main navigation'}).waitFor()
  const nav=page.getByRole('navigation',{name:'Main navigation'})
  await nav.getByRole('button',{name:shared.title,exact:true}).click();await page.getByRole('heading',{name:shared.title,exact:true}).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('workstream'),shared.id)
  assert.equal(await page.getByRole('heading',{name:'Current workstreams',exact:true}).count(),0)
  if(role==='owner'){
   await nav.getByRole('button',{name:hidden.title,exact:true}).waitFor()
   await nav.getByRole('button',{name:'Time settings',exact:true}).waitFor()
   await nav.getByRole('button',{name:'Workspace access',exact:true}).click();await page.getByRole('heading',{name:'Members',exact:true}).waitFor()
  }else{
   for(const label of [hidden.title,'Workspace access','Time','Time settings'])assert.equal(await nav.getByRole('button',{name:label,exact:true}).count(),0)
   assert.equal(await nav.getByRole('link',{name:'Dashboard',exact:true}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Add workstream',exact:true}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Save workstream',exact:true}).count(),role==='editor'?1:0)
   await page.screenshot({path:evidence+'/'+role+'-desktop.png'})
   await nav.getByRole('button',{name:'Collapse workstreams',exact:true}).click();assert.equal(await nav.getByRole('button',{name:shared.title,exact:true}).isVisible(),false)
   await nav.getByRole('button',{name:'Expand workstreams',exact:true}).press('Enter')
   await nav.getByRole('button',{name:other.title,exact:true}).click();await page.getByRole('heading',{name:other.title,exact:true}).waitFor()
   await page.goBack();await page.getByRole('heading',{name:shared.title,exact:true}).waitFor()
   await page.reload();await page.getByRole('heading',{name:shared.title,exact:true}).waitFor()
   await nav.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('heading',{name:'Notes',exact:true}).waitFor()
   await nav.getByRole('button',{name:'Workstreams',exact:true}).click();await page.getByRole('heading',{name:shared.title,exact:true}).waitFor()
   await nav.getByRole('button',{name:'Your account',exact:true}).click();await page.getByRole('heading',{name:'Your account',exact:true}).waitFor()
   await page.getByRole('link',{name:'Back to workstreams',exact:true}).click();await nav.waitFor()
   for(const path of ['/dashboard','/permissions','/time','/time-settings']){
    await page.goto(origin+path);await nav.waitFor();assert.equal(new URL(page.url()).pathname,'/workstreams')
   }
   await page.goto(origin+'/workstreams?workstream='+hidden.id);await page.getByRole('heading',{name:'Workstream unavailable',exact:true}).waitFor();assert.ok(!(await page.locator('body').textContent()).includes(hidden.title))
   await page.goto(origin+'/workstreams?workstream='+shared.id);await page.getByRole('heading',{name:shared.title,exact:true}).waitFor()
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:evidence+'/'+role+'-mobile.png',fullPage:true})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor()
  }
  assert.deepEqual(errors,[]);await context.close()
 }
 // Empty shared navigation must not prompt a viewer to create records.
 for(const stream of [shared,other])assert.equal((await api(base+'/workstreams/'+stream.id,'PATCH',{version:2,visibility:'private'},cookies.owner)).status,200)
 const signed=await api('/api/auth/sign-in/email','POST',{email:'viewer@example.test',password});cookies.viewer=signed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
 const context=await browser.newContext();await context.addCookies(cookies.viewer.split('; ').map(value=>{const i=value.indexOf('=');return{name:value.slice(0,i),value:value.slice(i+1),url:origin}}))
 const page=await context.newPage();await page.goto(origin+'/workstreams');await page.getByText('No shared workstreams yet.',{exact:true}).waitFor();await context.close()
 console.log('PASS production frontend + real Worker/D1: owner/viewer/editor shell, shared-only menu, read-only viewer, forbidden APIs/routes, selection/reload/back, keyboard disclosure, Notes/account/logout, empty state, desktop/mobile; disposable data only.')
}finally{await browser?.close();if(server.listening)await new Promise(done=>server.close(done));await mf.dispose()}
