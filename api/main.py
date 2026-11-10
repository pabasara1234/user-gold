import datetime as dt
import os
import re
import sys
from pathlib import Path

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials, db as firebase_db
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine import (
    aggregate_rates,
    generate_sweep_bos_signals,
    run_sweep_bos_backtest,
)

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None


MT5_PATH = os.getenv("MT5_PATH", r"C:\Program Files\MetaTrader 5\terminal64.exe")
MT5_SERVER_UTC_OFFSET_HOURS = float(os.getenv("MT5_SERVER_UTC_OFFSET_HOURS", "2"))
MT5_SERVER_UTC_OFFSET_SECONDS = round(MT5_SERVER_UTC_OFFSET_HOURS * 3600)
MAX_HISTORY_CHUNK_SECONDS = 30 * 24 * 60 * 60
TIMEFRAMES = {
    "1m": 1, "5m": 5, "15m": 15, "30m": 30, "39m": 39,
    "1h": 60, "4h": 240, "5h": 300, "6h": 360, "7h": 420, "8h": 480,
}
STRATEGY_TIMEFRAMES = {
    "5m": ("5m", 5, 0),
}
connected = False
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "").strip()
FIREBASE_PROFILES_DATABASE_URL = os.getenv("FIREBASE_PROFILES_DATABASE_URL", "").strip()
FIREBASE_ADMIN_UIDS = {
    uid.strip()
    for uid in os.getenv("FIREBASE_ADMIN_UIDS", "").split(",")
    if uid.strip()
}
MYVIEW_REQUIRE_AUTH = os.getenv("MYVIEW_REQUIRE_AUTH", "false").lower() == "true"
MYVIEW_ALLOW_LOCAL_ACCESS = os.getenv("MYVIEW_ALLOW_LOCAL_ACCESS", "false").lower() == "true"
MYVIEW_CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("MYVIEW_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
firebase_app = None
SIGNAL_SYMBOL_PATTERN = re.compile(r"^[A-Z0-9._-]{2,20}$")


class SignalPublishRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    signals: list[dict] = Field(default_factory=list)


class MarketPublishRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)


app = FastAPI(title="MyView MT5 Market Data", version="1.0.0")
FRONTEND_DIST = (
    Path(sys._MEIPASS) / "dist"
    if getattr(sys, "frozen", False)
    else Path(__file__).resolve().parent.parent / "dist"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", *MYVIEW_CORS_ORIGINS],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def get_firebase_app():
    global firebase_app
    if firebase_app is not None:
        return firebase_app
    if not FIREBASE_PROJECT_ID or not FIREBASE_PROFILES_DATABASE_URL:
        return None
    try:
        firebase_app = firebase_admin.get_app("myview-api")
    except ValueError:
        firebase_app = firebase_admin.initialize_app(
            credentials.ApplicationDefault(),
            {
                "projectId": FIREBASE_PROJECT_ID,
                "databaseURL": FIREBASE_PROFILES_DATABASE_URL,
            },
            name="myview-api",
        )
    return firebase_app


def get_signals_firebase_app():
    app = get_firebase_app()
    if app is None:
        raise HTTPException(status_code=503, detail="Firebase project is not configured")
    return app


def verify_firebase_uid(request: Request) -> str:
    if not FIREBASE_PROJECT_ID:
        raise HTTPException(status_code=503, detail="Firebase API authentication is not configured")

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="A Firebase sign-in is required")

    try:
        admin_app = get_firebase_app()
        if admin_app is None:
            raise ValueError("Firebase API authentication is not configured")
        claims = firebase_auth.verify_id_token(token, app=admin_app, check_revoked=True)
        uid = str(claims["uid"])
        request.state.firebase_uid = uid
        return uid
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=401, detail="Firebase sign-in could not be verified") from error


def require_market_access(request: Request) -> None:
    client_host = request.client.host if request.client else ""
    if MYVIEW_ALLOW_LOCAL_ACCESS and client_host in {"127.0.0.1", "::1"}:
        return

    if not FIREBASE_PROJECT_ID:
        if MYVIEW_REQUIRE_AUTH:
            raise HTTPException(status_code=503, detail="Firebase API authentication is not configured")
        return

    uid = verify_firebase_uid(request)
    if uid not in FIREBASE_ADMIN_UIDS:
        profile = firebase_db.reference(f"users/{uid}", app=get_firebase_app()).get()
        if not isinstance(profile, dict) or profile.get("status") != "approved":
            raise HTTPException(status_code=403, detail="Administrator approval is required")


def require_admin_access(request: Request) -> None:
    require_market_access(request)
    uid = getattr(request.state, "firebase_uid", None) or verify_firebase_uid(request)
    if uid not in FIREBASE_ADMIN_UIDS:
        raise HTTPException(status_code=403, detail="Administrator access is required")


def firebase_symbol_key(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if not SIGNAL_SYMBOL_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="Invalid market symbol")
    return normalized.replace(".", "_dot_")


def ensure_terminal() -> object:
    global connected
    if mt5 is None:
        raise HTTPException(status_code=503, detail="MetaTrader5 Python package is not installed")
    if connected:
        terminal = mt5.terminal_info()
        if terminal is None or not terminal.connected:
            mt5.shutdown()
            connected = False
    if not connected:
        if not mt5.initialize(path=MT5_PATH):
            raise HTTPException(status_code=503, detail=f"MT5 initialize failed: {mt5.last_error()}")
        connected = True
    terminal = mt5.terminal_info()
    if terminal is None or not terminal.connected:
        connected = False
        raise HTTPException(status_code=503, detail="MT5 terminal is not connected to a broker")
    return terminal


def ensure_connection(symbol: str) -> None:
    ensure_terminal()
    if not mt5.symbol_select(symbol, True):
        raise HTTPException(status_code=503, detail=f"MT5 symbol not available: {symbol}")


def aggregate_mt5_rates(rates, minutes: int) -> list[dict]:
    return aggregate_rates(normalize_mt5_rates(rates), minutes)


def normalize_mt5_rates(rates) -> list[dict]:
    return [
        {
            "time": int(rate["time"]) - MT5_SERVER_UTC_OFFSET_SECONDS,
            "open": float(rate["open"]),
            "high": float(rate["high"]),
            "low": float(rate["low"]),
            "close": float(rate["close"]),
            "tick_volume": int(rate["tick_volume"]),
        }
        for rate in rates
    ]


def fetch_bars(symbol: str, timeframe: str, start: int, end: int) -> list[dict]:
    if timeframe not in TIMEFRAMES:
        raise HTTPException(status_code=422, detail="Unsupported timeframe")
    if start >= end:
        raise HTTPException(status_code=422, detail="Start time must be before end time")

    ensure_connection(symbol)
    rates = []
    chunk_start = start
    while chunk_start < end:
        chunk_end = min(chunk_start + MAX_HISTORY_CHUNK_SECONDS, end)
        chunk_rates = mt5.copy_rates_range(
            symbol,
            mt5.TIMEFRAME_M1,
            dt.datetime.fromtimestamp(chunk_start, dt.timezone.utc),
            dt.datetime.fromtimestamp(chunk_end - 1, dt.timezone.utc),
        )
        if chunk_rates is None:
            raise HTTPException(
                status_code=502,
                detail=f"MT5 history request failed: {mt5.last_error()}",
            )
        rates.extend(chunk_rates)
        chunk_start = chunk_end

    return aggregate_mt5_rates(rates, TIMEFRAMES[timeframe])


def fetch_native_bars(symbol: str, timeframe: str, start: int, end: int) -> list[dict]:
    mt5_timeframes = {
        "1h": mt5.TIMEFRAME_H1,
        "4h": mt5.TIMEFRAME_H4,
    }
    if timeframe not in mt5_timeframes:
        raise HTTPException(status_code=422, detail="Native strategy timeframe must be 1h or 4h")
    if start >= end:
        raise HTTPException(status_code=422, detail="Start time must be before end time")

    ensure_connection(symbol)
    rates = mt5.copy_rates_range(
        symbol,
        mt5_timeframes[timeframe],
        dt.datetime.fromtimestamp(start, dt.timezone.utc),
        dt.datetime.fromtimestamp(end, dt.timezone.utc),
    )
    if rates is None:
        raise HTTPException(status_code=502, detail=f"MT5 {timeframe} history request failed: {mt5.last_error()}")
    return normalize_mt5_rates(rates)


@app.get("/api/status", dependencies=[Depends(require_market_access)])
def status(symbol: str = "GOLD") -> dict:
    terminal = ensure_terminal()
    return {
        "connected": bool(terminal.connected),
        "symbol": symbol,
        "terminal_path": MT5_PATH,
        "terminal_connected": bool(terminal.connected),
    }


@app.get("/api/history")
def history(
    symbol: str = "GOLD",
    timeframe: str = "5m",
    start: int = Query(..., ge=0),
    end: int = Query(..., ge=0),
    _access: None = Depends(require_market_access),
) -> dict:
    bars = fetch_bars(symbol, timeframe, start, end)
    return {"symbol": symbol, "timeframe": timeframe, "bars": bars}


@app.get("/api/latest", dependencies=[Depends(require_market_access)])
def latest(symbol: str = "GOLD", timeframe: str = "5m") -> dict:
    if timeframe not in TIMEFRAMES:
        raise HTTPException(status_code=422, detail="Unsupported timeframe")
    ensure_connection(symbol)
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, TIMEFRAMES[timeframe] * 2 + 2)
    if rates is None:
        raise HTTPException(status_code=502, detail=f"MT5 latest history request failed: {mt5.last_error()}")

    bars = aggregate_mt5_rates(rates, TIMEFRAMES[timeframe])
    return {"symbol": symbol, "timeframe": timeframe, "bars": bars}


@app.get("/api/backtest")
def backtest(
    symbol: str = "GOLD",
    htf_timeframe: str = "5m",
    start: int = Query(..., ge=0),
    end: int = Query(..., ge=0),
    atr_len: int = Query(14, ge=1, le=100),
    atr_buffer: float = Query(0.1, ge=0, le=10),
    sweep_len: int = Query(8, ge=3, le=100),
    bos_len: int = Query(5, ge=2, le=50),
    confirm_bars: int = Query(5, ge=1, le=50),
    _access: None = Depends(require_market_access),
) -> dict:
    if htf_timeframe not in STRATEGY_TIMEFRAMES:
        raise HTTPException(status_code=422, detail="The sweep + BOS strategy uses 5m candles")
    if start >= end:
        raise HTTPException(status_code=422, detail="Start time must be before end time")

    ltf_timeframe, ltf_minutes, _ = STRATEGY_TIMEFRAMES[htf_timeframe]
    context_start = max(0, start - 14 * 24 * 60 * 60)
    bars = fetch_bars(symbol, ltf_timeframe, context_start, end)
    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    if bars and int(bars[-1]["time"]) + ltf_minutes * 60 > now:
        bars = bars[:-1]
    result = run_sweep_bos_backtest(
        bars,
        atr_len=atr_len,
        atr_buffer=atr_buffer,
        sweep_len=sweep_len,
        bos_len=bos_len,
        confirm_bars=confirm_bars,
        start_time=start,
    )
    selected_bars = sum(start <= int(bar["time"]) < end for bar in bars)
    for target_result in result["results"]:
        target_result["summary"]["bars"] = selected_bars
    for session_result in result["session_results"]:
        session_result["summary"]["bars"] = selected_bars
    return {
        "results": result["results"],
        "session_results": result["session_results"],
        "signals": [
            {key: value for key, value in signal.items() if key != "entry_index"}
            for signal in result["signals"]
        ],
        "key_levels": result["key_levels"],
        "ltf_timeframe": f"{ltf_minutes}m",
        "htf_timeframe": htf_timeframe,
    }


@app.get("/api/signals")
def live_signals(
    symbol: str = "GOLD",
    htf_timeframe: str = "5m",
    atr_len: int = Query(14, ge=1, le=100),
    atr_buffer: float = Query(0.1, ge=0, le=10),
    sweep_len: int = Query(8, ge=3, le=100),
    bos_len: int = Query(5, ge=2, le=50),
    confirm_bars: int = Query(5, ge=1, le=50),
    _access: None = Depends(require_market_access),
) -> dict:
    if htf_timeframe not in STRATEGY_TIMEFRAMES:
        raise HTTPException(status_code=422, detail="The sweep + BOS strategy uses 5m candles")

    ltf_timeframe, ltf_minutes, _ = STRATEGY_TIMEFRAMES[htf_timeframe]
    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    context_bar_count = atr_len + sweep_len + bos_len + confirm_bars + 50
    raw_bar_count = context_bar_count * ltf_minutes
    ensure_connection(symbol)
    rates = mt5.copy_rates_from_pos(
        symbol,
        mt5.TIMEFRAME_M1,
        0,
        raw_bar_count,
    )
    if rates is None:
        raise HTTPException(
            status_code=502,
            detail=f"MT5 live strategy history request failed: {mt5.last_error()}",
        )
    bars = aggregate_mt5_rates(rates, ltf_minutes)
    bars = [
        bar for bar in bars
        if int(bar["time"]) + ltf_minutes * 60 <= now
    ]
    detected_signals, key_levels = generate_sweep_bos_signals(
        bars,
        atr_len=atr_len,
        atr_buffer=atr_buffer,
        sweep_len=sweep_len,
        bos_len=bos_len,
        confirm_bars=confirm_bars,
    )
    signals = [
        {
            **{key: value for key, value in signal.items() if key != "entry_index"},
            "target": (
                signal["entry"] + (signal["entry"] - signal["stop"]) * 2
                if signal["direction"] == "buy"
                else signal["entry"] - (signal["stop"] - signal["entry"]) * 2
            ),
            "exit_time": signal["entry_time"],
            "exit_price": signal["entry"],
            "result_r": 0,
            "outcome": "open",
        }
        for signal in detected_signals
    ]
    return {
        "signals": signals,
        "watch_signals": [],
        "key_levels": key_levels,
        "ltf_timeframe": f"{ltf_minutes}m",
        "htf_timeframe": htf_timeframe,
    }


@app.get("/api/signals/published")
def published_signals(
    symbol: str = "GOLD",
    _access: None = Depends(require_market_access),
) -> dict:
    symbol_key = firebase_symbol_key(symbol)
    signal_app = get_signals_firebase_app()
    stored = firebase_db.reference(f"signals/{symbol_key}", app=signal_app).get()
    signals = list(stored.values()) if isinstance(stored, dict) else []
    signals = [signal for signal in signals if isinstance(signal, dict)]
    signals.sort(key=lambda signal: int(signal.get("entry_time", 0)))
    return {"symbol": symbol.strip().upper(), "signals": signals[-80:]}


@app.post("/api/signals/publish")
def publish_signals(
    payload: SignalPublishRequest,
    _access: None = Depends(require_admin_access),
) -> dict:
    symbol = payload.symbol.strip().upper()
    symbol_key = firebase_symbol_key(symbol)
    signal_app = get_signals_firebase_app()
    signal_ref = firebase_db.reference(f"signals/{symbol_key}", app=signal_app)
    stored = signal_ref.get()
    merged = {
        key: value
        for key, value in stored.items()
        if isinstance(value, dict)
    } if isinstance(stored, dict) else {}

    for signal in payload.signals:
        direction = signal.get("direction")
        entry_time = signal.get("entry_time")
        if direction not in {"buy", "sell"} or isinstance(entry_time, bool) or not isinstance(entry_time, (int, float)):
            continue
        signal_id = f"{int(entry_time)}_{direction}"
        merged[signal_id] = {**signal, "entry_time": int(entry_time), "symbol": symbol}

    recent = sorted(
        merged.items(),
        key=lambda item: int(item[1].get("entry_time", 0)),
    )[-80:]
    signal_ref.set(dict(recent))
    return {"symbol": symbol, "count": len(recent)}


@app.post("/api/market/publish")
def publish_market_data(
    payload: MarketPublishRequest,
    _access: None = Depends(require_admin_access),
) -> dict:
    symbol = payload.symbol.strip().upper()
    symbol_key = firebase_symbol_key(symbol)
    end = int(dt.datetime.now(dt.timezone.utc).timestamp())
    start = end - 7 * 24 * 60 * 60
    bars = fetch_bars(symbol, "5m", start, end)
    if not bars:
        raise HTTPException(status_code=502, detail="MT5 returned no chart history for this symbol")

    candles = {str(int(bar["time"])): bar for bar in bars}
    signal_app = get_signals_firebase_app()
    firebase_db.reference(f"market/{symbol_key}", app=signal_app).set({
        "candles": candles,
        "updatedAt": end,
    })
    return {"symbol": symbol, "count": len(candles), "updatedAt": end}


@app.get("/api/signals/history")
def signal_history(
    symbol: str = "GOLD",
    htf_timeframe: str = "5m",
    start: int = Query(..., ge=0),
    end: int = Query(..., ge=0),
    atr_len: int = Query(14, ge=1, le=100),
    atr_buffer: float = Query(0.1, ge=0, le=10),
    sweep_len: int = Query(8, ge=3, le=100),
    bos_len: int = Query(5, ge=2, le=50),
    confirm_bars: int = Query(5, ge=1, le=50),
    _access: None = Depends(require_market_access),
) -> dict:
    if htf_timeframe not in STRATEGY_TIMEFRAMES:
        raise HTTPException(status_code=422, detail="The sweep + BOS strategy uses 5m candles")
    if start >= end:
        raise HTTPException(status_code=422, detail="Start time must be before end time")

    ltf_timeframe, ltf_minutes, _ = STRATEGY_TIMEFRAMES[htf_timeframe]
    context_start = max(0, start - 14 * 24 * 60 * 60)
    bars = fetch_bars(symbol, ltf_timeframe, context_start, end)
    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    bars = [
        bar for bar in bars
        if int(bar["time"]) + ltf_minutes * 60 <= now
    ]
    detected_signals, _ = generate_sweep_bos_signals(
        bars,
        atr_len=atr_len,
        atr_buffer=atr_buffer,
        sweep_len=sweep_len,
        bos_len=bos_len,
        confirm_bars=confirm_bars,
    )
    return {
        "signals": [
            {key: value for key, value in signal.items() if key != "entry_index"}
            for signal in detected_signals
            if start <= int(signal["entry_time"]) < end
        ],
        "ltf_timeframe": f"{ltf_minutes}m",
        "htf_timeframe": htf_timeframe,
    }


if FRONTEND_DIST.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=str(FRONTEND_DIST), html=True),
        name="frontend",
    )