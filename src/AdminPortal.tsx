import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { onValue, ref, update, serverTimestamp } from 'firebase/database'
import { CircleAlert, LogOut, Radio, RefreshCw, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import { AuthProvider } from './auth'
import { useAuth, type UserProfile } from './auth-context'
import { adminUids, firebaseReady, profilesDb } from './firebase'
import { apiUrl, appPath } from './deployment'

type ManagedUser = UserProfile & { reviewedAt?: number }
type EngineSignal = { direction: 'buy' | 'sell'; entry_time: number; entry: number; stop: number; [key: string]: unknown }

function AdminRoot() {
  const { user, loading, isAdmin, login, logout } = useAuth()
  if (!firebaseReady) return <div className="admin-login-screen"><div className="admin-login-panel"><Brand /><span className="eyebrow">CONFIGURATION NEEDED</span><h1>Connect Firebase first</h1><p>Set the Firebase project values before opening access management.</p></div></div>
  if (loading) return <div className="portal-loading"><span className="loader-mark" />Checking administrator access</div>
  if (!user) return <AdminLogin onLogin={login} />
  if (!isAdmin) return <div className="pending-screen"><div className="pending-panel"><Brand /><span className="pending-icon"><UserX size={22} /></span><span className="eyebrow">RESTRICTED</span><h1>Administrator access required</h1><p>This account is not listed as an admin. Sign out and use the designated administrator account.</p><button className="secondary-button" type="button" onClick={() => void logout()}><LogOut size={15} /> Sign out</button></div></div>
  return <AdminDesk adminEmail={user.email ?? ''} logout={logout} />
}

export default function AdminPortal() {
  return <AuthProvider><AdminRoot /></AuthProvider>
}

function AdminLogin({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    try {
      await onLogin(String(data.get('email') ?? ''), String(data.get('password') ?? ''))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }
  return <main className="admin-login-screen"><section className="admin-login-panel"><Brand /><span className="eyebrow">ADMINISTRATOR ACCESS</span><h1>Access management</h1><p>Sign in with the Firebase account whose UID is configured as an admin.</p><form className="auth-form" onSubmit={(event) => void submit(event)}><label>Email address<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{error && <div className="form-error"><CircleAlert size={14} />{error}</div>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></section></main>
}

function AdminDesk({ adminEmail, logout }: { adminEmail: string; logout: () => Promise<void> }) {
  const { user } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [workingUid, setWorkingUid] = useState('')
  const [relayEnabled, setRelayEnabled] = useState(false)
  const [relaySymbol, setRelaySymbol] = useState('GOLD')
  const [relayUpdated, setRelayUpdated] = useState('Not started')
  const [relayError, setRelayError] = useState('')
  const [signalCount, setSignalCount] = useState(0)
  const filteredUsers = useMemo(() => users.filter((item) => `${item.fullName} ${item.email} ${item.phone}`.toLowerCase().includes(search.toLowerCase())), [users, search])
  const pendingCount = users.filter((item) => item.status === 'pending').length
  const approvedCount = users.filter((item) => item.status === 'approved').length
  const validRelaySymbol = /^[A-Z0-9._-]{2,20}$/.test(relaySymbol)

  useEffect(() => {
    if (!profilesDb) return
    return onValue(ref(profilesDb, 'users'), (snapshot) => {
      const value = snapshot.val() as Record<string, ManagedUser> | null
      setUsers(value ? Object.values(value).filter((item) => item && typeof item.uid === 'string') : [])
      setError('')
    }, () => setError('Could not read the profiles database. Check admin UID and database rules.'))
  }, [])

  async function setAccess(target: ManagedUser, status: 'approved' | 'denied' | 'disabled') {
    if (!profilesDb || !user) return
    setWorkingUid(target.uid)
    setError('')
    setNotice('')
    try {
      await update(ref(profilesDb, `users/${target.uid}`), { status, reviewedAt: serverTimestamp(), reviewedBy: user.uid })
      setNotice(`${target.fullName} access ${status === 'approved' ? 'approved' : 'revoked'}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update user access.')
    } finally {
      setWorkingUid('')
    }
  }

  useEffect(() => {
    if (!relayEnabled || !user) return
    let active = true
    let busy = false
    const relay = async () => {
      if (busy) return
      busy = true
      try {
        const token = await user.getIdToken()
        const response = await fetch(apiUrl(`/api/signals?symbol=${encodeURIComponent(relaySymbol)}`), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        if (!response.ok) throw new Error(`Signal API returned ${response.status}. Check the MT5 service.`)
        const result = await response.json() as { signals?: EngineSignal[] }
        const publishResponse = await fetch(apiUrl('/api/signals/publish'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: relaySymbol, signals: result.signals ?? [] }),
        })
        if (!publishResponse.ok) throw new Error(`Signal publish API returned ${publishResponse.status}.`)
        const published = await publishResponse.json() as { count: number }
        if (active) {
          setSignalCount(published.count)
          setRelayUpdated(new Date().toLocaleTimeString())
          setRelayError('')
        }
      } catch (reason) {
        if (active) setRelayError(reason instanceof Error ? reason.message : 'Could not relay engine signals.')
      } finally {
        busy = false
      }
    }
    void relay()
    const interval = window.setInterval(() => void relay(), 5_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [relayEnabled, relaySymbol, user])

  return <div className="admin-shell"><header className="admin-topbar"><a className="brand" href={appPath('admin.html')}><span className="brand-mark">M</span><span>myview<span className="brand-dot">.</span></span><i /><small>ADMIN</small></a><div className="admin-user"><span>{adminEmail}</span><button className="icon-control" type="button" aria-label="Sign out" title="Sign out" onClick={() => void logout()}><LogOut size={16} /></button></div></header>
    <main className="admin-content"><div className="admin-heading"><div><span className="eyebrow">OPERATIONS / ACCESS CONTROL</span><h1>Admin desk</h1><p>Review member requests and keep the market signal feed connected.</p></div><a className="secondary-button" href={appPath()}>Open user site</a></div>
      <div className="admin-metrics"><div className="admin-metric"><span>REGISTERED MEMBERS</span><strong>{users.length}</strong></div><div className="admin-metric"><span>WAITING FOR REVIEW</span><strong>{pendingCount}</strong></div><div className="admin-metric"><span>ACTIVE ACCESS</span><strong>{approvedCount}</strong></div></div>
      <div className="admin-grid"><section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">MEMBERS</span><h2>User access</h2></div><input className="admin-filter" aria-label="Search users" placeholder="Search name, email or phone" value={search} onChange={(event) => setSearch(event.target.value)} /></div>{error && <div className="admin-error" role="alert">{error}</div>}{notice && <div className="admin-success" role="status">{notice}</div>}<div className="user-list"><div className="user-row header"><span>MEMBER</span><span>CONTACT</span><span>NIC</span><span>STATUS</span><span>ACTIONS</span></div>{filteredUsers.length ? filteredUsers.map((item) => <UserRow key={item.uid} item={item} busy={workingUid === item.uid} onApprove={() => void setAccess(item, 'approved')} onRevoke={() => void setAccess(item, 'disabled')} />) : <div className="list-empty">{users.length ? 'No matching members.' : 'No user registrations yet.'}</div>}</div></section>
        <aside className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">MT5 · PYTHON ENGINE</span><h2>Signal relay</h2></div><Radio size={16} color="#63736a" /></div><div className="relay-body"><div className={`relay-status ${relayEnabled ? 'running' : ''}`}><i />{relayEnabled ? 'Relay is polling every 5 seconds' : 'Relay is stopped'}</div><label className="field-label" htmlFor="relay-symbol" style={{ display: 'block', marginTop: 16, color: '#78827c', fontSize: 9 }}>MT5 SYMBOL</label><div className="symbol-picker" style={{ marginTop: 6, width: '100%' }}><input id="relay-symbol" value={relaySymbol} disabled={relayEnabled} onChange={(event) => setRelaySymbol(event.target.value.toUpperCase())} aria-label="Relay symbol" /><button type="button" title="Reset symbol" aria-label="Reset symbol" disabled={relayEnabled} onClick={() => setRelaySymbol('GOLD')}><RefreshCw size={13} /></button></div><button className={`relay-button ${relayEnabled ? 'stop' : ''}`} type="button" disabled={(!relayEnabled && !validRelaySymbol) || !adminUids.size} onClick={() => setRelayEnabled((enabled) => !enabled)}>{relayEnabled ? 'Stop relay' : 'Start signal relay'}</button>{!validRelaySymbol && <small className="password-message">Use 2–20 letters, numbers, dots, underscores or hyphens.</small>}{relayError && <div className="admin-error" role="alert">{relayError}</div>}<div className="relay-meta"><span>LAST CHECK <strong>{relayUpdated}</strong></span><span>PUBLISHED SIGNALS <strong>{signalCount}</strong></span></div><p className="relay-note">Keep this admin page open while the relay is active. It reads confirmed signals from the Python/MT5 API and writes them to the signals database. Member access is required to read that database.</p></div></aside></div>
      <div className="desk-disclaimer"><ShieldCheck size={14} /><span>Admin identity is checked against the configured UID; database rules must use the same UID. Never expose a Firebase service-account key in this website.</span></div>
    </main>
  </div>
}

function UserRow({ item, busy, onApprove, onRevoke }: { item: ManagedUser; busy: boolean; onApprove: () => void; onRevoke: () => void }) {
  return <div className="user-row"><div className="user-cell"><strong>{item.fullName || 'Unnamed account'}</strong><small>{item.email}</small></div><div className="user-cell"><strong>{item.phone || '—'}</strong><small>Registered member</small></div><div className="user-cell"><strong>{maskNic(item.nic || '')}</strong></div><span className={`user-status ${item.status}`}>{item.status}</span><div className="row-actions">{item.status === 'approved' ? <button className="deny" type="button" disabled={busy} onClick={onRevoke}><UserX size={12} /> Revoke</button> : <><button type="button" disabled={busy} onClick={onApprove}><UserCheck size={12} /> Approve</button>{item.status !== 'denied' && <button className="deny" type="button" disabled={busy} onClick={onRevoke}><UserX size={12} /> Deny</button>}</>}</div></div>
}

function Brand() {
  return <a className="brand" href={appPath('admin.html')}><span className="brand-mark">M</span><span>myview<span className="brand-dot">.</span></span></a>
}

function maskNic(nic: string) {
  return nic.length > 4 ? `${'•'.repeat(nic.length - 4)}${nic.slice(-4)}` : nic || '—'
}