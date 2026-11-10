import datetime as dt
import hashlib
import ipaddress
import json
import logging
import os
import re
import smtplib
import socket
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlsplit

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials, db as firebase_db
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pywebpush import WebPushException, webpush

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
MARKET_RETENTION_SECONDS = 24 * 60 * 60
MAX_PUBLISHED_SIGNALS = 3
MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10
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
logger = logging.getLogger("myview.notifications")
_notification_config_warnings: set[str] = set()


class SignalPublishRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    signals: list[dict] = Field(default_factory=list)


class MarketPublishRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=512)
    auth: str = Field(min_length=1, max_length=256)


class PushSubscriptionRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=4096)
    keys: PushSubscriptionKeys


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
    allow_methods=["GET", "POST", "DELETE"],
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


def retain_recent_market_candles(
    stored_candles: dict,
    cutoff: int,
    end: int,
) -> dict[str, dict]:
    recent = {}
    for key, bar in stored_candles.items():
        if not isinstance(bar, dict):
            continue
        try:
            timestamp = int(key)
        except (TypeError, ValueError):
            continue
        if cutoff <= timestamp <= end:
            recent[str(timestamp)] = bar
    return recent


def retain_latest_signals(
    stored_signals: dict,
    limit: int = MAX_PUBLISHED_SIGNALS,
    end: int | None = None,
) -> dict:
    valid = [
        (key, signal)
        for key, signal in stored_signals.items()
        if isinstance(signal, dict)
        and isinstance(signal.get("entry_time"), (int, float))
        and not isinstance(signal.get("entry_time"), bool)
        and (end is None or int(signal["entry_time"]) <= end)
    ]
    valid.sort(key=lambda item: int(item[1]["entry_time"]))
    return dict(valid[-limit:])


def _approved_notification_users(signal_app: object) -> dict[str, dict]:
    users = firebase_db.reference("users", app=signal_app).get()
    if not isinstance(users, dict):
        return {}
    return {
        str(uid): profile
        for uid, profile in users.items()
        if isinstance(profile, dict)
        and profile.get("status") == "approved"
        and isinstance(profile.get("email"), str)
        and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", profile["email"].strip())
    }


def _notification_targets(signal_app: object) -> tuple[list[str], dict[str, list[str]]]:
    users = _approved_notification_users(signal_app)
    push_targets = {}
    for uid, profile in users.items():
        subscriptions = profile.get("pushSubscriptions")
        if isinstance(subscriptions, dict):
            ids = [
                str(subscription_id)
                for subscription_id, subscription in subscriptions.items()
                if isinstance(subscription, dict)
                and isinstance(subscription.get("endpoint"), str)
            ]
            if ids:
                push_targets[uid] = ids
    return sorted(users), push_targets


def _new_notification_dispatch(signal_app: object, timestamp: int) -> dict:
    email_recipients, push_recipients = _notification_targets(signal_app)
    if _smtp_configuration() is None:
        email_recipients = []
    return {
        "createdAt": timestamp,
        "emailRecipients": email_recipients,
        "emailSent": {},
        "pushRecipients": push_recipients,
        "pushSent": {},
    }


def _smtp_configuration() -> dict | None:
    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM_EMAIL", "").strip()
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    if not host or not sender or bool(username) != bool(password):
        return None
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
    except ValueError:
        return None
    if not 1 <= port <= 65535:
        return None
    return {
        "host": host,
        "port": port,
        "sender": sender,
        "username": username,
        "password": password,
        "use_ssl": os.getenv("SMTP_USE_SSL", "false").strip().lower() == "true",
    }


def _send_signal_email(recipient: str, symbol: str, signal: dict) -> None:
    settings = _smtp_configuration()
    if settings is None:
        raise RuntimeError("SMTP notification settings are incomplete")

    direction = str(signal["direction"]).upper()
    entry_time = dt.datetime.fromtimestamp(
        int(signal["entry_time"]), dt.timezone.utc
    ).astimezone(dt.timezone(dt.timedelta(hours=5, minutes=30)))
    message = EmailMessage()
    message["Subject"] = f"NextGen Gold {direction} signal: {symbol}"
    message["From"] = settings["sender"]
    message["To"] = recipient
    message.set_content(
        "\n".join((
            f"A new {direction} signal is available on NextGen Gold.",
            "",
            f"Symbol: {symbol}",
            f"Setup: {signal.get('setup') or 'Sweep + BOS'}",
            f"Time (Sri Lanka): {entry_time:%Y-%m-%d %H:%M}",
            f"Entry: {float(signal['entry']):.2f}",
            f"Stop loss: {float(signal['stop']):.2f}",
            f"Open your approved signal desk: {os.getenv('SIGNAL_DESK_URL', 'https://pabasara1234.github.io/user-gold/')}",
            "",
            "Signals are informational and are not financial advice.",
        ))
    )

    context = ssl.create_default_context()
    if settings["use_ssl"]:
        server = smtplib.SMTP_SSL(
            settings["host"], settings["port"], timeout=15, context=context
        )
    else:
        server = smtplib.SMTP(settings["host"], settings["port"], timeout=15)
    with server:
        if not settings["use_ssl"]:
            server.starttls(context=context)
        if settings["username"]:
            server.login(settings["username"], settings["password"])
        server.send_message(message)


def _validate_push_endpoint(endpoint: str) -> None:
    try:
        parsed = urlsplit(endpoint)
        port = parsed.port
    except ValueError as error:
        raise ValueError("Push subscription endpoint is malformed") from error
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        raise ValueError("Push subscription endpoint must be a public HTTPS URL")
    try:
        addresses = {
            ipaddress.ip_address(result[4][0].split("%", 1)[0])
            for result in socket.getaddrinfo(
                parsed.hostname, port or 443, type=socket.SOCK_STREAM
            )
        }
    except (OSError, ValueError) as error:
        raise ValueError("Push subscription host could not be resolved") from error
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Push subscription host must resolve to public IP addresses")


def _send_web_push(subscription: dict, symbol: str, signal: dict) -> None:
    private_key_file = os.getenv("WEB_PUSH_VAPID_PRIVATE_KEY_FILE", "").strip()
    subject = os.getenv("WEB_PUSH_VAPID_SUBJECT", "").strip()
    if not private_key_file or not subject:
        raise RuntimeError("Web Push VAPID settings are incomplete")
    _validate_push_endpoint(str(subscription["endpoint"]))
    if not Path(private_key_file).is_file():
        raise RuntimeError("Web Push VAPID private key file is unavailable")

    payload = {
        "title": f"NextGen Gold · {str(signal['direction']).upper()} {symbol}",
        "body": (
            f"{signal.get('setup') or 'Sweep + BOS'} · "
            f"Entry {float(signal['entry']):.2f} · "
            f"SL {float(signal['stop']):.2f}"
        ),
        "url": "/user-gold/",
        "tag": f"signal-{int(signal['entry_time'])}-{signal['direction']}",
    }
    webpush(
        subscription_info=subscription,
        data=json.dumps(payload),
        vapid_private_key=private_key_file,
        vapid_claims={"sub": subject},
        ttl=300,
    )


def _web_push_configuration_available() -> bool:
    key_file = os.getenv("WEB_PUSH_VAPID_PRIVATE_KEY_FILE", "").strip()
    subject = os.getenv("WEB_PUSH_VAPID_SUBJECT", "").strip()
    return bool(key_file and subject and Path(key_file).is_file())


def _dispatch_signal_notifications(
    signal_app: object,
    symbol: str,
    symbol_key: str,
    signal_id: str,
    signal: dict,
    dispatch: dict,
) -> dict[str, int]:
    result = {"email_sent": 0, "email_failed": 0, "push_sent": 0, "push_failed": 0}
    users = _approved_notification_users(signal_app)
    email_recipients = dispatch.get("emailRecipients", [])
    email_sent = dispatch.get("emailSent", {})
    email_attempted = dispatch.get("emailAttemptedAt", {})
    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    if isinstance(email_recipients, list) and isinstance(email_sent, dict):
        for uid in email_recipients:
            uid = str(uid)
            if email_sent.get(uid) is True:
                continue
            last_attempt = email_attempted.get(uid, 0) if isinstance(email_attempted, dict) else 0
            if isinstance(last_attempt, (int, float)) and now - last_attempt < 300:
                continue
            profile = users.get(uid)
            if not profile:
                firebase_db.reference(
                    f"notificationDispatch/{symbol_key}/{signal_id}/emailSent/{uid}",
                    app=signal_app,
                ).set(True)
                continue
            if _smtp_configuration() is None:
                firebase_db.reference(
                    f"notificationDispatch/{symbol_key}/{signal_id}/emailAttemptedAt/{uid}",
                    app=signal_app,
                ).set(now)
                result["email_failed"] += 1
                _warn_notification_configuration_once("smtp", "Signal email notifications are pending: SMTP is not configured.")
                continue
            try:
                firebase_db.reference(
                    f"notificationDispatch/{symbol_key}/{signal_id}/emailAttemptedAt/{uid}",
                    app=signal_app,
                ).set(now)
                _send_signal_email(profile["email"].strip(), symbol, signal)
                firebase_db.reference(
                    f"notificationDispatch/{symbol_key}/{signal_id}/emailSent/{uid}",
                    app=signal_app,
                ).set(True)
                result["email_sent"] += 1
            except Exception:
                logger.exception(
                    "Could not send signal email for %s to approved user %s",
                    signal_id,
                    uid,
                )
                result["email_failed"] += 1

    push_recipients = dispatch.get("pushRecipients", {})
    push_sent = dispatch.get("pushSent", {})
    push_attempted = dispatch.get("pushAttemptedAt", {})
    push_is_configured = _web_push_configuration_available()
    if isinstance(push_recipients, dict) and isinstance(push_sent, dict):
        for uid, subscription_ids in push_recipients.items():
            if not isinstance(subscription_ids, list):
                continue
            for subscription_id in subscription_ids:
                uid = str(uid)
                subscription_id = str(subscription_id)
                sent_for_user = push_sent.get(uid, {})
                if isinstance(sent_for_user, dict) and sent_for_user.get(subscription_id) is True:
                    continue
                attempted_for_user = push_attempted.get(uid, {}) if isinstance(push_attempted, dict) else {}
                last_attempt = attempted_for_user.get(subscription_id, 0) if isinstance(attempted_for_user, dict) else 0
                if isinstance(last_attempt, (int, float)) and now - last_attempt < 300:
                    continue
                subscription = firebase_db.reference(
                    f"users/{uid}/pushSubscriptions/{subscription_id}", app=signal_app
                ).get()
                if not isinstance(subscription, dict):
                    firebase_db.reference(
                        f"notificationDispatch/{symbol_key}/{signal_id}/pushSent/{uid}/{subscription_id}",
                        app=signal_app,
                    ).set(True)
                    continue
                if not push_is_configured:
                    firebase_db.reference(
                        f"notificationDispatch/{symbol_key}/{signal_id}/pushAttemptedAt/{uid}/{subscription_id}",
                        app=signal_app,
                    ).set(now)
                    result["push_failed"] += 1
                    _warn_notification_configuration_once(
                        "webpush",
                        "Signal browser notifications are pending: Web Push VAPID settings are incomplete.",
                    )
                    continue
                try:
                    firebase_db.reference(
                        f"notificationDispatch/{symbol_key}/{signal_id}/pushAttemptedAt/{uid}/{subscription_id}",
                        app=signal_app,
                    ).set(now)
                    _send_web_push(subscription, symbol, signal)
                    firebase_db.reference(
                        f"notificationDispatch/{symbol_key}/{signal_id}/pushSent/{uid}/{subscription_id}",
                        app=signal_app,
                    ).set(True)
                    result["push_sent"] += 1
                except WebPushException as error:
                    status_code = getattr(getattr(error, "response", None), "status_code", None)
                    if status_code in (404, 410):
                        firebase_db.reference(
                            f"users/{uid}/pushSubscriptions/{subscription_id}",
                            app=signal_app,
                        ).delete()
                        firebase_db.reference(
                            f"notificationDispatch/{symbol_key}/{signal_id}/pushSent/{uid}/{subscription_id}",
                            app=signal_app,
                        ).set(True)
                    logger.exception(
                        "Could not deliver web push for signal %s to approved user %s",
                        signal_id,
                        uid,
                    )
                    result["push_failed"] += 1
                except Exception:
                    logger.exception(
                        "Could not deliver web push for signal %s to approved user %s",
                        signal_id,
                        uid,
                    )
                    result["push_failed"] += 1

    return result


def _warn_notification_configuration_once(channel: str, message: str) -> None:
    if channel not in _notification_config_warnings:
        logger.warning(message)
        _notification_config_warnings.add(channel)


def _has_pending_notification(dispatch: dict) -> bool:
    email_recipients = dispatch.get("emailRecipients", [])
    email_sent = dispatch.get("emailSent", {})
    if isinstance(email_recipients, list) and isinstance(email_sent, dict):
        if any(email_sent.get(str(uid)) is not True for uid in email_recipients):
            return True

    push_recipients = dispatch.get("pushRecipients", {})
    push_sent = dispatch.get("pushSent", {})
    if isinstance(push_recipients, dict) and isinstance(push_sent, dict):
        for uid, subscription_ids in push_recipients.items():
            sent_for_user = push_sent.get(str(uid), {})
            if isinstance(subscription_ids, list) and any(
                not isinstance(sent_for_user, dict)
                or sent_for_user.get(str(subscription_id)) is not True
                for subscription_id in subscription_ids
            ):
                return True
    return False


def require_notification_access(request: Request) -> str:
    uid = verify_firebase_uid(request)
    if uid not in FIREBASE_ADMIN_UIDS:
        profile = firebase_db.reference(f"users/{uid}", app=get_firebase_app()).get()
        if not isinstance(profile, dict) or profile.get("status") != "approved":
            raise HTTPException(status_code=403, detail="Administrator approval is required")
    return uid


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
    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    signals = retain_latest_signals(stored, end=now) if isinstance(stored, dict) else {}
    return {"symbol": symbol.strip().upper(), "signals": list(signals.values())}


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
    existing_ids = set(stored) if isinstance(stored, dict) else set()
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

    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    recent = retain_latest_signals(merged, end=now)
    dispatch_root = firebase_db.reference(
        f"notificationDispatch/{symbol_key}", app=signal_app
    )
    new_signal_ids = set()
    for signal_id, signal in recent.items():
        if signal_id not in existing_ids:
            new_signal_ids.add(signal_id)
            try:
                dispatch_root.child(signal_id).set(
                    _new_notification_dispatch(signal_app, now)
                )
            except Exception:
                logger.exception("Could not queue notifications for signal %s", signal_id)
    signal_ref.set(recent)
    notification_results = {
        "email_sent": 0,
        "email_failed": 0,
        "push_sent": 0,
        "push_failed": 0,
    }
    for signal_id, signal in recent.items():
        dispatch = dispatch_root.child(signal_id).get()
        if not isinstance(dispatch, dict) or not _has_pending_notification(dispatch):
            continue
        try:
            result = _dispatch_signal_notifications(
                signal_app, symbol, symbol_key, signal_id, signal, dispatch
            )
            for key, count in result.items():
                notification_results[key] += count
        except Exception:
            logger.exception("Could not process notifications for signal %s", signal_id)
            notification_results["email_failed"] += 1
            notification_results["push_failed"] += 1

    dispatches = dispatch_root.get()
    if isinstance(dispatches, dict):
        for signal_id in set(dispatches) - set(recent):
            dispatch_root.child(signal_id).delete()
    return {
        "symbol": symbol,
        "count": len(recent),
        "new_signals": len(new_signal_ids),
        "notifications": notification_results,
    }


@app.post("/api/notifications/push-subscription")
def save_push_subscription(
    payload: PushSubscriptionRequest,
    request: Request,
) -> dict:
    uid = require_notification_access(request)
    try:
        _validate_push_endpoint(payload.endpoint)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    subscription_id = hashlib.sha256(payload.endpoint.encode("utf-8")).hexdigest()
    app = get_signals_firebase_app()
    subscription_ref = firebase_db.reference(
        f"users/{uid}/pushSubscriptions/{subscription_id}",
        app=app,
    )
    existing = subscription_ref.get()
    if not isinstance(existing, dict):
        subscriptions = firebase_db.reference(
            f"users/{uid}/pushSubscriptions", app=app
        ).get()
        if isinstance(subscriptions, dict) and len(subscriptions) >= MAX_PUSH_SUBSCRIPTIONS_PER_USER:
            raise HTTPException(status_code=409, detail="This account already has the maximum number of browser devices registered.")
    subscription_ref.set({
        "endpoint": payload.endpoint,
        "keys": payload.keys.model_dump(),
    })
    return {"enabled": True}


@app.get("/api/notifications/push-subscription")
def get_push_subscriptions(request: Request) -> dict:
    uid = require_notification_access(request)
    subscriptions = firebase_db.reference(
        f"users/{uid}/pushSubscriptions", app=get_signals_firebase_app()
    ).get()
    ids = list(subscriptions) if isinstance(subscriptions, dict) else []
    return {"subscription_ids": ids}


@app.delete("/api/notifications/push-subscription")
def delete_push_subscription(
    payload: PushSubscriptionRequest,
    request: Request,
) -> dict:
    uid = require_notification_access(request)
    subscription_id = hashlib.sha256(payload.endpoint.encode("utf-8")).hexdigest()
    firebase_db.reference(
        f"users/{uid}/pushSubscriptions/{subscription_id}",
        app=get_signals_firebase_app(),
    ).delete()
    return {"enabled": False}


@app.post("/api/market/publish")
def publish_market_data(
    payload: MarketPublishRequest,
    _access: None = Depends(require_admin_access),
) -> dict:
    symbol = payload.symbol.strip().upper()
    symbol_key = firebase_symbol_key(symbol)
    end = int(dt.datetime.now(dt.timezone.utc).timestamp())
    cutoff = end - MARKET_RETENTION_SECONDS
    signal_app = get_signals_firebase_app()
    market_ref = firebase_db.reference(f"market/{symbol_key}", app=signal_app)
    stored = market_ref.get()
    stored_candles = stored.get("candles") if isinstance(stored, dict) else None
    candles = (
        retain_recent_market_candles(stored_candles, cutoff, end)
        if isinstance(stored_candles, dict)
        else {}
    )

    if candles:
        ensure_connection(symbol)
        rates = mt5.copy_rates_from_pos(
            symbol,
            mt5.TIMEFRAME_M1,
            0,
            TIMEFRAMES["5m"] * 2 + 2,
        )
        if rates is None:
            raise HTTPException(
                status_code=502,
                detail=f"MT5 latest chart request failed: {mt5.last_error()}",
            )
        bars = aggregate_mt5_rates(rates, TIMEFRAMES["5m"])
    else:
        bars = fetch_bars(symbol, "5m", cutoff, end)
    if not bars:
        raise HTTPException(status_code=502, detail="MT5 returned no recent chart data for this symbol")

    candles.update({
        str(int(bar["time"])): bar
        for bar in bars
        if cutoff <= int(bar["time"]) <= end
    })
    market_ref.set({
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