import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ComponentProps, FormEvent } from 'react'
import { passwordRules, validPassword, passwordPolicyMessage } from '../shared/password-policy'
import { Dashboard } from './Dashboard'
import { Permissions } from './Permissions'
const WorkstreamsPage=lazy(()=>import('./Workstreams').then(module=>({default:module.Workstreams})))
const NotesPage=lazy(()=>import('./Notes').then(module=>({default:module.Notes})))
function Workstreams(props:ComponentProps<typeof WorkstreamsPage>) {return <Suspense fallback={<p role="status">Opening workstreams…</p>}><WorkstreamsPage {...props}/></Suspense>}
function Notes(props:ComponentProps<typeof NotesPage>) {return <Suspense fallback={<p role="status">Opening notes…</p>}><NotesPage {...props}/></Suspense>}
import type { DashboardData, NavigationWorkstream } from './Dashboard'

type Mode = 'signin' | 'signup' | 'forgot' | 'reset'
type SavedRecord = { id: string; content: string }
function initialMode(): Mode {
  if (location.pathname === '/reset-password') return 'reset'
  if (location.pathname === '/forgot-password') return 'forgot'
  if (location.pathname === '/sign-up') return 'signup'
  return 'signin'
}

function PasswordChecklist({ value }: { value: string }) {
  return <ul className="password-rules" id="password-rules">
    {passwordRules.map(rule => <li key={rule.label} data-met={rule.check(value)}>
      <span aria-hidden="true">{rule.check(value) ? '✓' : '○'}</span> {rule.label}
      <span className="sr-only">{rule.check(value) ? ' met' : ' required'}</span>
    </li>)}
  </ul>
}

export default function App() {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [token] = useState(() => new URLSearchParams(location.search).get('token'))
  const [name, setName] = useState<string | null>(null)
  const [records, setRecords] = useState<SavedRecord[]>([])
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [content, setContent] = useState('')
  const [message, setMessage] = useState(() => {
    const query = new URLSearchParams(location.search)
    if (query.has('error')) return 'This email link is expired or invalid. Request a new link.'
    return query.get('verified') === '1' ? 'Email verified. You can sign in.' : ''
  })
  const [busy, setBusy] = useState(false)
  const [mailLink, setMailLink] = useState<string | null>(null)
  const [mailKind, setMailKind] = useState<'verification' | 'reset' | null>(null)
  const [showChange, setShowChange] = useState(false)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [accountView, setAccountView] = useState(location.pathname === '/account')
  const [loading, setLoading] = useState(true)
  const [view,setView] = useState(location.pathname.slice(1)||'dashboard')
  const [selectedWorkstreamId,setSelectedWorkstreamId] = useState<string|null>(()=>location.pathname==='/workstreams'?new URLSearchParams(location.search).get('workstream'):null)
  const [navigationWorkstreams,setNavigationWorkstreams] = useState<NavigationWorkstream[]>([])
  const [workspace,setWorkspace] = useState<{id:string;name:string;role:string}|null>(null)
  const [acceptingInvite,setAcceptingInvite] = useState(location.pathname==='/accept-invitation'&&!!token)
  const [localAccessToken] = useState(() => import.meta.env.DEV ? new URLSearchParams(location.hash.slice(1)).get('local-access') : null)
  const localAccessRequest = useRef<Promise<unknown> | null>(null)

  function navigate(next: Mode, keepMessage = false) {
    const paths = { signin: '/', signup: '/sign-up', forgot: '/forgot-password', reset: '/reset-password' }
    history.pushState({}, '', paths[next]); setMode(next)
    setPassword(''); setConfirm(''); setCurrentPassword(''); setMailLink(null); setMailKind(null)
    if (!keepMessage) setMessage('')
  }
  async function post(path: string, body: object) {
    const response = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || 'Unable to complete the request. Please try again.')
    return data
  }
  async function refresh() {
    const session = await fetch('/api/auth/get-session').then(response => response.json())
    setName(session?.user?.name ?? null)
    if (session?.user) {
      setEmail(session.user.email)
      const spaces=await fetch('/api/workspaces').then(r=>r.json())
      setWorkspace(spaces.workspaces?.[0]??null)
      const response = await fetch('/api/dashboard')
      if (response.ok) {
        setDashboard(await response.json())
        await refreshWorkstreamNavigation(spaces.workspaces?.[0]?.id)
        if (!['/account', '/reset-password','/workstreams','/notes','/permissions','/accept-invitation'].includes(location.pathname)) {
          history.replaceState({}, '', '/dashboard'); setAccountView(false);setView('dashboard')
        }
      } else if (response.status === 403) {setDashboard(null);if(spaces.workspaces?.length&&location.pathname==='/'){history.replaceState({},'','/workstreams');setView('workstreams');setAccountView(false)}}
      else throw new Error('Unable to load your workspace. Please refresh.')
      if (import.meta.env.DEV) {
        const result = await fetch('/api/dev/records').then(response => response.json())
        setRecords(result.records ?? [])
      }
    } else { setRecords([]); setDashboard(null);setWorkspace(null);setNavigationWorkstreams([]) }
  }
  async function refreshWorkstreamNavigation(workspaceId:string|undefined){
    if(!workspaceId)return
    const response=await fetch(`/api/workspaces/${workspaceId}/workstreams`)
    if(response.ok)setNavigationWorkstreams((await response.json()).workstreams)
    else setNavigationWorkstreams([])
  }
  function selectWorkstream(id:string|null){
    if(selectedWorkstreamId!==id||location.pathname!=='/workstreams')history.pushState({},'',`/workstreams${id?`?workstream=${encodeURIComponent(id)}`:''}`)
    setSelectedWorkstreamId(id);setView('workstreams');setMessage('')
  }
  useEffect(() => {
    // Keep recovery tokens in memory rather than browser history or storage.
    if (location.search || localAccessToken) history.replaceState({}, '', location.pathname+(location.pathname==='/workstreams'&&selectedWorkstreamId?`?workstream=${encodeURIComponent(selectedWorkstreamId)}`:''))
    const onBack = () => { if(!window.dispatchEvent(new Event('portal:navigate',{cancelable:true}))){history.go(1);return} setMode(initialMode()); setAccountView(location.pathname === '/account');setView(location.pathname.slice(1)||'dashboard');setSelectedWorkstreamId(new URLSearchParams(location.search).get('workstream')); setPassword(''); setConfirm(''); setMessage('') }
    addEventListener('popstate', onBack)
    if (localAccessToken && !localAccessRequest.current) {
      localAccessRequest.current = post('local-owner-access', { token: localAccessToken })
        .then(() => setMessage('Local development access opened your dashboard. Your password is unchanged.'))
    }
    (localAccessRequest.current ?? Promise.resolve()).then(refresh)
      .catch(error => setMessage(localAccessToken ? (error as Error).message : 'Unable to connect. Please refresh.'))
      .finally(() => setLoading(false))
    return () => removeEventListener('popstate', onBack)
  }, [])

  async function submitAccount(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setMailLink(null)
    try {
      if (mode === 'signup' || mode === 'reset') {
        if (!validPassword(password)) throw new Error(passwordPolicyMessage)
        if (password !== confirm) throw new Error('The passwords do not match.')
      }
      if (mode === 'signin') {
        await post('sign-in/email', { email, password })
        setPassword(''); await refresh()
      } else if (mode === 'signup') {
        const created = await post('sign-up/email', { name: displayName, email, password, callbackURL: `${location.origin}/?verified=1` })
        setPassword(''); setConfirm('')
        if (created?.user?.emailVerified) await refresh()
        else {
          setMailKind('verification')
          setMessage('Check your verification email before signing in. Creating an account does not grant access to an engagement.')
        }
      } else if (mode === 'forgot') {
        await post('request-password-reset', { email, redirectTo: `${location.origin}/reset-password` })
        setMailKind('reset'); setMessage('If an account exists for that email, a password reset link has been sent.')
      } else {
        if (!token) throw new Error('This reset link is missing or invalid. Request a new one.')
        await post('reset-password', { token, newPassword: password })
        await refresh(); navigate('signin', true); setMessage('Password reset. Sign in with your new password.')
      }
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }
  async function showLocalMail() {
    setBusy(true)
    try {
      const result = await fetch('/api/dev/outbox').then(response => response.json())
      const latest = result.messages?.filter((item: { email: string; kind: string }) => item.email === email && item.kind === mailKind)
        .sort((a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt)).at(-1)
      setMailLink(latest?.url ?? null)
      if (!latest) setMessage('No local message found yet. Check the email address or try again shortly.')
    } catch { setMessage('Unable to open development mail.') }
    finally { setBusy(false) }
  }
  async function saveRecord(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/dev/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
      if (!response.ok) throw new Error('Unable to save. Your text is still here; please retry.')
      setContent(''); await refresh(); setMessage('Test record saved.')
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      if (!validPassword(password)) throw new Error(passwordPolicyMessage)
      if (password !== confirm) throw new Error('The passwords do not match.')
      await post('change-password', { currentPassword, newPassword: password, revokeOtherSessions: true })
      setPassword(''); setConfirm(''); setCurrentPassword(''); setShowChange(false)
      setMessage('Password changed. Other sign-in sessions have been revoked.')
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }
  function allowNavigation(){return window.dispatchEvent(new Event('portal:navigate',{cancelable:true}))}
  async function signOut() {
    if(!allowNavigation())return
    setBusy(true)
    try { await post('sign-out', {}); await refresh(); setShowChange(false); navigate('signin', true); setMessage('Signed out.') }
    catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }
  const titles = { signin: 'Sign in', signup: 'Create your account', forgot: 'Forgot your password?', reset: 'Choose a new password' }
  const link = (next: Mode, label: string) => <a className="text-link" href={next === 'signin' ? '/' : next === 'signup' ? '/sign-up' : '/forgot-password'} onClick={event => { event.preventDefault(); navigate(next) }}>{label}</a>
  const newPasswordFields = <>
    <label htmlFor="new-password">New password</label>
    <input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required aria-describedby="password-rules" value={password} onChange={event => setPassword(event.target.value)} />
    <PasswordChecklist value={password} />
    <label htmlFor="confirm-password">Confirm password</label>
    <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} />
  </>
  if (loading) return <main className="foundation-page"><p role="status">Opening your workspace…</p></main>
  if(name&&acceptingInvite) return <main className="foundation-page"><h1>Accept workspace invitation</h1><p>Signed in as {email}. Accepting grants the role chosen by the workspace owner.</p><button className="primary-button" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await fetch('/api/invitations/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const d=await r.json();if(!r.ok)throw new Error(d.error);setAcceptingInvite(false);history.replaceState({},'','/workstreams');setView('workstreams');await refresh()}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}}>Accept invitation</button><button className="outline-button" disabled={busy} onClick={signOut}>Sign out</button><p role="status">{message}</p></main>
  if(name&&workspace&&workspace.role!=='owner'&&!accountView) return <main className="foundation-page"><span className="scope-tag">Shared workspace</span><h1>{workspace.name}</h1><p>Signed in as {name}</p><button className="outline-button" disabled={busy} onClick={signOut}>Sign out</button><button className="text-button" onClick={()=>{history.pushState({},'','/account');setAccountView(true)}}>Your account</button><nav className="portal-actions"><button className="outline-button" onClick={()=>{if(allowNavigation()){setView('workstreams');history.pushState({},'','/workstreams')}}}>Workstreams</button><button className="outline-button" onClick={()=>{if(allowNavigation()){setView('notes');history.pushState({},'','/notes')}}}>Notes</button></nav>{view==='notes'?<Notes workspaceId={workspace.id} role={workspace.role}/>:<Workstreams workspaceId={workspace.id} role={workspace.role}/>}</main>
  if (name && dashboard && mode !== 'reset' && !accountView) return <Dashboard data={dashboard} name={name} busy={busy} message={message}
    view={view} workstreams={navigationWorkstreams} selectedWorkstreamId={selectedWorkstreamId} onWorkstream={id=>{if(view==='workstreams'&&selectedWorkstreamId===id)return;if(allowNavigation())selectWorkstream(id)}}
    onNavigate={next=>{if(next===view||!allowNavigation())return;history.pushState({},'',`/${next}${next==='workstreams'&&selectedWorkstreamId?`?workstream=${encodeURIComponent(selectedWorkstreamId)}`:''}`);setView(next);setMessage('');if(next==='dashboard')refresh().catch(e=>setMessage(e.message));else if(next!=='workstreams')refreshWorkstreamNavigation(dashboard.workspace.id)}}
    onAccount={() => { if(!allowNavigation())return;history.pushState({}, '', '/account'); setAccountView(true); setMessage('') }} onSignOut={signOut} >
      {view==='permissions'?<Permissions workspaceId={dashboard.workspace.id}/>:view==='workstreams'?<Workstreams workspaceId={dashboard.workspace.id} role="owner" selectedId={selectedWorkstreamId} onSelectionChange={selectWorkstream} onStreamsChange={setNavigationWorkstreams}/>:view==='notes'?<Notes workspaceId={dashboard.workspace.id} role="owner"/>:undefined}
    </Dashboard>
  return <main className="foundation-page">
    <header><span className="scope-tag">Private · Central Time</span><h1>SilverAssist Advisory</h1></header>
    <section className="foundation-panel" aria-labelledby="account-title">
      <span className="eyebrow">{name ? workspace ? 'Account settings' : 'Foundation preview' : 'Your account'}</span>
      <h2 id="account-title">{name && mode !== 'reset' ? workspace ? 'Your account' : 'Getting your workspace ready' : titles[mode]}</h2>
      {name && mode !== 'reset' ? <>
        {dashboard ? <a className="text-link" href="/dashboard" onClick={event => { event.preventDefault(); history.pushState({}, '', '/dashboard'); setAccountView(false); setView('dashboard'); setShowChange(false); setPassword(''); setConfirm(''); setCurrentPassword('') }}>Back to dashboard</a> : workspace ? <a className="text-link" href="/workstreams" onClick={event=>{event.preventDefault();history.pushState({},'','/workstreams');setView('workstreams');setAccountView(false);setShowChange(false)}}>Back to workstreams</a> : <p>Your account is signed in. Engagement access and the working portal are being built next.</p>}
        <div className="session-row"><p>Signed in as <strong>{name}</strong></p>
          <button className="outline-button" disabled={busy} onClick={signOut}>Sign out</button></div>
        <button className="text-button account-action" onClick={() => { setShowChange(!showChange); setPassword(''); setConfirm(''); setCurrentPassword(''); setMessage('') }}>Change password</button>
        {showChange && <form onSubmit={changePassword}>
          <label htmlFor="current-password">Current password</label><input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
          {newPasswordFields}<button className="primary-button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>}
        {import.meta.env.DEV && !workspace && <>
          <form onSubmit={saveRecord}><label htmlFor="content">Test record</label>
            <textarea id="content" maxLength={300} required value={content} onChange={event => setContent(event.target.value)} />
            <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save test record'}</button></form>
          <h3>Saved test records</h3>
          {records.length ? <ul>{records.map(record => <li key={record.id}>{record.content}</li>)}</ul> : <p>No test records yet.</p>}
        </>}
      </> : <>
        <form onSubmit={submitAccount}>
          {mode === 'signup' && <><label htmlFor="display-name">Name</label><input id="display-name" autoComplete="name" required maxLength={100} value={displayName} onChange={event => setDisplayName(event.target.value)} /></>}
          {mode !== 'reset' && <><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></>}
          {mode === 'signin' && <><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></>}
          {(mode === 'signup' || mode === 'reset') && newPasswordFields}
          <button className="primary-button" disabled={busy || (mode === 'reset' && !token)}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Reset password' : 'Sign in'}</button>
        </form>
        {mode === 'reset' && !token && <p>This reset link is missing, expired, or invalid. {link('forgot', 'Request a new reset link')}</p>}
        <nav className="account-links" aria-label="Account options">
          {mode === 'signin' ? <>{link('signup', 'Create an account')}{link('forgot', 'Forgot password?')}</> : link('signin', 'Back to sign in')}
        </nav>
      </>}
      <p role="status" aria-live="polite">{message}</p>
      {import.meta.env.DEV && mailKind && <aside className="development-mail">
        <strong>Development mail · local only</strong>
        <p>For this local preview, email is captured on your computer rather than delivered to your inbox.</p>
        <button className="outline-button" disabled={busy} onClick={showLocalMail}>Show local {mailKind === 'reset' ? 'reset' : 'verification'} email</button>
        {mailLink && <p><a className="text-link" href={mailLink}>Open {mailKind === 'reset' ? 'password reset' : 'verification'} link</a></p>}
      </aside>}
    </section>
  </main>
}
