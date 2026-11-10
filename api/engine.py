import datetime as dt
from bisect import bisect_left, bisect_right
from collections.abc import Mapping, Sequence


def aggregate_rates(rates: Sequence[Mapping], minutes: int) -> list[dict]:
    if minutes < 1:
        raise ValueError("minutes must be positive")

    seconds = minutes * 60
    bars: dict[int, dict] = {}
    for rate in rates:
        timestamp = int(rate["time"])
        bucket = timestamp - timestamp % seconds
        bar = bars.get(bucket)
        if bar is None:
            bars[bucket] = {
                "time": bucket,
                "open": float(rate["open"]),
                "high": float(rate["high"]),
                "low": float(rate["low"]),
                "close": float(rate["close"]),
                "volume": float(rate.get("tick_volume", rate.get("volume", 0))),
            }
        else:
            bar["high"] = max(bar["high"], float(rate["high"]))
            bar["low"] = min(bar["low"], float(rate["low"]))
            bar["close"] = float(rate["close"])
            bar["volume"] += float(rate.get("tick_volume", rate.get("volume", 0)))

    return [bars[key] for key in sorted(bars)]


def _atr_values(bars: Sequence[Mapping], length: int) -> list[float | None]:
    true_ranges: list[float] = []
    values: list[float | None] = [None] * len(bars)
    for index, bar in enumerate(bars):
        high = float(bar["high"])
        low = float(bar["low"])
        previous_close = float(bars[index - 1]["close"]) if index else float(bar["close"])
        true_ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))
        if index == length - 1:
            values[index] = sum(true_ranges[-length:]) / length
        elif index >= length:
            previous_atr = values[index - 1]
            values[index] = (previous_atr * (length - 1) + true_ranges[index]) / length
    return values


_SESSIONS = (
    ("Asian", 330, 870),
    ("London", 810, 1350),
    ("New York", 1110, 210),
)
_LANKA_UTC_OFFSET_SECONDS = 5 * 60 * 60 + 30 * 60


def _session_window(name: str, anchor_date: dt.date, offset_seconds: int) -> dict:
    _, start_minute, end_minute = next(
        session for session in _SESSIONS if session[0] == name
    )
    start_time = dt.datetime.combine(
        anchor_date,
        dt.time(start_minute // 60, start_minute % 60),
        dt.timezone.utc,
    )
    end_date = anchor_date + (
        dt.timedelta(days=1) if end_minute <= start_minute else dt.timedelta()
    )
    end_time = dt.datetime.combine(
        end_date,
        dt.time(end_minute // 60, end_minute % 60),
        dt.timezone.utc,
    )
    return {
        "name": name,
        "anchor_date": anchor_date,
        "start": int(start_time.timestamp()) - offset_seconds,
        "end": int(end_time.timestamp()) - offset_seconds,
    }


def _active_sessions(timestamp: int, session_offset_seconds: int) -> list[dict]:
    local_time = dt.datetime.fromtimestamp(
        timestamp + session_offset_seconds, dt.timezone.utc
    )
    minute = local_time.hour * 60 + local_time.minute
    active = []
    for name, start_minute, end_minute in _SESSIONS:
        if start_minute < end_minute:
            is_active = start_minute <= minute < end_minute
            anchor_date = local_time.date()
        else:
            is_active = minute >= start_minute or minute < end_minute
            anchor_date = (
                local_time.date()
                if minute >= start_minute
                else local_time.date() - dt.timedelta(days=1)
            )
        if not is_active:
            continue
        active.append(_session_window(name, anchor_date, session_offset_seconds))
    return active


def _session_volume_profile(
    bars: Sequence[Mapping],
    bin_size: float,
) -> dict | None:
    bins: dict[int, float] = {}
    total_volume = 0.0
    for bar in bars:
        volume = float(bar.get("volume", bar.get("tick_volume", 0)))
        if volume <= 0:
            continue
        typical_price = (
            float(bar["high"]) + float(bar["low"]) + float(bar["close"])
        ) / 3
        bin_index = int(typical_price // bin_size)
        bins[bin_index] = bins.get(bin_index, 0.0) + volume
        total_volume += volume
    if not bins:
        return None

    indices = sorted(bins)
    poc_index = max(indices, key=lambda item: bins[item])
    left = right = indices.index(poc_index)
    value_area_volume = bins[poc_index]
    target_volume = total_volume * 0.7
    while value_area_volume < target_volume and (left > 0 or right < len(indices) - 1):
        left_volume = bins[indices[left - 1]] if left > 0 else -1.0
        right_volume = bins[indices[right + 1]] if right < len(indices) - 1 else -1.0
        if right_volume > left_volume:
            right += 1
            value_area_volume += bins[indices[right]]
        else:
            left -= 1
            value_area_volume += bins[indices[left]]
    return {
        "poc": (poc_index + 0.5) * bin_size,
        "vah": (indices[right] + 1) * bin_size,
        "val": indices[left] * bin_size,
        "volume": total_volume,
        "bin_size": bin_size,
    }


def _session_signal_context(
    bars: Sequence[Mapping],
    sweep_index: int,
    confirmation_index: int,
    entry_index: int,
    direction: str,
    entry: float,
    atr: float,
    session_offset_seconds: int,
) -> dict:
    sweep_bar = bars[sweep_index]
    active_at_sweep = _active_sessions(
        int(sweep_bar["time"]), session_offset_seconds
    )
    sweep_time = int(sweep_bar["time"])
    sweep_extreme = float(sweep_bar["high"] if direction == "sell" else sweep_bar["low"])
    sweep_close = float(sweep_bar["close"])
    session_level_candidates = []

    for session in active_at_sweep:
        developing_bars = [
            bar for bar in bars
            if session["start"] <= int(bar["time"]) < sweep_time
        ]
        if len(developing_bars) < 6:
            continue
        session_high = max(float(bar["high"]) for bar in developing_bars)
        session_low = min(float(bar["low"]) for bar in developing_bars)
        session_level_candidates.append((
            session,
            session_high,
            session_low,
            "developing",
        ))

    local_date = dt.datetime.fromtimestamp(
        sweep_time + session_offset_seconds, dt.timezone.utc
    ).date()
    completed_windows = []
    for days_back in range(8):
        anchor_date = local_date - dt.timedelta(days=days_back)
        for name, _, _ in _SESSIONS:
            session = _session_window(name, anchor_date, session_offset_seconds)
            if session["end"] > sweep_time:
                continue
            session_bars = [
                bar for bar in bars
                if session["start"] <= int(bar["time"]) < session["end"]
            ]
            if len(session_bars) < 54:
                continue
            completed_windows.append((
                session,
                max(float(bar["high"]) for bar in session_bars),
                min(float(bar["low"]) for bar in session_bars),
                "previous",
            ))

    for session, session_high, session_low, reference in completed_windows:
        session_level_candidates.append(
            (session, session_high, session_low, reference)
        )

    matching_sweeps = []
    for session, session_high, session_low, reference in session_level_candidates:
        swept_high = (
            direction == "sell"
            and sweep_extreme > session_high
            and sweep_close < session_high
        )
        swept_low = (
            direction == "buy"
            and sweep_extreme < session_low
            and sweep_close > session_low
        )
        if swept_high or swept_low:
            level = session_high if swept_high else session_low
            matching_sweeps.append((
                abs(sweep_extreme - level),
                -int(session["end"]),
                {
                    "name": session["name"],
                    "level_type": "high" if swept_high else "low",
                    "level": level,
                    "previous_high": session_high,
                    "previous_low": session_low,
                    "reference": reference,
                },
            ))
    session_sweep = min(matching_sweeps, default=None)
    session_sweep = session_sweep[2] if session_sweep else None

    active_at_entry = _active_sessions(
        int(bars[entry_index]["time"]), session_offset_seconds
    )
    session_names = [session["name"] for session in active_at_entry]
    if "London" in session_names and "New York" in session_names:
        session_label = "London + New York Overlap"
    elif "Asian" in session_names and "London" in session_names:
        session_label = "Asian + London Overlap"
    else:
        session_label = " + ".join(session_names) if session_names else None

    atr_bin_size = max(atr * 0.1, 0.00001)
    profile_candidates = []
    for session in active_at_entry:
        session_bars = [
            bar for bar in bars
            if session["start"] <= int(bar["time"]) <= int(bars[entry_index]["time"])
        ]
        profile = _session_volume_profile(session_bars, atr_bin_size)
        if profile is None:
            continue
        nearest_level = min(
            ("POC", "VAH", "VAL"),
            key=lambda name: abs(entry - profile[name.lower()]),
        )
        profile_distance = abs(entry - profile[nearest_level.lower()])
        profile_candidates.append((
            profile_distance,
            session["name"],
            session_bars,
            profile,
            nearest_level,
        ))

    profile_confirmed = False
    profile_session = None
    profile_level = None
    profile = None
    volume_ratio = None
    if profile_candidates:
        (
            profile_distance,
            profile_session,
            session_bars,
            profile,
            profile_level,
        ) = min(profile_candidates, key=lambda item: item[0])
        prior_volumes = [
            float(bar.get("volume", bar.get("tick_volume", 0)))
            for bar in session_bars[:-1]
            if float(bar.get("volume", bar.get("tick_volume", 0))) > 0
        ]
        confirmation_volume = float(
            bars[confirmation_index].get(
                "volume", bars[confirmation_index].get("tick_volume", 0)
            )
        )
        if len(prior_volumes) >= 6:
            average_volume = sum(prior_volumes) / len(prior_volumes)
            volume_ratio = confirmation_volume / average_volume if average_volume else None
        profile_confirmed = (
            profile_distance <= max(atr * 0.2, float(profile["bin_size"]))
            and volume_ratio is not None
            and volume_ratio >= 1.2
        )

    return {
        "session_name": session_label,
        "session_liquidity_swept": session_sweep is not None,
        "session_sweep_name": session_sweep["name"] if session_sweep else None,
        "session_sweep_level_type": session_sweep["level_type"] if session_sweep else None,
        "session_sweep_level": session_sweep["level"] if session_sweep else None,
        "session_sweep_reference": session_sweep["reference"] if session_sweep else None,
        "session_reference_high": session_sweep["previous_high"] if session_sweep else None,
        "session_reference_low": session_sweep["previous_low"] if session_sweep else None,
        "session_profile_session": profile_session,
        "session_profile_poc": profile["poc"] if profile else None,
        "session_profile_vah": profile["vah"] if profile else None,
        "session_profile_val": profile["val"] if profile else None,
        "session_profile_level": profile_level if profile_confirmed else None,
        "session_profile_volume_ratio": volume_ratio,
        "session_profile_confirmed": profile_confirmed,
    }


def run_backtest(
    bars: Sequence[Mapping],
    sweep_len: int = 10,
    bos_len: int = 5,
    confirm_bars: int = 10,
    atr_len: int = 14,
    atr_buffer: float = 0.15,
    target_r: float = 2.0,
) -> list[dict]:
    if not bars or sweep_len < 1 or bos_len < 1 or confirm_bars < 1 or atr_len < 1:
        return []

    atr = _atr_values(bars, atr_len)
    bull_sweep: tuple[int, float] | None = None
    bear_sweep: tuple[int, float] | None = None
    trades: list[dict] = []
    index = max(sweep_len, bos_len, atr_len - 1)

    while index < len(bars):
        bar = bars[index]
        prior = bars[max(0, index - sweep_len):index]
        if len(prior) < sweep_len:
            index += 1
            continue

        prior_low = min(float(item["low"]) for item in prior)
        prior_high = max(float(item["high"]) for item in prior)
        low = float(bar["low"])
        high = float(bar["high"])
        close = float(bar["close"])

        if low < prior_low and close > prior_low:
            bull_sweep = (index, low)
            bear_sweep = None
        if high > prior_high and close < prior_high:
            bear_sweep = (index, high)
            bull_sweep = None

        if bull_sweep and index - bull_sweep[0] > confirm_bars:
            bull_sweep = None
        if bear_sweep and index - bear_sweep[0] > confirm_bars:
            bear_sweep = None

        bos_prior = bars[max(0, index - bos_len):index]
        if len(bos_prior) < bos_len or atr[index] is None:
            index += 1
            continue

        direction = None
        sweep_extreme = 0.0
        if bull_sweep and index > bull_sweep[0] and close > max(float(item["high"]) for item in bos_prior):
            direction, sweep_extreme = "buy", bull_sweep[1]
        elif bear_sweep and index > bear_sweep[0] and close < min(float(item["low"]) for item in bos_prior):
            direction, sweep_extreme = "sell", bear_sweep[1]

        if direction is None:
            index += 1
            continue

        entry = close
        stop = sweep_extreme - float(atr[index]) * atr_buffer if direction == "buy" else sweep_extreme + float(atr[index]) * atr_buffer
        risk = abs(entry - stop)
        if risk <= 0:
            index += 1
            continue
        target = entry + risk * target_r if direction == "buy" else entry - risk * target_r
        exit_index = len(bars) - 1
        exit_price = float(bars[exit_index]["close"])
        outcome = "open"

        for future_index in range(index + 1, len(bars)):
            future = bars[future_index]
            future_high = float(future["high"])
            future_low = float(future["low"])
            stop_hit = future_low <= stop if direction == "buy" else future_high >= stop
            target_hit = future_high >= target if direction == "buy" else future_low <= target
            if stop_hit:
                exit_index, exit_price, outcome = future_index, stop, "stop"
                break
            if target_hit:
                exit_index, exit_price, outcome = future_index, target, "target"
                break

        result_r = (exit_price - entry) / risk if direction == "buy" else (entry - exit_price) / risk
        trades.append({
            "direction": direction,
            "entry_time": int(bar["time"]),
            "exit_time": int(bars[exit_index]["time"]),
            "entry": entry,
            "stop": stop,
            "target": target,
            "exit_price": exit_price,
            "result_r": result_r,
            "outcome": outcome,
        })
        bull_sweep = None
        bear_sweep = None
        index = exit_index + 1

    return trades


def _strategy_key_levels(
    htf_bars: Sequence[Mapping],
    htf_minutes: int,
    session_offset_seconds: int,
) -> list[dict]:
    levels: list[dict] = []
    seconds = htf_minutes * 60

    for index in range(4, len(htf_bars)):
        pivot_index = index - 2
        pivot = htf_bars[pivot_index]
        left = htf_bars[pivot_index - 2:pivot_index]
        right = htf_bars[pivot_index + 1:index + 1]
        pivot_high = float(pivot["high"])
        pivot_low = float(pivot["low"])
        if pivot_high > max(float(bar["high"]) for bar in left) and pivot_high >= max(float(bar["high"]) for bar in right):
            levels.append({
                "price": pivot_high,
                "direction": "resistance",
                "source": "HTF swing high",
                "available_time": int(htf_bars[index]["time"]) + seconds,
                "zone_low": float(pivot["low"]),
                "zone_high": pivot_high,
            })
        if pivot_low < min(float(bar["low"]) for bar in left) and pivot_low <= min(float(bar["low"]) for bar in right):
            levels.append({
                "price": pivot_low,
                "direction": "support",
                "source": "HTF swing low",
                "available_time": int(htf_bars[index]["time"]) + seconds,
                "zone_low": pivot_low,
                "zone_high": float(pivot["high"]),
            })

    for period in ("day", "week"):
        groups: dict[tuple[int, ...], list[Mapping]] = {}
        for bar in htf_bars:
            timestamp = dt.datetime.fromtimestamp(
                int(bar["time"]) + session_offset_seconds,
                dt.timezone.utc,
            )
            if period == "day":
                key = (timestamp.year, timestamp.month, timestamp.day)
            else:
                iso = timestamp.isocalendar()
                key = (iso.year, iso.week)
            groups.setdefault(key, []).append(bar)

        previous: list[Mapping] | None = None
        for group in groups.values():
            if previous:
                available_time = int(group[0]["time"])
                previous_high_bar = max(previous, key=lambda bar: float(bar["high"]))
                previous_low_bar = min(previous, key=lambda bar: float(bar["low"]))
                levels.extend((
                    {
                        "price": float(previous_high_bar["high"]),
                        "direction": "resistance",
                        "source": f"Previous {period} high",
                        "available_time": available_time,
                        "zone_low": float(previous_high_bar["low"]),
                        "zone_high": float(previous_high_bar["high"]),
                    },
                    {
                        "price": float(previous_low_bar["low"]),
                        "direction": "support",
                        "source": f"Previous {period} low",
                        "available_time": available_time,
                        "zone_low": float(previous_low_bar["low"]),
                        "zone_high": float(previous_low_bar["high"]),
                    },
                ))
            previous = group

    return sorted(levels, key=lambda level: level["available_time"])


_COLOMBO_OFFSET_SECONDS = 5 * 60 * 60 + 30 * 60
_STRATEGY_SESSIONS = (
    ("Asia", 6 * 60 + 30, 8 * 60 + 30),
    ("London", 13 * 60 + 30, 16 * 60 + 30),
    ("New York", 19 * 60 + 30, 21 * 60 + 30),
    ("IB", 18 * 60 + 50, 19 * 60 + 50),
)


def _configured_strategy_sessions(timestamp: int) -> tuple[str, ...]:
    local_time = dt.datetime.fromtimestamp(
        timestamp + _COLOMBO_OFFSET_SECONDS, dt.timezone.utc
    )
    minute = local_time.hour * 60 + local_time.minute
    return tuple(
        name
        for name, start_minute, end_minute in _STRATEGY_SESSIONS
        if start_minute <= minute < end_minute
    )


_SWEEP_BOS_SESSIONS = (
    ("Asia", 6 * 60 + 30, 8 * 60 + 30),
    ("London", 13 * 60 + 30, 16 * 60 + 30),
    ("New York", 19 * 60 + 30, 21 * 60 + 30),
    ("IB", 18 * 60 + 50, 19 * 60 + 50),
)


def _sweep_bos_sessions(timestamp: int) -> tuple[str, ...]:
    local_time = dt.datetime.fromtimestamp(
        timestamp + _COLOMBO_OFFSET_SECONDS, dt.timezone.utc
    )
    minute = local_time.hour * 60 + local_time.minute
    return tuple(
        name
        for name, start_minute, end_minute in _SWEEP_BOS_SESSIONS
        if start_minute - 30 <= minute < end_minute
    )


def generate_sweep_bos_signals(
    bars: Sequence[Mapping],
    atr_len: int = 14,
    atr_buffer: float = 0.1,
    sweep_len: int = 8,
    bos_len: int = 5,
    confirm_bars: int = 5,
) -> tuple[list[dict], list[dict]]:
    if not bars or min(atr_len, sweep_len, bos_len, confirm_bars) < 1:
        return [], []

    atr_values = _atr_values(bars, atr_len)
    signals = []
    bull_sweep: dict | None = None
    bear_sweep: dict | None = None
    for index, bar in enumerate(bars):
        sessions = _sweep_bos_sessions(int(bar["time"]))
        prior_bars = bars[max(0, index - sweep_len):index]
        bos_bars = bars[max(0, index - bos_len):index]
        if len(prior_bars) < sweep_len or len(bos_bars) < bos_len:
            continue

        prior_low = min(float(item["low"]) for item in prior_bars)
        prior_high = max(float(item["high"]) for item in prior_bars)
        bos_high = max(float(item["high"]) for item in bos_bars)
        bos_low = min(float(item["low"]) for item in bos_bars)
        low = float(bar["low"])
        high = float(bar["high"])
        close = float(bar["close"])

        if sessions:
            if low < prior_low and close > prior_low:
                bull_sweep = {
                    "index": index,
                    "extreme": low,
                    "key_level": prior_low,
                    "key_source": f"Prior {sweep_len}-bar liquidity low",
                }
                bear_sweep = None
            if high > prior_high and close < prior_high:
                bear_sweep = {
                    "index": index,
                    "extreme": high,
                    "key_level": prior_high,
                    "key_source": f"Prior {sweep_len}-bar liquidity high",
                }
                bull_sweep = None

        if bull_sweep is not None and index - bull_sweep["index"] > confirm_bars:
            bull_sweep = None
        if bear_sweep is not None and index - bear_sweep["index"] > confirm_bars:
            bear_sweep = None

        if not sessions or index == 0 or atr_values[index] is None:
            continue
        direction = None
        setup = None
        if bull_sweep is not None and index > bull_sweep["index"] and close > bos_high:
            direction, setup = "buy", bull_sweep
        elif bear_sweep is not None and index > bear_sweep["index"] and close < bos_low:
            direction, setup = "sell", bear_sweep
        if setup is None:
            continue

        atr = float(atr_values[index])
        entry = close
        stop = (
            float(setup["extreme"]) - atr * atr_buffer
            if direction == "buy"
            else float(setup["extreme"]) + atr * atr_buffer
        )
        risk = entry - stop if direction == "buy" else stop - entry
        if risk > 0:
            signals.append({
                "direction": direction,
                "signal_status": "confirmed",
                "entry_time": int(bar["time"]),
                "entry_index": index,
                "entry": entry,
                "stop": stop,
                "sweep_time": int(bars[int(setup["index"])]["time"]),
                "sweep_extreme": float(setup["extreme"]),
                "key_level": float(setup["key_level"]),
                "key_source": setup["key_source"],
                "confluence_count": 1,
                "htf_timeframe": "5m",
                "signal_type": "liquidity_sweep",
                "setup": "M5 Sweep + BOS",
                "signal_strength": f"{sweep_len}-bar sweep + {bos_len}-bar BOS",
                "cisd_confirmed": False,
                "fvg_confirmed": False,
                "session_names": list(sessions),
                "session_name": " + ".join(sessions),
            })
        if direction == "buy":
            bull_sweep = None
        else:
            bear_sweep = None

    key_levels = []
    if len(bars) >= sweep_len + 1:
        recent = bars[-sweep_len - 1:-1]
        key_levels = [
            {
                "price": max(float(bar["high"]) for bar in recent),
                "direction": "resistance",
                "source": f"Prior {sweep_len}-bar liquidity high",
                "time": int(bars[-1]["time"]),
            },
            {
                "price": min(float(bar["low"]) for bar in recent),
                "direction": "support",
                "source": f"Prior {sweep_len}-bar liquidity low",
                "time": int(bars[-1]["time"]),
            },
        ]
    return signals, key_levels


def generate_liquidity_cisd_signals(
    ltf_bars: Sequence[Mapping],
    h1_bars: Sequence[Mapping],
    h4_bars: Sequence[Mapping],
    h7_bars: Sequence[Mapping],
    atr_len: int = 14,
    atr_buffer: float = 0.15,
    setup_expiry_bars: int = 24,
    max_sweep_atr: float = 0.2,
) -> tuple[list[dict], list[dict]]:
    if (
        not ltf_bars
        or atr_len < 1
        or setup_expiry_bars < 1
        or max_sweep_atr < 0
    ):
        return [], []

    levels = []
    for minutes, bars in ((60, h1_bars), (240, h4_bars), (420, h7_bars)):
        label = f"H{minutes // 60}"
        for level in _strategy_key_levels(bars, minutes, _COLOMBO_OFFSET_SECONDS):
            if level["source"] not in ("HTF swing high", "HTF swing low"):
                continue
            levels.append({
                **level,
                "source": f"{label} {level['source'].replace('HTF ', '')}",
                "timeframe": label,
            })
    levels.sort(key=lambda level: level["available_time"])
    atr_values = _atr_values(ltf_bars, atr_len)
    active_levels = {
        "support": {"prices": [], "levels": []},
        "resistance": {"prices": [], "levels": []},
    }
    consumed_levels: set[tuple[str, float, str]] = set()
    level_index = 0
    pending: dict | None = None
    signals: list[dict] = []

    for index, bar in enumerate(ltf_bars):
        timestamp = int(bar["time"])
        while level_index < len(levels) and levels[level_index]["available_time"] <= timestamp:
            level = levels[level_index]
            direction_levels = active_levels[level["direction"]]
            price = float(level["price"])
            insertion_index = bisect_right(direction_levels["prices"], price)
            direction_levels["prices"].insert(insertion_index, price)
            direction_levels["levels"].insert(insertion_index, level)
            level_index += 1

        current_sessions = _configured_strategy_sessions(timestamp)
        atr = atr_values[index - 1] if index > 0 else None
        if pending is not None:
            same_session = bool(set(pending["session_names"]).intersection(current_sessions))
            expired = index - pending["sweep_index"] > setup_expiry_bars
            invalidated = (
                float(bar["close"]) <= pending["key_level"]
                if pending["direction"] == "buy"
                else float(bar["close"]) >= pending["key_level"]
            )
            if not same_session or expired or invalidated:
                pending = None
            elif index > pending["sweep_index"]:
                is_opposing = (
                    float(bar["close"]) < float(bar["open"])
                    if pending["direction"] == "buy"
                    else float(bar["close"]) > float(bar["open"])
                )
                if is_opposing:
                    pending["last_opposing"] = bar
                opposing = pending["last_opposing"]
                cisd_confirmed = opposing is not None and (
                    float(bar["close"]) > float(opposing["high"])
                    if pending["direction"] == "buy"
                    else float(bar["close"]) < float(opposing["low"])
                )
                if cisd_confirmed and atr is not None:
                    entry = float(bar["close"])
                    stop = (
                        pending["sweep_extreme"] - pending["sweep_atr"] * atr_buffer
                        if pending["direction"] == "buy"
                        else pending["sweep_extreme"] + pending["sweep_atr"] * atr_buffer
                    )
                    risk = entry - stop if pending["direction"] == "buy" else stop - entry
                    if risk > 0:
                        timeframe = pending["timeframe"]
                        signals.append({
                            "direction": pending["direction"],
                            "signal_status": "confirmed",
                            "entry_time": timestamp,
                            "entry_index": index,
                            "entry": entry,
                            "stop": stop,
                            "sweep_time": int(ltf_bars[pending["sweep_index"]]["time"]),
                            "sweep_extreme": pending["sweep_extreme"],
                            "key_level": pending["key_level"],
                            "key_source": pending["key_source"],
                            "key_zone_low": pending["key_zone_low"],
                            "key_zone_high": pending["key_zone_high"],
                            "h1_key_level": pending["key_level"] if timeframe == "H1" else None,
                            "h4_key_level": pending["key_level"] if timeframe == "H4" else None,
                            "htf_key_level": pending["key_level"] if timeframe == "H7" else None,
                            "m15_key_level": None,
                            "confluence_timeframes": [timeframe],
                            "confluence_count": 1,
                            "htf_timeframe": "7h",
                            "signal_type": "liquidity_sweep",
                            "setup": "HTF sweep + 1m CISD",
                            "signal_strength": "H1/H4/H7 liquidity sweep + 1m CISD",
                            "cisd_confirmed": True,
                            "fvg_confirmed": False,
                            "session_names": list(current_sessions),
                            "session_name": " + ".join(current_sessions),
                        })
                        consumed_levels.add(pending["level_identity"])
                    pending = None

        if pending is not None or not current_sessions or atr is None:
            continue

        low = float(bar["low"])
        high = float(bar["high"])
        close = float(bar["close"])
        candidates = []
        for direction, lower, upper in (
            ("support", low, close),
            ("resistance", close, high),
        ):
            direction_levels = active_levels[direction]
            prices = direction_levels["prices"]
            levels_in_range = direction_levels["levels"]
            first = bisect_right(prices, lower)
            last = bisect_left(prices, upper)
            for level in levels_in_range[first:last]:
                price = float(level["price"])
                identity = (
                    level["direction"],
                    round(price, 8),
                    level["timeframe"],
                )
                if identity in consumed_levels:
                    continue
                if direction == "support":
                    penetration = price - low
                    if penetration <= atr * max_sweep_atr:
                        candidates.append(("buy", level, low, penetration, identity))
                else:
                    penetration = high - price
                    if penetration <= atr * max_sweep_atr:
                        candidates.append(("sell", level, high, penetration, identity))
        if candidates:
            direction, level, extreme, _, identity = min(
                candidates,
                key=lambda item: (item[3], -int(item[1]["available_time"])),
            )
            pending = {
                "direction": direction,
                "sweep_index": index,
                "sweep_extreme": extreme,
                "sweep_atr": atr,
                "key_level": float(level["price"]),
                "key_source": level["source"],
                "key_zone_low": float(level["zone_low"]),
                "key_zone_high": float(level["zone_high"]),
                "timeframe": level["timeframe"],
                "level_identity": identity,
                "session_names": current_sessions,
                "last_opposing": None,
            }

    latest_time = int(ltf_bars[-1]["time"])
    visible_levels = [
        level for level in levels if level["available_time"] <= latest_time
    ]
    current_price = float(ltf_bars[-1]["close"])
    nearest_levels = []
    for direction in ("support", "resistance"):
        candidates = [level for level in visible_levels if level["direction"] == direction]
        candidates.sort(key=lambda level: abs(float(level["price"]) - current_price))
        nearest_levels.extend({
            **level,
            "time": level["available_time"],
        } for level in candidates[:3])
    return signals, nearest_levels


def _entry_zone(
    direction: str,
    index: int,
    bars: Sequence[Mapping],
    last_opposing: Mapping | None,
) -> dict | None:
    bar = bars[index]
    previous = bars[index - 1]
    open_price = float(bar["open"])
    close = float(bar["close"])
    high = float(bar["high"])
    low = float(bar["low"])
    previous_high = float(previous["high"])
    previous_low = float(previous["low"])

    if direction == "buy":
        if index >= 2 and low > float(bars[index - 2]["high"]):
            return {"kind": "FVG", "low": float(bars[index - 2]["high"]), "high": low}
        if close > open_price and close > previous_high and last_opposing:
            return {
                "kind": "Order block",
                "low": float(last_opposing["low"]),
                "high": float(last_opposing["open"]),
            }
        if last_opposing and close > float(last_opposing["open"]):
            level = float(last_opposing["open"])
            return {"kind": "CISD", "low": level, "high": level}
    else:
        if index >= 2 and high < float(bars[index - 2]["low"]):
            return {"kind": "FVG", "low": high, "high": float(bars[index - 2]["low"])}
        if close < open_price and close < previous_low and last_opposing:
            return {
                "kind": "Order block",
                "low": float(last_opposing["open"]),
                "high": float(last_opposing["high"]),
            }
        if last_opposing and close < float(last_opposing["open"]):
            level = float(last_opposing["open"])
            return {"kind": "CISD", "low": level, "high": level}
    return None


def generate_mtf_signals(
    ltf_bars: Sequence[Mapping],
    htf_bars: Sequence[Mapping],
    htf_minutes: int,
    atr_len: int = 14,
    atr_buffer: float = 0.15,
    setup_expiry_bars: int = 24,
    session_offset_seconds: int = 0,
) -> tuple[list[dict], list[dict]]:
    if not ltf_bars or not htf_bars or atr_len < 1 or setup_expiry_bars < 1:
        return [], []

    levels = _strategy_key_levels(htf_bars, htf_minutes, session_offset_seconds)
    atr_values = _atr_values(ltf_bars, atr_len)
    active_levels: list[dict] = []
    used_levels: set[tuple[str, float]] = set()
    level_index = 0
    pending: dict | None = None
    signals: list[dict] = []
    ltf_seconds = int(ltf_bars[1]["time"]) - int(ltf_bars[0]["time"]) if len(ltf_bars) > 1 else 60

    for index, bar in enumerate(ltf_bars):
        timestamp = int(bar["time"])
        while level_index < len(levels) and levels[level_index]["available_time"] <= timestamp:
            active_levels.append(levels[level_index])
            level_index += 1

        low = float(bar["low"])
        high = float(bar["high"])
        close = float(bar["close"])
        swept = []
        for level in active_levels:
            key = (level["direction"], round(float(level["price"]), 8))
            if key in used_levels:
                continue
            price = float(level["price"])
            if level["direction"] == "support" and low < price and close > price:
                swept.append(("buy", level, low))
            elif level["direction"] == "resistance" and high > price and close < price:
                swept.append(("sell", level, high))

        if swept:
            direction, level, extreme = min(swept, key=lambda candidate: abs(close - float(candidate[1]["price"])))
            used_levels.add((level["direction"], round(float(level["price"]), 8)))
            pending = {
                "direction": direction,
                "level_direction": level["direction"],
                "sweep_index": index,
                "sweep_extreme": extreme,
                "key_level": float(level["price"]),
                "key_source": level["source"],
                "zone": None,
                "last_opposing": None,
            }

        if pending is None:
            continue
        if index - pending["sweep_index"] > setup_expiry_bars:
            pending = None
            continue
        if index > pending["sweep_index"]:
            invalidated = close < pending["key_level"] if pending["direction"] == "buy" else close > pending["key_level"]
            if invalidated:
                pending = None
                continue

        is_opposing = (
            float(bar["close"]) < float(bar["open"])
            if pending["direction"] == "buy"
            else float(bar["close"]) > float(bar["open"])
        )
        if is_opposing:
            pending["last_opposing"] = bar

        if index > pending["sweep_index"]:
            candidate_zone = _entry_zone(
                pending["direction"],
                index,
                ltf_bars,
                pending["last_opposing"],
            )
            priority = {"FVG": 0, "Order block": 1, "CISD": 2}
            selected_zone = pending["zone"]
            if candidate_zone and (
                selected_zone is None
                or priority[candidate_zone["kind"]] < priority[selected_zone["kind"]]
            ):
                candidate_zone["available_index"] = index + 1
                pending["zone"] = candidate_zone

        zone = pending["zone"]
        if not zone or index < zone["available_index"] or index == 0 or atr_values[index - 1] is None:
            continue
        zone_low = float(zone["low"])
        zone_high = float(zone["high"])
        if low > zone_high or high < zone_low:
            continue

        entry = (zone_low + zone_high) / 2
        atr = float(atr_values[index - 1])
        stop = (
            pending["sweep_extreme"] - atr * atr_buffer
            if pending["direction"] == "buy"
            else pending["sweep_extreme"] + atr * atr_buffer
        )
        risk = entry - stop if pending["direction"] == "buy" else stop - entry
        if risk <= 0:
            pending = None
            continue
        signals.append({
            "direction": pending["direction"],
            "entry_time": timestamp,
            "entry_index": index,
            "entry": entry,
            "stop": stop,
            "sweep_time": int(ltf_bars[pending["sweep_index"]]["time"]),
            "sweep_extreme": pending["sweep_extreme"],
            "key_level": pending["key_level"],
            "key_source": pending["key_source"],
            "setup": zone["kind"],
        })
        pending = None

    latest_time = int(ltf_bars[-1]["time"])
    visible_levels = [
        level for level in levels
        if level["available_time"] <= latest_time
    ]
    current_price = float(ltf_bars[-1]["close"])
    nearest_levels = []
    for direction in ("support", "resistance"):
        candidates = [level for level in visible_levels if level["direction"] == direction]
        candidates.sort(key=lambda level: abs(float(level["price"]) - current_price))
        nearest_levels.extend({
            **level,
            "time": level["available_time"],
        } for level in candidates[:3])
    return signals, nearest_levels


def _confluent_h4_h1_levels(
    h1_bars: Sequence[Mapping],
    h4_bars: Sequence[Mapping],
    session_offset_seconds: int,
    htf_minutes: int = 240,
    m15_bars: Sequence[Mapping] | None = None,
) -> list[dict]:
    h1_levels = _strategy_key_levels(h1_bars, 60, session_offset_seconds)
    htf_levels = _strategy_key_levels(h4_bars, htf_minutes, session_offset_seconds)
    confluences: list[dict] = []
    htf_label = f"H{htf_minutes // 60}"

    for h1_level in h1_levels:
        h1_price = float(h1_level["price"])
        matches = [
            level for level in htf_levels
            if level["direction"] == h1_level["direction"]
            and float(level["zone_low"]) <= h1_price <= float(level["zone_high"])
        ]
        if not matches:
            continue
        htf_level = min(
            matches,
            key=lambda level: (
                abs(float(level["price"]) - h1_price),
                -int(level["available_time"]),
            ),
        )
        available_time = max(htf_level["available_time"], h1_level["available_time"])
        confluences.append({
            "price": h1_price,
            "direction": h1_level["direction"],
            "source": f"{htf_label} {htf_level['source']} + H1 {h1_level['source']}",
            "h4_source": htf_level["source"],
            "h1_source": h1_level["source"],
            "h4_price": float(htf_level["price"]),
            "htf_price": float(htf_level["price"]),
            "h1_price": h1_price,
            "zone_low": max(float(htf_level["zone_low"]), float(h1_level["zone_low"])),
            "zone_high": min(float(htf_level["zone_high"]), float(h1_level["zone_high"])),
            "available_time": available_time,
        })

    if m15_bars is not None:
        m15_levels = _strategy_key_levels(m15_bars, 15, session_offset_seconds)
        filtered: list[dict] = []
        for confluence in confluences:
            matches = [
                level for level in m15_levels
                if level["direction"] == confluence["direction"]
                and float(confluence["zone_low"]) <= float(level["price"]) <= float(confluence["zone_high"])
            ]
            for m15_level in matches:
                filtered.append({
                    **confluence,
                    "price": float(m15_level["price"]),
                    "m15_price": float(m15_level["price"]),
                    "source": f"{confluence['source']} + M15 {m15_level['source']}",
                    "m15_source": m15_level["source"],
                    "zone_low": max(float(confluence["zone_low"]), float(m15_level["zone_low"])),
                    "zone_high": min(float(confluence["zone_high"]), float(m15_level["zone_high"])),
                    "available_time": max(
                        int(confluence["available_time"]),
                        int(m15_level["available_time"]),
                    ),
                })
        confluences = filtered
    return sorted(confluences, key=lambda level: level["available_time"])


def _multi_timeframe_key_levels(
    timeframe_bars: Sequence[tuple[int, Sequence[Mapping]]],
    session_offset_seconds: int,
) -> list[dict]:
    unique_timeframes = {
        minutes: bars for minutes, bars in timeframe_bars if bars
    }
    if len(unique_timeframes) < 2:
        return []

    frame_levels: dict[int, list[dict]] = {
        minutes: _strategy_key_levels(bars, minutes, session_offset_seconds)
        for minutes, bars in unique_timeframes.items()
    }
    labels = {minutes: f"H{minutes // 60}" for minutes in unique_timeframes}
    confluences: dict[tuple, dict] = {}

    for anchor_minutes, levels in frame_levels.items():
        for anchor in levels:
            anchor_price = float(anchor["price"])
            matched = {anchor_minutes: anchor}
            for other_minutes, candidates in frame_levels.items():
                if other_minutes == anchor_minutes:
                    continue
                nearby = [
                    candidate for candidate in candidates
                    if candidate["direction"] == anchor["direction"]
                    and float(candidate["zone_low"]) <= anchor_price <= float(candidate["zone_high"])
                    and float(anchor["zone_low"]) <= float(candidate["price"]) <= float(anchor["zone_high"])
                ]
                if nearby:
                    matched[other_minutes] = min(
                        nearby,
                        key=lambda candidate: (
                            abs(float(candidate["price"]) - anchor_price),
                            -int(candidate["available_time"]),
                        ),
                    )

            if len(matched) < 2:
                continue
            members = sorted(matched.items())
            prices = [float(level["price"]) for _, level in members]
            zone_low = max(float(level["zone_low"]) for _, level in members)
            zone_high = min(float(level["zone_high"]) for _, level in members)
            if zone_low > zone_high:
                continue
            identity = (
                anchor["direction"],
                tuple((minutes, round(float(level["price"]), 8)) for minutes, level in members),
            )
            frame_prices = {
                labels[minutes]: float(level["price"])
                for minutes, level in members
            }
            source = " + ".join(
                f"{labels[minutes]} {level['source']}"
                for minutes, level in members
            )
            confluences[identity] = {
                "price": sum(prices) / len(prices),
                "direction": anchor["direction"],
                "source": source,
                "h4_source": matched[240]["source"] if 240 in matched else None,
                "h1_source": matched[60]["source"] if 60 in matched else None,
                "h4_price": frame_prices.get("H4"),
                "htf_price": frame_prices.get(f"H{max(unique_timeframes) // 60}"),
                "h1_price": frame_prices.get("H1"),
                "m15_price": None,
                "confluence_timeframes": [labels[minutes] for minutes, _ in members],
                "confluence_count": len(members),
                "zone_low": zone_low,
                "zone_high": zone_high,
                "available_time": max(
                    int(level["available_time"]) for _, level in members
                ),
            }

    return sorted(confluences.values(), key=lambda level: level["available_time"])


def _failed_break_reversal_setup(
    ltf_bars: Sequence[Mapping],
    breakout_index: int,
    reclaim_index: int,
    direction: str,
    breakout: Mapping,
    atr_values: Sequence[float | None],
    atr_buffer: float,
) -> dict | None:
    structure_bars = ltf_bars[max(0, breakout_index - 3):breakout_index]
    if len(structure_bars) != 3:
        return None

    breakout_bar = ltf_bars[breakout_index]
    reclaim_bar = ltf_bars[reclaim_index]
    structure_level = (
        max(float(item["high"]) for item in structure_bars)
        if direction == "buy"
        else min(float(item["low"]) for item in structure_bars)
    )
    sweep_extreme = (
        min(float(item["low"]) for item in ltf_bars[breakout_index:reclaim_index + 1])
        if direction == "buy"
        else max(float(item["high"]) for item in ltf_bars[breakout_index:reclaim_index + 1])
    )
    setup = {
        "kind": "failed_break_reversal",
        "direction": direction,
        "level_direction": breakout["level_direction"],
        "sweep_index": breakout_index,
        "sweep_extreme": sweep_extreme,
        "sweep_body": abs(float(breakout_bar["close"]) - float(breakout_bar["open"])),
        "sweep_high": float(breakout_bar["high"]),
        "sweep_low": float(breakout_bar["low"]),
        "key_level": float(breakout["key_level"]),
        "key_source": breakout["key_source"],
        "h4_key_level": breakout["h4_key_level"],
        "h1_key_level": breakout["h1_key_level"],
        "structure_level": structure_level,
        "phase": "awaiting_displacement",
    }

    reclaim_open = float(reclaim_bar["open"])
    reclaim_close = float(reclaim_bar["close"])
    reclaim_body = abs(reclaim_close - reclaim_open)
    if direction == "buy":
        displaced = (
            reclaim_close > reclaim_open
            and reclaim_close > setup["sweep_high"]
            and reclaim_close > structure_level
        )
    else:
        displaced = (
            reclaim_close < reclaim_open
            and reclaim_close < setup["sweep_low"]
            and reclaim_close < structure_level
        )
    if reclaim_body <= setup["sweep_body"] or not displaced or atr_values[reclaim_index - 1] is None:
        return setup

    opposing_index = next((
        prior_index
        for prior_index in range(reclaim_index - 1, breakout_index - 1, -1)
        if (
            float(ltf_bars[prior_index]["close"]) < float(ltf_bars[prior_index]["open"])
            if direction == "buy"
            else float(ltf_bars[prior_index]["close"]) > float(ltf_bars[prior_index]["open"])
        )
    ), None)
    if opposing_index is None:
        return setup

    opposing = ltf_bars[opposing_index]
    opposing_open = float(opposing["open"])
    opposing_high = float(opposing["high"])
    opposing_low = float(opposing["low"])
    cisd_confirmed = reclaim_close > opposing_high if direction == "buy" else reclaim_close < opposing_low
    fair_value_gap = (
        float(reclaim_bar["low"]) > float(ltf_bars[reclaim_index - 2]["high"])
        if direction == "buy" and reclaim_index >= 2
        else float(reclaim_bar["high"]) < float(ltf_bars[reclaim_index - 2]["low"])
        if direction == "sell" and reclaim_index >= 2
        else False
    )
    strength = (
        "MSNR + BOS + OB + CISD + FVG"
        if cisd_confirmed and fair_value_gap
        else "MSNR + BOS + OB + CISD"
        if cisd_confirmed
        else "MSNR + BOS + OB + FVG"
        if fair_value_gap
        else "MSNR + BOS + OB"
    )
    block_low, block_high = (
        (opposing_low, opposing_open)
        if direction == "buy"
        else (opposing_open, opposing_high)
    )
    atr = float(atr_values[reclaim_index - 1])
    stop = block_low - atr * atr_buffer if direction == "buy" else block_high + atr * atr_buffer
    setup.update({
        "phase": "awaiting_retest",
        "confirmation_index": reclaim_index,
        "order_block_index": opposing_index,
        "order_block_low": block_low,
        "order_block_high": block_high,
        "structure_break": structure_level,
        "msnr_confirmed": True,
        "cisd_confirmed": cisd_confirmed,
        "fvg_confirmed": fair_value_gap,
        "signal_strength": strength,
        "stop": stop,
    })
    return setup


def _market_structure_breaker_setup(
    bars: Sequence[Mapping],
    index: int,
    active_levels: Sequence[Mapping],
    atr_values: Sequence[float | None],
    atr_buffer: float,
    setup_expiry_bars: int,
) -> dict | None:
    if index < 7 or atr_values[index] is None:
        return None

    bar = bars[index]
    open_price = float(bar["open"])
    high = float(bar["high"])
    low = float(bar["low"])
    close = float(bar["close"])
    atr = float(atr_values[index])
    body = abs(close - open_price)
    bar_range = high - low
    if bar_range <= 0 or body < atr * 0.35:
        return None

    direction = "sell" if close < open_price else "buy" if close > open_price else None
    if direction is None:
        return None
    close_position = (close - low) / bar_range
    if (direction == "sell" and close_position > 0.25) or (
        direction == "buy" and close_position < 0.75
    ):
        return None

    start = max(2, index - 30)
    pivot_field = "low" if direction == "sell" else "high"
    pivot_indices = [
        pivot
        for pivot in range(start, index - 1)
        if all(
            (
                float(bars[pivot][pivot_field]) < float(bars[neighbor][pivot_field])
                if direction == "sell"
                else float(bars[pivot][pivot_field]) > float(bars[neighbor][pivot_field])
            )
            for neighbor in (pivot - 2, pivot - 1, pivot + 1, pivot + 2)
        )
    ]
    if not pivot_indices:
        return None

    structure_index = pivot_indices[-1]
    structure_level = float(bars[structure_index][pivot_field])
    previous_close = float(bars[index - 1]["close"])
    clearance = atr * 0.05
    structure_broken = (
        previous_close >= structure_level
        and close < structure_level - clearance
        if direction == "sell"
        else previous_close <= structure_level
        and close > structure_level + clearance
    )
    if not structure_broken:
        return None

    sweep_candidates: list[tuple[int, Mapping, float]] = []
    for sweep_index in range(max(6, index - setup_expiry_bars), index - 2):
        if structure_index <= sweep_index:
            continue
        prior = bars[sweep_index - 6:sweep_index]
        sweep_bar = bars[sweep_index]
        sweep_atr = atr_values[sweep_index]
        if len(prior) != 6 or sweep_atr is None:
            continue

        if direction == "sell":
            prior_high = max(float(item["high"]) for item in prior)
            sweep_extreme = float(sweep_bar["high"])
            swept_and_rejected = (
                sweep_extreme >= prior_high + float(sweep_atr) * 0.1
                and float(sweep_bar["close"]) < prior_high
            )
            zone_edge = "zone_high"
        else:
            prior_low = min(float(item["low"]) for item in prior)
            sweep_extreme = float(sweep_bar["low"])
            swept_and_rejected = (
                sweep_extreme <= prior_low - float(sweep_atr) * 0.1
                and float(sweep_bar["close"]) > prior_low
            )
            zone_edge = "zone_low"
        if not swept_and_rejected:
            continue

        matching_levels = [
            level for level in active_levels
            if int(level["available_time"]) <= int(sweep_bar["time"])
            and abs(sweep_extreme - float(level[zone_edge])) <= float(sweep_atr) * 0.2
        ]
        for level in matching_levels:
            sweep_candidates.append((sweep_index, level, sweep_extreme))

    if not sweep_candidates:
        return None

    sweep_index, level, sweep_extreme = min(
        sweep_candidates,
        key=lambda item: (
            index - item[0],
            abs(
                item[2]
                - float(item[1]["zone_high" if direction == "sell" else "zone_low"])
            ),
        ),
    )
    opposing_index = next((
        prior_index
        for prior_index in range(index - 1, sweep_index, -1)
        if (
            float(bars[prior_index]["close"]) > float(bars[prior_index]["open"])
            if direction == "sell"
            else float(bars[prior_index]["close"]) < float(bars[prior_index]["open"])
        )
    ), None)
    if opposing_index is None:
        return None

    opposing = bars[opposing_index]
    opposing_open = float(opposing["open"])
    opposing_low = float(opposing["low"])
    opposing_high = float(opposing["high"])
    block_low, block_high = (
        (opposing_open, opposing_high)
        if direction == "sell"
        else (opposing_low, opposing_open)
    )
    cisd_confirmed = close < opposing_low if direction == "sell" else close > opposing_high
    if not cisd_confirmed:
        return None

    fair_value_gap = (
        high < float(bars[index - 2]["low"])
        if direction == "sell"
        else low > float(bars[index - 2]["high"])
    )
    stop = (
        block_high + atr * atr_buffer
        if direction == "sell"
        else block_low - atr * atr_buffer
    )
    strength = (
        "MSNR + Liquidity Sweep + BOS + CISD + Breaker Block + FVG"
        if fair_value_gap
        else "MSNR + Liquidity Sweep + BOS + CISD + Breaker Block"
    )
    return {
        "kind": "structure_reversal",
        "direction": direction,
        "level_direction": level["direction"],
        "sweep_index": sweep_index,
        "sweep_extreme": sweep_extreme,
        "key_level": float(level["price"]),
        "key_source": level["source"],
        "h4_key_level": level["h4_price"],
        "h1_key_level": level["h1_price"],
        "key_zone_low": float(level["zone_low"]),
        "key_zone_high": float(level["zone_high"]),
        "phase": "awaiting_retest",
        "confirmation_index": index,
        "order_block_index": opposing_index,
        "order_block_low": block_low,
        "order_block_high": block_high,
        "structure_break": structure_level,
        "msnr_confirmed": True,
        "cisd_confirmed": True,
        "fvg_confirmed": fair_value_gap,
        "signal_strength": strength,
        "stop": stop,
    }


def generate_hierarchical_signals(
    ltf_bars: Sequence[Mapping],
    h1_bars: Sequence[Mapping],
    h4_bars: Sequence[Mapping],
    atr_len: int = 14,
    atr_buffer: float = 0.15,
    setup_expiry_bars: int = 24,
    session_offset_seconds: int = 0,
    include_watch_signals: bool = False,
    m15_bars: Sequence[Mapping] | None = None,
    htf_minutes: int = 240,
    signal_on_cisd: bool = False,
    additional_timeframes: Sequence[tuple[int, Sequence[Mapping]]] | None = None,
) -> tuple[list[dict], list[dict]]:
    if (
        not ltf_bars
        or not h1_bars
        or not h4_bars
        or atr_len < 1
        or setup_expiry_bars < 1
    ):
        return [], []

    if additional_timeframes is None:
        levels = _confluent_h4_h1_levels(
            h1_bars,
            h4_bars,
            session_offset_seconds,
            htf_minutes=htf_minutes,
            m15_bars=m15_bars,
        )
    else:
        levels = _multi_timeframe_key_levels(
            [
                (60, h1_bars),
                (htf_minutes, h4_bars),
                *additional_timeframes,
            ],
            session_offset_seconds,
        )
    atr_values = _atr_values(ltf_bars, atr_len)
    active_levels: list[dict] = []
    pending: list[dict] = []
    last_level_signal: dict[tuple[str, float], int] = {}
    emitted_entries: set[tuple[str, int]] = set()
    level_index = 0
    signals: list[dict] = []

    for index, bar in enumerate(ltf_bars):
        timestamp = int(bar["time"])
        while level_index < len(levels) and levels[level_index]["available_time"] <= timestamp:
            active_levels.append(levels[level_index])
            level_index += 1

        low = float(bar["low"])
        high = float(bar["high"])
        close = float(bar["close"])
        swept: list[tuple[str, dict, float]] = []
        for level in active_levels:
            key = (level["direction"], round(float(level["price"]), 8))
            if index - last_level_signal.get(key, -setup_expiry_bars - 1) <= setup_expiry_bars:
                continue
            price = float(level["price"])
            if level["direction"] == "support" and low < price < close:
                swept.append(("buy", level, low))
            elif level["direction"] == "resistance" and close < price < high:
                swept.append(("sell", level, high))

        if swept:
            direction, level, extreme = min(
                swept,
                key=lambda candidate: abs(close - float(candidate[1]["price"])),
            )
            pending = [
                setup for setup in pending
                if not (
                    setup["direction"] == direction
                    and setup.get("level_direction") == level["direction"]
                    and round(float(setup["key_level"]), 8) == round(float(level["price"]), 8)
                    and setup.get("kind") != "breakout"
                )
            ]
            structure_bars = ltf_bars[max(0, index - 3):index]
            if len(structure_bars) != 3:
                continue
            structure_level = (
                max(float(item["high"]) for item in structure_bars)
                if direction == "buy"
                else min(float(item["low"]) for item in structure_bars)
            )
            pending.append({
                "direction": direction,
                "level_direction": level["direction"],
                "sweep_index": index,
                "sweep_extreme": extreme,
                "sweep_body": abs(float(bar["close"]) - float(bar["open"])),
                "sweep_high": high,
                "sweep_low": low,
                "key_level": float(level["price"]),
                "key_source": level["source"],
                "h4_key_level": level["h4_price"],
                "htf_key_level": level.get("htf_price", level["h4_price"]),
                "h1_key_level": level["h1_price"],
                "m15_key_level": level.get("m15_price"),
                "confluence_timeframes": level.get("confluence_timeframes", []),
                "confluence_count": level.get("confluence_count", 2),
                "structure_level": structure_level,
                "phase": "awaiting_displacement",
            })

        breakout_candidates: list[tuple[str, dict]] = []
        if index > 0:
            previous_close = float(ltf_bars[index - 1]["close"])
            for level in active_levels:
                key = (level["direction"], round(float(level["price"]), 8))
                if index - last_level_signal.get(key, -setup_expiry_bars - 1) <= setup_expiry_bars:
                    continue
                pending_matches = [
                    setup for setup in pending
                    if setup.get("level_direction") == key[0]
                    and round(float(setup["key_level"]), 8) == key[1]
                ]
                if any(
                    not (
                        (setup["direction"] == "buy" and close < setup["key_level"])
                        or (setup["direction"] == "sell" and close > setup["key_level"])
                    )
                    for setup in pending_matches
                ):
                    continue
                price = float(level["price"])
                if level["direction"] == "resistance" and previous_close <= price < close:
                    breakout_candidates.append(("buy", level))
                elif level["direction"] == "support" and previous_close >= price > close:
                    breakout_candidates.append(("sell", level))

        if breakout_candidates:
            direction, level = min(
                breakout_candidates,
                key=lambda candidate: abs(close - float(candidate[1]["price"])),
            )
            pending.append({
                "kind": "breakout",
                "direction": direction,
                "level_direction": level["direction"],
                "sweep_index": index,
                "breakout_time": timestamp,
                "sweep_extreme": None,
                "sweep_body": 0.0,
                "sweep_high": high,
                "sweep_low": low,
                "key_level": float(level["price"]),
                "key_source": level["source"],
                "h4_key_level": level["h4_price"],
                "htf_key_level": level.get("htf_price", level["h4_price"]),
                "h1_key_level": level["h1_price"],
                "m15_key_level": level.get("m15_price"),
                "confluence_timeframes": level.get("confluence_timeframes", []),
                "confluence_count": level.get("confluence_count", 2),
                "phase": "awaiting_level_retest",
            })

        reversal = _market_structure_breaker_setup(
            ltf_bars,
            index,
            active_levels,
            atr_values,
            atr_buffer,
            setup_expiry_bars,
        )
        if reversal is not None:
            level_key = (
                str(reversal["level_direction"]),
                round(float(reversal["key_level"]), 8),
            )
            has_pending_reversal = any(
                setup.get("kind") == "structure_reversal"
                and setup["direction"] == reversal["direction"]
                and setup["level_direction"] == level_key[0]
                and round(float(setup["key_level"]), 8) == level_key[1]
                for setup in pending
            )
            within_signal_cooldown = (
                index - last_level_signal.get(level_key, -setup_expiry_bars - 1)
                <= setup_expiry_bars
            )
            if not has_pending_reversal and not within_signal_cooldown:
                pending = [
                    setup for setup in pending
                    if (
                        setup["level_direction"] != level_key[0]
                        or round(float(setup["key_level"]), 8) != level_key[1]
                    )
                ]
                pending.append(reversal)

        still_pending = []
        for setup in pending:
            direction = setup["direction"]
            sweep_index = int(setup["sweep_index"])
            if index <= sweep_index:
                still_pending.append(setup)
                continue
            if index - sweep_index > setup_expiry_bars:
                continue
            if setup.get("phase") == "awaiting_optional_retest":
                block_entry = (
                    float(setup["order_block_high"])
                    if direction == "buy"
                    else float(setup["order_block_low"])
                )
                retested = (
                    low <= block_entry <= high and close > block_entry
                    if direction == "buy"
                    else low <= block_entry <= high and close < block_entry
                )
                stop_hit = (
                    low <= float(setup["stop"])
                    if direction == "buy"
                    else high >= float(setup["stop"])
                )
                if retested and not stop_hit:
                    signal = signals[int(setup["signal_index"])]
                    signal["retest_confirmed"] = True
                    signal["retest_time"] = timestamp
                elif not stop_hit:
                    still_pending.append(setup)
                continue
            is_breakout = setup.get("kind") == "breakout"
            failed_reversal_retest = (
                setup.get("kind") == "failed_break_reversal"
                and setup["phase"] == "awaiting_retest"
            )
            structure_reversal_retest = (
                setup.get("kind") == "structure_reversal"
                and setup["phase"] == "awaiting_retest"
            )
            invalidated = not (
                failed_reversal_retest or structure_reversal_retest
            ) and (
                direction == "buy" and (
                    close <= setup["key_level"] if is_breakout else close < setup["key_level"]
                )
                or (
                    direction == "sell" and (
                        close >= setup["key_level"] if is_breakout else close > setup["key_level"]
                    )
                )
            )
            if invalidated and is_breakout:
                reversal_direction = "sell" if direction == "buy" else "buy"
                setup_key = round(float(setup["key_level"]), 8)
                reversal = _failed_break_reversal_setup(
                    ltf_bars,
                    sweep_index,
                    index,
                    reversal_direction,
                    setup,
                    atr_values,
                    atr_buffer,
                )
                if reversal is not None:
                    still_pending.append(reversal)
                continue
            if invalidated:
                continue

            if is_breakout and setup["phase"] == "awaiting_level_retest":
                level_retested = (
                    low <= float(setup["key_level"])
                    and close > float(setup["key_level"])
                    and close > float(bar["open"])
                    if direction == "buy"
                    else high >= float(setup["key_level"])
                    and close < float(setup["key_level"])
                    and close < float(bar["open"])
                )
                if not level_retested:
                    still_pending.append(setup)
                    continue
                setup["phase"] = "awaiting_displacement"
                setup["level_retest_index"] = index
                still_pending.append(setup)
                continue

            if setup["phase"] == "awaiting_displacement":
                if is_breakout:
                    structure_bars = ltf_bars[max(0, index - 3):index]
                    if len(structure_bars) != 3 or index == 0 or atr_values[index - 1] is None:
                        still_pending.append(setup)
                        continue
                    body = abs(float(bar["close"]) - float(bar["open"]))
                    previous_body = abs(
                        float(ltf_bars[index - 1]["close"]) - float(ltf_bars[index - 1]["open"])
                    )
                    structure_level = (
                        max(float(item["high"]) for item in structure_bars)
                        if direction == "buy"
                        else min(float(item["low"]) for item in structure_bars)
                    )
                    structure_broken = (
                        close > structure_level and close > float(bar["open"])
                        if direction == "buy"
                        else close < structure_level and close < float(bar["open"])
                    )
                    if body <= previous_body or not structure_broken:
                        still_pending.append(setup)
                        continue

                    opposing_index = next((
                        prior_index
                        for prior_index in range(index - 1, max(-1, index - 6), -1)
                        if (
                            float(ltf_bars[prior_index]["close"]) < float(ltf_bars[prior_index]["open"])
                            if direction == "buy"
                            else float(ltf_bars[prior_index]["close"]) > float(ltf_bars[prior_index]["open"])
                        )
                    ), None)
                    if opposing_index is None:
                        still_pending.append(setup)
                        continue
                    opposing = ltf_bars[opposing_index]
                    opposing_open = float(opposing["open"])
                    opposing_high = float(opposing["high"])
                    opposing_low = float(opposing["low"])
                    cisd_confirmed = (
                        close > opposing_high
                        if direction == "buy"
                        else close < opposing_low
                    )
                    if not cisd_confirmed:
                        still_pending.append(setup)
                        continue

                    fair_value_gap = (
                        low > float(ltf_bars[index - 2]["high"])
                        if direction == "buy" and index >= 2
                        else high < float(ltf_bars[index - 2]["low"])
                        if direction == "sell" and index >= 2
                        else False
                    )
                    strength = (
                        "MSNR + BOS + OB + CISD + FVG"
                        if fair_value_gap
                        else "MSNR + BOS + OB + CISD"
                    )
                    atr = float(atr_values[index - 1])
                    block_low, block_high = (
                        (opposing_low, opposing_open)
                        if direction == "buy"
                        else (opposing_open, opposing_high)
                    )
                    stop = (
                        block_low - atr * atr_buffer
                        if direction == "buy"
                        else block_high + atr * atr_buffer
                    )
                    setup.update({
                        "phase": "awaiting_retest",
                        "confirmation_index": index,
                        "order_block_index": opposing_index,
                        "order_block_low": block_low,
                        "order_block_high": block_high,
                        "structure_break": structure_level,
                        "msnr_confirmed": True,
                        "cisd_confirmed": True,
                        "fvg_confirmed": fair_value_gap,
                        "signal_strength": strength,
                        "stop": stop,
                    })
                    still_pending.append(setup)
                    continue

                body = abs(float(bar["close"]) - float(bar["open"]))
                if body <= setup["sweep_body"]:
                    still_pending.append(setup)
                    continue
                if direction == "buy":
                    displaced = (
                        close > float(bar["open"])
                        and close > setup["sweep_high"]
                        and close > setup["structure_level"]
                    )
                else:
                    displaced = (
                        close < float(bar["open"])
                        and close < setup["sweep_low"]
                        and close < setup["structure_level"]
                    )
                if not displaced:
                    still_pending.append(setup)
                    continue

                last_opposing_index = next((
                    prior_index
                    for prior_index in range(index - 1, sweep_index - 1, -1)
                    if (
                        float(ltf_bars[prior_index]["close"]) < float(ltf_bars[prior_index]["open"])
                        if direction == "buy"
                        else float(ltf_bars[prior_index]["close"]) > float(ltf_bars[prior_index]["open"])
                    )
                ), None)
                if last_opposing_index is None or atr_values[index - 1] is None:
                    continue

                order_block = ltf_bars[last_opposing_index]
                block_open = float(order_block["open"])
                block_low = float(order_block["low"])
                block_high = float(order_block["high"])
                block_bottom, block_top = (
                    (block_low, block_open)
                    if direction == "buy"
                    else (block_open, block_high)
                )
                previous_opposing_extreme = (
                    block_high if direction == "buy" else block_low
                )
                cisd_confirmed = (
                    close > previous_opposing_extreme
                    if direction == "buy"
                    else close < previous_opposing_extreme
                )
                fair_value_gap = (
                    low > float(ltf_bars[index - 2]["high"])
                    if direction == "buy" and index >= 2
                    else high < float(ltf_bars[index - 2]["low"])
                    if direction == "sell" and index >= 2
                    else False
                )
                if cisd_confirmed and fair_value_gap:
                    strength = "MSNR + OB + CISD + FVG"
                elif fair_value_gap:
                    strength = "MSNR + OB + FVG"
                elif cisd_confirmed:
                    strength = "MSNR + OB + CISD"
                else:
                    strength = "MSNR + OB"

                atr = float(atr_values[index - 1])
                stop = (
                    setup["sweep_extreme"] - atr * atr_buffer
                    if direction == "buy"
                    else setup["sweep_extreme"] + atr * atr_buffer
                )
                setup.update({
                    "phase": "awaiting_retest",
                    "confirmation_index": index,
                    "order_block_index": last_opposing_index,
                    "order_block_low": block_bottom,
                    "order_block_high": block_top,
                    "structure_break": float(setup["structure_level"]),
                    "signal_strength": strength,
                    "cisd_confirmed": cisd_confirmed,
                    "fvg_confirmed": fair_value_gap,
                    "stop": stop,
                })
                if signal_on_cisd and not is_breakout and setup.get("kind") is None:
                    if not cisd_confirmed:
                        still_pending.append(setup)
                        continue
                    entry = close
                    risk = entry - stop if direction == "buy" else stop - entry
                    if risk <= 0:
                        continue
                    session_context = _session_signal_context(
                        ltf_bars,
                        sweep_index,
                        index,
                        index,
                        direction,
                        entry,
                        float(atr_values[index] or 0.0),
                        _LANKA_UTC_OFFSET_SECONDS,
                    )
                    strength_score = (
                        1
                        + int(bool(setup.get("msnr_confirmed", True)))
                        + int(cisd_confirmed)
                        + int(fair_value_gap)
                        + int(session_context["session_liquidity_swept"])
                        + int(session_context["session_profile_confirmed"])
                    )
                    strength_label, strength_emoji = (
                        ("VERY STRONG", "🔥")
                        if strength_score >= 6 or (
                            session_context["session_liquidity_swept"]
                            and session_context["session_profile_confirmed"]
                        )
                        else ("STRONG", "💪")
                        if strength_score >= 5 or session_context["session_liquidity_swept"]
                        else ("CONFIRMED", "✅")
                        if strength_score >= 3
                        else ("BASE", "⚪")
                    )
                    signal = {
                        "direction": direction,
                        "signal_status": "confirmed",
                        "entry_time": timestamp,
                        "entry_index": index,
                        "entry": entry,
                        "stop": float(stop),
                        "sweep_time": int(ltf_bars[sweep_index]["time"]),
                        "sweep_extreme": setup["sweep_extreme"],
                        "confirmation_time": timestamp,
                        "order_block_time": int(ltf_bars[last_opposing_index]["time"]),
                        "order_block_low": block_bottom,
                        "order_block_high": block_top,
                        "structure_break": float(setup["structure_level"]),
                        "msnr_confirmed": True,
                        "signal_type": "liquidity_sweep",
                        "key_level": setup["key_level"],
                        "key_zone_low": setup.get("key_zone_low"),
                        "key_zone_high": setup.get("key_zone_high"),
                        "h4_key_level": setup["h4_key_level"],
                        "htf_key_level": setup.get("htf_key_level", setup["h4_key_level"]),
                        "h1_key_level": setup["h1_key_level"],
                        "m15_key_level": setup.get("m15_key_level"),
                        "confluence_timeframes": setup.get("confluence_timeframes", []),
                        "confluence_count": setup.get("confluence_count", 2),
                        "htf_timeframe": f"{htf_minutes // 60}h",
                        "key_source": setup["key_source"],
                        "setup": "Sweep + CISD",
                        "signal_strength": strength,
                        "cisd_confirmed": True,
                        "fvg_confirmed": fair_value_gap,
                        "retest_confirmed": False,
                        **session_context,
                        "strength_score": strength_score,
                        "strength_score_max": 6,
                        "strength_label": strength_label,
                        "strength_emoji": strength_emoji,
                    }
                    signals.append(signal)
                    entry_identity = (direction, timestamp)
                    emitted_entries.add(entry_identity)
                    signal_level_key = (
                        str(setup["level_direction"]),
                        round(float(setup["key_level"]), 8),
                    )
                    last_level_signal[signal_level_key] = index
                    setup["signal_index"] = len(signals) - 1
                    setup["phase"] = "awaiting_optional_retest"
                    still_pending.append(setup)
                    continue
                still_pending.append(setup)
                continue

            if index <= int(setup["confirmation_index"]):
                still_pending.append(setup)
                continue
            if (
                direction == "buy" and low <= float(setup["stop"])
            ) or (
                direction == "sell" and high >= float(setup["stop"])
            ):
                continue

            block_entry = (
                float(setup["order_block_high"])
                if direction == "buy"
                else float(setup["order_block_low"])
            )
            directional_rejection = close > block_entry if direction == "buy" else close < block_entry
            if not low <= block_entry <= high or not directional_rejection:
                still_pending.append(setup)
                continue

            risk = block_entry - float(setup["stop"]) if direction == "buy" else float(setup["stop"]) - block_entry
            if risk <= 0:
                continue
            signal_type = (
                "breakout"
                if is_breakout
                else "market_structure_reversal"
                if setup.get("kind") == "structure_reversal"
                else "failed_break_reversal"
                if setup.get("kind") == "failed_break_reversal"
                else "liquidity_sweep"
            )
            entry_identity = (direction, timestamp)
            if entry_identity in emitted_entries:
                continue
            signal_level_key = (
                str(setup["level_direction"]),
                round(float(setup["key_level"]), 8),
            )
            emitted_entries.add(entry_identity)
            last_level_signal[signal_level_key] = index
            session_context = _session_signal_context(
                ltf_bars,
                sweep_index,
                int(setup["confirmation_index"]),
                index,
                direction,
                block_entry,
                float(atr_values[index] or 0.0),
                _LANKA_UTC_OFFSET_SECONDS,
            )
            strength_score = (
                1
                + int(bool(setup.get("msnr_confirmed", True)))
                + int(bool(setup["cisd_confirmed"]))
                + int(bool(setup["fvg_confirmed"]))
                + int(session_context["session_liquidity_swept"])
                + int(session_context["session_profile_confirmed"])
            )
            strength_label, strength_emoji = (
                ("VERY STRONG", "🔥")
                if strength_score >= 6 or (
                    session_context["session_liquidity_swept"]
                    and session_context["session_profile_confirmed"]
                )
                else ("STRONG", "💪")
                if strength_score >= 5 or session_context["session_liquidity_swept"]
                else ("CONFIRMED", "✅")
                if strength_score >= 3
                else ("BASE", "⚪")
            )
            signals.append({
                "direction": direction,
                "signal_status": "confirmed",
                "entry_time": timestamp,
                "entry_index": index,
                "entry": block_entry,
                "stop": float(setup["stop"]),
                "sweep_time": int(ltf_bars[sweep_index]["time"]) if not is_breakout else None,
                "sweep_extreme": setup["sweep_extreme"],
                "confirmation_time": int(ltf_bars[int(setup["confirmation_index"])]["time"]),
                "order_block_time": int(ltf_bars[int(setup["order_block_index"])]["time"]),
                "order_block_low": setup["order_block_low"],
                "order_block_high": setup["order_block_high"],
                "structure_break": setup["structure_break"],
                "trendline_level": setup.get("trendline_level"),
                "trendline_pivots": setup.get("trendline_pivots"),
                "msnr_confirmed": setup.get("msnr_confirmed", True),
                "signal_type": signal_type,
                "key_level": setup["key_level"],
                "key_zone_low": setup.get("key_zone_low"),
                "key_zone_high": setup.get("key_zone_high"),
                "h4_key_level": setup["h4_key_level"],
                "htf_key_level": setup.get("htf_key_level", setup["h4_key_level"]),
                "h1_key_level": setup["h1_key_level"],
                "m15_key_level": setup.get("m15_key_level"),
                "htf_timeframe": f"{htf_minutes // 60}h",
                "key_source": setup["key_source"],
                "setup": (
                    "Breakout OB retest"
                    if is_breakout
                    else "MSS Breaker Block Retest"
                    if setup.get("kind") == "structure_reversal"
                    else "Sweep OB retest"
                ),
                "signal_strength": setup["signal_strength"],
                "cisd_confirmed": setup["cisd_confirmed"],
                "fvg_confirmed": setup["fvg_confirmed"],
                **session_context,
                "strength_score": strength_score,
                "strength_score_max": 6,
                "strength_label": strength_label,
                "strength_emoji": strength_emoji,
            })

        pending = still_pending

    latest_time = int(ltf_bars[-1]["time"])
    if include_watch_signals:
        for setup in pending:
            if (
                setup.get("phase") != "awaiting_retest"
                or "confirmation_index" not in setup
                or "order_block_index" not in setup
                or "stop" not in setup
            ):
                continue
            direction = str(setup["direction"])
            watch_entry = (
                float(setup["order_block_high"])
                if direction == "buy"
                else float(setup["order_block_low"])
            )
            risk = (
                watch_entry - float(setup["stop"])
                if direction == "buy"
                else float(setup["stop"]) - watch_entry
            )
            if risk <= 0:
                continue
            signals.append({
                "direction": direction,
                "signal_status": "watch",
                "entry_time": int(ltf_bars[int(setup["confirmation_index"])]["time"]),
                "watch_time": latest_time,
                "entry_index": len(ltf_bars) - 1,
                "entry": watch_entry,
                "stop": float(setup["stop"]),
                "sweep_time": int(ltf_bars[int(setup["sweep_index"])]["time"]),
                "sweep_extreme": setup["sweep_extreme"],
                "confirmation_time": int(ltf_bars[int(setup["confirmation_index"])]["time"]),
                "order_block_time": int(ltf_bars[int(setup["order_block_index"])]["time"]),
                "order_block_low": setup["order_block_low"],
                "order_block_high": setup["order_block_high"],
                "structure_break": setup["structure_break"],
                "msnr_confirmed": setup.get("msnr_confirmed", True),
                "signal_type": (
                    "market_structure_reversal"
                    if setup.get("kind") == "structure_reversal"
                    else "failed_break_reversal"
                    if setup.get("kind") == "failed_break_reversal"
                    else "breakout"
                    if setup.get("kind") == "breakout"
                    else "liquidity_sweep"
                ),
                "key_level": setup["key_level"],
                "key_zone_low": setup.get("key_zone_low"),
                "key_zone_high": setup.get("key_zone_high"),
                "h4_key_level": setup["h4_key_level"],
                "htf_key_level": setup.get("htf_key_level", setup["h4_key_level"]),
                "h1_key_level": setup["h1_key_level"],
                "m15_key_level": setup.get("m15_key_level"),
                "htf_timeframe": f"{htf_minutes // 60}h",
                "key_source": setup["key_source"],
                "setup": (
                    "Breakout OB retest"
                    if setup.get("kind") == "breakout"
                    else "MSS Breaker Block Retest"
                    if setup.get("kind") == "structure_reversal"
                    else "Sweep OB retest"
                ),
                "signal_strength": setup["signal_strength"],
                "cisd_confirmed": setup["cisd_confirmed"],
                "fvg_confirmed": setup["fvg_confirmed"],
            })
    visible_levels = [level for level in levels if level["available_time"] <= latest_time]
    current_price = float(ltf_bars[-1]["close"])
    nearest_levels = []
    for direction in ("support", "resistance"):
        candidates = [level for level in visible_levels if level["direction"] == direction]
        candidates.sort(key=lambda level: abs(float(level["price"]) - current_price))
        nearest_levels.extend({**level, "time": level["available_time"]} for level in candidates[:3])
    return signals, nearest_levels


def _trades_for_target(
    bars: Sequence[Mapping],
    signals: Sequence[Mapping],
    target_r: int,
) -> list[dict]:
    trades: list[dict] = []
    last_exit_index = -1
    for signal in signals:
        entry_index = int(signal["entry_index"])
        if entry_index <= last_exit_index:
            continue
        direction = str(signal["direction"])
        entry = float(signal["entry"])
        stop = float(signal["stop"])
        risk = entry - stop if direction == "buy" else stop - entry
        target = entry + risk * target_r if direction == "buy" else entry - risk * target_r
        exit_index = len(bars) - 1
        exit_price = float(bars[exit_index]["close"])
        outcome = "open"

        for future_index in range(entry_index + 1, len(bars)):
            future = bars[future_index]
            future_high = float(future["high"])
            future_low = float(future["low"])
            stop_hit = future_low <= stop if direction == "buy" else future_high >= stop
            target_hit = future_high >= target if direction == "buy" else future_low <= target
            if stop_hit:
                exit_index, exit_price, outcome = future_index, stop, "stop"
                break
            if target_hit:
                exit_index, exit_price, outcome = future_index, target, "target"
                break

        result_r = (exit_price - entry) / risk if direction == "buy" else (entry - exit_price) / risk
        trades.append({
            **{key: value for key, value in signal.items() if key != "entry_index"},
            "target": target,
            "exit_time": int(bars[exit_index]["time"]),
            "exit_price": exit_price,
            "result_r": result_r,
            "outcome": outcome,
        })
        last_exit_index = exit_index
    return trades


def _backtest_summary(trades: Sequence[Mapping], bar_count: int) -> dict:
    wins = sum(float(trade["result_r"]) > 0 for trade in trades)
    gross_profit = sum(
        float(trade["result_r"]) for trade in trades if float(trade["result_r"]) > 0
    )
    gross_loss = abs(sum(
        float(trade["result_r"]) for trade in trades if float(trade["result_r"]) < 0
    ))
    equity = peak = max_drawdown = 0.0
    for trade in trades:
        equity += float(trade["result_r"])
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    return {
        "bars": bar_count,
        "trades": len(trades),
        "wins": wins,
        "losses": len(trades) - wins,
        "win_rate": wins / len(trades) * 100 if trades else 0,
        "net_r": sum(float(trade["result_r"]) for trade in trades),
        "max_drawdown_r": max_drawdown,
        "profit_factor": gross_profit / gross_loss if gross_loss else None,
    }


def run_sweep_bos_backtest(
    bars: Sequence[Mapping],
    atr_len: int = 14,
    atr_buffer: float = 0.1,
    sweep_len: int = 8,
    bos_len: int = 5,
    confirm_bars: int = 5,
    start_time: int | None = None,
) -> dict:
    signals, key_levels = generate_sweep_bos_signals(
        bars,
        atr_len=atr_len,
        atr_buffer=atr_buffer,
        sweep_len=sweep_len,
        bos_len=bos_len,
        confirm_bars=confirm_bars,
    )
    if start_time is not None:
        signals = [
            signal for signal in signals if int(signal["entry_time"]) >= start_time
        ]

    results = []
    session_results = []
    bar_count = sum(
        start_time is None or start_time <= int(bar["time"])
        for bar in bars
    )
    for target_r in range(1, 6):
        trades = _trades_for_target(bars, signals, target_r)
        results.append({
            "target_r": target_r,
            "trades": trades,
            "summary": _backtest_summary(trades, bar_count),
        })
        session_names = sorted({
            name for trade in trades for name in trade.get("session_names", [])
        })
        for session_name in session_names:
            session_trades = [
                trade for trade in trades
                if session_name in trade.get("session_names", [])
            ]
            session_results.append({
                "target_r": target_r,
                "session": session_name,
                "summary": _backtest_summary(session_trades, bar_count),
            })
    return {
        "results": results,
        "session_results": session_results,
        "signals": signals,
        "key_levels": key_levels,
    }


def run_liquidity_cisd_backtest(
    ltf_bars: Sequence[Mapping],
    h1_bars: Sequence[Mapping],
    h4_bars: Sequence[Mapping],
    h7_bars: Sequence[Mapping],
    atr_len: int = 14,
    atr_buffer: float = 0.15,
    start_time: int | None = None,
) -> dict:
    signals, key_levels = generate_liquidity_cisd_signals(
        ltf_bars,
        h1_bars,
        h4_bars,
        h7_bars,
        atr_len=atr_len,
        atr_buffer=atr_buffer,
    )
    if start_time is not None:
        signals = [
            signal for signal in signals if int(signal["entry_time"]) >= start_time
        ]

    results = []
    session_results = []
    bar_count = sum(
        start_time is None or start_time <= int(bar["time"])
        for bar in ltf_bars
    )
    for target_r in range(1, 7):
        trades = _trades_for_target(ltf_bars, signals, target_r)
        results.append({
            "target_r": target_r,
            "trades": trades,
            "summary": _backtest_summary(trades, bar_count),
        })
        session_names = sorted({
            name for trade in trades for name in trade.get("session_names", [])
        })
        for session_name in session_names:
            session_trades = [
                trade for trade in trades
                if session_name in trade.get("session_names", [])
            ]
            session_results.append({
                "target_r": target_r,
                "session": session_name,
                "summary": _backtest_summary(session_trades, bar_count),
            })
    return {
        "results": results,
        "session_results": session_results,
        "signals": signals,
        "key_levels": key_levels,
    }


def run_mtf_backtest(
    ltf_bars: Sequence[Mapping],
    htf_bars: Sequence[Mapping],
    htf_minutes: int,
    atr_len: int = 14,
    atr_buffer: float = 0.15,
    start_time: int | None = None,
    session_offset_seconds: int = 0,
) -> dict:
    signals, key_levels = generate_mtf_signals(
        ltf_bars,
        htf_bars,
        htf_minutes,
        atr_len,
        atr_buffer,
        session_offset_seconds=session_offset_seconds,
    )
    if start_time is not None:
        signals = [signal for signal in signals if signal["entry_time"] >= start_time]

    results = []
    for target_r in range(1, 7):
        trades = _trades_for_target(ltf_bars, signals, target_r)
        wins = sum(trade["result_r"] > 0 for trade in trades)
        gross_profit = sum(trade["result_r"] for trade in trades if trade["result_r"] > 0)
        gross_loss = abs(sum(trade["result_r"] for trade in trades if trade["result_r"] < 0))
        equity = peak = max_drawdown = 0.0
        for trade in trades:
            equity += trade["result_r"]
            peak = max(peak, equity)
            max_drawdown = max(max_drawdown, peak - equity)
        results.append({
            "target_r": target_r,
            "trades": trades,
            "summary": {
                "bars": len(ltf_bars),
                "trades": len(trades),
                "wins": wins,
                "losses": len(trades) - wins,
                "win_rate": wins / len(trades) * 100 if trades else 0,
                "net_r": sum(trade["result_r"] for trade in trades),
                "max_drawdown_r": max_drawdown,
                "profit_factor": gross_profit / gross_loss if gross_loss else None,
            },
        })
    return {"results": results, "signals": signals, "key_levels": key_levels}


def run_hierarchical_backtest(
    ltf_bars: Sequence[Mapping],
    h1_bars: Sequence[Mapping],
    h4_bars: Sequence[Mapping],
    atr_len: int = 14,
    atr_buffer: float = 0.15,
    start_time: int | None = None,
    session_offset_seconds: int = 0,
    m15_bars: Sequence[Mapping] | None = None,
    htf_minutes: int = 240,
    signal_on_cisd: bool = False,
    additional_timeframes: Sequence[tuple[int, Sequence[Mapping]]] | None = None,
) -> dict:
    signals, key_levels = generate_hierarchical_signals(
        ltf_bars,
        h1_bars,
        h4_bars,
        atr_len=atr_len,
        atr_buffer=atr_buffer,
        session_offset_seconds=session_offset_seconds,
        m15_bars=m15_bars,
        htf_minutes=htf_minutes,
        signal_on_cisd=signal_on_cisd,
        additional_timeframes=additional_timeframes,
    )
    if start_time is not None:
        signals = [signal for signal in signals if signal["entry_time"] >= start_time]

    results = []
    for target_r in range(1, 7):
        trades = _trades_for_target(ltf_bars, signals, target_r)
        wins = sum(trade["result_r"] > 0 for trade in trades)
        gross_profit = sum(trade["result_r"] for trade in trades if trade["result_r"] > 0)
        gross_loss = abs(sum(trade["result_r"] for trade in trades if trade["result_r"] < 0))
        equity = peak = max_drawdown = 0.0
        for trade in trades:
            equity += trade["result_r"]
            peak = max(peak, equity)
            max_drawdown = max(max_drawdown, peak - equity)
        results.append({
            "target_r": target_r,
            "trades": trades,
            "summary": {
                "bars": len(ltf_bars),
                "trades": len(trades),
                "wins": wins,
                "losses": len(trades) - wins,
                "win_rate": wins / len(trades) * 100 if trades else 0,
                "net_r": sum(trade["result_r"] for trade in trades),
                "max_drawdown_r": max_drawdown,
                "profit_factor": gross_profit / gross_loss if gross_loss else None,
            },
        })
    return {"results": results, "signals": signals, "key_levels": key_levels}