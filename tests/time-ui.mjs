import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { initialSettings } from '../.local/time-tests/worker/time/settings.js'
import { calculate } from '../.local/time-tests/worker/time/logic.js'
await mkdir('.local/time-ui',{recursive:true})
const server=spawn('npm',['run','dev'],{stdio:'ignore',env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:'.local/time-ui/wrangler.log',SILVERASSIST_STATE_PATH:'.local/time-ui/state'}})
let browser
try {
 for(let n=0;n<60;n++){try {if((await fetch('http://localhost:5173')).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
 const data=calculate([{summary:'SilverAssist Strategy',start:{dateTime:'2026-10-06T23:00:00-05:00'},end:{dateTime:'2026-10-07T02:00:00-05:00'}}],initialSettings,Date.parse('2026-10-07T12:00:00-05:00'))
 let failure=false
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  let body={},status=200
  if(path==='/api/auth/get-session')body={user:{id:'owner',name:'Test Advisor',email:'owner@example.test',emailVerified:true},session:{id:'session'}}
  else if(path==='/api/workspaces')body={workspaces:[{id:'ws',name:'Test workspace',role:'owner'}]}
  else if(path==='/api/dashboard')body={workspace:{id:'ws',name:'Test workspace'},engagements:[],totals:{workstreams:0,openTasks:0}}
  else if(path.endsWith('/workstreams'))body={workstreams:[]}
  else if(path.endsWith('/time/settings'))body={settings:initialSettings,version:0}
  else if(path.endsWith('/time/calendar'))body={connection:{account_email:'owner@example.test',status:'connected'},configured:true}
  else if(path.endsWith('/time/hours')){body=failure?{error:'Synthetic provider failure'}:data;status=failure?502:200}
  await route.fulfill({status,json:body})
 })
 await page.goto('http://localhost:5173/time');await page.getByRole('heading',{name:'Hours by month',exact:true}).waitFor()
 assert.equal(await page.locator('.time-rollups .metric-value').first().textContent(),'3.0 h')
 await page.getByText('Daily hours table',{exact:true}).click();await page.getByRole('cell',{name:'2.0 h',exact:true}).first().waitFor()
 await page.screenshot({path:'.local/time-ui/desktop.png',fullPage:true})
 failure=true;await page.getByRole('button',{name:'Refresh hours',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/Previous successful totals/)
 await page.reload();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.time-rollups').count(),0)
 failure=false;await page.getByRole('button',{name:'Refresh hours',exact:true}).click();await page.locator('.time-rollups').waitFor()
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/time-ui/mobile.png',fullPage:true})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No page-wide mobile overflow')
 assert.deepEqual(errors,[])
 console.log('PASS Time direct route, hand-computed midnight sample, successful/error/initial-failure states, desktop/mobile layout; synthetic browser API only.')
}finally{await browser?.close();server.kill('SIGTERM')}
