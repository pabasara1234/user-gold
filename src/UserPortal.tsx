import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type UTCTimestamp,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  TickMarkType,
} from 'lightweight-charts'
import { onValue, ref } from 'firebase/database'
import { Activity, ArrowDownRight, ArrowUpRight, CircleAlert, LogOut, LockKeyhole, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react'
import { AuthProvider } from './auth'
import { useAuth, type UserProfile } from './auth-context'
import { firebaseReady, profilesDb, signalSymbolKey } from './firebase'
import { apiUrl, appPath } from './deployment'

type Signal = {
  direction: 'buy' | 'sell'
  entry_time: number
  entry: number
  stop: number
  target?: number
  outcome?: 'stop' | 'target' | 'open'
  result_r?: number
  session_name?: string | null
  setup?: string
  symbol?: string
}
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }
type SessionSummary = { target_r: number; session: string; summary: { wins: number; losses: number; trades: number; win_rate: number } }

function chartDate(time: Time) {
  if (typeof time === 'number') return new Date(time * 1000)
  if (typeof time === 'string') return new Date(time)
  return new Date(Date.UTC(time.year, time.month - 1, time.day))
}

function formatColomboTime(time: Time) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(chartDate(time))
}

function formatColomboTick(time: Time, tickMarkType: TickMarkType) {
  const date = chartDate(time)
  if (tickMarkType === TickMarkType.Year) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', year: 'numeric' }).format(date)
  }
  if (tickMarkType === TickMarkType.Month) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', month: 'short' }).format(date)
  }
  if (tickMarkType === TickMarkType.DayOfMonth) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    minute: '2-digit',
    ...(tickMarkType === TickMarkType.TimeWithSeconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }).format(date)
}

function Portal() {
  const authState = useAuth()
  if (!firebaseReady) return <SetupNotice />
  if (authState.loading) return <div className="portal-loading"><span className="loader-mark" />Checking access</div>
  if (!authState.user) return <AccessForm />
  if (authState.isAdmin) {
    const adminProfile = authState.profile ?? {
      uid: authState.user.uid,
      fullName: authState.user.displayName || authState.user.email || 'Administrator',
      email: authState.user.email || '',
      phone: '',
      nic: '',
      status: 'approved' as const,
    }
    return <SignalDesk profile={adminProfile} />
  }
  if (!authState.profile) return <PendingAccess title="Account details unavailable" detail="Your profile could not be found. Contact the administrator before retrying." />
  if (authState.profile.status === 'pending') return <PendingAccess title="Access request received" detail="Your account is waiting for admin approval. The signal desk will unlock as soon as access is granted." />
  if (authState.profile.status !== 'approved') return <PendingAccess title="Access is not active" detail="This account does not currently have signal desk access. Contact the administrator for help." />
  return <SignalDesk profile={authState.profile} />
}

export default function UserPortal() {
  return <AuthProvider><Portal /></AuthProvider>
}

function SetupNotice() {
  return <main className="setup-screen"><div className="setup-panel"><Brand /><span className="eyebrow">ONE-TIME SETUP</span><h1>Firebase is not connected yet.</h1><p>Add the Firebase web app values and both Realtime Database URLs to a local <code>.env</code> file, then restart Vite.</p></div></main>
}

function AccessForm() {
  const { login, register, resetPassword, error, clearError } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState('')
  const [formNotice, setFormNotice] = useState('')
  const [resetMessage, setResetMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setFormError('')
    setFormNotice('')
    setResetMessage('')
    clearError()
    const data = new FormData(event.currentTarget)
    try {
      const email = String(data.get('email') ?? '')
      const password = String(data.get('password') ?? '')
      if (mode === 'login') await login(email, password)
      else {
        const fullName = String(data.get('fullName') ?? '').trim()
        const phone = String(data.get('phone') ?? '').trim()
        const nic = String(data.get('nic') ?? '').trim()
        if (password.length < 8) throw new Error('Use a password with at least 8 characters.')
        await register({ fullName, email, phone, nic }, password)
        setFormNotice('Your request was created. Sign in after the administrator approves it.')
      }
    } catch (reason) {
      setFormError(firebaseMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function sendResetLink() {
    if (!email.trim()) {
      setFormError('Enter your email address first.')
      return
    }
    setResetBusy(true)
    setFormError('')
    setResetMessage('')
    try {
      await resetPassword(email)
      setResetMessage('If this email has an account, a password reset link has been sent.')
    } catch {
      setResetMessage('Could not send the reset email. Check your email address and try again.')
    } finally {
      setResetBusy(false)
    }
  }

  return <main className="auth-screen">
    <div className="auth-visual"><div className="visual-grid" /><Brand /><div className="visual-copy"><span className="eyebrow">MT5 · MARKET SIGNALS</span><h1>Read the market.<br /><em>Trade your plan.</em></h1><p>Live setup levels, chart context, and session performance in one quiet workspace.</p></div><div className="visual-foot"><span>NEXTGEN GOLD SIGNAL DESK</span><span>READ-ONLY MARKET DATA</span></div></div>
    <section className="auth-side"><div className="mobile-brand"><Brand /></div><div className="auth-form-wrap"><span className="eyebrow">{mode === 'login' ? 'MEMBER ACCESS' : 'NEW ACCOUNT'}</span><h2>{mode === 'login' ? 'Welcome back' : 'Request access'}</h2><p className="auth-subtitle">{mode === 'login' ? 'Sign in to your approved account.' : 'Create your profile. An administrator must approve access.'}</p>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {mode === 'register' && <>
          <label>Full name<input name="fullName" autoComplete="name" required maxLength={100} /></label>
          <div className="form-two"><label>Phone number<input name="phone" autoComplete="tel" type="tel" required maxLength={24} /></label><label>NIC number<input name="nic" autoComplete="off" required minLength={8} maxLength={15} /></label></div>
        </>}
        <label>Email address<input name="email" autoComplete="email" type="email" required maxLength={254} value={email} onChange={(event) => { setEmail(event.target.value); setResetMessage('') }} /></label>
        <label>Password<input name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" required minLength={8} /></label>
        {mode === 'login' && <button className="forgot-password" type="button" disabled={resetBusy} onClick={() => void sendResetLink()}>{resetBusy ? 'Sending reset link…' : 'Forgot password?'}</button>}
        {(formError || error) && <div className="form-error" role="alert"><CircleAlert size={15} />{formError || error}</div>}
        {formNotice && <p className="reset-message" role="status">{formNotice}</p>}
        {resetMessage && <p className="reset-message" role="status">{resetMessage}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <div className="auth-switch">{mode === 'login' ? 'Need an account?' : 'Already registered?'} <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setFormError(''); setFormNotice(''); setResetMessage(''); clearError() }}>{mode === 'login' ? 'Request access' : 'Sign in'}</button></div>
      <p className="privacy-note"><LockKeyhole size={13} /> Passwords are handled by Firebase Authentication.</p>
    </div><span className="auth-copyright">NEXTGEN GOLD <b>·</b> SIGNALS ARE FOR INFORMATION ONLY</span></section>
  </main>
}

function PendingAccess({ title, detail }: { title: string; detail: string }) {
  const { logout } = useAuth()
  return <main className="pending-screen"><div className="pending-panel"><Brand /><span className="pending-icon"><ShieldCheck size={23} /></span><span className="eyebrow">ACCOUNT ACCESS</span><h1>{title}</h1><p>{detail}</p><button className="secondary-button" type="button" onClick={() => void logout()}><LogOut size={15} /> Sign out</button></div></main>
}

function SignalDesk({ profile }: { profile: UserProfile }) {
  const { logout, user, isAdmin } = useAuth()
  const [symbol, setSymbol] = useState('GOLD')
  const [symbolInput, setSymbolInput] = useState('GOLD')
  const [signals, setSignals] = useState<Signal[]>([])
  const [signalFeedError, setSignalFeedError] = useState('')
  const [candles, setCandles] = useState<Candle[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [chartState, setChartState] = useState('Loading market data')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const chartNode = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const renderedCandlesRef = useRef<Candle[]>([])
  const chartInitializedRef = useRef(false)
  const latestSignals = useMemo(() => [...signals].sort((a, b) => b.entry_time - a.entry_time).slice(0, 3), [signals])

  useEffect(() => {
    if (profilesDb) {
      return onValue(ref(profilesDb, `signals/${signalSymbolKey(symbol)}`), (snapshot) => {
        const value = snapshot.val()
        const nextSignals = value && typeof value === 'object' ? Object.values(value) : []
        setSignals(nextSignals.filter(isSignal).sort((a, b) => a.entry_time - b.entry_time).slice(-3))
        setSignalFeedError('')
      }, (reason) => {
        setSignals([])
        setSignalFeedError(`Could not read signals from Firebase: ${reason.message}`)
      })
    }
    const controller = new AbortController()
    let active = true
    let inFlight = false
    const loadSignals = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const token = await user!.getIdToken()
        const response = await fetch(apiUrl(`/api/signals/published?symbol=${encodeURIComponent(symbol)}`), {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Could not load approved signal feed.')
        const data = await response.json() as { signals: Signal[] }
        if (active) setSignals((data.signals ?? []).filter(isSignal).sort((a, b) => a.entry_time - b.entry_time).slice(-3))
      } catch {
        if (active && !controller.signal.aborted) setSignals([])
      } finally {
        inFlight = false
      }
    }
    void loadSignals()
    const interval = window.setInterval(() => void loadSignals(), 5_000)
    return () => { active = false; controller.abort(); window.clearInterval(interval) }
  }, [symbol, user])

  useEffect(() => {
    if (profilesDb) {
      setChartState('Waiting for chart data from the MT5 laptop')
      return onValue(ref(profilesDb, `market/${signalSymbolKey(symbol)}`), (snapshot) => {
        const value = snapshot.val() as { candles?: Record<string, Candle> | Candle[]; updatedAt?: number } | null
        const storedCandles = value?.candles
        const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60
        const nextCandles = (Array.isArray(storedCandles)
          ? storedCandles
          : storedCandles && typeof storedCandles === 'object'
            ? Object.values(storedCandles)
            : [])
          .filter(isCandle)
          .filter((candle) => candle.time >= cutoff)
          .sort((a, b) => a.time - b.time)
        setCandles(nextCandles)
        setChartState(nextCandles.length ? '' : 'Waiting for chart data from the MT5 laptop')
        setUpdatedAt(value?.updatedAt ? new Date(value.updatedAt * 1000) : null)
      }, (reason) => {
        setCandles([])
        setChartState(`Could not read chart data from Firebase: ${reason.message}`)
      })
    }

    const controller = new AbortController()
    let mounted = true
    const loadChart = async () => {
      setChartState('Loading market data')
      try {
        const token = await user!.getIdToken()
        const end = Math.floor(Date.now() / 1000)
        const start = end - 24 * 60 * 60
        const response = await fetch(apiUrl(`/api/history?symbol=${encodeURIComponent(symbol)}&timeframe=5m&start=${start}&end=${end}`), { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok) throw new Error('MT5 history is not available. Check the terminal connection.')
        const result = await response.json() as { bars: Candle[] }
        if (!mounted) return
        setCandles(result.bars ?? [])
        setChartState(result.bars?.length ? '' : 'No market bars returned for this symbol.')
        setUpdatedAt(new Date())
      } catch (reason) {
        if (mounted && !controller.signal.aborted) setChartState(reason instanceof Error ? reason.message : 'Could not load MT5 history.')
      }
    }
    void loadChart()
    const interval = window.setInterval(() => void loadChart(), 30_000)
    return () => { mounted = false; controller.abort(); window.clearInterval(interval) }
  }, [symbol, user])

  useEffect(() => {
    const controller = new AbortController()
    const end = Math.floor(Date.now() / 1000)
    const start = end - 30 * 24 * 60 * 60
    const loadStats = async () => {
      try {
        const token = await user!.getIdToken()
        const response = await fetch(apiUrl(`/api/backtest?symbol=${encodeURIComponent(symbol)}&htf_timeframe=5m&start=${start}&end=${end}`), { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok) throw new Error('Backtest summary unavailable')
        const result = await response.json() as { session_results: SessionSummary[] }
        setSessions(result.session_results ?? [])
      } catch {
        if (!controller.signal.aborted) setSessions([])
      }
    }
    void loadStats()
    return () => controller.abort()
  }, [symbol, user])

  useEffect(() => {
    if (!chartNode.current) return
    const chart = createChart(chartNode.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#080f1e' }, textColor: '#9aacc5', fontFamily: 'DM Mono, monospace', fontSize: 10 },
      localization: { locale: 'en-GB', timeFormatter: formatColomboTime },
      grid: { vertLines: { color: '#1b2b43' }, horzLines: { color: '#1b2b43' } },
      rightPriceScale: { borderColor: '#263b58' },
      timeScale: { borderColor: '#263b58', timeVisible: true, secondsVisible: false, tickMarkFormatter: formatColomboTick },
      crosshair: { vertLine: { color: '#52708f' }, horzLine: { color: '#52708f' } },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#70c8ff', downColor: '#ff6678', borderVisible: false,
      wickUpColor: '#70c8ff', wickDownColor: '#ff6678',
    })
    chartRef.current = chart
    candleSeriesRef.current = series
    return () => {
      markersRef.current?.detach()
      markersRef.current = null
      chartRef.current = null
      candleSeriesRef.current = null
      renderedCandlesRef.current = []
      chartInitializedRef.current = false
      chart.remove()
    }
  }, [])

  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series || !candles.length) return
    const previous = renderedCandlesRef.current
    const previousLast = previous.at(-1)
    const previousLastIndex = previousLast
      ? candles.findIndex((candle) => candle.time === previousLast.time)
      : -1
    if (!previousLast || previousLastIndex < 0 || candles[0].time !== previous[0].time) {
      series.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })))
      if (!chartInitializedRef.current) {
        chartRef.current?.timeScale().fitContent()
        chartInitializedRef.current = true
      }
    } else {
      for (const candle of candles.slice(previousLastIndex)) {
        series.update({ ...candle, time: candle.time as UTCTimestamp })
      }
    }
    renderedCandlesRef.current = candles
  }, [candles])

  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return
    const markers = signals.filter((signal) => candles.some((bar) => bar.time === signal.entry_time)).map((signal) => ({
      time: signal.entry_time as UTCTimestamp,
      position: signal.direction === 'buy' ? 'belowBar' as const : 'aboveBar' as const,
      color: signal.direction === 'buy' ? '#10c9b0' : '#ff6678',
      shape: signal.direction === 'buy' ? 'arrowUp' as const : 'arrowDown' as const,
      text: signal.direction.toUpperCase(),
    }))
    if (markersRef.current) markersRef.current.setMarkers(markers)
    else markersRef.current = createSeriesMarkers(series, markers)
  }, [candles, signals])

  function chooseSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = symbolInput.trim().toUpperCase()
    if (/^[A-Z0-9._-]{2,20}$/.test(next)) setSymbol(next)
  }

  return <div className="desk-shell">
    <header className="desk-topbar"><a className="brand" href={appPath()} aria-label="NextGen Gold Signal Desk"><img className="brand-logo" src={appPath('nextgen-gold-logo.png')} alt="" /><span className="brand-name">NextGen Gold</span><i /> <small>SIGNAL DESK</small></a><div className="topbar-actions"><span className="connection-label"><i /> LIVE ENGINE</span>{isAdmin && <a className="icon-control" href={appPath('admin.html')} aria-label="Admin management" title="Admin management"><ShieldCheck size={16} /></a>}<button className="icon-control" type="button" aria-label="Account settings" title="Account settings" onClick={() => setProfileOpen(true)}><UserRound size={17} /></button><button className="icon-control" type="button" aria-label="Sign out" title="Sign out" onClick={() => void logout()}><LogOut size={17} /></button></div></header>
    <main className="desk-content">
      <div className="desk-title-row"><div><span className="eyebrow">MARKET OVERVIEW <b>/</b> {symbol}</span><h1>Signal desk</h1><p>Read-only market context and confirmed strategy levels.</p></div><form className="symbol-picker" onSubmit={chooseSymbol}><label htmlFor="symbol-input">SYMBOL</label><input id="symbol-input" value={symbolInput} onChange={(event) => setSymbolInput(event.target.value)} aria-label="Market symbol" /><button type="submit" title="Load symbol" aria-label="Load symbol"><RefreshCw size={15} /></button></form></div>
      <section className="market-layout">
        <div className="market-chart-panel"><div className="panel-heading"><div><span className="eyebrow">{symbol} · M5</span><h2>Price action</h2></div><span className="readonly-tag">READ ONLY</span></div><div className="market-chart-wrap"><div className="market-chart" ref={chartNode} />{chartState && <div className="chart-overlay-state"><Activity size={18} /><span>{chartState}</span></div>}</div><div className="chart-note"><span>MT5 market feed <b>·</b> 5-minute candles</span><span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Awaiting feed'}</span></div></div>
        <aside className="signal-rail"><div className="panel-heading"><div><span className="eyebrow">ENGINE FEED</span><h2>Latest signals <b className="count-badge">{latestSignals.length}</b></h2></div><span className="feed-live"><i /> LIVE</span></div>
          {signalFeedError ? <div className="empty-feed" role="alert"><span className="empty-orbit"><CircleAlert size={18} /></span><strong>Signal feed unavailable</strong><span>{signalFeedError}</span></div> : latestSignals.length ? <div className="signal-cards">{latestSignals.map((signal) => <SignalCard key={`${signal.entry_time}-${signal.direction}`} signal={signal} />)}</div> : <div className="empty-feed"><span className="empty-orbit"><Activity size={18} /></span><strong>No confirmed signals</strong><span>New engine signals appear here when the admin relay is running.</span></div>}
        </aside>
      </section>
      <section className="session-section"><div className="section-heading"><div><span className="eyebrow">LAST 30 DAYS · 1R TARGET</span><h2>Session win rates</h2></div><span className="section-caption">Backtest performance · not a forecast</span></div><div className="session-grid">{['Asian', 'London', 'New York', 'IB'].map((session) => <SessionCard key={session} session={session} item={sessions.find((result) => result.target_r === 1 && result.session === session)} />)}</div></section>
      <div className="desk-disclaimer"><CircleAlert size={14} /><span>Signals are informational, not financial advice. NextGen Gold does not place or manage orders. Historical results do not guarantee future outcomes.</span></div>
    </main>
    <footer className="desk-footer"><span>NEXTGEN GOLD SIGNAL DESK</span><span>ASIA/COLOMBO <b>·</b> {profile.fullName}</span></footer>
    {profileOpen && <ProfileDialog profile={profile} onClose={() => setProfileOpen(false)} />}
  </div>
}

function SignalCard({ signal }: { signal: Signal }) {
  const distance = Math.abs(signal.entry - signal.stop)
  const tp1 = signal.direction === 'buy' ? signal.entry + distance : signal.entry - distance
  const tp2 = signal.direction === 'buy' ? signal.entry + distance * 2 : signal.entry - distance * 2
  const finished = signal.outcome !== 'open' && signal.outcome !== undefined
  return <article className={`signal-card ${signal.direction}`}><div className="signal-card-head"><span className={`side-pill ${signal.direction}`}>{signal.direction === 'buy' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{signal.direction.toUpperCase()}</span><span className="signal-time">{new Date(signal.entry_time * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div><strong className="signal-setup">{signal.setup ?? signal.session_name ?? 'Sweep + BOS setup'}</strong><div className="level-grid"><Level label="ENTRY" value={signal.entry} /><Level label="STOP LOSS" value={signal.stop} /></div><div className="target-grid"><div><span>TP 1 <b>1:1</b></span><strong>{tp1.toFixed(2)}</strong></div><div><span>TP 2 <b>1:2</b></span><strong>{tp2.toFixed(2)}</strong></div></div>{finished && <div className={`signal-result ${signal.outcome}`}>{signal.outcome === 'target' ? 'TARGET HIT' : 'STOP HIT'}</div>}</article>
}

function Level({ label, value }: { label: string; value: number }) {
  return <div className="signal-level"><span>{label}</span><strong>{value.toFixed(2)}</strong></div>
}

function SessionCard({ session, item }: { session: string; item?: SessionSummary }) {
  const trades = item?.summary.trades ?? 0
  const winRate = trades ? Math.max(0, Math.min(100, item?.summary.win_rate ?? 0)) : 0
  return <article className="session-card"><div className="session-card-top"><strong>{session}</strong><span>{trades} trades</span></div><div className="session-stat-row"><div className="win-donut" style={{ background: trades ? `conic-gradient(#10c9b0 ${winRate}%, #ff6678 0)` : 'conic-gradient(#263b58 100%, #263b58 0)' }}><div>{trades ? `${winRate.toFixed(0)}%` : '—'}</div></div><div className="session-counts"><span><i className="win-dot" />Wins <b>{item?.summary.wins ?? 0}</b></span><span><i className="loss-dot" />Losses <b>{item?.summary.losses ?? 0}</b></span></div></div><div className="session-card-foot"><span>WIN RATE</span><span>{trades ? `${winRate.toFixed(1)}%` : 'NO DATA'}</span></div></article>
}

function ProfileDialog({ profile, onClose }: { profile: UserProfile; onClose: () => void }) {
  const { changePassword } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await changePassword(currentPassword, password)
      setCurrentPassword('')
      setPassword('')
      setMessage('Password updated.')
    } catch (reason) {
      setMessage(firebaseMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title"><div className="modal-heading"><div><span className="eyebrow">ACCOUNT</span><h2 id="profile-title">Profile & security</h2></div><button className="icon-control" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button></div><div className="profile-details"><span><small>FULL NAME</small><b>{profile.fullName}</b></span><span><small>EMAIL</small><b>{profile.email}</b></span><span><small>PHONE</small><b>{profile.phone}</b></span><span><small>NIC</small><b>{maskNic(profile.nic)}</b></span></div><form className="password-form" onSubmit={(event) => void submit(event)}><label htmlFor="current-password">Change password</label><div className="password-fields"><input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" /><input aria-label="New password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password, at least 8 characters" /><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></div>{message && <small className="password-message">{message}</small>}</form></section></div>
}

function Brand() {
  return <a className="brand" href={appPath()} aria-label="NextGen Gold"><img className="brand-logo" src={appPath('nextgen-gold-logo.png')} alt="" /><span className="brand-name">NextGen Gold</span></a>
}

function maskNic(nic: string) {
  return nic.length > 4 ? `${'•'.repeat(nic.length - 4)}${nic.slice(-4)}` : nic
}

function isSignal(value: unknown): value is Signal {
  if (!value || typeof value !== 'object') return false
  const signal = value as Partial<Signal>
  return (signal.direction === 'buy' || signal.direction === 'sell') && typeof signal.entry_time === 'number' && typeof signal.entry === 'number' && typeof signal.stop === 'number'
}

function isCandle(value: unknown): value is Candle {
  if (!value || typeof value !== 'object') return false
  const candle = value as Partial<Candle>
  return typeof candle.time === 'number'
    && typeof candle.open === 'number'
    && typeof candle.high === 'number'
    && typeof candle.low === 'number'
    && typeof candle.close === 'number'
    && typeof candle.volume === 'number'
}

function firebaseMessage(reason: unknown) {
  if (!(reason instanceof Error)) return 'Something went wrong. Please try again.'
  const code = 'code' in reason ? String(reason.code) : ''
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password') || code.includes('auth/user-not-found')) return 'Email or password is incorrect.'
  if (code.includes('auth/email-already-in-use')) return 'This email is already registered. Sign in instead.'
  if (code.includes('auth/weak-password')) return 'Use a stronger password with at least 8 characters.'
  if (code.includes('auth/requires-recent-login')) return 'Sign out and sign back in before changing your password.'
  if (code.includes('permission-denied')) return 'Firebase denied access. Check the Realtime Database rules.'
  return reason.message
}