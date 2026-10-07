import { useState } from 'react'
import type { ReactNode } from 'react'
export type NavigationWorkstream = { id: string; title: string; archived_at: string | null }
export type DashboardData = {
  workspace: { id: string; name: string }
  engagements: { id: string; title: string; timezone: string; start_date: string | null }[]
  totals: { workstreams: number; openTasks: number }
}
export function Dashboard({ data, name, busy, message, onAccount, onSignOut, view = 'dashboard', onNavigate, children, workstreams = [], selectedWorkstreamId, onWorkstream, role = 'owner' }: {
  data: DashboardData; name: string; busy: boolean; message: string; role?: string
  onAccount: () => void; onSignOut: () => void
  view?: string; onNavigate?: (view: string) => void; children?: ReactNode
  workstreams?: NavigationWorkstream[]; selectedWorkstreamId?: string | null; onWorkstream?: (id: string) => void
}) {
  const owner = role === 'owner'
  const [workstreamsOpen,setWorkstreamsOpen] = useState(true)
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand"><span className="brand-mark" aria-hidden="true">SA</span><strong>SilverAssist<br />Advisory</strong></div>
      <p className="workspace-label">{data.workspace.name}</p>
      <nav className="nav-list" aria-label="Main navigation">
        {owner&&<a className={`nav-item ${view==='dashboard'?'active':''}`} href="/dashboard" aria-current={view==='dashboard'?'page':undefined} onClick={e=>{if(onNavigate){e.preventDefault();onNavigate('dashboard')}}}>Dashboard</a>}
        <div className="nav-workstream-group">
          <div className={`nav-workstream-row ${view==='workstreams'?'active':''}`}>
            <button className="nav-item" aria-current={view==='workstreams'&&!selectedWorkstreamId?'page':undefined} onClick={()=>{setWorkstreamsOpen(true);onNavigate?.('workstreams')}}>Workstreams</button>
            <button className="nav-disclosure" aria-label={`${workstreamsOpen?'Collapse':'Expand'} workstreams`} aria-expanded={workstreamsOpen} aria-controls="workstream-navigation" onClick={()=>setWorkstreamsOpen(!workstreamsOpen)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={workstreamsOpen?'m6 15 6-6 6 6':'m6 9 6 6 6-6'}/></svg>
            </button>
          </div>
          <ul id="workstream-navigation" className="nav-sublist" hidden={!workstreamsOpen} aria-label="Workstreams">
            {workstreams.map(stream=><li key={stream.id}><button className={`nav-subitem ${view==='workstreams'&&selectedWorkstreamId===stream.id?'active':''}`} aria-current={view==='workstreams'&&selectedWorkstreamId===stream.id?'page':undefined} onClick={()=>onWorkstream?.(stream.id)}>{stream.title}{stream.archived_at&&<span>Archived</span>}</button></li>)}
            {!workstreams.length&&<li className="nav-empty">No workstreams in this view.</li>}
          </ul>
        </div>
        {(owner?['notes','time','time-settings','permissions']:['notes']).map(item=><button key={item} className={`nav-item ${view===item?'active':''}`} aria-current={view===item?'page':undefined} onClick={()=>onNavigate?.(item)}>{item==='notes'?'Notes':item==='time'?'Time':item==='time-settings'?'Time settings':'Workspace access'}</button>)}
        <button className="nav-item" onClick={onAccount}>Your account</button>
      </nav>
      <div className="sidebar-footer"><span className="scope-tag">{owner?'Private workspace':'Shared workspace'}</span><p>Signed in as <strong>{name}</strong></p>
        <button className="outline-button" disabled={busy} onClick={onSignOut}>Sign out</button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><span className="eyebrow">Your engagement</span><span className="scope-tag">{owner?'Private · Central Time':'Shared workspace'}</span></header>
      <div className="dashboard-page">{children??<>
        <h1>Dashboard</h1><p className="lede">Welcome, {name.split(' ')[0]}. Your SilverAssist workspace is ready.</p>
        <div className="dashboard-metrics">
          <section className="ds-metric-card"><h2>Open follow-ups</h2><p className="metric-value">{data.totals.openTasks}</p><p>Open, in progress, or blocked</p></section>
        </div>
        <section className="foundation-panel" aria-labelledby="engagement-heading"><span className="eyebrow">Engagement overview</span>
          <h2 id="engagement-heading">{data.workspace.name}</h2>
          {data.engagements.map(item => <div className="engagement-summary" key={item.id}><h3>{item.title}</h3><dl>
            <div><dt>Reporting timezone</dt><dd>{item.timezone}</dd></div><div><dt>Start date</dt><dd>{item.start_date ?? 'Not set'}</dd></div>
          </dl></div>)}
          {!data.engagements.length && <p>No engagements yet.</p>}
          {data.totals.workstreams === 0 && <p className="dashboard-empty">No workstreams or follow-ups have been added yet. Open Workstreams or Notes to begin adding your engagement records.</p>}
        </section>
        <p role="status" aria-live="polite">{message}</p></>}
      </div>
    </main>
  </div>
}
