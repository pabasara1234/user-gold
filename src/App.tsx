import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  Activity,
  CalendarDays,
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  FastForward,
  Grip,
  Hand,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  MoveVertical,
  Pause,
  Play,
  RefreshCw,
  Rewind,
  Radio,
  Ruler,
  ScanLine,
  Settings2,
  Trash2,
  TrendingUp,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import './App.css'

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }
type StrategyTimeframe = '5m'
type Trade = {
  direction: 'buy' | 'sell'
  signal_status?: 'watch' | 'confirmed'
  entry_time: number
  watch_time?: number
  exit_time: number
  entry: number
  stop: number
  target: number
  exit_price: number
  result_r: number
  outcome: 'stop' | 'target' | 'open'
  setup?: string
  key_level?: number
  key_source?: string
  h4_key_level?: number
  htf_key_level?: number
  h1_key_level?: number
  m15_key_level?: number
  confluence_timeframes?: string[]
  confluence_count?: number
  htf_timeframe?: StrategyTimeframe
  retest_confirmed?: boolean
  retest_time?: number
  signal_strength?: string
  order_block_low?: number
  order_block_high?: number
  structure_break?: number
  key_zone_low?: number
  key_zone_high?: number
  trendline_level?: number
  trendline_pivots?: number[]
  signal_type?: 'breakout' | 'failed_break_reversal' | 'liquidity_sweep' | 'breaker_block' | 'market_structure_reversal'
  msnr_confirmed?: boolean
  session_name?: string | null
  session_liquidity_swept?: boolean
  session_sweep_name?: string | null
  session_sweep_level_type?: 'high' | 'low' | null
  session_sweep_level?: number | null
  session_sweep_reference?: 'developing' | 'previous' | null
  session_profile_poc?: number | null
  session_profile_vah?: number | null
  session_profile_val?: number | null
  session_profile_level?: 'POC' | 'VAH' | 'VAL' | null
  session_profile_confirmed?: boolean
  session_profile_volume_ratio?: number | null
  strength_score?: number
  strength_score_max?: number
  strength_label?: string
  strength_emoji?: string
}
type BacktestSummary = {
  bars: number
  trades: number
  wins: number
  losses: number
  win_rate: number
  net_r: number
  max_drawdown_r: number
  profit_factor: number | null
}
type StrategyResult = { target_r: number; trades: Trade[]; summary: BacktestSummary }
type SessionResult = { target_r: number; session: string; summary: BacktestSummary }
type KeyLevel = { price: number; direction: 'support' | 'resistance'; source: string; time: number }
type SignalHistoryItem = Pick<Trade, 'direction' | 'entry_time' | 'entry' | 'stop' | 'setup' | 'key_level' | 'key_zone_low' | 'key_zone_high' | 'key_source' | 'h4_key_level' | 'htf_key_level' | 'h1_key_level' | 'm15_key_level' | 'confluence_timeframes' | 'confluence_count' | 'htf_timeframe' | 'retest_confirmed' | 'retest_time' | 'signal_strength' | 'order_block_low' | 'order_block_high' | 'structure_break' | 'trendline_level' | 'trendline_pivots' | 'signal_type' | 'msnr_confirmed' | 'session_name' | 'session_liquidity_swept' | 'session_sweep_name' | 'session_sweep_level_type' | 'session_sweep_level' | 'session_sweep_reference' | 'session_profile_poc' | 'session_profile_vah' | 'session_profile_val' | 'session_profile_level' | 'session_profile_confirmed' | 'session_profile_volume_ratio' | 'strength_score' | 'strength_score_max' | 'strength_label' | 'strength_emoji'> & {
  symbol: string
  htf_timeframe: StrategyTimeframe
}
type BacktestSignal = Omit<SignalHistoryItem, 'symbol' | 'htf_timeframe'>
type BacktestResult = { results: StrategyResult[]; session_results: SessionResult[]; signals: BacktestSignal[]; key_levels: KeyLevel[] }
type Timeframe = '1m' | '5m' | '15m' | '30m' | '39m' | '1h' | '4h' | '7h'
type ChartType = 'candles' | 'line'
type ChartLayout = 1 | 2 | 4
type ChartTileSize = { width: number | null; height: number }
type SuperTrendPoint = { time: number; middle: number; bullish: number | null; bearish: number | null; direction: -1 | 1 | null }
type SuperTrendSeries = { bullish: ISeriesApi<'Line'>; bearish: ISeriesApi<'Line'> }
type VWAPSeries = { middle: ISeriesApi<'Line'>; upper: ISeriesApi<'Line'>; lower: ISeriesApi<'Line'> }
type LinkedChart = {
  chart: ReturnType<typeof createChart>
  series: ISeriesApi<'Candlestick'>
  bars: Candle[]
}
type LinkedChartsRef = { current: Map<string, LinkedChart> }
type CrosshairSyncRef = { current: (sourceId: string, time: number | null, price: number | null) => void }
type ApiStatus = 'checking' | 'online' | 'offline'
type EmaPeriod = 8 | 13 | 20 | 50 | 100 | 200
type RsiPoint = { time: number; value: number | null }
type RsiDivergence = {
  direction: 'bullish' | 'bearish'
  fromTime: number
  toTime: number
  fromPrice: number
  toPrice: number
  fromRsi: number
  toRsi: number
}
type SessionOverlayGroup = {
  id: string
  label: string
  startMinute: number
  endMinute: number
  color: string
}
type SessionRange = {
  session: SessionOverlayGroup
  day: number
  start: number
  end: number
  high: number
  low: number
  firstTime: number
  lastTime: number
}
type ChartPanGesture = {
  pointerId: number
  startX: number
  startY: number
  logicalRange: { from: number; to: number }
  priceRange: { from: number; to: number }
  plotWidth: number
  plotHeight: number
}
type ProfileRange = { from: number; to: number }
type ProfileDuration = '3h' | '4h' | '5h' | '6h' | '7h' | '8h' | 'day'
type ProfileLayout = 'rail' | 'split'
type ProfileSelectionGesture = { pointerId: number; startIndex: number }
type DrawingTool = 'horizontal' | 'vertical' | 'trend' | 'measure' | 'fibonacci' | null
type DrawingPoint = { time: number; price: number }
type ChartDrawing =
  | { id: number; kind: 'horizontal'; price: number; color: string; note: string }
  | { id: number; kind: 'vertical'; time: number; color: string; note: string }
  | { id: number; kind: 'trend' | 'measure' | 'fibonacci'; from: DrawingPoint; to: DrawingPoint; color: string; note: string }
type DrawingGesture = { pointerId: number; id: number; kind: 'trend' | 'measure' | 'fibonacci'; from: DrawingPoint; color: string; note: string }
type DrawingEditPart = 'from' | 'to' | 'move'
type DrawingHit = { drawing: ChartDrawing; part: DrawingEditPart }
type DrawingEditGesture = { pointerId: number; drawing: ChartDrawing; part: DrawingEditPart; start: DrawingPoint }
type ToolkitDragGesture = { pointerId: number; startX: number; startY: number; originX: number; originY: number }

const timeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '7h']
const emaPeriods: EmaPeriod[] = [8, 13, 20, 50, 100, 200]
const LANKA_TIME_ZONE = 'Asia/Colombo'
const signalHistoryStorageKey = 'myview.signal-history.v3'
const drawingColors: Record<Exclude<DrawingTool, null>, string> = {
  horizontal: '#23755f',
  vertical: '#4285a5',
  trend: '#8b6bb3',
  measure: '#bd8a2e',
  fibonacci: '#23755f',
}
const fibonacciLevels = [
  { ratio: 0, label: '0%', color: '#fb7185' },
  { ratio: 0.236, label: '23.6%', color: '#fb923c' },
  { ratio: 0.382, label: '38.2%', color: '#facc15' },
  { ratio: 0.5, label: '50%', color: '#4ade80' },
  { ratio: 0.618, label: '61.8%', color: '#22d3ee' },
  { ratio: 0.786, label: '78.6%', color: '#60a5fa' },
  { ratio: 1, label: '100%', color: '#c084fc' },
]
const emaColors: Record<EmaPeriod, string> = {
  8: '#c18c2e',
  13: '#d6634c',
  20: '#8b6bb3',
  50: '#28775f',
  100: '#4285a5',
  200: '#65717a',
}
const colomboUtcOffsetSeconds = 5.5 * 60 * 60
const openingMarkers = [
  { minute: 4 * 60 + 30, label: 'OPEN 18', color: '#fb923c' },
  { minute: 10 * 60 + 30, label: '10:30 OPEN', color: '#f8fafc' },
]
const sessionOverlayGroups: SessionOverlayGroup[] = [
  { id: 'asia', label: 'ASIA', startMinute: 6 * 60 + 30, endMinute: 8 * 60 + 30, color: '#38bdf8' },
  { id: 'london', label: 'LONDON', startMinute: 13 * 60 + 30, endMinute: 16 * 60 + 30, color: '#818cf8' },
  { id: 'new-york', label: 'NEW YORK', startMinute: 19 * 60 + 30, endMinute: 21 * 60 + 30, color: '#fb7185' },
  { id: 'ib', label: 'IB', startMinute: 18 * 60 + 50, endMinute: 19 * 60 + 50, color: '#fbbf24' },
]

function dateInputValue(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LANKA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function daysAgoInput(days: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LANKA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]))
  return new Date(Date.UTC(values.year, values.month - 1, values.day - days)).toISOString().slice(0, 10)
}

function monthsAgoInput(months: number) {
  const [year, month, day] = dateInputValue(new Date()).split('-').map(Number)
  const targetMonth = new Date(Date.UTC(year, month - 1 - months, 1))
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate()
  targetMonth.setUTCDate(Math.min(day, lastDay))
  return targetMonth.toISOString().slice(0, 10)
}

function rangeEpoch(value: string, endOfDay = false) {
  const start = Date.parse(`${value}T00:00:00+05:30`)
  return Math.floor((start + (endOfDay ? 86_400_000 : 0)) / 1000)
}

function timeToDate(time: Time) {
  if (typeof time === 'number') return new Date(time * 1000)
  if (typeof time === 'string') return new Date(`${time}T00:00:00Z`)
  return new Date(Date.UTC(time.year, time.month - 1, time.day))
}

function formatLankaTime(value: Date | number) {
  const date = typeof value === 'number' ? new Date(value * 1000) : value
  return new Intl.DateTimeFormat('en-LK', {
    timeZone: LANKA_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(date)
}

function formatLankaDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LANKA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp * 1000))
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared))
  return Math.hypot(px - (x1 + projection * dx), py - (y1 + projection * dy))
}

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.detail ?? `Request failed (${response.status})`)
  return data as T
}

function isSignalHistoryItem(value: unknown): value is SignalHistoryItem {
  if (!value || typeof value !== 'object') return false
  const signal = value as Partial<SignalHistoryItem>
  return (signal.direction === 'buy' || signal.direction === 'sell')
    && typeof signal.symbol === 'string'
    && signal.htf_timeframe === '5m'
    && typeof signal.entry_time === 'number'
    && Number.isFinite(signal.entry_time)
    && typeof signal.entry === 'number'
    && Number.isFinite(signal.entry)
    && typeof signal.stop === 'number'
    && Number.isFinite(signal.stop)
}

function mergeSignalHistory(
  current: SignalHistoryItem[],
  incoming: SignalHistoryItem[],
) {
  const unique = new Map<string, SignalHistoryItem>()
  for (const signal of [...current, ...incoming]) {
    const id = `${signal.symbol}:${signal.htf_timeframe}:${signal.direction}:${signal.entry_time}:${signal.setup ?? ''}`
    unique.set(id, signal)
  }
  return [...unique.values()].sort((left, right) => left.entry_time - right.entry_time)
}

function formatSignalLevels(
  signal: Pick<Trade, 'confluence_timeframes' | 'htf_timeframe' | 'htf_key_level' | 'h4_key_level' | 'h1_key_level' | 'm15_key_level' | 'key_level' | 'key_source'>,
  fallbackTimeframe: string,
) {
  if (signal.confluence_timeframes?.length) {
    return `${signal.confluence_timeframes.join(' + ')} · ${signal.key_level?.toFixed(2) ?? 'KEY LEVEL'}`
  }
  if (signal.htf_key_level === undefined && signal.h4_key_level === undefined) {
    return signal.key_source ?? '—'
  }
  return `${signal.htf_timeframe?.toUpperCase() ?? fallbackTimeframe.toUpperCase()} ${signal.htf_key_level ?? signal.h4_key_level} · H1 ${signal.h1_key_level ?? '—'}${signal.m15_key_level === undefined ? '' : ` · M15 ${signal.m15_key_level}`}`
}

function adaptiveSuperTrend(bars: Candle[], atrLength: number, factor: number): SuperTrendPoint[] {
  const trainingLength = 100
  const trueRanges = bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low
    const previousClose = bars[index - 1].close
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose))
  })
  const atr = Array<number>(bars.length).fill(Number.NaN)
  if (bars.length < atrLength) return bars.map((bar) => ({
    time: bar.time,
    middle: (bar.open + bar.close) / 2,
    bullish: null,
    bearish: null,
    direction: null,
  }))
  atr[atrLength - 1] = trueRanges.slice(0, atrLength).reduce((sum, range) => sum + range, 0) / atrLength
  for (let index = atrLength; index < bars.length; index += 1) {
    atr[index] = (atr[index - 1] * (atrLength - 1) + trueRanges[index]) / atrLength
  }

  const output = bars.map((bar) => ({
    time: bar.time,
    middle: (bar.open + bar.close) / 2,
    bullish: null as number | null,
    bearish: null as number | null,
    direction: null as -1 | 1 | null,
  }))
  let priorUpper = 0
  let priorLower = 0
  let priorTrend: number | null = null
  let priorSuperTrend: number | null = null

  for (let index = atrLength - 1; index < bars.length; index += 1) {
    const windowStart = index - trainingLength + 1
    if (windowStart < atrLength - 1) continue
    const sample = atr.slice(windowStart, index + 1)
    if (sample.some((value) => !Number.isFinite(value))) continue
    const minimum = Math.min(...sample)
    const maximum = Math.max(...sample)
    const range = maximum - minimum
    let centroids = [minimum + range * 0.75, minimum + range * 0.5, minimum + range * 0.25]

    for (let iteration = 0; iteration < 10; iteration += 1) {
      const groups: number[][] = [[], [], []]
      for (const value of sample) {
        let closest = 0
        for (let cluster = 1; cluster < centroids.length; cluster += 1) {
          if (Math.abs(value - centroids[cluster]) < Math.abs(value - centroids[closest])) closest = cluster
        }
        groups[closest].push(value)
      }
      const updated = centroids.map((centroid, cluster) => (
        groups[cluster].length ? groups[cluster].reduce((sum, value) => sum + value, 0) / groups[cluster].length : centroid
      ))
      if (updated.every((centroid, cluster) => Math.abs(centroid - centroids[cluster]) < 1e-10)) {
        centroids = updated
        break
      }
      centroids = updated
    }

    const currentAtr = atr[index]
    const assignedAtr = centroids.reduce((closest, centroid) => (
      Math.abs(currentAtr - centroid) < Math.abs(currentAtr - closest) ? centroid : closest
    ), centroids[0])
    const bar = bars[index]
    const source = (bar.high + bar.low) / 2
    const rawUpper = source + factor * assignedAtr
    const rawLower = source - factor * assignedAtr
    const upper = index === atrLength - 1 || rawUpper < priorUpper || bars[index - 1].close > priorUpper
      ? rawUpper
      : priorUpper
    const lower = index === atrLength - 1 || rawLower > priorLower || bars[index - 1].close < priorLower
      ? rawLower
      : priorLower

    let direction = priorTrend ?? 1
    if (priorTrend === null) direction = 1
    else if (priorSuperTrend === priorUpper) direction = bar.close > upper ? -1 : 1
    else direction = bar.close < lower ? 1 : -1

    const superTrend = direction === -1 ? lower : upper
    if (bar.close > superTrend) output[index].bullish = superTrend
    else if (bar.close < superTrend) output[index].bearish = superTrend
    output[index].direction = direction as -1 | 1
    priorUpper = upper
    priorLower = lower
    priorTrend = direction
    priorSuperTrend = superTrend
  }
  return output
}

function relativeStrengthIndex(bars: Candle[], period: number): RsiPoint[] {
  const points = bars.map((bar) => ({ time: bar.time, value: null as number | null }))
  if (bars.length <= period) return points

  let averageGain = 0
  let averageLoss = 0
  for (let index = 1; index <= period; index += 1) {
    const change = bars[index].close - bars[index - 1].close
    averageGain += Math.max(change, 0)
    averageLoss += Math.max(-change, 0)
  }
  averageGain /= period
  averageLoss /= period

  const valueAt = (gain: number, loss: number) => (
    loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss)
  )
  points[period].value = valueAt(averageGain, averageLoss)
  for (let index = period + 1; index < bars.length; index += 1) {
    const change = bars[index].close - bars[index - 1].close
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period
    points[index].value = valueAt(averageGain, averageLoss)
  }
  return points
}

function calculateVwap(bars: Candle[]) {
  let currentDay = Number.NaN
  let cumulativeVolume = 0
  let cumulativePriceVolume = 0
  let cumulativePriceSquaredVolume = 0
  return bars.map((bar) => {
    const day = Math.floor((bar.time + 19_800) / 86_400)
    if (day !== currentDay) {
      currentDay = day
      cumulativeVolume = 0
      cumulativePriceVolume = 0
      cumulativePriceSquaredVolume = 0
    }
    const volume = Math.max(0, bar.volume)
    const typicalPrice = (bar.high + bar.low + bar.close) / 3
    cumulativeVolume += volume
    cumulativePriceVolume += typicalPrice * volume
    cumulativePriceSquaredVolume += typicalPrice * typicalPrice * volume
    if (cumulativeVolume === 0) return { time: bar.time as UTCTimestamp }
    const vwap = cumulativePriceVolume / cumulativeVolume
    const variance = Math.max(0, cumulativePriceSquaredVolume / cumulativeVolume - vwap * vwap)
    const deviation = Math.sqrt(variance) * 2
    return {
      time: bar.time as UTCTimestamp,
      vwap,
      upper: vwap + deviation,
      lower: vwap - deviation,
    }
  })
}

function buildSessionRanges(bars: Candle[]): SessionRange[] {
  const ranges = new Map<string, SessionRange>()
  for (const bar of bars) {
    const localSeconds = bar.time + colomboUtcOffsetSeconds
    const day = Math.floor(localSeconds / 86_400)
    const minute = Math.floor((localSeconds % 86_400) / 60)
    for (const session of sessionOverlayGroups) {
      if (minute < session.startMinute || minute >= session.endMinute) continue
      const key = `${session.id}:${day}`
      const start = day * 86_400 - colomboUtcOffsetSeconds + session.startMinute * 60
      const end = day * 86_400 - colomboUtcOffsetSeconds + session.endMinute * 60
      const existing = ranges.get(key)
      if (existing) {
        existing.high = Math.max(existing.high, bar.high)
        existing.low = Math.min(existing.low, bar.low)
        existing.lastTime = bar.time
      } else {
        ranges.set(key, {
          session,
          day,
          start,
          end,
          high: bar.high,
          low: bar.low,
          firstTime: bar.time,
          lastTime: bar.time,
        })
      }
    }
  }
  return [...ranges.values()]
}

function findRsiDivergences(bars: Candle[], values: RsiPoint[], pivotWidth = 5): RsiDivergence[] {
  const highs: number[] = []
  const lows: number[] = []
  for (let index = pivotWidth; index < bars.length - pivotWidth; index += 1) {
    const rsi = values[index]?.value
    if (rsi === null || rsi === undefined) continue
    const window = bars.slice(index - pivotWidth, index + pivotWidth + 1)
    if (window.every((bar, offset) => offset === pivotWidth || bars[index].high > bar.high)) highs.push(index)
    if (window.every((bar, offset) => offset === pivotWidth || bars[index].low < bar.low)) lows.push(index)
  }

  const divergences: RsiDivergence[] = []
  const addPairs = (indices: number[], direction: RsiDivergence['direction']) => {
    for (let position = 1; position < indices.length; position += 1) {
      const fromIndex = indices[position - 1]
      const toIndex = indices[position]
      const fromRsi = values[fromIndex].value
      const toRsi = values[toIndex].value
      if (fromRsi === null || toRsi === null) continue
      const fromPrice = direction === 'bearish' ? bars[fromIndex].high : bars[fromIndex].low
      const toPrice = direction === 'bearish' ? bars[toIndex].high : bars[toIndex].low
      const isDivergent = direction === 'bearish'
        ? toPrice > fromPrice && toRsi < fromRsi
        : toPrice < fromPrice && toRsi > fromRsi
      if (isDivergent) {
        divergences.push({
          direction,
          fromTime: bars[fromIndex].time,
          toTime: bars[toIndex].time,
          fromPrice,
          toPrice,
          fromRsi,
          toRsi,
        })
      }
    }
  }

  addPairs(highs, 'bearish')
  addPairs(lows, 'bullish')
  return divergences
}

function drawSuperTrendCloud(
  canvas: HTMLCanvasElement,
  chart: ReturnType<typeof createChart>,
  series: ISeriesApi<'Candlestick'>,
  points: SuperTrendPoint[],
) {
  const bounds = canvas.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.round(bounds.width * ratio)
  canvas.height = Math.round(bounds.height * ratio)
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, bounds.width, bounds.height)
  const timeScale = chart.timeScale()
  const plotWidth = timeScale.width()
  const logicalRange = timeScale.getVisibleLogicalRange()
  const barWidth = logicalRange
    ? Math.max(1, Math.min(30, plotWidth / Math.max(1, logicalRange.to - logicalRange.from)))
    : 6
  const segments: { direction: -1 | 1; points: { x: number; middleY: number; trendY: number; time: number }[] }[] = []
  const transitions: { x: number; y: number; direction: -1 | 1 }[] = []
  let priorDirection: -1 | 1 | null = null
  let currentSegment: typeof segments[number] | null = null

  points.forEach((point) => {
    const trend = point.bullish ?? point.bearish
    if (trend === null || point.direction === null) {
      priorDirection = null
      currentSegment = null
      return
    }
    const x = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp)
    const middleY = series.priceToCoordinate(point.middle)
    const trendY = series.priceToCoordinate(trend)
    if (x === null || middleY === null || trendY === null || x < -5 || x > plotWidth + 5) return
    if (!currentSegment || currentSegment.direction !== point.direction) {
      currentSegment = { direction: point.direction, points: [] }
      segments.push(currentSegment)
    }
    currentSegment.points.push({ x, middleY, trendY, time: point.time })
    if (priorDirection !== null && priorDirection !== point.direction) {
      transitions.push({ x, y: trendY, direction: point.direction })
    }
    priorDirection = point.direction
  })

  segments.forEach(({ direction, points: segmentPoints }) => {
    const bullish = direction === -1
    const cloudPoints = segmentPoints.length === 1
      ? [
          { ...segmentPoints[0], x: segmentPoints[0].x - barWidth * 0.6 },
          { ...segmentPoints[0], x: segmentPoints[0].x + barWidth * 0.6 },
        ]
      : segmentPoints
    context.beginPath()
    context.moveTo(cloudPoints[0].x, cloudPoints[0].middleY)
    cloudPoints.slice(1).forEach((point) => context.lineTo(point.x, point.middleY))
    for (let index = cloudPoints.length - 1; index >= 0; index -= 1) {
      context.lineTo(cloudPoints[index].x, cloudPoints[index].trendY)
    }
    context.closePath()
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    cloudPoints.forEach((point) => {
      minY = Math.min(minY, point.middleY, point.trendY)
      maxY = Math.max(maxY, point.middleY, point.trendY)
    })
    const gradient = context.createLinearGradient(0, minY, 0, Math.max(minY + 1, maxY))
    if (bullish) {
      gradient.addColorStop(0, 'rgba(0, 105, 72, 0.78)')
      gradient.addColorStop(1, 'rgba(0, 57, 39, 0.88)')
    } else {
      gradient.addColorStop(0, 'rgba(123, 17, 15, 0.78)')
      gradient.addColorStop(1, 'rgba(67, 7, 8, 0.88)')
    }
    context.fillStyle = gradient
    context.fill()

    context.beginPath()
    context.moveTo(cloudPoints[0].x, cloudPoints[0].trendY)
    cloudPoints.slice(1).forEach((point) => context.lineTo(point.x, point.trendY))
    context.strokeStyle = bullish ? '#00c98b' : '#ff302f'
    context.lineWidth = 2
    context.stroke()
  })

  transitions.forEach(({ x, y, direction }) => {
    context.beginPath()
    context.arc(x, y, 4, 0, Math.PI * 2)
    context.fillStyle = direction === -1 ? '#00c98b' : '#ff302f'
    context.fill()
    context.strokeStyle = '#0b1425'
    context.lineWidth = 1.5
    context.stroke()
  })
}

function formatChartLevelLabel(source: string) {
  const knownLabels: Record<string, string> = {
    'Previous day high': 'PDH',
    'Previous day low': 'PDL',
    'Previous week high': 'PWH',
    'Previous week low': 'PWL',
  }
  if (knownLabels[source]) return knownLabels[source]
  return source
    .replace(/\bHTF swing high\b/g, 'H')
    .replace(/\bHTF swing low\b/g, 'L')
    .replace(/\s*\+\s*/g, ' · ')
}

function nearestChartBar(bars: Candle[], timestamp: number) {
  let low = 0
  let high = bars.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (bars[middle].time < timestamp) low = middle + 1
    else high = middle
  }
  if (low === 0) return bars[0]
  if (low === bars.length) return bars[bars.length - 1]
  return timestamp - bars[low - 1].time <= bars[low].time - timestamp ? bars[low - 1] : bars[low]
}

function ChartTile({
  id,
  width,
  height,
  onResize,
  children,
}: {
  id: string
  width: number | string
  height: number
  onResize: (id: string, width: number, height: number) => void
  children: ReactNode
}) {
  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const tile = event.currentTarget.parentElement
    if (!tile) return
    const bounds = tile.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const move = (moveEvent: PointerEvent) => onResize(
      id,
      Math.max(260, Math.min(2200, bounds.width + moveEvent.clientX - startX)),
      Math.max(220, Math.min(1400, bounds.height + moveEvent.clientY - startY)),
    )
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return <section className="chart-tile" style={{ width: typeof width === 'number' ? `${width}px` : width, height: `${height}px` }}>
    {children}
    <button className="chart-tile-resize" type="button" aria-label="Resize chart" title="Drag to resize this chart" onPointerDown={beginResize} />
  </section>
}

function AuxiliaryChart({
  id,
  symbol,
  timeframe,
  onTimeframeChange,
  startDate,
  endDate,
  reloadKey,
  autoUpdate,
  linkedChartsRef,
  crosshairSyncRef,
  superTrendEnabled,
  superTrendAtrLength,
  superTrendFactor,
  width,
  height,
  onResize,
}: {
  id: string
  symbol: string
  timeframe: Timeframe
  onTimeframeChange: (timeframe: Timeframe) => void
  startDate: string
  endDate: string
  reloadKey: number
  autoUpdate: boolean
  linkedChartsRef: LinkedChartsRef
  crosshairSyncRef: CrosshairSyncRef
  superTrendEnabled: boolean
  superTrendAtrLength: number
  superTrendFactor: number
  width: number | string
  height: number
  onResize: (id: string, width: number, height: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const superTrendCanvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<Candle[]>([])
  const appliedBarsRef = useRef<Candle[]>([])
  const superTrendSeriesRef = useRef<SuperTrendSeries | null>(null)
  const [bars, setBars] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0b1425' },
        textColor: '#8fa3bf',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 9,
      },
      localization: {
        locale: 'en-LK',
        timeFormatter: (time) => new Intl.DateTimeFormat('en-LK', {
          timeZone: LANKA_TIME_ZONE,
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(timeToDate(time)),
      },
      grid: { vertLines: { color: '#17243a' }, horzLines: { color: '#17243a' } },
      crosshair: { vertLine: { color: '#5283be', labelBackgroundColor: '#176ed1' }, horzLine: { color: '#5283be', labelBackgroundColor: '#176ed1' } },
      rightPriceScale: { borderColor: '#1e2d44' },
      timeScale: { borderColor: '#1e2d44', timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { price: true, time: true } },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#62bdff', downColor: '#f2f7ff', borderUpColor: '#62bdff',
      borderDownColor: '#f2f7ff', wickUpColor: '#62bdff', wickDownColor: '#f2f7ff',
    })
    const superTrendSeries = {
      bullish: chart.addSeries(LineSeries, {
        color: '#86d8ff', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      }),
      bearish: chart.addSeries(LineSeries, {
        color: '#d7e3f5', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      }),
    }
    superTrendSeriesRef.current = superTrendSeries
    linkedChartsRef.current.set(id, { chart, series, bars: barsRef.current })
    const onCrosshairMove = (param: Parameters<Parameters<typeof chart.subscribeCrosshairMove>[0]>[0]) => {
      if (typeof param.time !== 'number') {
        crosshairSyncRef.current(id, null, null)
        return
      }
      const point = param.seriesData.get(series)
      const price = point && 'close' in point ? point.close : null
      crosshairSyncRef.current(id, param.time, typeof price === 'number' ? price : null)
    }
    chart.subscribeCrosshairMove(onCrosshairMove)
    const observer = new ResizeObserver((entries) => {
      const { width: nextWidth, height: nextHeight } = entries[0]?.contentRect ?? {}
      if (nextWidth > 0 && nextHeight > 0) chart.applyOptions({ width: nextWidth, height: nextHeight })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(onCrosshairMove)
      linkedChartsRef.current.delete(id)
      chart.remove()
      superTrendSeriesRef.current = null
    }
  }, [id, linkedChartsRef, crosshairSyncRef])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setBars([])
    const query = new URLSearchParams({
      symbol,
      timeframe,
      start: String(rangeEpoch(startDate)),
      end: String(rangeEpoch(endDate, true)),
    })
    fetch(`/api/history?${query}`, { signal: controller.signal })
      .then((response) => responseJson<{ bars: Candle[] }>(response))
      .then((data) => {
        setBars(data.bars)
        if (!data.bars.length) setError('No market history for this chart.')
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message || 'Could not load chart history.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [symbol, timeframe, startDate, endDate, reloadKey])

  useEffect(() => {
    const entry = linkedChartsRef.current.get(id)
    if (!entry) return
    const previous = appliedBarsRef.current
    barsRef.current = bars
    entry.bars = bars
    const incremental = previous.length > 0
      && bars.length >= previous.length
      && bars[0]?.time === previous[0].time
    if (incremental) {
      for (let index = Math.max(0, previous.length - 1); index < bars.length; index += 1) {
        const bar = bars[index]
        entry.series.update({
          time: bar.time as UTCTimestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })
      }
    } else {
      entry.series.setData(bars.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })))
      if (bars.length) entry.chart.timeScale().fitContent()
    }
    appliedBarsRef.current = bars
  }, [bars, id, linkedChartsRef])

  useEffect(() => {
    const series = superTrendSeriesRef.current
    if (!series) return
    if (!superTrendEnabled) {
      series.bullish.setData([])
      series.bearish.setData([])
      return
    }
    const values = adaptiveSuperTrend(bars, superTrendAtrLength, superTrendFactor)
    series.bullish.setData(values.map((point) => point.bullish === null
      ? { time: point.time as UTCTimestamp }
      : { time: point.time as UTCTimestamp, value: point.bullish }))
    series.bearish.setData(values.map((point) => point.bearish === null
      ? { time: point.time as UTCTimestamp }
      : { time: point.time as UTCTimestamp, value: point.bearish }))
    series.bullish.applyOptions({ visible: superTrendEnabled })
    series.bearish.applyOptions({ visible: superTrendEnabled })
  }, [bars, superTrendAtrLength, superTrendEnabled, superTrendFactor])

  useEffect(() => {
    const chartState = linkedChartsRef.current.get(id)
    const chart = chartState?.chart
    const series = chartState?.series
    const canvas = superTrendCanvasRef.current
    if (!canvas || !chart || !series || !superTrendEnabled) {
      const context = canvas?.getContext('2d')
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    const points = adaptiveSuperTrend(bars, superTrendAtrLength, superTrendFactor)
    const draw = () => drawSuperTrendCloud(canvas, chart, series, points)
    const frame = window.requestAnimationFrame(draw)
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    chart.timeScale().subscribeVisibleLogicalRangeChange(draw)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(draw)
    }
  }, [bars, id, linkedChartsRef, superTrendAtrLength, superTrendEnabled, superTrendFactor])

  useEffect(() => {
    if (!autoUpdate || rangeEpoch(endDate, true) <= Math.floor(Date.now() / 1000)) return
    const controller = new AbortController()
    let active = true
    let inFlight = false
    const poll = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const query = new URLSearchParams({ symbol, timeframe })
        const response = await fetch(`/api/latest?${query}`, { signal: controller.signal })
        const data = await responseJson<{ bars: Candle[] }>(response)
        if (!active) return
        setBars((current) => {
          const merged = new Map(current.map((bar) => [bar.time, bar]))
          let changed = false
          data.bars.forEach((bar) => {
            const previous = merged.get(bar.time)
            if (!previous || previous.open !== bar.open || previous.high !== bar.high || previous.low !== bar.low || previous.close !== bar.close || previous.volume !== bar.volume) changed = true
            merged.set(bar.time, bar)
          })
          return changed ? [...merged.values()].sort((left, right) => left.time - right.time) : current
        })
        setError('')
      } catch (reason) {
        if (active && reason instanceof Error && reason.name !== 'AbortError') {
          setError(reason.message || 'Automatic chart update failed.')
        }
      } finally {
        inFlight = false
      }
    }
    const interval = window.setInterval(poll, 5000)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(interval)
    }
  }, [autoUpdate, endDate, symbol, timeframe])

  return <ChartTile id={id} width={width} height={height} onResize={onResize}>
    <div className="aux-chart-header">
      <strong>CHART {id.replace('chart', '')}</strong>
      <select aria-label={`Chart ${id.replace('chart', '')} timeframe`} value={timeframe} onChange={(event) => onTimeframeChange(event.target.value as Timeframe)}>
        {timeframes.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
      </select>
    </div>
    <div className="aux-chart-content">
      <div ref={containerRef} className="aux-chart-canvas" />
      <canvas ref={superTrendCanvasRef} className="supertrend-overlay aux-supertrend-overlay" aria-hidden="true" />
      {loading && <div className="aux-chart-state">Loading {timeframe.toUpperCase()}…</div>}
      {!loading && error && <div className="aux-chart-state">{error}</div>}
    </div>
  </ChartTile>
}

function App() {
  const [symbol, setSymbol] = useState('GOLD')
  const [htfTimeframe] = useState<StrategyTimeframe>('5m')
  const [timeframe, setTimeframe] = useState<Timeframe>('5m')
  const [startDate, setStartDate] = useState(monthsAgoInput(5))
  const [endDate, setEndDate] = useState(dateInputValue(new Date()))
  const [chartType, setChartType] = useState<ChartType>('candles')
  const [chartLayout, setChartLayout] = useState<ChartLayout>(1)
  const [auxiliaryTimeframes, setAuxiliaryTimeframes] = useState<Record<string, Timeframe>>({
    chart2: '1h',
    chart3: '15m',
    chart4: '4h',
  })
  const [chartTileSizes, setChartTileSizes] = useState<Record<string, ChartTileSize>>({})
  const [reloadKey, setReloadKey] = useState(0)
  const [bars, setBars] = useState<Candle[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [summary, setSummary] = useState<BacktestSummary | null>(null)
  const [strategyResults, setStrategyResults] = useState<StrategyResult[] | null>(null)
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([])
  const [selectedTargetR, setSelectedTargetR] = useState(2)
  const [liveSignals, setLiveSignals] = useState<Trade[]>([])
  const [watchSignals, setWatchSignals] = useState<Trade[]>([])
  const [signalHistory, setSignalHistory] = useState<SignalHistoryItem[]>([])
  const [signalHistoryLoadedScope, setSignalHistoryLoadedScope] = useState<string | null>(null)
  const [keyLevels, setKeyLevels] = useState<KeyLevel[]>([])
  const [signalsEnabled, setSignalsEnabled] = useState(true)
  const [signalDirections, setSignalDirections] = useState({ buy: true, sell: true })
  const signalHistoryScope = `${signalHistoryStorageKey}:${symbol.trim().toUpperCase()}:${htfTimeframe}`
  const [status, setStatus] = useState<ApiStatus>('checking')
  const [loadingBars, setLoadingBars] = useState(true)
  const [runningBacktest, setRunningBacktest] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [replayIndex, setReplayIndex] = useState<number | null>(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [profileEnabled, setProfileEnabled] = useState(true)
  const [profileDuration, setProfileDuration] = useState<ProfileDuration>('day')
  const [profileLayout, setProfileLayout] = useState<ProfileLayout>('split')
  const [profileRangeMode, setProfileRangeMode] = useState(false)
  const [profileRange, setProfileRange] = useState<ProfileRange | null>(null)
  const [drawingTool, setDrawingTool] = useState<DrawingTool>(null)
  const [drawings, setDrawings] = useState<ChartDrawing[]>([])
  const [selectedDrawingId, setSelectedDrawingId] = useState<number | null>(null)
  const [draftDrawing, setDraftDrawing] = useState<ChartDrawing | null>(null)
  const [toolkitExpanded, setToolkitExpanded] = useState(true)
  const [toolkitPosition, setToolkitPosition] = useState({ x: 16, y: 92 })
  const [pipSize, setPipSize] = useState(0.01)
  const [error, setError] = useState('')
  const [atrLen, setAtrLen] = useState(14)
  const [atrBuffer, setAtrBuffer] = useState(0.1)
  const [sweepLen, setSweepLen] = useState(8)
  const [bosLen, setBosLen] = useState(5)
  const [confirmBars, setConfirmBars] = useState(5)
  const [superTrendEnabled, setSuperTrendEnabled] = useState(false)
  const [superTrendAtrLength, setSuperTrendAtrLength] = useState(14)
  const [superTrendFactor, setSuperTrendFactor] = useState(3)
  const [rsiEnabled, setRsiEnabled] = useState(false)
  const [rsiPeriod, setRsiPeriod] = useState(14)
  const [vwapEnabled, setVwapEnabled] = useState(false)
  const [sessionOverlaysEnabled, setSessionOverlaysEnabled] = useState(false)
  const [previousDayLabelsEnabled, setPreviousDayLabelsEnabled] = useState(true)
  const [chartFullscreen, setChartFullscreen] = useState(false)
  const [fullscreenChromeVisible, setFullscreenChromeVisible] = useState(true)
  const [footprintVisible, setFootprintVisible] = useState(true)
  const [panMode, setPanMode] = useState(false)
  const [emaEnabled, setEmaEnabled] = useState<Record<EmaPeriod, boolean>>({
    8: true,
    13: true,
    20: true,
    50: true,
    100: true,
    200: true,
  })
  const chartNode = useRef<HTMLDivElement>(null)
  const footprintCanvasRef = useRef<HTMLCanvasElement>(null)
  const superTrendCanvasRef = useRef<HTMLCanvasElement>(null)
  const chartWorkspaceRef = useRef<HTMLElement>(null)
  const profileCanvasRef = useRef<HTMLCanvasElement>(null)
  const sessionCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null)
  const rsiCanvasRef = useRef<HTMLCanvasElement>(null)
  const rsiDivergenceCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingGestureRef = useRef<DrawingGesture | null>(null)
  const drawingEditGestureRef = useRef<DrawingEditGesture | null>(null)
  const drawingIdRef = useRef(0)
  const toolkitDragRef = useRef<ToolkitDragGesture | null>(null)
  const profileSelectionRef = useRef<ProfileSelectionGesture | null>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const linkedChartsRef = useRef(new Map<string, LinkedChart>())
  const syncingCrosshairRef = useRef(false)
  const crosshairSyncRef = useRef<CrosshairSyncRef['current']>(() => {})
  useEffect(() => {
    crosshairSyncRef.current = (sourceId, timestamp, price) => {
      if (syncingCrosshairRef.current) return
      syncingCrosshairRef.current = true
      linkedChartsRef.current.forEach((entry, id) => {
        if (id === sourceId) return
        if (timestamp === null || price === null || !entry.bars.length) {
          entry.chart.clearCrosshairPosition()
          return
        }
        const nearest = nearestChartBar(entry.bars, timestamp)
        entry.chart.setCrosshairPosition(price, nearest.time as UTCTimestamp, entry.series)
      })
      window.requestAnimationFrame(() => { syncingCrosshairRef.current = false })
    }
  })
  const chartBarsRef = useRef<Candle[]>([])
  const panGestureRef = useRef<ChartPanGesture | null>(null)
  const replayPriceRangeRef = useRef<{ from: number; to: number } | null>(null)
  const replayLogicalRangeRef = useRef<{ from: number; to: number } | null>(null)
  const replayAutoScaleRef = useRef<boolean | null>(null)
  const replayShiftVisibleRangeRef = useRef<boolean | null>(null)
  const replayRangesPendingRef = useRef(false)
  const goLivePendingRef = useRef(false)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const emaSeriesRef = useRef<Partial<Record<EmaPeriod, ISeriesApi<'Line'>>>>({})
  const vwapSeriesRef = useRef<VWAPSeries | null>(null)
  const superTrendSeriesRef = useRef<SuperTrendSeries | null>(null)
  const markerPluginRef = useRef<{ setMarkers: (markers: SeriesMarker<UTCTimestamp>[]) => void } | null>(null)
  const lineMarkerPluginRef = useRef<{ setMarkers: (markers: SeriesMarker<UTCTimestamp>[]) => void } | null>(null)
  const priceLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([])
  const linePriceLinesRef = useRef<ReturnType<ISeriesApi<'Line'>['createPriceLine']>[]>([])
  const visibleBars = replayIndex === null ? bars : bars.slice(0, replayIndex + 1)
  const superTrendPoints = useMemo(
    () => superTrendEnabled ? adaptiveSuperTrend(visibleBars, superTrendAtrLength, superTrendFactor) : [],
    [visibleBars, superTrendAtrLength, superTrendEnabled, superTrendFactor],
  )
  const visibleSignalHistory = signalHistory
    .filter((signal) => signal.symbol === symbol.trim().toUpperCase()
      && signal.htf_timeframe === htfTimeframe
      && signalDirections[signal.direction])
    .slice()
    .reverse()
  const displayedArchivedSignals = visibleSignalHistory.filter((signal) => !liveSignals.slice(-6).some((liveSignal) => (
    liveSignal.direction === signal.direction
    && liveSignal.entry_time === signal.entry_time
    && liveSignal.setup === signal.setup
  )))

  useEffect(() => {
    setSignalHistoryLoadedScope(null)
    try {
      const stored = window.localStorage.getItem(signalHistoryScope)
      if (!stored) {
        setSignalHistory([])
      } else {
        const parsed: unknown = JSON.parse(stored)
        if (!Array.isArray(parsed) || !parsed.every(isSignalHistoryItem)) {
          throw new Error('Saved signal history has an invalid format.')
        }
        setSignalHistory(parsed)
      }
      setSignalHistoryLoadedScope(signalHistoryScope)
    } catch (reason) {
      setSignalHistory([])
      setError(reason instanceof Error ? reason.message : 'Could not read saved signal history.')
    }
  }, [signalHistoryScope])

  useEffect(() => {
    if (signalHistoryLoadedScope !== signalHistoryScope) return
    try {
      window.localStorage.setItem(
        signalHistoryScope,
        JSON.stringify(signalHistory.filter((signal) => (
          signal.symbol === symbol.trim().toUpperCase()
          && signal.htf_timeframe === htfTimeframe
        ))),
      )
    } catch (reason) {
      setError(reason instanceof Error ? `Could not save signal history: ${reason.message}` : 'Could not save signal history.')
    }
  }, [htfTimeframe, signalHistory, signalHistoryLoadedScope, signalHistoryScope, symbol])

  useEffect(() => {
    if (!signalsEnabled
      || signalHistoryLoadedScope !== signalHistoryScope
      || !startDate
      || !endDate
      || rangeEpoch(startDate) >= rangeEpoch(endDate)) return
    const controller = new AbortController()
    let active = true
    const loadSignalHistory = async () => {
      const query = new URLSearchParams({
        symbol,
        htf_timeframe: htfTimeframe,
        start: String(rangeEpoch(startDate)),
        end: String(rangeEpoch(endDate, true)),
        atr_len: String(atrLen),
        atr_buffer: String(atrBuffer),
        sweep_len: String(sweepLen),
        bos_len: String(bosLen),
        confirm_bars: String(confirmBars),
      })
      try {
        const response = await fetch(`/api/signals/history?${query}`, { signal: controller.signal })
        const data = await responseJson<{ signals: Trade[] }>(response)
        if (!active) return
        setSignalHistory((current) => mergeSignalHistory(
          current,
          data.signals.map((signal) => ({
            ...signal,
            symbol: symbol.trim().toUpperCase(),
            htf_timeframe: htfTimeframe,
          })),
        ))
      } catch (reason) {
        if (active && reason instanceof Error && reason.name !== 'AbortError') {
          setError(reason.message || 'Could not load previous session signals.')
        }
      }
    }
    void loadSignalHistory()
    return () => {
      active = false
      controller.abort()
    }
  }, [atrBuffer, atrLen, bosLen, confirmBars, endDate, htfTimeframe, signalHistoryLoadedScope, signalHistoryScope, signalsEnabled, startDate, sweepLen, symbol])

  const drawingTimeCoordinate = useCallback((timestamp: number) => {
    const timeScale = chartRef.current?.timeScale()
    if (!timeScale || !visibleBars.length) return null
    const exactCoordinate = timeScale.timeToCoordinate(timestamp as UTCTimestamp)
    if (exactCoordinate !== null) return exactCoordinate
    if (timestamp < visibleBars[0].time || timestamp > visibleBars[visibleBars.length - 1].time) return null

    let low = 0
    let high = visibleBars.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (visibleBars[middle].time < timestamp) low = middle + 1
      else high = middle
    }
    const nextBar = visibleBars[low]
    const previousBar = visibleBars[Math.max(0, low - 1)]
    const nearestBar = timestamp - previousBar.time <= nextBar.time - timestamp ? previousBar : nextBar
    return timeScale.timeToCoordinate(nearestBar.time as UTCTimestamp)
  }, [visibleBars])

  useEffect(() => {
    const syncFullscreen = () => setChartFullscreen(document.fullscreenElement === chartWorkspaceRef.current)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: { pressedMouseMove: !panMode && !profileRangeMode && !drawingTool },
      handleScale: { axisPressedMouseMove: !panMode && !profileRangeMode && !drawingTool },
    })
  }, [panMode, profileRangeMode, drawingTool])

  useEffect(() => {
    setPipSize(/^(GOLD|XAU)/i.test(symbol) ? 0.01 : 0.0001)
  }, [symbol])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('checking')
    fetch(`/api/status?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then((response) => responseJson<{ connected: boolean }>(response))
      .then((data) => setStatus(data.connected ? 'online' : 'offline'))
      .catch(() => setStatus('offline'))
    return () => controller.abort()
  }, [symbol, reloadKey])

  useEffect(() => {
    if (!startDate || !endDate || rangeEpoch(startDate) >= rangeEpoch(endDate)) {
      setLoadingBars(false)
      setBars([])
      setError('Choose a valid date range.')
      return
    }
    const controller = new AbortController()
    const query = new URLSearchParams({
      symbol,
      timeframe,
      start: String(rangeEpoch(startDate)),
      end: String(rangeEpoch(endDate, true)),
    })
    setLoadingBars(true)
    setError('')
    setBars([])
    setProfileRange(null)
    profileSelectionRef.current = null
    setDraftDrawing(null)
    drawingGestureRef.current = null
    setReplayIndex(null)
    setReplayPlaying(false)
    setTrades([])
    setSummary(null)
    setStrategyResults(null)
    setSessionResults([])
    setLiveSignals([])
    setKeyLevels([])
    fetch(`/api/history?${query}`, { signal: controller.signal })
      .then((response) => responseJson<{ bars: Candle[] }>(response))
      .then((data) => {
        setBars(data.bars)
        setLastUpdated(new Date())
        setStatus('online')
        if (!data.bars.length) setError('No MT5 history in this date range.')
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') {
          setError(reason.message || 'Could not load MT5 history.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingBars(false)
      })
    return () => controller.abort()
  }, [symbol, timeframe, startDate, endDate, reloadKey])

  useEffect(() => {
    if (!autoUpdate || replayIndex !== null || rangeEpoch(endDate, true) <= Math.floor(Date.now() / 1000)) return
    let active = true
    let requestInFlight = false
    const pollLatest = async () => {
      if (requestInFlight) return
      requestInFlight = true
      const query = new URLSearchParams({ symbol, timeframe })
      try {
        const response = await fetch(`/api/latest?${query}`)
        const data = await responseJson<{ bars: Candle[] }>(response)
        if (!active) return
        setBars((current) => {
          const merged = new Map(current.map((bar) => [bar.time, bar]))
          let changed = false
          for (const bar of data.bars) {
            const previous = merged.get(bar.time)
            if (!previous || previous.open !== bar.open || previous.high !== bar.high || previous.low !== bar.low || previous.close !== bar.close || previous.volume !== bar.volume) changed = true
            merged.set(bar.time, bar)
          }
          return changed ? [...merged.values()].sort((left, right) => left.time - right.time) : current
        })
        setLastUpdated(new Date())
        setStatus('online')
        setError('')
      } catch (reason) {
        if (active && reason instanceof Error && reason.name !== 'AbortError') {
          setStatus('offline')
          setError(reason.message || 'Automatic market update failed.')
        }
      } finally {
        requestInFlight = false
      }
    }
    const interval = window.setInterval(pollLatest, 5000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [autoUpdate, endDate, replayIndex, symbol, timeframe])

  useEffect(() => {
    if (!signalsEnabled) {
      setLiveSignals([])
      setWatchSignals([])
      return
    }
    if (!autoUpdate || replayIndex !== null || rangeEpoch(endDate, true) <= Math.floor(Date.now() / 1000)) {
      setWatchSignals([])
      return
    }
    let active = true
    let requestInFlight = false
    const updateSignals = async () => {
      if (requestInFlight) return
      requestInFlight = true
      try {
        const query = new URLSearchParams({
          symbol,
          htf_timeframe: htfTimeframe,
          atr_len: String(atrLen),
          atr_buffer: String(atrBuffer),
          sweep_len: String(sweepLen),
          bos_len: String(bosLen),
          confirm_bars: String(confirmBars),
        })
        const response = await fetch(`/api/signals?${query}`, { cache: 'no-store' })
        const data = await responseJson<{ signals: Trade[]; watch_signals?: Trade[]; key_levels: KeyLevel[] }>(response)
        if (!active) return
        setLiveSignals(data.signals)
        setWatchSignals(data.watch_signals ?? [])
        setSignalHistory((current) => mergeSignalHistory(current, data.signals.map((signal) => ({
          ...signal,
          symbol: symbol.trim().toUpperCase(),
          htf_timeframe: htfTimeframe,
        }))))
        setKeyLevels(data.key_levels)
      } catch (reason) {
        if (active && reason instanceof Error && reason.name !== 'AbortError') {
          setError(reason.message || 'Could not update live strategy signals.')
        }
      } finally {
        requestInFlight = false
      }
    }
    updateSignals()
    const interval = window.setInterval(updateSignals, 5_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [atrBuffer, atrLen, autoUpdate, bosLen, confirmBars, endDate, htfTimeframe, replayIndex, signalsEnabled, sweepLen, symbol])

  useEffect(() => {
    if (!replayPlaying || replayIndex === null) return
    if (replayIndex >= bars.length - 1) {
      setReplayPlaying(false)
      return
    }
    const timeout = window.setTimeout(() => setReplayIndex(replayIndex + 1), 1000 / replaySpeed)
    return () => window.clearTimeout(timeout)
  }, [bars.length, replayIndex, replayPlaying, replaySpeed])

  useEffect(() => {
    if (!chartNode.current) return
    const chart = createChart(chartNode.current, {
      width: chartNode.current.clientWidth,
      height: 490,
      layout: {
        background: { type: ColorType.Solid, color: '#0b1425' },
        textColor: '#8fa3bf',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 9,
      },
      localization: {
        locale: 'en-LK',
        timeFormatter: (time) => new Intl.DateTimeFormat('en-LK', {
          timeZone: LANKA_TIME_ZONE,
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(timeToDate(time)),
      },
      grid: { vertLines: { color: '#17243a' }, horzLines: { color: '#17243a' } },
      crosshair: { vertLine: { color: '#5283be', labelBackgroundColor: '#176ed1' }, horzLine: { color: '#5283be', labelBackgroundColor: '#176ed1' } },
      rightPriceScale: { borderColor: '#1e2d44' },
      timeScale: { borderColor: '#1e2d44', timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { price: true, time: true } },
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#62bdff', downColor: '#f2f7ff', borderUpColor: '#62bdff',
      borderDownColor: '#f2f7ff', wickUpColor: '#62bdff', wickDownColor: '#f2f7ff',
      lastValueVisible: true, priceLineColor: '#54769e',
    })
    const lineSeries = chart.addSeries(LineSeries, {
      color: '#258cff',
      lineWidth: 2,
      lastValueVisible: true,
      priceLineColor: '#54769e',
      visible: false,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume', priceFormat: { type: 'volume' },
      lastValueVisible: false, priceLineVisible: false,
    })
    emaPeriods.forEach((period) => {
      emaSeriesRef.current[period] = chart.addSeries(LineSeries, {
        color: emaColors[period],
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      })
    })
    vwapSeriesRef.current = {
      middle: chart.addSeries(LineSeries, {
        color: '#facc15',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      }),
      upper: chart.addSeries(LineSeries, {
        color: '#fb7185',
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      }),
      lower: chart.addSeries(LineSeries, {
        color: '#60a5fa',
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      }),
    }
    const superTrendSeries = {
      bullish: chart.addSeries(LineSeries, {
        color: '#86d8ff', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      }),
      bearish: chart.addSeries(LineSeries, {
        color: '#d7e3f5', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      }),
    }
    superTrendSeriesRef.current = superTrendSeries
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false })
    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    lineSeriesRef.current = lineSeries
    volumeSeriesRef.current = volumeSeries
    linkedChartsRef.current.set('chart1', { chart, series: candleSeries, bars: chartBarsRef.current })
    const onCrosshairMove = (param: Parameters<Parameters<typeof chart.subscribeCrosshairMove>[0]>[0]) => {
      if (typeof param.time !== 'number') {
        crosshairSyncRef.current('chart1', null, null)
        return
      }
      const point = param.seriesData.get(candleSeries)
      const price = point && 'close' in point ? point.close : null
      crosshairSyncRef.current('chart1', param.time, typeof price === 'number' ? price : null)
    }
    chart.subscribeCrosshairMove(onCrosshairMove)
    markerPluginRef.current = createSeriesMarkers(candleSeries, [])
    lineMarkerPluginRef.current = createSeriesMarkers(lineSeries, [])

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? {}
      if (width && height) chart.applyOptions({ width, height })
    })
    resizeObserver.observe(chartNode.current)
    return () => {
      resizeObserver.disconnect()
      chart.unsubscribeCrosshairMove(onCrosshairMove)
      linkedChartsRef.current.delete('chart1')
      chart.remove()
      chartRef.current = null
      chartBarsRef.current = []
      candleSeriesRef.current = null
      lineSeriesRef.current = null
      volumeSeriesRef.current = null
      emaSeriesRef.current = {}
      vwapSeriesRef.current = null
      superTrendSeriesRef.current = null
      markerPluginRef.current = null
      lineMarkerPluginRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const series = candleSeriesRef.current
    const canvas = footprintCanvasRef.current
    const context = canvas?.getContext('2d')
    if (!chart || !series || !canvas || !context) return

    const drawFootprint = () => {
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const pixelRatio = window.devicePixelRatio || 1
      canvas.width = Math.round(bounds.width * pixelRatio)
      canvas.height = Math.round(bounds.height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, bounds.width, bounds.height)
      context.fillStyle = '#0a1322'
      context.fillRect(0, 0, bounds.width, bounds.height)

      const logicalRange = chart.timeScale().getVisibleLogicalRange()
      const priceRange = series.priceScale().getVisibleRange()
      if (!logicalRange || !priceRange || !visibleBars.length) return

      const priceColumnWidth = 48
      const plotWidth = Math.max(0, bounds.width - priceColumnWidth)
      const sourcePlotWidth = chart.timeScale().width()
      const logicalSpan = Math.max(1, logicalRange.to - logicalRange.from)
      const barSlotWidth = plotWidth / logicalSpan
      const visibleStart = Math.max(0, Math.floor(logicalRange.from))
      const visibleEnd = Math.min(visibleBars.length - 1, Math.ceil(logicalRange.to))
      const availableHeight = bounds.height

      context.strokeStyle = '#1e2d44'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(plotWidth + 0.5, 0)
      context.lineTo(plotWidth + 0.5, availableHeight)
      context.stroke()

      const priceSpan = priceRange.to - priceRange.from
      if (priceSpan > 0) {
        const roughStep = priceSpan / 12
        const magnitude = 10 ** Math.floor(Math.log10(roughStep))
        const normalized = roughStep / magnitude
        const step = (normalized < 2 ? 1 : normalized < 5 ? 2 : 5) * magnitude
        const firstPrice = Math.ceil(priceRange.from / step) * step
        context.font = '9px IBM Plex Mono, monospace'
        context.textAlign = 'right'
        context.textBaseline = 'middle'
        for (let price = firstPrice; price <= priceRange.to; price += step) {
          const y = series.priceToCoordinate(price)
          if (y === null || y < 0 || y > availableHeight) continue
          context.fillStyle = '#8296b0'
          context.fillText(price.toFixed(2), bounds.width - 4, y)
        }
      }

      context.textAlign = 'center'
      for (let index = visibleStart; index <= visibleEnd; index += 1) {
        const bar = visibleBars[index]
        const sourceX = chart.timeScale().timeToCoordinate(bar.time as UTCTimestamp)
        if (sourceX === null || sourcePlotWidth <= 0) continue
        const x = (sourceX / sourcePlotWidth) * plotWidth
        const candleRange = bar.high - bar.low
        if (candleRange <= 0) continue
        const top = series.priceToCoordinate(bar.high)
        const bottom = series.priceToCoordinate(bar.low)
        if (top === null || bottom === null) continue
        const cellCount = Math.max(3, Math.min(12, Math.floor(Math.abs(bottom - top) / 17)))
        const cellHeight = Math.max(3, (bottom - top) / cellCount)
        const cellWidth = Math.max(3, Math.min(78, barSlotWidth * 0.88))
        const buyShare = Math.max(0.05, Math.min(0.95, (bar.close - bar.low) / candleRange))
        const buyVolume = Math.round((bar.volume * buyShare) / cellCount)
        const sellVolume = Math.round((bar.volume - bar.volume * buyShare) / cellCount)
        const xLeft = x - cellWidth / 2
        if (xLeft + cellWidth < 0 || xLeft > plotWidth) continue

        for (let row = 0; row < cellCount; row += 1) {
          const y = top + row * cellHeight
          const mid = xLeft + cellWidth / 2
          context.fillStyle = 'rgba(16, 201, 176, 0.16)'
          context.fillRect(xLeft, y, cellWidth / 2 - 1, Math.max(2, cellHeight - 1))
          context.fillStyle = 'rgba(255, 92, 114, 0.16)'
          context.fillRect(mid + 1, y, cellWidth / 2 - 1, Math.max(2, cellHeight - 1))
          if (cellWidth >= 48 && cellHeight >= 13) {
            context.font = '8px IBM Plex Mono, monospace'
            context.textBaseline = 'middle'
            context.fillStyle = '#54dbc8'
            context.fillText(String(buyVolume), xLeft + cellWidth * 0.25, y + cellHeight / 2)
            context.fillStyle = '#ff8794'
            context.fillText(String(sellVolume), xLeft + cellWidth * 0.75, y + cellHeight / 2)
          }
        }

        const closeY = series.priceToCoordinate(bar.close)
        if (closeY !== null) {
          context.strokeStyle = bar.close >= bar.open ? '#10c9b0' : '#ff5c72'
          context.lineWidth = 1
          context.beginPath()
          context.moveTo(xLeft, closeY)
          context.lineTo(xLeft + cellWidth, closeY)
          context.stroke()
        }
      }
    }

    drawFootprint()
    const resizeObserver = new ResizeObserver(drawFootprint)
    resizeObserver.observe(canvas)
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawFootprint)
    chart.subscribeCrosshairMove(drawFootprint)
    return () => {
      resizeObserver.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(drawFootprint)
      chart.unsubscribeCrosshairMove(drawFootprint)
    }
  }, [visibleBars, chartFullscreen, footprintVisible])

  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: {
        visible: true,
        ticksVisible: !chartFullscreen || fullscreenChromeVisible,
        borderVisible: !chartFullscreen || fullscreenChromeVisible,
      },
    })
  }, [chartFullscreen, fullscreenChromeVisible])

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartType === 'candles' })
    lineSeriesRef.current?.applyOptions({ visible: chartType === 'line' })
  }, [chartType])

  useEffect(() => {
    emaPeriods.forEach((period) => {
      emaSeriesRef.current[period]?.applyOptions({ visible: emaEnabled[period] })
    })
  }, [emaEnabled])

  useEffect(() => {
    const series = vwapSeriesRef.current
    if (!series) return
    series.middle.applyOptions({ visible: vwapEnabled })
    series.upper.applyOptions({ visible: vwapEnabled })
    series.lower.applyOptions({ visible: vwapEnabled })
    if (!vwapEnabled) {
      series.middle.setData([])
      series.upper.setData([])
      series.lower.setData([])
      return
    }
    const values = calculateVwap(visibleBars)
    series.middle.setData(values.map((point) => (
      'vwap' in point ? { time: point.time, value: point.vwap } : { time: point.time }
    )))
    series.upper.setData(values.map((point) => (
      'upper' in point ? { time: point.time, value: point.upper } : { time: point.time }
    )))
    series.lower.setData(values.map((point) => (
      'lower' in point ? { time: point.time, value: point.lower } : { time: point.time }
    )))
  }, [visibleBars, vwapEnabled])

  useEffect(() => {
    superTrendSeriesRef.current?.bullish.applyOptions({ visible: superTrendEnabled })
    superTrendSeriesRef.current?.bearish.applyOptions({ visible: superTrendEnabled })
  }, [superTrendEnabled])

  useEffect(() => {
    const series = superTrendSeriesRef.current
    if (!series) return
    if (!superTrendEnabled) {
      series.bullish.setData([])
      series.bearish.setData([])
      return
    }
    series.bullish.setData(superTrendPoints.map((point) => point.bullish === null
      ? { time: point.time as UTCTimestamp }
      : { time: point.time as UTCTimestamp, value: point.bullish }))
    series.bearish.setData(superTrendPoints.map((point) => point.bearish === null
      ? { time: point.time as UTCTimestamp }
      : { time: point.time as UTCTimestamp, value: point.bearish }))
  }, [superTrendEnabled, superTrendPoints])

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) return
    if (!visibleBars.length) {
      candleSeriesRef.current.setData([])
      lineSeriesRef.current?.setData([])
      volumeSeriesRef.current.setData([])
      emaPeriods.forEach((period) => emaSeriesRef.current[period]?.setData([]))
      markerPluginRef.current?.setMarkers([])
      priceLinesRef.current.forEach((line) => candleSeriesRef.current?.removePriceLine(line))
      priceLinesRef.current = []
      chartBarsRef.current = []
      const linkedPrimaryChart = linkedChartsRef.current.get('chart1')
      if (linkedPrimaryChart) linkedPrimaryChart.bars = []
      return
    }
    const priorLogicalRange = chartRef.current.timeScale().getVisibleLogicalRange()
    const priorPriceRange = candleSeriesRef.current.priceScale().getVisibleRange()
    const previous = chartBarsRef.current
    const incremental = previous.length > 0
      && visibleBars.length >= previous.length
      && visibleBars[0].time === previous[0].time
      && (replayIndex === null || visibleBars.length === previous.length + 1)

    if (incremental) {
      for (let index = Math.max(0, previous.length - 1); index < visibleBars.length; index += 1) {
        const bar = visibleBars[index]
        candleSeriesRef.current.update({
          time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        })
        lineSeriesRef.current?.update({ time: bar.time as UTCTimestamp, value: bar.close })
        volumeSeriesRef.current.update({
          time: bar.time as UTCTimestamp,
          value: bar.volume,
          color: bar.close >= bar.open ? 'rgba(98, 189, 255, 0.34)' : 'rgba(242, 247, 255, 0.28)',
        })
      }
    } else {
      candleSeriesRef.current.setData(visibleBars.map((bar) => ({
        time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      })))
      lineSeriesRef.current?.setData(visibleBars.map((bar) => ({
        time: bar.time as UTCTimestamp, value: bar.close,
      })))
      volumeSeriesRef.current.setData(visibleBars.map((bar) => ({
        time: bar.time as UTCTimestamp,
        value: bar.volume,
        color: bar.close >= bar.open ? 'rgba(98, 189, 255, 0.34)' : 'rgba(242, 247, 255, 0.28)',
      })))
    }
    emaPeriods.forEach((period) => {
      const alpha = 2 / (period + 1)
      let value = visibleBars[0].close
      const data = visibleBars.map((bar, index) => {
        if (index > 0) value = bar.close * alpha + value * (1 - alpha)
        return { time: bar.time as UTCTimestamp, value }
      })
      emaSeriesRef.current[period]?.setData(data)
    })
    if (replayIndex === null) {
      if (!incremental) chartRef.current.timeScale().fitContent()
    } else if (replayRangesPendingRef.current) {
      const priceScale = candleSeriesRef.current.priceScale()
      priceScale.setAutoScale(false)
      if (replayPriceRangeRef.current) priceScale.setVisibleRange(replayPriceRangeRef.current)
      if (replayLogicalRangeRef.current) chartRef.current.timeScale().setVisibleLogicalRange(replayLogicalRangeRef.current)
      replayRangesPendingRef.current = false
    } else if (!incremental) {
      if (priorPriceRange) candleSeriesRef.current.priceScale().setVisibleRange(priorPriceRange)
      if (priorLogicalRange) chartRef.current.timeScale().setVisibleLogicalRange(priorLogicalRange)
    }
    chartBarsRef.current = visibleBars
    const linkedPrimaryChart = linkedChartsRef.current.get('chart1')
    if (linkedPrimaryChart) linkedPrimaryChart.bars = visibleBars
    if (goLivePendingRef.current) {
      chartRef.current.timeScale().scrollToRealTime()
      goLivePendingRef.current = false
    }
  }, [visibleBars, replayIndex])

  useEffect(() => {
    const canvas = superTrendCanvasRef.current
    const chart = chartRef.current
    const series = candleSeriesRef.current
    const chartElement = chartNode.current
    if (!canvas || !chart || !series || !chartElement || !superTrendEnabled) {
      const context = canvas?.getContext('2d')
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    const draw = () => drawSuperTrendCloud(canvas, chart, series, superTrendPoints)
    let firstFrame = 0
    let secondFrame = 0
    const scheduleDraw = () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(draw)
      })
    }
    const resizeChartAndDraw = () => {
      const bounds = chartElement.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) {
        chart.applyOptions({ width: bounds.width, height: bounds.height })
      }
      scheduleDraw()
    }
    const observer = new ResizeObserver(resizeChartAndDraw)
    observer.observe(canvas)
    observer.observe(chartElement)
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDraw)
    chart.subscribeCrosshairMove(scheduleDraw)
    window.addEventListener('resize', resizeChartAndDraw)
    document.addEventListener('fullscreenchange', resizeChartAndDraw)
    resizeChartAndDraw()
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      observer.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDraw)
      chart.unsubscribeCrosshairMove(scheduleDraw)
      window.removeEventListener('resize', resizeChartAndDraw)
      document.removeEventListener('fullscreenchange', resizeChartAndDraw)
    }
  }, [chartFullscreen, fullscreenChromeVisible, superTrendEnabled, superTrendPoints])

  useEffect(() => {
    const canvas = rsiCanvasRef.current
    const divergenceCanvas = rsiDivergenceCanvasRef.current
    const chart = chartRef.current
    const priceSeries = candleSeriesRef.current
    if (!canvas || !divergenceCanvas) return
    const clearCanvases = () => {
      for (const target of [canvas, divergenceCanvas]) {
        const targetContext = target.getContext('2d')
        if (targetContext) targetContext.clearRect(0, 0, target.width, target.height)
      }
    }
    if (!rsiEnabled || !chart || !visibleBars.length) {
      clearCanvases()
      return
    }

    const values = relativeStrengthIndex(visibleBars, rsiPeriod)
    const divergences = findRsiDivergences(visibleBars, values)
    const drawRsi = () => {
      const bounds = canvas.getBoundingClientRect()
      const divergenceBounds = divergenceCanvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height || !divergenceBounds.width || !divergenceBounds.height) return
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(bounds.width * ratio)
      canvas.height = Math.round(bounds.height * ratio)
      divergenceCanvas.width = Math.round(divergenceBounds.width * ratio)
      divergenceCanvas.height = Math.round(divergenceBounds.height * ratio)
      const drawingContext = canvas.getContext('2d')
      const priceContext = divergenceCanvas.getContext('2d')
      if (!drawingContext || !priceContext || !priceSeries) return
      drawingContext.setTransform(ratio, 0, 0, ratio, 0, 0)
      drawingContext.clearRect(0, 0, bounds.width, bounds.height)
      priceContext.setTransform(ratio, 0, 0, ratio, 0, 0)
      priceContext.clearRect(0, 0, divergenceBounds.width, divergenceBounds.height)

      const plotWidth = chart.timeScale().width()
      const top = 7
      const bottom = bounds.height - 7
      const yForValue = (value: number) => bottom - (value / 100) * (bottom - top)
      const drawRedConnector = (
        context: CanvasRenderingContext2D,
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        label: string,
        labelX: number,
        labelY: number,
      ) => {
        context.beginPath()
        context.moveTo(fromX, fromY)
        context.lineTo(toX, toY)
        context.strokeStyle = '#ff4058'
        context.lineWidth = 2.5
        context.lineCap = 'round'
        context.stroke()
        for (const [x, y] of [[fromX, fromY], [toX, toY]]) {
          context.beginPath()
          context.arc(x, y, 3, 0, Math.PI * 2)
          context.fillStyle = '#ff4058'
          context.fill()
        }
        context.font = 'bold 8px IBM Plex Mono, monospace'
        const labelWidth = context.measureText(label).width + 6
        const boundedX = Math.max(2, Math.min(labelX, context.canvas.clientWidth - labelWidth - 2))
        const boundedY = Math.max(10, Math.min(labelY, context.canvas.clientHeight - 3))
        context.fillStyle = 'rgba(7, 16, 29, .92)'
        context.fillRect(boundedX, boundedY - 9, labelWidth, 12)
        context.fillStyle = '#ff6679'
        context.fillText(label, boundedX + 3, boundedY)
      }

      for (const divergence of divergences) {
        const fromX = chart.timeScale().timeToCoordinate(divergence.fromTime as UTCTimestamp)
        const toX = chart.timeScale().timeToCoordinate(divergence.toTime as UTCTimestamp)
        if (fromX === null || toX === null) continue
        const directionLabel = divergence.direction === 'bullish' ? 'BULL DIV' : 'BEAR DIV'
        const fromPriceY = priceSeries.priceToCoordinate(divergence.fromPrice)
        const toPriceY = priceSeries.priceToCoordinate(divergence.toPrice)
        if (fromPriceY !== null && toPriceY !== null) {
          drawRedConnector(
            priceContext,
            fromX,
            fromPriceY,
            toX,
            toPriceY,
            directionLabel,
            (fromX + toX) / 2 + 4,
            (fromPriceY + toPriceY) / 2,
          )
        }
      }

      drawingContext.font = '8px IBM Plex Mono, monospace'
      for (const level of [70, 50, 30]) {
        const y = yForValue(level)
        drawingContext.beginPath()
        drawingContext.setLineDash(level === 50 ? [2, 4] : [4, 3])
        drawingContext.strokeStyle = level === 50 ? 'rgba(143, 163, 191, .28)' : 'rgba(143, 163, 191, .48)'
        drawingContext.lineWidth = 1
        drawingContext.moveTo(0, y)
        drawingContext.lineTo(plotWidth, y)
        drawingContext.stroke()
        drawingContext.setLineDash([])
        drawingContext.fillStyle = '#8fa3bf'
        drawingContext.fillText(String(level), plotWidth + 7, y + 3)
      }

      drawingContext.beginPath()
      drawingContext.strokeStyle = '#c084fc'
      drawingContext.lineWidth = 1.75
      let hasPrevious = false
      let lastValue: number | null = null
      for (const point of values) {
        if (point.value === null) {
          hasPrevious = false
          continue
        }
        const x = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp)
        if (x === null) {
          hasPrevious = false
          continue
        }
        const y = yForValue(point.value)
        if (hasPrevious) drawingContext.lineTo(x, y)
        else drawingContext.moveTo(x, y)
        hasPrevious = true
        lastValue = point.value
      }
      drawingContext.stroke()
      if (lastValue !== null) {
        const y = yForValue(lastValue)
        drawingContext.fillStyle = '#c084fc'
        drawingContext.fillRect(plotWidth + 1, y - 7, 37, 14)
        drawingContext.fillStyle = '#101827'
        drawingContext.fillText(lastValue.toFixed(1), plotWidth + 5, y + 3)
      }
      for (const divergence of divergences) {
        const fromX = chart.timeScale().timeToCoordinate(divergence.fromTime as UTCTimestamp)
        const toX = chart.timeScale().timeToCoordinate(divergence.toTime as UTCTimestamp)
        if (fromX === null || toX === null) continue
        const fromY = yForValue(divergence.fromRsi)
        const toY = yForValue(divergence.toRsi)
        drawRedConnector(
          drawingContext,
          fromX,
          fromY,
          toX,
          toY,
          divergence.direction === 'bullish' ? 'BULL DIV' : 'BEAR DIV',
          (fromX + toX) / 2 + 4,
          (fromY + toY) / 2,
        )
      }
    }

    const observer = new ResizeObserver(drawRsi)
    observer.observe(canvas)
    observer.observe(divergenceCanvas)
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawRsi)
    chart.subscribeCrosshairMove(drawRsi)
    window.addEventListener('resize', drawRsi)
    document.addEventListener('fullscreenchange', drawRsi)
    drawRsi()
    return () => {
      observer.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(drawRsi)
      chart.unsubscribeCrosshairMove(drawRsi)
      window.removeEventListener('resize', drawRsi)
      document.removeEventListener('fullscreenchange', drawRsi)
    }
  }, [chartFullscreen, fullscreenChromeVisible, rsiEnabled, rsiPeriod, visibleBars])

  useEffect(() => {
    const canvas = profileCanvasRef.current
    const series = candleSeriesRef.current
    const chart = chartRef.current
    if (!canvas) return
    const canvasContext = canvas.getContext('2d')
    if (canvasContext) canvasContext.clearRect(0, 0, canvas.width, canvas.height)
    if (!profileEnabled || !series || !chart || !visibleBars.length) return

    const drawProfile = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(bounds.width * ratio)
      canvas.height = Math.round(bounds.height * ratio)
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, bounds.width, bounds.height)

      const profileBars = profileRange
        ? visibleBars.filter((bar) => bar.time >= profileRange.from && bar.time <= profileRange.to)
        : (() => {
            const profileEnd = visibleBars[visibleBars.length - 1]?.time
            if (profileEnd === undefined) return []
            const durationSeconds = profileDuration === 'day'
              ? 24 * 60 * 60
              : Number(profileDuration.replace('h', '')) * 60 * 60
            return visibleBars.filter((bar) => bar.time >= profileEnd - durationSeconds && bar.time <= profileEnd)
          })()
      if (!profileBars.length) return
      const rangeHigh = Math.max(...profileBars.map((bar) => bar.high))
      const rangeLow = Math.min(...profileBars.map((bar) => bar.low))
      const priceRange = rangeHigh - rangeLow
      if (priceRange <= 0) return

      const binCount = 24
      const binVolumes = Array<number>(binCount).fill(0)
      for (const bar of profileBars) {
        const bin = Math.max(0, Math.min(binCount - 1, Math.floor(((bar.close - rangeLow) / priceRange) * binCount)))
        binVolumes[bin] += bar.volume
      }
      const maxVolume = Math.max(...binVolumes)
      const pocIndex = binVolumes.indexOf(maxVolume)
      const totalVolume = binVolumes.reduce((total, volume) => total + volume, 0)
      let valueAreaLow = pocIndex
      let valueAreaHigh = pocIndex
      let valueAreaVolume = binVolumes[pocIndex]
      const valueAreaTarget = totalVolume * 0.7
      while (valueAreaVolume < valueAreaTarget && (valueAreaLow > 0 || valueAreaHigh < binCount - 1)) {
        const lowerVolume = valueAreaLow > 0 ? binVolumes[valueAreaLow - 1] : -1
        const upperVolume = valueAreaHigh < binCount - 1 ? binVolumes[valueAreaHigh + 1] : -1
        if (upperVolume >= lowerVolume) {
          valueAreaHigh += 1
          valueAreaVolume += upperVolume
        } else {
          valueAreaLow -= 1
          valueAreaVolume += lowerVolume
        }
      }
      const profileRight = bounds.width - 67
      if (profileLayout === 'split' && visibleBars.length > 1) {
        const visibleRange = chart.timeScale().getVisibleLogicalRange()
        const visibleStartIndex = visibleRange ? Math.max(0, Math.ceil(visibleRange.from)) : 0
        const visibleEndIndex = visibleRange
          ? Math.min(visibleBars.length - 1, Math.floor(visibleRange.to))
          : visibleBars.length - 1
        const viewportBars = visibleStartIndex <= visibleEndIndex
          ? visibleBars.slice(visibleStartIndex, visibleEndIndex + 1)
          : visibleBars
        const splitSourceBars = profileRange
          ? viewportBars.filter((bar) => bar.time >= profileRange.from && bar.time <= profileRange.to)
          : viewportBars
        if (splitSourceBars.length > 1) {
          const segmentDuration = profileDuration === 'day'
            ? 24 * 60 * 60
            : Number(profileDuration.replace('h', '')) * 60 * 60
          const lankaAnchorSeconds = 5 * 60 * 60 + 30 * 60
          const segmentCount = profileDuration === 'day'
            ? Math.ceil((splitSourceBars[splitSourceBars.length - 1].time - splitSourceBars[0].time) / segmentDuration)
            : Math.ceil((splitSourceBars[splitSourceBars.length - 1].time - splitSourceBars[0].time) / segmentDuration)
          const firstEpoch = splitSourceBars[0].time
          const lastEpoch = splitSourceBars[splitSourceBars.length - 1].time
          const utcAlignedStart = Math.floor((firstEpoch + lankaAnchorSeconds) / segmentDuration) * segmentDuration - lankaAnchorSeconds
          for (let segment = 0; segment <= segmentCount; segment += 1) {
            const segmentFrom = Math.max(firstEpoch, utcAlignedStart + segment * segmentDuration)
            const segmentTo = Math.min(lastEpoch, segmentFrom + segmentDuration)
            if (segmentTo <= segmentFrom) break
            const segmentBars = splitSourceBars.filter((bar) => bar.time >= segmentFrom && bar.time <= segmentTo)
            if (!segmentBars.length) continue
            const segmentRangeHigh = Math.max(...segmentBars.map((bar) => bar.high))
            const segmentRangeLow = Math.min(...segmentBars.map((bar) => bar.low))
            const segmentPriceRange = segmentRangeHigh - segmentRangeLow
            if (segmentPriceRange <= 0) continue
            const segmentBins = Array<number>(binCount).fill(0)
            for (const bar of segmentBars) {
              const bin = Math.max(0, Math.min(binCount - 1, Math.floor(((bar.close - segmentRangeLow) / segmentPriceRange) * binCount)))
              segmentBins[bin] += bar.volume
            }
            const segmentMax = Math.max(...segmentBins)
            const segmentPoc = segmentBins.indexOf(segmentMax)
            if (segmentMax <= 0) continue
            const fromX = chart.timeScale().timeToCoordinate(segmentFrom as UTCTimestamp)
            const toX = chart.timeScale().timeToCoordinate(segmentTo as UTCTimestamp)
            if (fromX === null || toX === null) continue
            const left = Math.max(0, Math.min(fromX, toX))
            const width = Math.max(4, Math.abs(toX - fromX))
            for (let bin = 0; bin < binCount; bin += 1) {
              if (segmentBins[bin] <= 0) continue
              const low = segmentRangeLow + (segmentPriceRange * bin) / binCount
              const high = segmentRangeLow + (segmentPriceRange * (bin + 1)) / binCount
              const top = series.priceToCoordinate(high)
              const bottom = series.priceToCoordinate(low)
              if (top === null || bottom === null) continue
              const profileWidth = Math.max(2, (segmentBins[bin] / segmentMax) * (width * 0.42))
              context.fillStyle = bin === segmentPoc
                ? 'rgba(160, 218, 255, 0.92)'
                : (segmentBins[bin] >= segmentMax * 0.55
                  ? 'rgba(137, 207, 255, 0.62)'
                  : 'rgba(103, 164, 220, 0.32)')
              context.fillRect(left, Math.min(top, bottom) + 1, profileWidth, Math.max(1, Math.abs(bottom - top) - 2))
            }
            context.strokeStyle = 'rgba(120, 132, 125, 0.24)'
            context.setLineDash([3, 5])
            context.beginPath()
            context.moveTo(left, 0)
            context.lineTo(left, bounds.height)
            context.stroke()
            context.setLineDash([])
          }
        }
      }
      if (profileRange) {
        const fromX = chart.timeScale().timeToCoordinate(profileRange.from as UTCTimestamp)
        const toX = chart.timeScale().timeToCoordinate(profileRange.to as UTCTimestamp)
        if (fromX !== null && toX !== null) {
          const left = Math.min(fromX, toX)
          const width = Math.max(2, Math.abs(toX - fromX))
          context.fillStyle = 'rgba(145, 202, 255, 0.08)'
          context.fillRect(left, 0, width, bounds.height)
          context.strokeStyle = 'rgba(145, 202, 255, 0.62)'
          context.setLineDash([4, 3])
          context.strokeRect(left, 1, width, bounds.height - 2)
          context.setLineDash([])
        }
      }
      if (profileLayout !== 'split') {
        for (let bin = 0; bin < binCount; bin += 1) {
          const low = rangeLow + (priceRange * bin) / binCount
          const high = rangeLow + (priceRange * (bin + 1)) / binCount
          const top = series.priceToCoordinate(high)
          const bottom = series.priceToCoordinate(low)
          if (top === null || bottom === null || maxVolume <= 0) continue
          const width = (binVolumes[bin] / maxVolume) * 58
          context.fillStyle = bin === pocIndex
            ? 'rgba(160, 218, 255, 0.94)'
            : bin >= valueAreaLow && bin <= valueAreaHigh
              ? 'rgba(137, 207, 255, 0.66)'
              : 'rgba(103, 164, 220, 0.36)'
          context.fillRect(profileRight - width, Math.min(top, bottom) + 1, width, Math.max(1, Math.abs(bottom - top) - 2))
        }
      }

      const pocPrice = rangeLow + (priceRange * (pocIndex + 0.5)) / binCount
      const valueAreaHighPrice = rangeLow + (priceRange * (valueAreaHigh + 1)) / binCount
      const valueAreaLowPrice = rangeLow + (priceRange * valueAreaLow) / binCount
      const drawProfileLevel = (price: number, label: string, color: string, dash: number[]) => {
        const y = series.priceToCoordinate(price)
        if (y === null) return
        context.strokeStyle = color
        context.fillStyle = color
        context.setLineDash(dash)
        context.beginPath()
        context.moveTo(8, y)
        context.lineTo(profileRight - 60, y)
        context.stroke()
        context.setLineDash([])
        context.font = '9px IBM Plex Mono, monospace'
        context.fillText(label, profileRight - 99, y - 3)
      }
      drawProfileLevel(pocPrice, 'POC', '#a0daff', [4, 3])
      drawProfileLevel(valueAreaHighPrice, 'VAH', '#c2d0ff', [3, 2])
      drawProfileLevel(valueAreaLowPrice, 'VAL', '#79dce8', [3, 2])

      const recent = visibleBars.slice(-11, -1)
      if (recent.length) {
        const liquidityHigh = Math.max(...recent.map((bar) => bar.high))
        const liquidityLow = Math.min(...recent.map((bar) => bar.low))
        const highY = series.priceToCoordinate(liquidityHigh)
        const lowY = series.priceToCoordinate(liquidityLow)
        context.setLineDash([2, 3])
        if (highY !== null) {
          context.strokeStyle = 'rgba(214, 99, 76, 0.7)'
          context.beginPath()
          context.moveTo(8, highY)
          context.lineTo(profileRight - 63, highY)
          context.stroke()
        }
        if (lowY !== null) {
          context.strokeStyle = 'rgba(23, 131, 107, 0.7)'
          context.beginPath()
          context.moveTo(8, lowY)
          context.lineTo(profileRight - 63, lowY)
          context.stroke()
        }
        context.setLineDash([])
      }
    }

    drawProfile()
    const resizeObserver = new ResizeObserver(drawProfile)
    resizeObserver.observe(canvas)
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawProfile)
    return () => {
      resizeObserver.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(drawProfile)
    }
  }, [visibleBars, profileRange, profileEnabled, profileDuration, profileLayout])

  useEffect(() => {
    const canvas = sessionCanvasRef.current
    const chart = chartRef.current
    const series = candleSeriesRef.current
    const chartElement = chartNode.current
    const workspaceElement = chartWorkspaceRef.current
    if (!canvas || !chart || !series || !chartElement || !workspaceElement) return
    const context = canvas.getContext('2d')
    if (!context) return
    const clear = () => context.clearRect(0, 0, canvas.width, canvas.height)
    if (!sessionOverlaysEnabled || !visibleBars.length) {
      clear()
      return
    }

    const ranges = buildSessionRanges(visibleBars)
    const barsByDay = new Map<number, Candle[]>()
    for (const bar of visibleBars) {
      const day = Math.floor((bar.time + colomboUtcOffsetSeconds) / 86_400)
      const dayBars = barsByDay.get(day)
      if (dayBars) dayBars.push(bar)
      else barsByDay.set(day, [bar])
    }
    const secondsPerBar: Record<Timeframe, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '30m': 1800,
      '39m': 2340,
      '1h': 3600,
      '4h': 14_400,
      '7h': 25_200,
    }

    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(bounds.width * ratio)
      canvas.height = Math.round(bounds.height * ratio)
      const drawingContext = canvas.getContext('2d')
      if (!drawingContext) return
      drawingContext.setTransform(ratio, 0, 0, ratio, 0, 0)
      drawingContext.clearRect(0, 0, bounds.width, bounds.height)
      const timeScale = chart.timeScale()
      const plotWidth = timeScale.width()
      const logicalRange = timeScale.getVisibleLogicalRange()
      const barSpacing = logicalRange
        ? Math.max(2, Math.min(40, plotWidth / Math.max(1, logicalRange.to - logicalRange.from)))
        : 5
      const chartBottom = bounds.height - timeScale.height()
      const visibleStartTime = visibleBars[0].time
      const visibleEndTime = visibleBars[visibleBars.length - 1].time

      drawingContext.save()
      drawingContext.beginPath()
      drawingContext.rect(0, 0, plotWidth, chartBottom)
      drawingContext.clip()

      for (const range of ranges) {
        if (range.end < visibleStartTime || range.start > visibleEndTime) continue
        const firstX = chart.timeScale().timeToCoordinate(range.firstTime as UTCTimestamp)
        const lastX = chart.timeScale().timeToCoordinate(range.lastTime as UTCTimestamp)
        const highY = series.priceToCoordinate(range.high)
        const lowY = series.priceToCoordinate(range.low)
        if (firstX === null || lastX === null || highY === null || lowY === null) continue
        const left = Math.max(0, Math.min(firstX, lastX) - barSpacing / 2)
        const right = Math.min(plotWidth, Math.max(firstX, lastX) + barSpacing / 2)
        const top = Math.max(0, Math.min(highY, lowY))
        const bottom = Math.min(chartBottom, Math.max(highY, lowY))
        const width = right - left
        const height = bottom - top
        if (width <= 0 || height <= 0) continue
        const color = range.session.color
        drawingContext.fillStyle = `${color}20`
        drawingContext.fillRect(left, top, width, height)
        drawingContext.strokeStyle = `${color}c8`
        drawingContext.lineWidth = 1
        drawingContext.setLineDash([4, 3])
        drawingContext.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, height - 1))
        drawingContext.setLineDash([])
        drawingContext.font = '9px IBM Plex Mono, monospace'
        drawingContext.fillStyle = color
        drawingContext.fillText(range.session.label, Math.max(left + 4, Math.min((left + right) / 2 - drawingContext.measureText(range.session.label).width / 2, right - drawingContext.measureText(range.session.label).width - 4)), Math.max(11, top + 12))
      }

      const openingStep = secondsPerBar[timeframe]
      for (const [day, dayBars] of barsByDay) {
        for (const opening of openingMarkers) {
          const openingTime = day * 86_400 - colomboUtcOffsetSeconds + opening.minute * 60
          let openingBar: Candle | null = null
          let nearestDistance = Number.POSITIVE_INFINITY
          for (const bar of dayBars) {
            const distance = Math.abs(bar.time - openingTime)
            if (distance < nearestDistance) {
              nearestDistance = distance
              openingBar = bar
            }
            if (bar.time > openingTime && distance > nearestDistance) break
          }
          if (!openingBar || nearestDistance > openingStep) continue
          const startX = timeScale.timeToCoordinate(openingBar.time as UTCTimestamp)
          const endX = timeScale.timeToCoordinate(dayBars[dayBars.length - 1].time as UTCTimestamp)
          const priceY = series.priceToCoordinate(openingBar.open)
          if (startX === null || endX === null || priceY === null) continue
          drawingContext.beginPath()
          drawingContext.moveTo(startX, priceY)
          drawingContext.lineTo(Math.min(plotWidth, endX + barSpacing / 2), priceY)
          drawingContext.strokeStyle = opening.color
          drawingContext.lineWidth = 1.5
          drawingContext.setLineDash([7, 4])
          drawingContext.stroke()
          drawingContext.setLineDash([])
          drawingContext.font = '8px IBM Plex Mono, monospace'
          const labelWidth = drawingContext.measureText(opening.label).width + 8
          const labelX = Math.max(2, Math.min(startX + 4, plotWidth - labelWidth - 2))
          drawingContext.fillStyle = 'rgba(7, 16, 29, .9)'
          drawingContext.fillRect(labelX, priceY - 13, labelWidth, 12)
          drawingContext.fillStyle = opening.color
          drawingContext.fillText(opening.label, labelX + 4, priceY - 4)
        }
      }
      drawingContext.restore()
    }

    let firstFrame = 0
    let secondFrame = 0
    const scheduleDraw = () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(draw)
      })
    }
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(canvas)
    observer.observe(chartElement)
    observer.observe(workspaceElement)
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDraw)
    chart.subscribeCrosshairMove(scheduleDraw)
    window.addEventListener('resize', scheduleDraw)
    document.addEventListener('fullscreenchange', scheduleDraw)
    scheduleDraw()
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      observer.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDraw)
      chart.unsubscribeCrosshairMove(scheduleDraw)
      window.removeEventListener('resize', scheduleDraw)
      document.removeEventListener('fullscreenchange', scheduleDraw)
    }
  }, [chartFullscreen, fullscreenChromeVisible, sessionOverlaysEnabled, timeframe, visibleBars])

  useEffect(() => {
    const canvas = drawingCanvasRef.current
    const chart = chartRef.current
    const series = candleSeriesRef.current
    if (!canvas || !chart || !series) return

    const drawAnnotations = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(bounds.width * ratio)
      canvas.height = Math.round(bounds.height * ratio)
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, bounds.width, bounds.height)
      const items = draftDrawing
        ? drawings.some((drawing) => drawing.id === draftDrawing.id)
          ? drawings.map((drawing) => drawing.id === draftDrawing.id ? draftDrawing : drawing)
          : [...drawings, draftDrawing]
        : drawings
      const lineRight = bounds.width - 66
      const drawNote = (note: string, x: number, y: number, color: string) => {
        if (!note.trim()) return
        context.font = '10px DM Sans, sans-serif'
        const width = context.measureText(note).width + 10
        context.fillStyle = 'rgba(16, 29, 49, 0.96)'
        context.fillRect(x, y - 12, width, 18)
        context.fillStyle = color
        context.fillText(note, x + 5, y + 1)
      }
      const drawAnchor = (x: number, y: number, color: string) => {
        context.beginPath()
        context.arc(x, y, 5, 0, Math.PI * 2)
        context.fillStyle = '#f8fafc'
        context.fill()
        context.lineWidth = 2
        context.strokeStyle = color
        context.stroke()
      }

      for (const drawing of items) {
        context.lineWidth = drawing.id === selectedDrawingId ? 2.5 : 1.5
        context.setLineDash([])
        if (drawing.kind === 'horizontal') {
          const y = series.priceToCoordinate(drawing.price)
          if (y === null) continue
          context.strokeStyle = drawing.color
          context.beginPath()
          context.moveTo(8, y)
          context.lineTo(lineRight, y)
          context.stroke()
          context.fillStyle = drawing.color
          context.font = '10px IBM Plex Mono, monospace'
          context.fillText(drawing.price.toFixed(2), lineRight - 53, y - 4)
          drawNote(drawing.note, 12, y - 10, drawing.color)
          continue
        }

        if (drawing.kind === 'vertical') {
          const x = drawingTimeCoordinate(drawing.time)
          if (x === null) continue
          context.strokeStyle = drawing.color
          context.setLineDash([4, 3])
          context.beginPath()
          context.moveTo(x, 0)
          context.lineTo(x, bounds.height - chart.timeScale().height())
          context.stroke()
          context.setLineDash([])
          drawNote(drawing.note, x + 6, 16, drawing.color)
          continue
        }

        const fromX = drawingTimeCoordinate(drawing.from.time)
        const toX = drawingTimeCoordinate(drawing.to.time)
        const fromY = series.priceToCoordinate(drawing.from.price)
        const toY = series.priceToCoordinate(drawing.to.price)
        if (fromX === null || toX === null || fromY === null || toY === null) continue

        if (drawing.kind === 'fibonacci') {
          context.font = '9px IBM Plex Mono, monospace'
          for (const level of fibonacciLevels) {
            const price = drawing.to.price + (drawing.from.price - drawing.to.price) * level.ratio
            const y = series.priceToCoordinate(price)
            if (y === null) continue
            const label = `${level.label}  ${price.toFixed(2)}`
            const labelWidth = context.measureText(label).width + 8
            const labelX = Math.max(8, Math.min(toX + 5, lineRight - labelWidth))
            const labelY = Math.max(12, Math.min(y - 3, bounds.height - chart.timeScale().height() - 3))
            context.globalAlpha = 1
            context.strokeStyle = level.color
            context.fillStyle = level.color
            context.lineWidth = level.ratio === 0 || level.ratio === 1 ? 2 : 1.75
            context.beginPath()
            context.moveTo(fromX, y)
            context.lineTo(toX, y)
            context.stroke()
            context.fillStyle = 'rgba(7, 16, 29, 0.94)'
            context.fillRect(labelX, labelY - 10, labelWidth, 14)
            context.fillStyle = level.color
            context.fillText(label, labelX + 4, labelY)
          }
          context.globalAlpha = 1
          context.lineWidth = drawing.id === selectedDrawingId ? 2.5 : 1.5
          if (drawing.id === selectedDrawingId) {
            drawAnchor(fromX, fromY, drawing.color)
            drawAnchor(toX, toY, drawing.color)
          }
          drawNote(drawing.note, (fromX + toX) / 2 + 8, (fromY + toY) / 2 + 14, drawing.color)
          continue
        }

        context.strokeStyle = drawing.color
        context.setLineDash(drawing.kind === 'measure' ? [5, 3] : [])
        context.beginPath()
        context.moveTo(fromX, fromY)
        context.lineTo(toX, toY)
        context.stroke()
        context.setLineDash([])
        if (drawing.id === selectedDrawingId) {
          drawAnchor(fromX, fromY, drawing.color)
          drawAnchor(toX, toY, drawing.color)
        }

        if (drawing.kind === 'measure') {
          const delta = drawing.to.price - drawing.from.price
          const pips = pipSize > 0 ? Math.abs(delta) / pipSize : 0
          const label = `${pips.toFixed(1)} pips  |  ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`
          const labelX = (fromX + toX) / 2 + 8
          const labelY = (fromY + toY) / 2 - 9
          context.font = '10px IBM Plex Mono, monospace'
          const labelWidth = context.measureText(label).width + 12
          context.fillStyle = 'rgba(16, 29, 49, 0.96)'
          context.fillRect(labelX - 5, labelY - 12, labelWidth, 20)
          context.fillStyle = '#8c681f'
          context.fillText(label, labelX + 1, labelY + 2)
        }
        drawNote(drawing.note, (fromX + toX) / 2 + 8, (fromY + toY) / 2 + 14, drawing.color)
      }
    }

    drawAnnotations()
    const resizeObserver = new ResizeObserver(drawAnnotations)
    resizeObserver.observe(canvas)
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawAnnotations)
    return () => {
      resizeObserver.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(drawAnnotations)
    }
  }, [visibleBars, drawings, draftDrawing, pipSize, selectedDrawingId, drawingTimeCoordinate])

  useEffect(() => {
    const series = candleSeriesRef.current
    const lineSeries = lineSeriesRef.current
    if (!series || !lineSeries) return
    priceLinesRef.current.forEach((line) => series.removePriceLine(line))
    priceLinesRef.current = []
    linePriceLinesRef.current.forEach((line) => lineSeries.removePriceLine(line))
    linePriceLinesRef.current = []
    const replayTime = visibleBars[visibleBars.length - 1]?.time ?? Number.POSITIVE_INFINITY
    const visibleTrades = trades.filter((trade) => (
      trade.entry_time <= replayTime && signalDirections[trade.direction]
    ))
    const currentHistory = signalsEnabled ? signalHistory.filter((signal) => (
      signal.symbol === symbol.trim().toUpperCase()
      && signal.htf_timeframe === htfTimeframe
      && signal.entry_time <= replayTime
      && signalDirections[signal.direction]
    )) : []
    const visibleSignals = signalsEnabled ? liveSignals.filter((signal) => (
      signal.entry_time <= replayTime && signalDirections[signal.direction]
    )) : []
    const visibleWatches = signalsEnabled ? watchSignals.filter((signal) => (
      signal.entry_time <= replayTime && signalDirections[signal.direction]
    )) : []
    const chartTrades = signalsEnabled ? [...visibleTrades, ...currentHistory] : []
    const anchorToChartBar = (timestamp: number): UTCTimestamp | null => {
      let low = 0
      let high = visibleBars.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (visibleBars[middle].time <= timestamp) low = middle + 1
        else high = middle
      }
      return low > 0 ? visibleBars[low - 1].time as UTCTimestamp : null
    }
    const markerSignals = new Map<string, Trade | SignalHistoryItem>()
    const watchMarkerKeys = new Set<string>()
    for (const signal of [...chartTrades, ...visibleSignals]) {
      const id = `${signal.direction}:${signal.entry_time}:${signal.setup ?? ''}`
      markerSignals.set(id, signal)
    }
    for (const signal of visibleWatches) {
      const id = `watch:${signal.direction}:${signal.entry_time}:${signal.setup ?? ''}`
      watchMarkerKeys.add(id)
      markerSignals.set(id, signal)
    }
    const markers: SeriesMarker<UTCTimestamp>[] = [...markerSignals.values()]
      .flatMap((trade): SeriesMarker<UTCTimestamp>[] => {
        const time = anchorToChartBar(trade.entry_time)
        const isWatch = watchMarkerKeys.has(`watch:${trade.direction}:${trade.entry_time}:${trade.setup ?? ''}`)
        return time === null ? [] : [{
          time,
          price: trade.entry,
          position: trade.direction === 'buy' ? 'belowBar' : 'aboveBar',
          color: isWatch ? '#a9c8ec' : trade.direction === 'buy' ? '#39d98a' : '#ff5c68',
          shape: trade.direction === 'buy' ? 'arrowUp' : 'arrowDown',
          text: isWatch ? 'WATCH' : trade.direction.toUpperCase(),
        }]
      })
      .sort((left, right) => Number(left.time) - Number(right.time))
    markerPluginRef.current?.setMarkers(markers)
    lineMarkerPluginRef.current?.setMarkers(markers)
    const latestWatch = visibleWatches[visibleWatches.length - 1]
    const latest = visibleSignals[visibleSignals.length - 1] ?? visibleTrades[visibleTrades.length - 1] ?? latestWatch
    if (latest) {
      priceLinesRef.current.push(
        series.createPriceLine({ price: latest.entry, color: '#a9d8ff', lineStyle: 0, lineWidth: 1, axisLabelVisible: true, title: 'IN' }),
        series.createPriceLine({ price: latest.stop, color: '#c4b8dc', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'SL' }),
        series.createPriceLine({ price: latest.target, color: '#83d9d4', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'TP' }),
      )
      linePriceLinesRef.current.push(
        lineSeries.createPriceLine({ price: latest.entry, color: '#a9d8ff', lineStyle: 0, lineWidth: 1, axisLabelVisible: true, title: 'IN' }),
        lineSeries.createPriceLine({ price: latest.stop, color: '#c4b8dc', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'SL' }),
        latest.target !== undefined
          ? lineSeries.createPriceLine({ price: latest.target, color: '#83d9d4', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'TP' })
          : lineSeries.createPriceLine({ price: latest.stop, color: '#a9c8ec', lineStyle: 3, lineWidth: 1, axisLabelVisible: true, title: 'WATCH' }),
      )
      if (latest.order_block_low !== undefined && latest.order_block_high !== undefined) {
        for (const [price, title] of [
          [latest.order_block_low, 'OB L'],
          [latest.order_block_high, 'OB H'],
        ] as const) {
          priceLinesRef.current.push(series.createPriceLine({
            price, color: '#b8c8e8', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title,
          }))
          linePriceLinesRef.current.push(lineSeries.createPriceLine({
            price, color: '#b8c8e8', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title,
          }))
        }
      }
    }
    keyLevels.forEach((level) => {
      const color = level.direction === 'support' ? '#79dce8' : '#c2d0ff'
      const isPreviousDayLevel = /previous day (high|low)/i.test(level.source)
      const title = isPreviousDayLevel && !previousDayLabelsEnabled ? '' : formatChartLevelLabel(level.source)
      priceLinesRef.current.push(series.createPriceLine({
        price: level.price, color, lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title,
      }))
      linePriceLinesRef.current.push(lineSeries.createPriceLine({
        price: level.price, color, lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title,
      }))
    })
  }, [trades, liveSignals, watchSignals, signalHistory, keyLevels, visibleBars, signalDirections, signalsEnabled, symbol, htfTimeframe, previousDayLabelsEnabled])

  const lastBar = visibleBars[visibleBars.length - 1]
  const firstBar = bars[0]
  const selectedDrawing = drawings.find((drawing) => drawing.id === selectedDrawingId) ?? null
  const change = firstBar && lastBar ? ((lastBar.close - firstBar.close) / firstBar.close) * 100 : 0
  const liveRange = rangeEpoch(endDate, true) > Math.floor(Date.now() / 1000)
  const pollingActive = autoUpdate && replayIndex === null && liveRange
  const updateLabel = replayIndex !== null ? 'REPLAY' : !liveRange ? 'HISTORY' : autoUpdate ? 'AUTO' : 'PAUSED'

  function resizeChartTile(id: string, width: number, height: number) {
    setChartTileSizes((current) => ({ ...current, [id]: { width, height } }))
  }

  async function runStrategy() {
    if (!startDate || !endDate) return
    setRunningBacktest(true)
    setError('')
    const query = new URLSearchParams({
      symbol, htf_timeframe: htfTimeframe,
      start: String(rangeEpoch(startDate)), end: String(rangeEpoch(endDate, true)),
      atr_len: String(atrLen), atr_buffer: String(atrBuffer),
      sweep_len: String(sweepLen), bos_len: String(bosLen), confirm_bars: String(confirmBars),
    })
    try {
      const response = await fetch(`/api/backtest?${query}`)
      const result = await responseJson<BacktestResult>(response)
      const selectedResult = result.results.find((item) => item.target_r === selectedTargetR)
      if (!selectedResult) throw new Error('Backtest response is missing the selected R target.')
      setStrategyResults(result.results)
      setSessionResults(result.session_results)
      setTrades(selectedResult.trades)
      setSummary(selectedResult.summary)
      setKeyLevels(result.key_levels)
      setSignalHistory((current) => mergeSignalHistory(current, result.signals.map((signal) => ({
        ...signal,
        symbol: symbol.trim().toUpperCase(),
        htf_timeframe: htfTimeframe,
      }))))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Backtest request failed.')
    } finally {
      setRunningBacktest(false)
    }
  }

  function selectTarget(targetR: number) {
    setSelectedTargetR(targetR)
    const result = strategyResults?.find((item) => item.target_r === targetR)
    if (result) {
      setTrades(result.trades)
      setSummary(result.summary)
    }
  }

  function chooseRange(value: number, months = false) {
    setEndDate(dateInputValue(new Date()))
    setStartDate(months ? monthsAgoInput(value) : daysAgoInput(value))
  }

  function updateDrawing(id: number, values: { color?: string; note?: string }) {
    setDrawings((current) => current.map((drawing) => drawing.id === id ? { ...drawing, ...values } : drawing))
  }

  function deleteDrawing(id: number) {
    setDrawings((current) => current.filter((drawing) => drawing.id !== id))
    setSelectedDrawingId((current) => current === id ? null : current)
  }

  function resetDrawings() {
    setDrawings([])
    setDraftDrawing(null)
    setSelectedDrawingId(null)
    drawingGestureRef.current = null
    drawingEditGestureRef.current = null
  }

  function setReplayCursor(index: number) {
    const boundedIndex = Math.max(0, Math.min(bars.length - 1, index))
    if (replayIndex === null) {
      const series = candleSeriesRef.current
      const chart = chartRef.current
      if (series && chart) {
        const priceScale = series.priceScale()
        replayAutoScaleRef.current = priceScale.options().autoScale
        replayPriceRangeRef.current = priceScale.getVisibleRange()
        replayLogicalRangeRef.current = chart.timeScale().getVisibleLogicalRange()
        replayShiftVisibleRangeRef.current = true
        replayRangesPendingRef.current = true
        chart.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: false } })
        if (replayPriceRangeRef.current) {
          priceScale.setAutoScale(false)
          priceScale.setVisibleRange(replayPriceRangeRef.current)
        }
      }
    }
    setReplayPlaying(false)
    setReplayIndex(boundedIndex)
  }

  function startReplay() {
    if (!bars.length) return
    const initialIndex = replayIndex ?? Math.max(0, bars.length - 100)
    setReplayCursor(initialIndex)
    setReplayPlaying(initialIndex < bars.length - 1)
  }

  function stepReplay(amount: number) {
    if (!bars.length) return
    setReplayCursor((replayIndex ?? bars.length - 1) + amount)
  }

  function drawingPointAt(event: ReactPointerEvent<HTMLDivElement>): DrawingPoint | null {
    const chart = chartRef.current
    const series = candleSeriesRef.current
    const node = chartNode.current
    if (!chart || !series || !node || !visibleBars.length) return null
    const bounds = node.getBoundingClientRect()
    const logicalIndex = chart.timeScale().coordinateToLogical(event.clientX - bounds.left)
    const price = series.coordinateToPrice(event.clientY - bounds.top)
    if (logicalIndex === null || price === null) return null
    const index = Math.max(0, Math.min(visibleBars.length - 1, Math.round(logicalIndex)))
    return { time: visibleBars[index].time, price }
  }

  function chooseDrawingTool(tool: Exclude<DrawingTool, null>) {
    setPanMode(false)
    setProfileRangeMode(false)
    setSelectedDrawingId(null)
    profileSelectionRef.current = null
    setDraftDrawing(null)
    drawingGestureRef.current = null
    drawingEditGestureRef.current = null
    setDrawingTool((current) => current === tool ? null : tool)
  }

  function beginToolkitDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!chartFullscreen || event.button !== 0) return
    toolkitDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: toolkitPosition.x,
      originY: toolkitPosition.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveToolkit(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = toolkitDragRef.current
    const workspace = chartWorkspaceRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || !workspace) return
    const maxX = Math.max(0, workspace.clientWidth - (toolkitExpanded ? 330 : 112))
    const maxY = Math.max(0, workspace.clientHeight - (toolkitExpanded ? 90 : 42))
    setToolkitPosition({
      x: Math.max(0, Math.min(maxX, gesture.originX + event.clientX - gesture.startX)),
      y: Math.max(0, Math.min(maxY, gesture.originY + event.clientY - gesture.startY)),
    })
    event.preventDefault()
  }

  function endToolkitDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (toolkitDragRef.current?.pointerId !== event.pointerId) return
    toolkitDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    event.preventDefault()
  }

  function chartDrawingAt(event: ReactPointerEvent<HTMLDivElement>): DrawingHit | null {
    const chart = chartRef.current
    const series = candleSeriesRef.current
    const node = chartNode.current
    if (!chart || !series || !node) return null
    const bounds = node.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    for (const drawing of [...drawings].reverse()) {
      if (drawing.kind === 'horizontal') {
        const lineY = series.priceToCoordinate(drawing.price)
        if (lineY !== null && Math.abs(lineY - y) <= 8) return { drawing, part: 'move' }
      } else if (drawing.kind === 'vertical') {
        const lineX = drawingTimeCoordinate(drawing.time)
        if (lineX !== null && Math.abs(lineX - x) <= 8) return { drawing, part: 'move' }
      } else {
        const fromX = drawingTimeCoordinate(drawing.from.time)
        const toX = drawingTimeCoordinate(drawing.to.time)
        const fromY = series.priceToCoordinate(drawing.from.price)
        const toY = series.priceToCoordinate(drawing.to.price)
        if (fromX === null || toX === null || fromY === null || toY === null) continue
        if (Math.hypot(x - fromX, y - fromY) <= 12) return { drawing, part: 'from' }
        if (Math.hypot(x - toX, y - toY) <= 12) return { drawing, part: 'to' }
        if (drawing.kind === 'fibonacci') {
          for (const level of fibonacciLevels) {
            const price = drawing.to.price + (drawing.from.price - drawing.to.price) * level.ratio
            const lineY = series.priceToCoordinate(price)
            if (lineY !== null && x >= Math.min(fromX, toX) - 8 && x <= Math.max(fromX, toX) + 8
              && Math.abs(lineY - y) <= 8) return { drawing, part: 'move' }
          }
        } else if (pointToSegmentDistance(x, y, fromX, fromY, toX, toY) <= 8) {
          return { drawing, part: 'move' }
        }
      }
    }
    return null
  }

  function editedDrawingAt(drawing: ChartDrawing, part: DrawingEditPart, start: DrawingPoint, point: DrawingPoint): ChartDrawing {
    if (drawing.kind === 'horizontal') return { ...drawing, price: drawing.price + point.price - start.price }
    if (drawing.kind === 'vertical') return { ...drawing, time: drawing.time + point.time - start.time }
    if (part === 'from') return { ...drawing, from: point }
    if (part === 'to') return { ...drawing, to: point }
    const timeShift = point.time - start.time
    const priceShift = point.price - start.price
    return {
      ...drawing,
      from: { time: drawing.from.time + timeShift, price: drawing.from.price + priceShift },
      to: { time: drawing.to.time + timeShift, price: drawing.to.price + priceShift },
    }
  }

  function beginChartPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawingTool && event.button === 0) {
      const point = drawingPointAt(event)
      if (!point) return
      if (drawingTool === 'horizontal') {
        const id = drawingIdRef.current++
        setDrawings((current) => [...current, { id, kind: 'horizontal', price: point.price, color: drawingColors.horizontal, note: '' }])
        setSelectedDrawingId(id)
      } else if (drawingTool === 'vertical') {
        const id = drawingIdRef.current++
        setDrawings((current) => [...current, { id, kind: 'vertical', time: point.time, color: drawingColors.vertical, note: '' }])
        setSelectedDrawingId(id)
      } else {
        const id = drawingIdRef.current++
        const color = drawingColors[drawingTool]
        drawingGestureRef.current = { pointerId: event.pointerId, id, kind: drawingTool, from: point, color, note: '' }
        setDraftDrawing({ id, kind: drawingTool, from: point, to: point, color, note: '' })
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (profileRangeMode && event.button === 0 && chartRef.current && chartNode.current && visibleBars.length) {
      const bounds = chartNode.current.getBoundingClientRect()
      const logicalIndex = chartRef.current.timeScale().coordinateToLogical(event.clientX - bounds.left)
      if (logicalIndex === null) return
      const startIndex = Math.max(0, Math.min(visibleBars.length - 1, Math.round(logicalIndex)))
      const timestamp = visibleBars[startIndex].time
      profileSelectionRef.current = { pointerId: event.pointerId, startIndex }
      setProfileRange({ from: timestamp, to: timestamp })
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!drawingTool && !profileRangeMode && event.button === 0) {
      const hit = chartDrawingAt(event)
      setSelectedDrawingId(hit?.drawing.id ?? null)
      if (hit) {
        const point = drawingPointAt(event)
        if (point) {
          drawingEditGestureRef.current = {
            pointerId: event.pointerId,
            drawing: hit.drawing,
            part: hit.part,
            start: point,
          }
          setDraftDrawing(hit.drawing)
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
    const chart = chartRef.current
    const series = candleSeriesRef.current
    const logicalRange = chart?.timeScale().getVisibleLogicalRange()
    const priceRange = series?.priceScale().getVisibleRange()
    if (!panMode || event.button !== 0 || !chart || !series || !chartNode.current || !logicalRange || !priceRange) return

    const plotWidth = chart.timeScale().width()
    const plotHeight = chartNode.current.clientHeight - chart.timeScale().height()
    if (plotWidth <= 0 || plotHeight <= 0) return
    panGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      logicalRange,
      priceRange,
      plotWidth,
      plotHeight,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveChartPan(event: ReactPointerEvent<HTMLDivElement>) {
    const editGesture = drawingEditGestureRef.current
    if (editGesture?.pointerId === event.pointerId) {
      const point = drawingPointAt(event)
      if (!point) return
      setDraftDrawing(editedDrawingAt(editGesture.drawing, editGesture.part, editGesture.start, point))
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const drawingGesture = drawingGestureRef.current
    if (drawingTool && drawingGesture?.pointerId === event.pointerId) {
      const point = drawingPointAt(event)
      if (!point) return
      setDraftDrawing({ ...drawingGesture, to: point })
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const profileGesture = profileSelectionRef.current
    if (profileRangeMode && profileGesture?.pointerId === event.pointerId && chartRef.current && chartNode.current) {
      const bounds = chartNode.current.getBoundingClientRect()
      const logicalIndex = chartRef.current.timeScale().coordinateToLogical(event.clientX - bounds.left)
      if (logicalIndex === null) return
      const currentIndex = Math.max(0, Math.min(visibleBars.length - 1, Math.round(logicalIndex)))
      const startTime = visibleBars[profileGesture.startIndex].time
      const currentTime = visibleBars[currentIndex].time
      setProfileRange({ from: Math.min(startTime, currentTime), to: Math.max(startTime, currentTime) })
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const gesture = panGestureRef.current
    const chart = chartRef.current
    const series = candleSeriesRef.current
    if (!panMode || !gesture || gesture.pointerId !== event.pointerId || !chart || !series) return

    const logicalShift = -((event.clientX - gesture.startX) / gesture.plotWidth) * (gesture.logicalRange.to - gesture.logicalRange.from)
    const priceShift = ((event.clientY - gesture.startY) / gesture.plotHeight) * (gesture.priceRange.to - gesture.priceRange.from)
    chart.timeScale().setVisibleLogicalRange({ from: gesture.logicalRange.from + logicalShift, to: gesture.logicalRange.to + logicalShift })
    series.priceScale().setVisibleRange({ from: gesture.priceRange.from + priceShift, to: gesture.priceRange.to + priceShift })
    event.preventDefault()
  }

  function endChartPan(event: ReactPointerEvent<HTMLDivElement>) {
    const editGesture = drawingEditGestureRef.current
    if (editGesture?.pointerId === event.pointerId) {
      const point = drawingPointAt(event)
      if (point) {
        const edited = editedDrawingAt(editGesture.drawing, editGesture.part, editGesture.start, point)
        setDrawings((current) => current.map((drawing) => drawing.id === edited.id ? edited : drawing))
      }
      drawingEditGestureRef.current = null
      setDraftDrawing(null)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const drawingGesture = drawingGestureRef.current
    if (drawingGesture?.pointerId === event.pointerId) {
      const point = drawingPointAt(event)
      if (point) {
        setDrawings((current) => [...current, {
          id: drawingGesture.id,
          kind: drawingGesture.kind,
          from: drawingGesture.from,
          to: point,
          color: drawingGesture.color,
          note: drawingGesture.note,
        }])
        setSelectedDrawingId(drawingGesture.id)
      }
      drawingGestureRef.current = null
      setDraftDrawing(null)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (profileSelectionRef.current?.pointerId === event.pointerId) {
      profileSelectionRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (panGestureRef.current?.pointerId !== event.pointerId) return
    panGestureRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function goLive() {
    const series = candleSeriesRef.current
    if (series && replayAutoScaleRef.current !== null) {
      series.priceScale().setAutoScale(replayAutoScaleRef.current)
      if (replayAutoScaleRef.current && replayPriceRangeRef.current) {
        series.priceScale().setVisibleRange(replayPriceRangeRef.current)
      }
    }
    replayPriceRangeRef.current = null
    replayLogicalRangeRef.current = null
    replayRangesPendingRef.current = false
    replayAutoScaleRef.current = null
    chartRef.current?.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: replayShiftVisibleRangeRef.current ?? true } })
    replayShiftVisibleRangeRef.current = null
    setReplayPlaying(false)
    setReplayIndex(null)
    goLivePendingRef.current = true
  }

  async function toggleChartFullscreen() {
    const chartWorkspace = chartWorkspaceRef.current
    if (!chartWorkspace) return
    try {
      if (document.fullscreenElement === chartWorkspace) {
        await document.exitFullscreen()
        setChartFullscreen(false)
      } else {
        await chartWorkspace.requestFullscreen()
        setChartFullscreen(true)
      }
    } catch {
      setError('Fullscreen is not available in this browser.')
    }
  }

  function exportTrades() {
    if (!trades.length) return
    const rows = ['direction,setup,key_source,key_level,entry_time,exit_time,entry,stop,target,exit_price,result_r,outcome', ...trades.map((trade) => [
      trade.direction, trade.setup ?? '', trade.key_source ?? '', trade.key_level ?? '',
      new Date(trade.entry_time * 1000).toISOString(), new Date(trade.exit_time * 1000).toISOString(),
      trade.entry, trade.stop, trade.target, trade.exit_price, trade.result_r, trade.outcome,
    ].join(','))]
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }))
    link.download = `${symbol}-${htfTimeframe}-backtest.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="MyView workspace">
          <span className="brand-mark"><Activity size={17} strokeWidth={2.4} /></span>
          <span>myview<span className="brand-period">.</span></span><span className="brand-divider" />
          <span className="brand-caption">MARKET LAB</span>
        </a>
        <div className={`connection-pill ${status}`}>
          {status === 'online' ? <Wifi size={14} /> : status === 'checking' ? <LoaderCircle className="spin" size={14} /> : <WifiOff size={14} />}
          <span>{status === 'online' ? 'MT5 CONNECTED' : status === 'checking' ? 'CONNECTING' : 'MT5 OFFLINE'}</span><i />
        </div>
      </header>

      <main className="workspace" id="top">
        <aside className="sidebar">
          <div className="sidebar-heading"><div><span className="eyebrow">STRATEGY TESTER</span><h1>M5 Sweep + BOS</h1></div><span className="pine-tag">M5</span></div>
          <div className="sidebar-section">
            <div className="section-title"><span>Market</span><Settings2 size={14} /></div>
            <label className="field-label" htmlFor="symbol">MT5 symbol</label>
            <div className="symbol-input-wrap"><Activity size={15} /><input id="symbol" value={symbol} onChange={(event) => setSymbol(event.target.value.trim())} spellCheck={false} /></div>
            <div className="field-pair">
              <label className="field-label" htmlFor="date-from">From<input id="date-from" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
              <label className="field-label" htmlFor="date-to">To<input id="date-to" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            </div>
            <div className="range-shortcuts" aria-label="Quick history ranges">
              {[['1D', 1], ['5D', 5], ['1M', 30], ['3M', 90], ['5M', 150]].map(([label, days]) => <button key={label} type="button" onClick={() => label === '5M' ? chooseRange(5, true) : chooseRange(Number(days))}>{label}</button>)}
            </div>
          </div>

          <div className="sidebar-section strategy-section">
            <div className="section-title"><span>Sweep + BOS setup</span><span className="section-index">01</span></div>
            <label className="parameter-row" htmlFor="sweep-len"><span>Liquidity lookback</span><input id="sweep-len" type="number" min="3" max="100" value={sweepLen} onChange={(event) => setSweepLen(Number(event.target.value))} /></label>
            <label className="parameter-row" htmlFor="bos-len"><span>BOS lookback</span><input id="bos-len" type="number" min="2" max="50" value={bosLen} onChange={(event) => setBosLen(Number(event.target.value))} /></label>
            <label className="parameter-row" htmlFor="confirm-bars"><span>Bars allowed after sweep</span><input id="confirm-bars" type="number" min="1" max="50" value={confirmBars} onChange={(event) => setConfirmBars(Number(event.target.value))} /></label>
            <p className="strategy-note">Completed M5 bar sweeps the prior liquidity high/low, then must break the previous BOS range. Signal scanning starts 30 minutes before each Colombo session: Asia 06:00, London 13:00, New York 19:00 and IB 18:20, continuing through each session.</p>
          </div>

          <div className="sidebar-section risk-section">
            <div className="section-title"><span>Risk model</span><span className="section-index">02</span></div>
            <label className="parameter-row" htmlFor="atr-len"><span>ATR length</span><input id="atr-len" type="number" min="1" max="100" value={atrLen} onChange={(event) => setAtrLen(Number(event.target.value))} /></label>
            <label className="parameter-row" htmlFor="atr-buffer"><span>SL ATR buffer</span><span className="input-suffix"><input id="atr-buffer" type="number" min="0" max="10" step="0.05" value={atrBuffer} onChange={(event) => setAtrBuffer(Number(event.target.value))} /><small>ATR</small></span></label>
            <p className="risk-note">Backtest compares TP1–TP5 (1R–5R) by session. If SL and target touch in the same candle, SL counts first.</p>
          </div>

          <button className="run-button" type="button" onClick={runStrategy} disabled={runningBacktest || !bars.length}>
            {runningBacktest ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}
            <span>{runningBacktest ? 'Running test' : 'Run backtest'}</span><span className="button-shortcut">ENTER</span>
          </button>
          <div className="sidebar-foot"><CalendarDays size={14} /><span>Historical data from your MT5 terminal</span></div>
        </aside>

        <section className="main-panel">
          <section ref={chartWorkspaceRef} className={`chart-workspace${chartFullscreen && !fullscreenChromeVisible ? ' fullscreen-chrome-hidden' : ''}`} aria-label="Price chart">
          {chartFullscreen && <button
            className="fullscreen-chrome-toggle"
            type="button"
            title={fullscreenChromeVisible ? 'Hide chart controls and labels' : 'Show chart controls and labels'}
            aria-label={fullscreenChromeVisible ? 'Hide chart controls and labels' : 'Show chart controls and labels'}
            aria-pressed={fullscreenChromeVisible}
            onClick={() => setFullscreenChromeVisible((visible) => !visible)}
          >{fullscreenChromeVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
          {chartFullscreen && !fullscreenChromeVisible && <div className="fullscreen-timeframes" role="group" aria-label="Chart timeframe">
            {timeframes.map((item) => (
              <button key={item} type="button" className={timeframe === item ? 'active' : ''} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>{item}</button>
            ))}
            <button
              type="button"
              className={`previous-day-label-toggle ${previousDayLabelsEnabled ? 'active' : ''}`}
              aria-label={previousDayLabelsEnabled ? 'Hide previous day labels' : 'Show previous day labels'}
              aria-pressed={previousDayLabelsEnabled}
              onClick={() => setPreviousDayLabelsEnabled((enabled) => !enabled)}
            >PD</button>
          </div>}
          <div className="instrument-row">
            <div className="instrument-name"><span className="instrument-symbol">{symbol || 'SYMBOL'}</span><span className="instrument-market">SPOT GOLD · MT5</span></div>
            <div className="instrument-price"><strong>{lastBar ? lastBar.close.toFixed(2) : '—'}</strong><span className={change >= 0 ? 'positive' : 'negative'}>{bars.length ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : 'NO QUOTE'}</span></div>
          </div>
          <div className="chart-toolbar">
            <div className="chart-toolbar-controls">
              <div className="timeframe-control" aria-label="Chart timeframe">{timeframes.map((item) => (
                <button key={item} type="button" className={timeframe === item ? 'active' : ''} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>{item}</button>
              ))}</div>
              <div className="chart-type-control" role="group" aria-label="Chart type">
                <button type="button" className={chartType === 'candles' ? 'active' : ''} aria-pressed={chartType === 'candles'} onClick={() => setChartType('candles')}>Candle</button>
                <button type="button" className={chartType === 'line' ? 'active' : ''} aria-pressed={chartType === 'line'} onClick={() => setChartType('line')}>Line</button>
              </div>
            </div>
            <div className="chart-actions"><span className="bars-count">{bars.length.toLocaleString()} bars</span><div className="chart-layout-control" role="group" aria-label="Number of charts">{([1, 2, 4] as ChartLayout[]).map((count) => <button key={count} type="button" className={chartLayout === count ? 'active' : ''} aria-pressed={chartLayout === count} aria-label={`${count} chart${count > 1 ? 's' : ''}`} onClick={() => setChartLayout(count)}>{count}×</button>)}</div><button className={`footprint-toggle ${footprintVisible ? 'active' : ''}`} type="button" aria-pressed={footprintVisible} title={footprintVisible ? 'Turn estimated footprint off' : 'Turn estimated footprint on'} onClick={() => setFootprintVisible((visible) => !visible)}>Footprint {footprintVisible ? 'ON' : 'OFF'}</button><button className="icon-button" type="button" title="Reload MT5 history" aria-label="Reload MT5 history" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={15} /></button><button className={`icon-button ${panMode ? 'pan-active' : ''}`} type="button" title={panMode ? 'Disable chart pan' : 'Pan chart'} aria-label={panMode ? 'Disable chart pan' : 'Pan chart'} aria-pressed={panMode} onClick={() => { setProfileRangeMode(false); setDrawingTool(null); setPanMode((enabled) => !enabled) }}><Hand size={15} /></button><button className={`icon-button ${profileRangeMode ? 'pan-active' : ''}`} type="button" title="Drag across candles to choose profile range" aria-label={profileRangeMode ? 'Cancel profile range selection' : 'Select profile range'} aria-pressed={profileRangeMode} onClick={() => { setProfileEnabled(true); setPanMode(false); setDrawingTool(null); setProfileRangeMode((enabled) => !enabled) }}><ScanLine size={15} /></button>{profileRange && <button className="icon-button" type="button" title="Clear selected profile range" aria-label="Clear selected profile range" onClick={() => setProfileRange(null)}><X size={15} /></button>}<button className="icon-button" type="button" title={chartFullscreen ? 'Exit fullscreen chart' : 'Expand chart fullscreen'} aria-label={chartFullscreen ? 'Exit fullscreen chart' : 'Expand chart fullscreen'} onClick={toggleChartFullscreen}>{chartFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div>
          </div>
          <div
            className={`drawing-toolbar${chartFullscreen ? ` fullscreen-toolkit${toolkitExpanded ? '' : ' toolkit-collapsed'}` : ''}`}
            style={chartFullscreen ? { left: `${toolkitPosition.x}px`, top: `${toolkitPosition.y}px` } : undefined}
            aria-label="Chart drawing tools"
          >
            {chartFullscreen && <div className="toolkit-heading">
              <button
                className="toolkit-drag-handle"
                type="button"
                aria-label="Drag to move chart tools"
                title="Drag to move chart tools"
                onPointerDown={beginToolkitDrag}
                onPointerMove={moveToolkit}
                onPointerUp={endToolkitDrag}
                onPointerCancel={endToolkitDrag}
              ><Grip size={15} /></button>
              <button
                className="toolkit-toggle"
                type="button"
                aria-expanded={toolkitExpanded}
                onClick={() => setToolkitExpanded((expanded) => !expanded)}
              >TOOLS {toolkitExpanded ? '−' : '+'}</button>
            </div>}
            <div className="drawing-tool-items">
              <button className={`icon-button ${drawingTool === 'horizontal' ? 'pan-active' : ''}`} type="button" title="Draw horizontal price line" aria-label="Draw horizontal line" aria-pressed={drawingTool === 'horizontal'} onClick={() => chooseDrawingTool('horizontal')}><Minus size={15} /></button>
              <button className={`icon-button ${drawingTool === 'vertical' ? 'pan-active' : ''}`} type="button" title="Draw vertical time line" aria-label="Draw vertical line" aria-pressed={drawingTool === 'vertical'} onClick={() => chooseDrawingTool('vertical')}><MoveVertical size={15} /></button>
              <button className={`icon-button ${drawingTool === 'trend' ? 'pan-active' : ''}`} type="button" title="Drag to draw trend line" aria-label="Draw trend line" aria-pressed={drawingTool === 'trend'} onClick={() => chooseDrawingTool('trend')}><TrendingUp size={15} /></button>
              <button className={`icon-button ${drawingTool === 'measure' ? 'pan-active' : ''}`} type="button" title="Drag to measure range in pips" aria-label="Measure range in pips" aria-pressed={drawingTool === 'measure'} onClick={() => chooseDrawingTool('measure')}><Ruler size={15} /></button>
              <button className={`icon-button fib-tool-button ${drawingTool === 'fibonacci' ? 'pan-active' : ''}`} type="button" title="Drag to draw Fibonacci retracement" aria-label="Draw Fibonacci retracement" aria-pressed={drawingTool === 'fibonacci'} onClick={() => chooseDrawingTool('fibonacci')}>Fib</button>
              {(drawingTool === 'measure' || drawings.some((drawing) => drawing.kind === 'measure')) && <label className="pip-size-control">PIP <input aria-label="Pip size" type="number" min="0.000001" step="0.01" value={pipSize} onChange={(event) => setPipSize(Math.max(0.000001, Number(event.target.value) || 0.000001))} /></label>}
              {drawings.length > 0 && <button className="icon-button" type="button" title="Clear chart drawings" aria-label="Clear chart drawings" onClick={() => { setDrawings([]); setSelectedDrawingId(null) }}><Trash2 size={14} /></button>}
            </div>
          </div>
          <div className="annotation-editor" aria-label="Selected drawing settings">
            {selectedDrawing && <>
              <span className="annotation-kind">{selectedDrawing.kind.toUpperCase()}</span>
              <label className="annotation-color" title="Drawing color"><input aria-label="Drawing color" type="color" value={selectedDrawing.color} onChange={(event) => updateDrawing(selectedDrawing.id, { color: event.target.value })} /></label>
              <input className="annotation-note" aria-label="Drawing comment" placeholder="Add a comment" maxLength={80} value={selectedDrawing.note} onChange={(event) => updateDrawing(selectedDrawing.id, { note: event.target.value })} />
              <button className="icon-button" type="button" title="Delete selected drawing" aria-label="Delete selected drawing" onClick={() => deleteDrawing(selectedDrawing.id)}><Trash2 size={14} /></button>
            </>}
            {drawings.length > 0 && <button className="reset-drawings" type="button" onClick={resetDrawings}><X size={13} /> Reset all</button>}
          </div>
          <div className="replay-toolbar">
            <div className="replay-controls">
              <button className="icon-button" type="button" title="Go to first bar" aria-label="Go to first replay bar" disabled={!bars.length} onClick={() => setReplayCursor(0)}><Rewind size={14} /></button>
              <button className="icon-button" type="button" title="Step back one bar" aria-label="Step back one bar" disabled={!bars.length} onClick={() => stepReplay(-1)}><span className="step-back">|‹</span></button>
              <button className="icon-button replay-play" type="button" title={replayPlaying ? 'Pause replay' : 'Play replay'} aria-label={replayPlaying ? 'Pause replay' : 'Play replay'} disabled={!bars.length} onClick={() => replayPlaying ? setReplayPlaying(false) : startReplay()}>
                {replayPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
              </button>
              <button className="icon-button" type="button" title="Step forward one bar" aria-label="Step forward one bar" disabled={!bars.length} onClick={() => stepReplay(1)}><FastForward size={14} /></button>
              <select aria-label="Replay speed" value={replaySpeed} onChange={(event) => setReplaySpeed(Number(event.target.value))}>
                {[1, 2, 5, 10].map((speed) => <option key={speed} value={speed}>{speed}x</option>)}
              </select>
            </div>
            <input
              aria-label="Replay position"
              className="replay-scrubber"
              type="range"
              min="0"
              max={Math.max(0, bars.length - 1)}
              value={bars.length ? Math.min(replayIndex ?? bars.length - 1, bars.length - 1) : 0}
              disabled={!bars.length}
              onChange={(event) => setReplayCursor(Number(event.target.value))}
            />
            <div className="replay-meta">
              <span>{visibleBars.length ? formatLankaTime(visibleBars[visibleBars.length - 1].time) : 'No bars loaded'}</span>
              <button className={`auto-update ${pollingActive ? 'enabled' : ''}`} type="button" aria-pressed={autoUpdate} title={replayIndex !== null ? 'Automatic updates resume when you go live' : 'Toggle automatic market updates'} onClick={() => setAutoUpdate((enabled) => !enabled)}>
                <Radio size={13} />{updateLabel}
              </button>
              <span className="update-stamp">{lastUpdated ? `Updated ${formatLankaTime(lastUpdated)}` : 'Waiting for data'}</span>
              {replayIndex !== null && <button className="go-live" type="button" onClick={goLive}>Go live</button>}
            </div>
          </div>
          <div className="chart-legend">
            <span className="legend-candle"><i /> O<span>{lastBar?.open.toFixed(2) ?? '—'}</span> H<span>{lastBar?.high.toFixed(2) ?? '—'}</span> L<span>{lastBar?.low.toFixed(2) ?? '—'}</span> C<span>{lastBar?.close.toFixed(2) ?? '—'}</span></span>
            <span className="legend-profile"><i /> PROFILE / POC</span><span className="legend-liquidity">VAH / VAL</span><span className="legend-liquidity">LIQUIDITY</span><span className="profile-range-readout">{profileRange ? `${formatLankaTime(profileRange.from)} — ${formatLankaTime(profileRange.to)}` : profileEnabled ? (profileDuration === 'day' ? 'DAY PROFILE' : `${profileDuration.toUpperCase()} PROFILE`) : 'PROFILE OFF'}</span><span className="profile-controls"><button type="button" className={`profile-toggle ${profileEnabled ? 'active' : ''}`} aria-pressed={profileEnabled} onClick={() => { setProfileEnabled((enabled) => !enabled); setProfileRangeMode(false) }}>{profileEnabled ? 'ON' : 'OFF'}</button><select aria-label="Volume profile layout" disabled={!profileEnabled} value={profileLayout} onChange={(event) => { setProfileLayout(event.target.value as ProfileLayout); setProfileRange(null) }}><option value="rail">RAIL</option><option value="split">SPLIT</option></select><select aria-label="Volume profile duration" disabled={!profileEnabled} value={profileDuration} onChange={(event) => { setProfileDuration(event.target.value as ProfileDuration); setProfileRange(null) }}>{(['3h', '4h', '5h', '6h', '7h', '8h', 'day'] as ProfileDuration[]).map((duration) => <option key={duration} value={duration}>{duration === 'day' ? 'DAY' : duration.toUpperCase()}</option>)}</select></span><span className="legend-volume">TICK VOLUME</span>
          </div>
          <div className="ema-controls" role="group" aria-label="EMA indicators">
            <span className="ema-controls-label">EMA</span>
            {emaPeriods.map((period) => (
              <button
                key={period}
                type="button"
                className={`ema-toggle ${emaEnabled[period] ? 'active' : ''}`}
                style={{ color: emaEnabled[period] ? emaColors[period] : undefined }}
                aria-pressed={emaEnabled[period]}
                aria-label={`Toggle EMA ${period}`}
                onClick={() => setEmaEnabled((current) => ({ ...current, [period]: !current[period] }))}
              >
                {period}
              </button>
            ))}
            <span className="ema-controls-label vwap-label">VWAP</span>
            <button
              type="button"
              className={`ema-toggle vwap-toggle ${vwapEnabled ? 'active' : ''}`}
              style={{ color: vwapEnabled ? '#facc15' : undefined }}
              aria-label="Toggle VWAP and plus/minus two standard deviation bands"
              aria-pressed={vwapEnabled}
              onClick={() => setVwapEnabled((enabled) => !enabled)}
            >{vwapEnabled ? 'ON ±2σ' : 'OFF'}</button>
            <span className="ema-controls-label supertrend-label">SUPER TREND</span>
            <button
              type="button"
              className={`ema-toggle supertrend-toggle ${superTrendEnabled ? 'active' : ''}`}
              aria-pressed={superTrendEnabled}
              onClick={() => setSuperTrendEnabled((enabled) => !enabled)}
            >{superTrendEnabled ? 'ON' : 'OFF'}</button>
            <label className="supertrend-setting">ATR
              <input aria-label="SuperTrend ATR length" type="number" min="1" max="100" value={superTrendAtrLength} onChange={(event) => setSuperTrendAtrLength(Math.max(1, Math.min(100, Number(event.target.value) || 14)))} />
            </label>
            <label className="supertrend-setting">FACTOR
              <input aria-label="SuperTrend factor" type="number" min="0.1" max="10" step="0.1" value={superTrendFactor} onChange={(event) => setSuperTrendFactor(Math.max(0.1, Math.min(10, Number(event.target.value) || 3)))} />
            </label>
            <span className="ema-controls-label rsi-controls-label">RSI</span>
            <button
              type="button"
              className={`ema-toggle rsi-toggle ${rsiEnabled ? 'active' : ''}`}
              aria-pressed={rsiEnabled}
              onClick={() => setRsiEnabled((enabled) => !enabled)}
            >{rsiEnabled ? 'ON' : 'OFF'}</button>
            <label className="supertrend-setting">PERIOD
              <input aria-label="RSI period" type="number" min="2" max="100" value={rsiPeriod} onChange={(event) => setRsiPeriod(Math.max(2, Math.min(100, Number(event.target.value) || 14)))} />
            </label>
            <span className="ema-controls-label sessions-label">SESSIONS</span>
            <button
              type="button"
              className={`ema-toggle sessions-toggle ${sessionOverlaysEnabled ? 'active' : ''}`}
              style={{ color: sessionOverlaysEnabled ? '#38bdf8' : undefined }}
              aria-label="Toggle Asia, London, New York, IB ranges and 10:30 open line"
              aria-pressed={sessionOverlaysEnabled}
              onClick={() => setSessionOverlaysEnabled((enabled) => !enabled)}
            >{sessionOverlaysEnabled ? 'ON' : 'OFF'}</button>
            <span className="ema-controls-label previous-day-label-title">PD LABELS</span>
            <button
              type="button"
              className={`ema-toggle previous-day-label-toggle ${previousDayLabelsEnabled ? 'active' : ''}`}
              style={{ color: previousDayLabelsEnabled ? '#c2d0ff' : undefined }}
              aria-label={previousDayLabelsEnabled ? 'Hide previous day labels' : 'Show previous day labels'}
              aria-pressed={previousDayLabelsEnabled}
              onClick={() => setPreviousDayLabelsEnabled((enabled) => !enabled)}
            >{previousDayLabelsEnabled ? 'ON' : 'OFF'}</button>
          </div>
          <div className="chart-board" data-layout={chartLayout}>
            <ChartTile
              id="chart1"
              width={chartTileSizes.chart1?.width ?? (chartLayout === 1 ? '100%' : 'calc(50% - 5px)')}
              height={chartTileSizes.chart1?.height ?? 490}
              onResize={resizeChartTile}
            >
              <div className={`chart-wrap${footprintVisible ? '' : ' footprint-hidden'}`}>
                <div className="primary-chart-pane">
                  <div className={`price-chart-area${rsiEnabled ? ' with-rsi' : ''}`}>
                    <div
                      ref={chartNode}
                      className={`chart-canvas ${panMode ? 'pan-mode' : ''} ${profileRangeMode ? 'profile-range-mode' : ''} ${drawingTool ? 'drawing-tool-mode' : ''}`}
                      onPointerDown={beginChartPan}
                      onPointerMove={moveChartPan}
                      onPointerUp={endChartPan}
                      onPointerCancel={endChartPan}
                    />
                    <canvas ref={superTrendCanvasRef} className="supertrend-overlay" aria-hidden="true" />
                    <canvas ref={profileCanvasRef} className="profile-overlay" aria-hidden="true" />
                    {sessionOverlaysEnabled && <canvas ref={sessionCanvasRef} className="session-overlay" aria-hidden="true" />}
                    <canvas ref={drawingCanvasRef} className="annotation-overlay" aria-hidden="true" />
                    {rsiEnabled && <canvas ref={rsiDivergenceCanvasRef} className="rsi-divergence-overlay" aria-hidden="true" />}
                    {(loadingBars || !bars.length) && <div className="chart-state">
                      {loadingBars ? <LoaderCircle className="spin" size={22} /> : error ? <CircleAlert size={23} /> : <Activity size={23} />}
                      <strong>{loadingBars ? 'Loading market history' : status === 'offline' ? 'Waiting for MT5 connection' : 'No bars for this range'}</strong>
                      <span>{loadingBars ? 'Requesting M1 rates and building chart interval.' : error || 'Choose a wider date range.'}</span>
                    </div>}
                  </div>
                  {rsiEnabled && <div className="rsi-pane" aria-label={`RSI ${rsiPeriod} indicator`}>
                    <span className="rsi-pane-label">RSI {rsiPeriod}</span>
                    <canvas ref={rsiCanvasRef} className="rsi-canvas" aria-hidden="true" />
                  </div>}
                </div>
                {footprintVisible && <div className="footprint-pane">
                  <div className="footprint-title"><strong>FOOTPRINT · ESTIMATED</strong><span>BUY | SELL</span></div>
                  <canvas ref={footprintCanvasRef} className="footprint-canvas" aria-label="Estimated tick-volume footprint chart" />
                  <div className="footprint-disclaimer">Tick-volume estimate · not bid/ask order flow</div>
                </div>}
              </div>
            </ChartTile>
            {chartLayout >= 2 && ['chart2', ...(chartLayout === 4 ? ['chart3', 'chart4'] : [])].map((id) => (
              <AuxiliaryChart
                key={id}
                id={id}
                symbol={symbol}
                timeframe={auxiliaryTimeframes[id]}
                onTimeframeChange={(nextTimeframe) => setAuxiliaryTimeframes((current) => ({ ...current, [id]: nextTimeframe }))}
                startDate={startDate}
                endDate={endDate}
                reloadKey={reloadKey}
                autoUpdate={pollingActive}
                linkedChartsRef={linkedChartsRef}
                crosshairSyncRef={crosshairSyncRef}
                superTrendEnabled={superTrendEnabled}
                superTrendAtrLength={superTrendAtrLength}
                superTrendFactor={superTrendFactor}
                width={chartTileSizes[id]?.width ?? 'calc(50% - 5px)'}
                height={chartTileSizes[id]?.height ?? 490}
                onResize={resizeChartTile}
              />
            ))}
          </div>
          <div className="chart-footer"><span><i className="dot-live" /> {timeframe.toUpperCase()} <b>·</b> {bars.length ? `${formatLankaDate(bars[0].time)} — ${formatLankaDate(bars[bars.length - 1].time)}` : 'HISTORY WINDOW'}</span><span>UTC+05:30 · MT5 TICK VOLUME</span></div>
          </section>

          <section className="live-signals-section" aria-live="polite">
            <div className="live-signals-heading">
              <div><span className="eyebrow">LIVE MONITOR</span><h2>Strategy signals</h2></div>
              <div className="signal-display-controls" role="group" aria-label="Show signal directions">
                <button
                  className={`signal-master-toggle ${signalsEnabled ? 'active' : ''}`}
                  type="button"
                  aria-pressed={signalsEnabled}
                  onClick={() => setSignalsEnabled((enabled) => !enabled)}
                >
                  SIGNALS {signalsEnabled ? 'ON' : 'OFF'}
                </button>
                <button className={`signal-filter buy ${signalDirections.buy ? 'active' : ''}`} type="button" aria-pressed={signalDirections.buy} onClick={() => setSignalDirections((current) => ({ ...current, buy: !current.buy }))}>BUY</button>
                <button className={`signal-filter sell ${signalDirections.sell ? 'active' : ''}`} type="button" aria-pressed={signalDirections.sell} onClick={() => setSignalDirections((current) => ({ ...current, sell: !current.sell }))}>SELL</button>
                <span className={`live-monitor-state ${pollingActive ? 'active' : ''}`}>{!signalsEnabled ? 'SIGNALS OFF' : pollingActive ? 'LIVE · 5s CHECK' : 'PAUSED'}</span>
              </div>
            </div>
            {signalsEnabled && watchSignals.some((signal) => signalDirections[signal.direction]) && <div className="live-signal-list live-watch-list">
              {watchSignals.filter((signal) => signalDirections[signal.direction]).slice(-6).reverse().map((signal) => (
                <div className="live-signal-row live-watch-row" key={`watch-${signal.direction}-${signal.entry_time}-${signal.setup}`}>
                  <span className={`trade-side ${signal.direction}`}>{signal.direction.toUpperCase()} WATCH</span>
                  <strong title={signal.signal_strength}>👀 WATCH · Waiting for OB retest · {signal.setup}</strong>
                  <span title={`${signal.key_source ?? ''} · Entry only after the OB boundary retest confirms`}>{signal.session_name ?? signal.key_source ?? 'Confirmed setup'}</span>
                  <span>Updated {formatLankaTime(signal.watch_time ?? signal.entry_time)}</span>
                  <b>OB {signal.entry.toFixed(2)}</b>
                </div>
              ))}
            </div>}
            {!signalsEnabled ? <div className="live-signals-empty">Signal detection and chart markers are off. Turn SIGNALS ON to monitor.</div> : liveSignals.some((signal) => signalDirections[signal.direction]) ? <div className="live-signal-list">
              {liveSignals.filter((signal) => signalDirections[signal.direction]).slice(-6).reverse().map((signal) => (
                <div className="live-signal-row" key={`${signal.entry_time}-${signal.setup}`}>
                  <span className={`trade-side ${signal.direction}`}>{signal.direction.toUpperCase()}</span>
                  <strong title={signal.signal_strength}>{signal.strength_emoji ?? ''} {signal.strength_label ?? 'UNRATED'} {signal.strength_score === undefined ? '' : `${signal.strength_score}/${signal.strength_score_max}`} · {signal.setup}</strong>
                  <span title={`${signal.key_source ?? ''}${signal.session_liquidity_swept ? ` · ${signal.session_sweep_name} ${signal.session_sweep_reference} ${signal.session_sweep_level_type} swept at ${signal.session_sweep_level}` : ''}${typeof signal.session_profile_poc === 'number' ? ` · VP POC ${signal.session_profile_poc.toFixed(2)} VAH ${signal.session_profile_vah?.toFixed(2)} VAL ${signal.session_profile_val?.toFixed(2)}` : ''}${signal.session_profile_confirmed ? ` · ${signal.session_profile_level} +${signal.session_profile_volume_ratio?.toFixed(1)}x volume` : ''}`}>{`${formatSignalLevels(signal, htfTimeframe)}${signal.retest_confirmed ? ' · RETEST' : ''}${signal.session_name ? ` · ${signal.session_name}` : ''}${signal.session_liquidity_swept ? ' · SWEEP' : ''}${signal.session_profile_confirmed ? ` · VP ${signal.session_profile_level}` : ''}`}</span>
                  <span>{formatLankaTime(signal.entry_time)}</span>
                  <b>{signal.entry.toFixed(2)}</b>
                </div>
              ))}
            </div> : <div className="live-signals-empty">{pollingActive ? 'Waiting for a confirmed sweep and entry setup.' : 'Go live and enable AUTO to monitor new signals.'}</div>}
            <div className="signal-history-heading">
              <div><span className="eyebrow">SAVED LOCALLY</span><h3>Previous signals <b>{displayedArchivedSignals.length}</b></h3></div>
              {displayedArchivedSignals.length > 0 && <button className="clear-signal-history" type="button" onClick={() => setSignalHistory((current) => current.filter((signal) => (
                signal.symbol !== symbol.trim().toUpperCase() || signal.htf_timeframe !== htfTimeframe
              )))}>Clear history</button>}
            </div>
            {displayedArchivedSignals.length ? <div className="signal-history-list">
              <div className="signal-history-row signal-history-columns">
                <span>Side</span><span>Setup</span><span>Liquidity level</span><span>Price</span><span>Signal time</span>
              </div>
              {displayedArchivedSignals.map((signal) => (
                <div className="signal-history-row" key={`${signal.symbol}-${signal.htf_timeframe}-${signal.direction}-${signal.entry_time}-${signal.setup}`}>
                  <span className={`trade-side ${signal.direction}`}>{signal.direction.toUpperCase()}</span>
                  <strong>{signal.strength_emoji ?? ''} {signal.strength_label ?? 'UNRATED'} {signal.strength_score === undefined ? '' : `${signal.strength_score}/${signal.strength_score_max}`} · {signal.setup ?? '—'}</strong>
                  <span title={`${signal.signal_strength ?? ''}${signal.session_liquidity_swept ? ` · ${signal.session_sweep_name} ${signal.session_sweep_reference} ${signal.session_sweep_level_type} swept at ${signal.session_sweep_level}` : ''}${typeof signal.session_profile_poc === 'number' ? ` · VP POC ${signal.session_profile_poc.toFixed(2)} VAH ${signal.session_profile_vah?.toFixed(2)} VAL ${signal.session_profile_val?.toFixed(2)}` : ''}${signal.session_profile_confirmed ? ` · ${signal.session_profile_level} +${signal.session_profile_volume_ratio?.toFixed(1)}x volume` : ''}`}>{`${formatSignalLevels(signal, htfTimeframe)}${signal.retest_confirmed ? ' · RETEST' : ''}${signal.session_name ? ` · ${signal.session_name}` : ''}${signal.session_liquidity_swept ? ' · SWEEP' : ''}${signal.session_profile_confirmed ? ` · VP ${signal.session_profile_level}` : ''}`}</span>
                  <b>{signal.entry.toFixed(2)}</b>
                  <span>{formatLankaTime(signal.entry_time)}</span>
                </div>
              ))}
            </div> : <div className="signal-history-empty">Previous signals from this symbol and strategy will be saved here.</div>}
          </section>

          <section className="results-section">
            <div className="results-heading"><div><span className="eyebrow">PERFORMANCE</span><h2>Backtest results</h2></div><button className="export-button" type="button" onClick={exportTrades} disabled={!trades.length}><Download size={14} /> Export CSV</button></div>
            {summary ? <>
              <div className="target-results-grid" role="group" aria-label="Backtest results by risk-reward target">
                {strategyResults?.map((result) => (
                  <button key={result.target_r} className={`target-result ${selectedTargetR === result.target_r ? 'selected' : ''}`} type="button" aria-pressed={selectedTargetR === result.target_r} onClick={() => selectTarget(result.target_r)}>
                    <span>{result.target_r}R TARGET</span>
                    <strong className={result.summary.net_r >= 0 ? 'positive' : 'negative'}>{result.summary.net_r >= 0 ? '+' : ''}{result.summary.net_r.toFixed(1)}R</strong>
                    <small>{result.summary.win_rate.toFixed(0)}% wins · {result.summary.trades} trades</small>
                  </button>
                ))}
              </div>
              <div className="metric-grid">
                <div className="metric"><span>NET RESULT</span><strong className={summary.net_r >= 0 ? 'positive' : 'negative'}>{summary.net_r >= 0 ? '+' : ''}{summary.net_r.toFixed(2)}R</strong></div>
                <div className="metric"><span>WIN RATE</span><strong>{summary.win_rate.toFixed(1)}<small>%</small></strong></div>
                <div className="metric"><span>TRADES</span><strong>{summary.trades}<small> / {summary.bars} bars</small></strong></div>
                <div className="metric"><span>MAX DRAWDOWN</span><strong className="negative">{summary.max_drawdown_r.toFixed(2)}<small>R</small></strong></div>
                <div className="metric"><span>PROFIT FACTOR</span><strong>{summary.profit_factor === null ? '—' : summary.profit_factor.toFixed(2)}</strong></div>
              </div>
              {summary.net_r <= 0 && <div className="backtest-warning">This target was not profitable over the selected historical sample. Treat the setup as unvalidated; results do not guarantee future performance.</div>}
              <div className="session-performance">
                <div className="trades-heading"><span>SESSION PERFORMANCE · {selectedTargetR}R</span><span>Signals may count in both overlapping sessions</span></div>
                <div className="session-results-grid">
                  {sessionResults.filter((item) => item.target_r === selectedTargetR).map((item) => (
                    <div className="session-result" key={`${item.target_r}-${item.session}`}>
                      <strong>{item.session}</strong>
                      <span className={item.summary.net_r >= 0 ? 'positive' : 'negative'}>{item.summary.net_r >= 0 ? '+' : ''}{item.summary.net_r.toFixed(1)}R</span>
                      <small>{item.summary.win_rate.toFixed(0)}% wins · {item.summary.trades} trades</small>
                    </div>
                  ))}
                  {!sessionResults.some((item) => item.target_r === selectedTargetR) && <div className="session-results-empty">No qualifying session trades in this period.</div>}
                </div>
              </div>
              <div className="trades-heading"><span>{selectedTargetR}R TRADE LOG <b>{trades.length}</b></span><span>STOP-FIRST INTRABAR MODEL</span></div>
              {trades.length ? <div className="trade-table-wrap"><table>
                <thead><tr><th>Side</th><th>Setup</th><th>Key level</th><th>Entry time</th><th>Entry</th><th>Stop</th><th>Target</th><th>Exit</th><th>Result</th></tr></thead>
                <tbody>{trades.map((trade, index) => <tr key={`${trade.entry_time}-${index}`}>
                  <td><span className={`trade-side ${trade.direction}`}>{trade.direction.toUpperCase()}</span></td>
                  <td>{trade.setup ?? '—'}</td><td>{trade.key_source ?? '—'}</td>
                  <td>{formatLankaTime(trade.entry_time)}</td><td>{trade.entry.toFixed(2)}</td><td>{trade.stop.toFixed(2)}</td><td>{trade.target.toFixed(2)}</td><td>{trade.exit_price.toFixed(2)}</td>
                  <td className={trade.result_r >= 0 ? 'positive' : 'negative'}>{trade.result_r >= 0 ? '+' : ''}{trade.result_r.toFixed(2)}R</td>
                </tr>)}</tbody>
              </table></div> : <div className="empty-trades">No qualifying M5 sweep and BOS entries in this period.</div>}
            </> : <div className="results-empty"><span className="empty-symbol"><Settings2 size={17} /></span><div><strong>Ready when you are</strong><span>Choose a history window and run the strategy against the loaded MT5 bars.</span></div></div>}
          </section>
          {error && bars.length > 0 && <div className="inline-error"><CircleAlert size={14} />{error}</div>}
          <div className="disclaimer">Research tool only · Historical simulation is not a guarantee of future results · No orders are sent to MT5</div>
        </section>
      </main>
    </div>
  )
}

export default App
