import unittest
import datetime as dt
from unittest.mock import patch

from engine import (
    _active_sessions,
    _confluent_h4_h1_levels,
    _multi_timeframe_key_levels,
    _session_signal_context,
    _sweep_bos_sessions,
    aggregate_rates,
    generate_sweep_bos_signals,
    generate_liquidity_cisd_signals,
    generate_hierarchical_signals,
    generate_mtf_signals,
    run_backtest,
    run_hierarchical_backtest,
    run_liquidity_cisd_backtest,
    run_mtf_backtest,
    run_sweep_bos_backtest,
)


class AggregateRatesTests(unittest.TestCase):
    def test_combines_ohlcv_into_custom_period(self):
        rates = [
            {"time": 60, "open": 10, "high": 12, "low": 9, "close": 11, "tick_volume": 4},
            {"time": 120, "open": 11, "high": 13, "low": 10, "close": 12, "tick_volume": 6},
            {"time": 180, "open": 12, "high": 14, "low": 11, "close": 13, "tick_volume": 2},
        ]

        bars = aggregate_rates(rates, 2)

        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[0], {"time": 0, "open": 10.0, "high": 12.0, "low": 9.0, "close": 11.0, "volume": 4.0})
        self.assertEqual(bars[1]["time"], 120)
        self.assertEqual(bars[1]["volume"], 8.0)


class SessionStrengthTests(unittest.TestCase):
    def test_lanka_session_windows_include_overlap_and_overnight_new_york(self):
        offset = 5 * 60 * 60 + 30 * 60
        overlap = int(dt.datetime(2026, 10, 22, 13, 0, tzinfo=dt.timezone.utc).timestamp())
        new_york_overnight = int(dt.datetime(2026, 10, 21, 21, 0, tzinfo=dt.timezone.utc).timestamp())

        self.assertEqual(
            [session["name"] for session in _active_sessions(overlap, offset)],
            ["London", "New York"],
        )
        overnight = _active_sessions(new_york_overnight, offset)
        self.assertEqual([session["name"] for session in overnight], ["New York"])
        self.assertEqual(overnight[0]["anchor_date"], dt.date(2026, 10, 21))

    def test_session_high_sweep_and_volume_profile_confirmation_strengthen_signal(self):
        bars = []
        base_day = dt.date(2026, 10, 21)
        for index in range(108):
            timestamp = int((
                dt.datetime.combine(base_day, dt.time(13, 30), dt.timezone.utc)
                + dt.timedelta(minutes=index * 5)
            ).timestamp())
            bars.append({
                "time": timestamp, "open": 109.0, "high": 110.0 if index == 0 else 109.3,
                "low": 108.7, "close": 109.0, "volume": 100,
            })

        current_day = dt.date(2026, 10, 22)
        current_candles = [
            (109.0, 109.3, 108.7, 109.0, 100),
            (109.0, 109.3, 108.7, 109.0, 100),
            (109.0, 109.3, 108.7, 109.0, 100),
            (109.0, 109.3, 108.7, 109.0, 100),
            (109.0, 109.3, 108.7, 109.0, 100),
            (109.0, 111.0, 108.8, 109.0, 100),
            (109.0, 109.2, 108.2, 108.5, 200),
            (108.5, 109.2, 108.4, 108.8, 100),
        ]
        for index, (open_price, high, low, close, volume) in enumerate(current_candles):
            timestamp = int((
                dt.datetime.combine(current_day, dt.time(14, 30), dt.timezone.utc)
                + dt.timedelta(minutes=index * 5)
            ).timestamp())
            bars.append({
                "time": timestamp,
                "open": open_price,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            })

        context = _session_signal_context(
            bars,
            sweep_index=113,
            confirmation_index=114,
            entry_index=115,
            direction="sell",
            entry=108.8,
            atr=2.0,
            session_offset_seconds=0,
        )

        self.assertTrue(context["session_liquidity_swept"])
        self.assertEqual(context["session_sweep_name"], "London")
        self.assertEqual(context["session_sweep_level_type"], "high")
        self.assertEqual(context["session_sweep_level"], 110.0)
        self.assertEqual(context["session_sweep_reference"], "previous")
        self.assertEqual(context["session_name"], "London")
        self.assertTrue(context["session_profile_confirmed"])
        self.assertEqual(context["session_profile_session"], "London")
        self.assertGreaterEqual(context["session_profile_volume_ratio"], 1.2)


class BacktestTests(unittest.TestCase):
    def test_bullish_sweep_bos_exits_at_target(self):
        bars = [
            {"time": 0, "open": 11, "high": 12, "low": 10, "close": 11},
            {"time": 60, "open": 11, "high": 11.5, "low": 10.5, "close": 11},
            {"time": 120, "open": 10.8, "high": 11, "low": 9.5, "close": 10.8},
            {"time": 180, "open": 10.8, "high": 12, "low": 10.7, "close": 11.8},
            {"time": 240, "open": 11.8, "high": 14.2, "low": 11.7, "close": 14},
        ]

        trades = run_backtest(bars, sweep_len=2, bos_len=2, confirm_bars=3, atr_len=2, atr_buffer=0, target_r=1)

        self.assertEqual(len(trades), 1)
        self.assertEqual(trades[0]["direction"], "buy")
        self.assertEqual(trades[0]["outcome"], "target")
        self.assertEqual(trades[0]["result_r"], 1)

    def test_mtf_strategy_sweeps_prior_day_low_and_enters_on_cisd(self):
        htf_bars = [
            {"time": index * 3600, "open": 105, "high": 110, "low": 100, "close": 105}
            for index in range(25)
        ]
        ltf_values = [
            (101, 102, 100.5, 101),
            (101, 101.2, 99.9, 100.5),
            (100.5, 102, 100.1, 101.5),
            (101.3, 101.4, 100.9, 101.05),
            (101.05, 102.2, 100.8, 102),
            (102, 103.3, 100.8, 103),
            (103, 104.4, 100.8, 104),
            (104, 105.5, 100.8, 105),
            (105, 106.6, 100.8, 106),
            (106, 107.7, 100.8, 107),
        ]
        ltf_bars = [
            {
                "time": 86400 + index * 300,
                "open": values[0],
                "high": values[1],
                "low": values[2],
                "close": values[3],
                "volume": 1,
            }
            for index, values in enumerate(ltf_values)
        ]

        result = run_mtf_backtest(ltf_bars, htf_bars, htf_minutes=60, atr_len=1, atr_buffer=0)

        self.assertEqual(len(result["signals"]), 1)
        self.assertEqual(result["signals"][0]["direction"], "buy")
        self.assertEqual(result["signals"][0]["setup"], "Order block")
        self.assertEqual(result["signals"][0]["key_source"], "Previous day low")
        self.assertEqual([item["target_r"] for item in result["results"]], [1, 2, 3, 4, 5, 6])
        self.assertEqual([item["trades"][0]["outcome"] for item in result["results"]], ["target"] * 6)

    def test_mtf_strategy_can_enter_on_fvg_or_order_block_retracement(self):
        htf_bars = [
            {"time": index * 3600, "open": 105, "high": 110, "low": 100, "close": 105}
            for index in range(25)
        ]
        fixtures = {
            "FVG": [
                (101, 101, 100.5, 101),
                (102, 102.1, 99.9, 100.5),
                (103, 103.5, 102, 102.5),
                (102, 102.4, 101.2, 101.5),
            ],
            "Order block": [
                (101, 104, 100.5, 101),
                (107, 108, 99.9, 100.5),
                (100.5, 103, 100.2, 102.5),
                (102.5, 105, 102, 104),
                (103.4, 103.6, 102.9, 103.5),
            ],
        }

        for expected_setup, values in fixtures.items():
            with self.subTest(setup=expected_setup):
                ltf_bars = [
                    {
                        "time": 86400 + index * 300,
                        "open": candle[0],
                        "high": candle[1],
                        "low": candle[2],
                        "close": candle[3],
                        "volume": 1,
                    }
                    for index, candle in enumerate(values)
                ]
                signals, _ = generate_mtf_signals(
                    ltf_bars,
                    htf_bars,
                    htf_minutes=60,
                    atr_len=1,
                    atr_buffer=0,
                )
                self.assertEqual(len(signals), 1)
                self.assertEqual(signals[0]["setup"], expected_setup)

    def test_higher_priority_fvg_replaces_an_unfilled_cisd(self):
        htf_bars = [
            {"time": index * 3600, "open": 105, "high": 110, "low": 100, "close": 105}
            for index in range(25)
        ]
        values = [
            (101, 101, 100.5, 101),
            (101, 104, 99.9, 100.5),
            (101, 102, 100.2, 100.5),
            (100.5, 103, 100.3, 101.5),
            (101.5, 104, 102.5, 103.5),
            (103.5, 103.8, 102.2, 102.4),
        ]
        ltf_bars = [
            {
                "time": 86400 + index * 300,
                "open": candle[0],
                "high": candle[1],
                "low": candle[2],
                "close": candle[3],
                "volume": 1,
            }
            for index, candle in enumerate(values)
        ]

        signals, _ = generate_mtf_signals(
            ltf_bars,
            htf_bars,
            htf_minutes=60,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["setup"], "FVG")
        self.assertEqual(signals[0]["entry"], 102.25)


class HierarchicalStrategyTests(unittest.TestCase):
    def setUp(self):
        self.h4_bars = [
            {"time": index * 14400, "open": 96, "high": high, "low": low, "close": 96}
            for index, (high, low) in enumerate([
                (100, 95), (101, 94), (99, 90), (102, 94), (102, 95),
            ])
        ]
        self.h1_bars = [
            {"time": index * 3600, "open": 96, "high": high, "low": low, "close": 96}
            for index, (high, low) in enumerate([
                (100, 99), (99, 98), (98, 95), (99, 98), (100, 99),
            ])
        ]
        self.ltf_bars = [
            {"time": 71100, "open": 95.4, "high": 95.5, "low": 95.2, "close": 95.4},
            {"time": 71400, "open": 95.3, "high": 95.4, "low": 95.1, "close": 95.25},
            {"time": 71700, "open": 95.4, "high": 95.6, "low": 95.2, "close": 95.4},
            {"time": 72000, "open": 95.5, "high": 95.7, "low": 94.5, "close": 95.2},
            {"time": 72300, "open": 95.3, "high": 97, "low": 95.9, "close": 96.6},
            {"time": 72600, "open": 96.4, "high": 96.8, "low": 95.4, "close": 96.2},
        ]

    def test_h4_h1_confluence_and_m5_order_block_strength(self):
        signals, levels = generate_hierarchical_signals(
            self.ltf_bars,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal["direction"], "buy")
        self.assertEqual(signal["setup"], "Sweep OB retest")
        self.assertEqual(signal["signal_strength"], "MSNR + OB + CISD + FVG")
        self.assertTrue(signal["cisd_confirmed"])
        self.assertTrue(signal["fvg_confirmed"])
        self.assertEqual(signal["h4_key_level"], 90)
        self.assertEqual(signal["h1_key_level"], 95)
        self.assertIn("H4 HTF swing low", signal["key_source"])
        self.assertIn("H1 HTF swing low", signal["key_source"])
        self.assertEqual(signal["entry"], 95.5)
        self.assertEqual(signal["entry_time"], 72600)
        self.assertTrue(levels)

    def test_multi_timeframe_levels_allow_two_or_more_matching_frames_without_m15(self):
        def fake_levels(_bars, minutes, _session_offset_seconds):
            level_prices = {60: 95.0, 240: 95.1, 420: 95.2}
            if minutes not in level_prices:
                return []
            price = level_prices[minutes]
            return [{
                "price": price,
                "direction": "support",
                "source": "swing low",
                "zone_low": 94.0,
                "zone_high": 96.0,
                "available_time": 0,
            }]

        with patch("engine._strategy_key_levels", side_effect=fake_levels):
            levels = _multi_timeframe_key_levels(
                [(60, self.h1_bars), (240, self.h4_bars), (420, self.h4_bars)],
                0,
            )

        three_frame = next(level for level in levels if level["confluence_count"] == 3)
        self.assertEqual(three_frame["confluence_timeframes"], ["H1", "H4", "H7"])
        self.assertEqual(three_frame["h1_price"], 95.0)
        self.assertEqual(three_frame["h4_price"], 95.1)
        self.assertEqual(three_frame["htf_price"], 95.2)
        self.assertAlmostEqual(three_frame["price"], 95.1)

        with patch("engine._strategy_key_levels", side_effect=fake_levels):
            two_frame = _multi_timeframe_key_levels(
                [(60, self.h1_bars), (420, self.h4_bars)],
                0,
            )
        self.assertTrue(two_frame)
        self.assertTrue(all(level["confluence_count"] == 2 for level in two_frame))

    def test_matching_h1_and_h7_support_sweep_cisd_emits_buy_without_m15(self):
        def fake_levels(_bars, minutes, _session_offset_seconds):
            if minutes not in (60, 420):
                return []
            return [{
                "price": 95.0,
                "direction": "support",
                "source": "swing low",
                "zone_low": 94.0,
                "zone_high": 96.0,
                "available_time": 0,
            }]

        with patch("engine._strategy_key_levels", side_effect=fake_levels):
            signals, _ = generate_hierarchical_signals(
                self.ltf_bars[:-1],
                self.h1_bars,
                self.h4_bars,
                atr_len=1,
                atr_buffer=0,
                htf_minutes=420,
                signal_on_cisd=True,
                additional_timeframes=[(240, [])],
            )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "buy")
        self.assertEqual(signals[0]["setup"], "Sweep + CISD")
        self.assertEqual(signals[0]["entry_time"], 72300)
        self.assertEqual(signals[0]["confluence_timeframes"], ["H1", "H7"])
        self.assertTrue(signals[0]["cisd_confirmed"])

    def test_matching_h1_and_h7_resistance_sweep_cisd_emits_sell(self):
        bearish_bars = [
            {
                **bar,
                "open": 200 - bar["open"],
                "high": 200 - bar["low"],
                "low": 200 - bar["high"],
                "close": 200 - bar["close"],
            }
            for bar in self.ltf_bars
        ]

        def fake_levels(_bars, minutes, _session_offset_seconds):
            if minutes not in (60, 420):
                return []
            return [{
                "price": 105.0,
                "direction": "resistance",
                "source": "swing high",
                "zone_low": 104.0,
                "zone_high": 106.0,
                "available_time": 0,
            }]

        with patch("engine._strategy_key_levels", side_effect=fake_levels):
            signals, _ = generate_hierarchical_signals(
                bearish_bars[:-1],
                self.h1_bars,
                self.h4_bars,
                atr_len=1,
                atr_buffer=0,
                htf_minutes=420,
                signal_on_cisd=True,
                additional_timeframes=[(240, [])],
            )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "sell")
        self.assertEqual(signals[0]["setup"], "Sweep + CISD")
        self.assertEqual(signals[0]["entry_time"], 72300)
        self.assertEqual(signals[0]["confluence_timeframes"], ["H1", "H7"])
        self.assertTrue(signals[0]["cisd_confirmed"])

    def test_no_signal_without_h4_h1_level_overlap(self):
        disjoint_h1 = [
            {**bar, "low": bar["low"] + 15, "high": bar["high"] + 15}
            for bar in self.h1_bars
        ]

        signals, _ = generate_hierarchical_signals(
            self.ltf_bars,
            disjoint_h1,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(signals, [])

    def test_order_block_must_have_larger_body_and_close_beyond_sweep(self):
        weak_confirmation = [
            *self.ltf_bars[:4],
            {"time": 72300, "open": 95.2, "high": 95.8, "low": 95.1, "close": 95.6},
        ]

        signals, _ = generate_hierarchical_signals(
            weak_confirmation,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(signals, [])

    def test_displacement_alone_does_not_signal_without_ob_retest(self):
        signals, _ = generate_hierarchical_signals(
            self.ltf_bars[:-1],
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(signals, [])

    def test_sweep_cisd_signals_without_waiting_for_order_block_retest(self):
        signals, _ = generate_hierarchical_signals(
            self.ltf_bars[:-1],
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
            signal_on_cisd=True,
        )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "buy")
        self.assertEqual(signals[0]["setup"], "Sweep + CISD")
        self.assertEqual(signals[0]["entry_time"], 72300)
        self.assertEqual(signals[0]["entry"], 96.6)
        self.assertTrue(signals[0]["cisd_confirmed"])
        self.assertFalse(signals[0]["retest_confirmed"])

    def test_order_block_retest_confirms_existing_sweep_cisd_signal(self):
        signals, _ = generate_hierarchical_signals(
            self.ltf_bars,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
            signal_on_cisd=True,
        )

        self.assertEqual(len(signals), 1)
        self.assertTrue(signals[0]["retest_confirmed"])
        self.assertEqual(signals[0]["retest_time"], 72600)

    def test_selected_htf_and_m15_level_confluence_are_preserved(self):
        def fake_levels(bars, minutes, _session_offset_seconds):
            if minutes == 60:
                return [{
                    "price": 99,
                    "direction": "support",
                    "source": "H1 swing low",
                    "zone_low": 98,
                    "zone_high": 100,
                    "available_time": 100,
                }]
            if minutes == 300:
                return [{
                    "price": 100,
                    "direction": "support",
                    "source": "HTF swing low",
                    "zone_low": 90,
                    "zone_high": 110,
                    "available_time": 200,
                }]
            return [{
                "price": 99.5,
                "direction": "support",
                "source": "M15 swing low",
                "zone_low": 99,
                "zone_high": 100,
                "available_time": 300,
            }]

        with patch("engine._strategy_key_levels", side_effect=fake_levels):
            levels = _confluent_h4_h1_levels(
                [{"time": 0}],
                [{"time": 0}],
                0,
                htf_minutes=300,
                m15_bars=[{"time": 0}],
            )

        self.assertEqual(len(levels), 1)
        self.assertEqual(levels[0]["price"], 99.5)
        self.assertEqual(levels[0]["htf_price"], 100)
        self.assertEqual(levels[0]["h1_price"], 99)
        self.assertEqual(levels[0]["m15_price"], 99.5)
        self.assertIn("H5", levels[0]["source"])

    def test_setup_is_cancelled_if_sweep_stop_is_hit_before_retest(self):
        invalidated = [
            *self.ltf_bars[:5],
            {"time": 72600, "open": 95.2, "high": 95.4, "low": 94.2, "close": 95.0},
        ]

        signals, _ = generate_hierarchical_signals(
            invalidated,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0.15,
        )

        self.assertEqual(signals, [])

    def test_resistance_break_structure_break_cisd_and_ob_retest_generate_buy(self):
        h4_bars = [
            {"time": index * 14400, "open": 104, "high": high, "low": low, "close": 104}
            for index, (high, low) in enumerate([
                (106, 100), (107, 101), (110, 102), (107, 101), (106, 100),
            ])
        ]
        h1_bars = [
            {"time": index * 3600, "open": 103, "high": high, "low": low, "close": 103}
            for index, (high, low) in enumerate([
                (102, 99), (103, 100), (105, 101), (103, 100), (102, 99),
            ])
        ]
        ltf_bars = [
            {"time": 90000, "open": 104.0, "high": 104.5, "low": 103.8, "close": 104.3},
            {"time": 90300, "open": 104.4, "high": 104.6, "low": 103.9, "close": 104.0},
            {"time": 90600, "open": 104.1, "high": 104.8, "low": 104.0, "close": 104.5},
            {"time": 90900, "open": 104.8, "high": 105.4, "low": 104.7, "close": 105.2},
            {"time": 91200, "open": 105.0, "high": 105.3, "low": 104.9, "close": 105.1},
            {"time": 91500, "open": 105.6, "high": 105.7, "low": 105.1, "close": 105.2},
            {"time": 91800, "open": 105.2, "high": 106.6, "low": 105.1, "close": 106.5},
            {"time": 92100, "open": 106.4, "high": 106.5, "low": 105.2, "close": 105.8},
        ]

        signals, _ = generate_hierarchical_signals(
            ltf_bars,
            h1_bars,
            h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal["direction"], "buy")
        self.assertEqual(signal["signal_type"], "breakout")
        self.assertEqual(signal["setup"], "Breakout OB retest")
        self.assertTrue(signal["msnr_confirmed"])
        self.assertTrue(signal["cisd_confirmed"])
        self.assertEqual(signal["entry"], 105.6)
        self.assertEqual(signal["entry_time"], 92100)
        self.assertEqual(signal["h4_key_level"], 110)
        self.assertEqual(signal["h1_key_level"], 105)

    def test_resistance_break_without_ob_retest_does_not_signal(self):
        bars_without_retest = [
            {"time": 90000, "open": 104.0, "high": 104.5, "low": 103.8, "close": 104.3},
            {"time": 90300, "open": 104.4, "high": 104.6, "low": 103.9, "close": 104.0},
            {"time": 90600, "open": 104.1, "high": 104.8, "low": 104.0, "close": 104.5},
            {"time": 90900, "open": 104.8, "high": 105.4, "low": 104.7, "close": 105.2},
            {"time": 91200, "open": 105.2, "high": 105.3, "low": 104.9, "close": 105.0},
            {"time": 91500, "open": 105.0, "high": 106.6, "low": 105.0, "close": 106.5},
        ]
        h4_bars = [
            {"time": index * 14400, "open": 104, "high": high, "low": low, "close": 104}
            for index, (high, low) in enumerate([
                (106, 100), (107, 101), (110, 102), (107, 101), (106, 100),
            ])
        ]
        h1_bars = [
            {"time": index * 3600, "open": 103, "high": high, "low": low, "close": 103}
            for index, (high, low) in enumerate([
                (102, 99), (103, 100), (105, 101), (103, 100), (102, 99),
            ])
        ]

        signals, _ = generate_hierarchical_signals(
            bars_without_retest,
            h1_bars,
            h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(signals, [])

    def test_trendline_break_without_mss_or_liquidity_sweep_is_ignored(self):
        ltf_bars = [
            (96.0, 96.5, 95.8, 96.2),
            (96.2, 97.0, 96.0, 96.8),
            (97.0, 98.0, 96.8, 97.5),
            (97.4, 97.3, 97.0, 97.2),
            (97.2, 97.4, 96.9, 97.0),
            (97.1, 97.5, 96.8, 97.3),
            (97.2, 97.3, 96.7, 96.9),
            (96.9, 97.0, 96.5, 96.8),
            (96.9, 97.0, 96.4, 96.5),
            (96.5, 98.5, 96.4, 98.2),
            (98.1, 98.3, 96.8, 97.5),
        ]
        bars = [
            {
                "time": 71100 + index * 300,
                "open": candle[0],
                "high": candle[1],
                "low": candle[2],
                "close": candle[3],
            }
            for index, candle in enumerate(ltf_bars)
        ]
        with patch("engine._confluent_h4_h1_levels", return_value=[]):
            signals, _ = generate_hierarchical_signals(
                bars,
                self.h1_bars,
                self.h4_bars,
                atr_len=1,
                atr_buffer=0,
            )

        self.assertEqual(signals, [])

    def test_4025_resistance_sweep_structure_breaker_retest_emits_sell(self):
        candle_values = [
            (4025.32, 4025.32, 4021.43, 4021.97),
            (4021.98, 4022.70, 4020.71, 4021.98),
            (4022.02, 4024.37, 4021.64, 4023.78),
            (4023.77, 4025.79, 4022.93, 4025.08),
            (4025.06, 4025.06, 4020.32, 4022.12),
            (4022.11, 4023.73, 4019.97, 4023.28),
            (4023.25, 4025.93, 4022.26, 4025.39),
            (4025.37, 4028.37, 4022.94, 4026.83),
            (4026.84, 4030.01, 4026.44, 4028.31),
            (4028.38, 4029.96, 4026.42, 4029.05),
            (4028.97, 4029.88, 4027.23, 4029.73),
            (4029.60, 4030.73, 4024.70, 4027.52),
            (4027.42, 4027.42, 4022.83, 4024.74),
            (4024.67, 4025.30, 4022.57, 4023.39),
            (4023.40, 4027.06, 4023.12, 4024.31),
            (4024.32, 4027.68, 4022.66, 4026.34),
            (4026.36, 4028.00, 4023.81, 4025.74),
            (4025.72, 4025.72, 4022.27, 4024.33),
            (4024.27, 4028.19, 4022.55, 4027.71),
            (4027.68, 4029.74, 4023.23, 4023.51),
            (4023.50, 4024.73, 4021.34, 4021.97),
            (4021.86, 4025.20, 4021.64, 4024.23),
        ]
        bars = [
            {
                "time": 1792751400 + index * 300,
                "open": candle[0],
                "high": candle[1],
                "low": candle[2],
                "close": candle[3],
            }
            for index, candle in enumerate(candle_values)
        ]
        confluence = [{
            "price": 4021.09,
            "direction": "support",
            "source": "H4/H1 confluence",
            "h4_price": 4021.09,
            "h1_price": 4021.09,
            "zone_low": 4021.09,
            "zone_high": 4031.04,
            "available_time": 1792706400,
        }]

        with patch("engine._confluent_h4_h1_levels", return_value=confluence):
            signals, _ = generate_hierarchical_signals(
                bars,
                self.h1_bars,
                self.h4_bars,
                atr_len=1,
                atr_buffer=0.15,
            )
            early_signals, _ = generate_hierarchical_signals(
                bars[:-1],
                self.h1_bars,
                self.h4_bars,
                atr_len=1,
                atr_buffer=0.15,
                include_watch_signals=True,
            )

        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal["direction"], "sell")
        self.assertEqual(signal["signal_type"], "market_structure_reversal")
        self.assertEqual(signal["setup"], "MSS Breaker Block Retest")
        self.assertEqual(signal["entry_time"], 1792757700)
        self.assertAlmostEqual(signal["entry"], 4024.27)
        self.assertEqual(signal["sweep_time"], 1792754700)
        self.assertEqual(signal["confirmation_time"], 1792757400)
        self.assertEqual(signal["order_block_time"], 1792756800)
        self.assertAlmostEqual(signal["structure_break"], 4022.27)
        self.assertTrue(signal["cisd_confirmed"])
        self.assertGreater(signal["stop"], signal["order_block_high"])
        self.assertTrue(signal["session_liquidity_swept"])
        self.assertEqual(signal["session_sweep_name"], "London")
        self.assertEqual(signal["session_sweep_reference"], "developing")
        self.assertEqual(signal["strength_score"], 4)
        self.assertEqual(signal["strength_score_max"], 6)
        self.assertEqual(signal["strength_label"], "STRONG")
        self.assertEqual(signal["strength_emoji"], "💪")
        watch_signals = [
            signal for signal in early_signals
            if signal.get("signal_status") == "watch"
        ]
        self.assertEqual(len(watch_signals), 1)
        self.assertEqual(watch_signals[0]["direction"], "sell")
        self.assertEqual(watch_signals[0]["entry"], 4024.27)
        self.assertEqual(watch_signals[0]["watch_time"], 1792757400)
        self.assertFalse(any(
            signal.get("signal_status") != "watch"
            for signal in early_signals
        ))

    def test_support_sweep_structure_breaker_retest_emits_buy(self):
        candle_values = [
            (100.0, 100.3, 99.5, 99.9),
            (99.9, 100.1, 99.2, 99.5),
            (99.5, 100.0, 99.0, 99.2),
            (99.2, 99.8, 98.8, 99.1),
            (99.1, 99.5, 98.5, 98.8),
            (98.8, 99.3, 98.2, 98.6),
            (98.6, 99.0, 97.9, 98.3),
            (98.3, 98.7, 94.8, 98.1),
            (98.1, 98.2, 97.2, 97.5),
            (97.5, 98.8, 97.4, 98.5),
            (98.5, 98.6, 97.4, 97.7),
            (98.2, 98.4, 97.8, 98.0),
            (98.0, 100.0, 97.9, 99.8),
            (98.1, 98.6, 97.9, 98.4),
        ]
        bars = [
            {
                "time": 71100 + index * 300,
                "open": candle[0],
                "high": candle[1],
                "low": candle[2],
                "close": candle[3],
            }
            for index, candle in enumerate(candle_values)
        ]
        confluence = [{
            "price": 95.0,
            "direction": "support",
            "source": "H4/H1 confluence",
            "h4_price": 95.0,
            "h1_price": 95.0,
            "zone_low": 95.0,
            "zone_high": 96.0,
            "available_time": 0,
        }]

        with patch("engine._confluent_h4_h1_levels", return_value=confluence):
            signals, _ = generate_hierarchical_signals(
                bars,
                self.h1_bars,
                self.h4_bars,
                atr_len=1,
                atr_buffer=0.15,
            )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "buy")
        self.assertEqual(signals[0]["signal_type"], "market_structure_reversal")
        self.assertEqual(signals[0]["entry_time"], 75000)

    def test_support_break_structure_break_cisd_and_ob_retest_generate_sell(self):
        ltf_bars = [
            {"time": 90000, "open": 96.0, "high": 96.4, "low": 95.8, "close": 96.1},
            {"time": 90300, "open": 96.0, "high": 96.5, "low": 95.9, "close": 96.4},
            {"time": 90600, "open": 96.3, "high": 96.4, "low": 95.7, "close": 96.0},
            {"time": 90900, "open": 96.0, "high": 96.1, "low": 94.7, "close": 94.8},
            {"time": 91200, "open": 95.2, "high": 95.3, "low": 94.8, "close": 94.9},
            {"time": 91500, "open": 94.3, "high": 94.9, "low": 94.2, "close": 94.7},
            {"time": 91800, "open": 94.7, "high": 94.7, "low": 93.5, "close": 93.6},
            {"time": 92100, "open": 94.6, "high": 94.6, "low": 94.2, "close": 94.2},
        ]

        signals, _ = generate_hierarchical_signals(
            ltf_bars,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal["direction"], "sell")
        self.assertEqual(signal["signal_type"], "breakout")
        self.assertEqual(signal["setup"], "Breakout OB retest")
        self.assertTrue(signal["msnr_confirmed"])
        self.assertTrue(signal["cisd_confirmed"])
        self.assertEqual(signal["entry"], 94.3)
        self.assertEqual(signal["entry_time"], 92100)
        self.assertEqual(signal["h4_key_level"], 90)
        self.assertEqual(signal["h1_key_level"], 95)

    def test_failed_support_break_reclaims_as_buy_instead_of_sell(self):
        ltf_bars = [
            {"time": 90000, "open": 96.0, "high": 96.4, "low": 95.8, "close": 96.1},
            {"time": 90300, "open": 96.0, "high": 96.5, "low": 95.9, "close": 96.4},
            {"time": 90600, "open": 96.3, "high": 96.4, "low": 95.7, "close": 96.0},
            {"time": 90900, "open": 96.0, "high": 96.1, "low": 94.7, "close": 94.8},
            {"time": 91200, "open": 94.8, "high": 94.9, "low": 94.3, "close": 94.5},
            {"time": 91500, "open": 94.5, "high": 94.7, "low": 93.5, "close": 94.0},
            {"time": 91800, "open": 94.0, "high": 95.3, "low": 93.7, "close": 95.1},
            {"time": 92100, "open": 95.6, "high": 95.8, "low": 95.0, "close": 95.2},
            {"time": 92400, "open": 95.2, "high": 97.0, "low": 95.1, "close": 96.8},
            {"time": 92700, "open": 96.2, "high": 96.3, "low": 95.3, "close": 95.8},
        ]

        signals, _ = generate_hierarchical_signals(
            ltf_bars,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "buy")
        self.assertEqual(signals[0]["signal_type"], "failed_break_reversal")
        self.assertEqual(signals[0]["setup"], "Sweep OB retest")
        self.assertTrue(signals[0]["cisd_confirmed"])
        self.assertEqual(signals[0]["entry_time"], 92700)
        self.assertEqual(signals[0]["h1_key_level"], 95)

    def test_support_break_reclaim_displacement_then_ob_retest_generates_buy(self):
        ltf_bars = [
            {"time": 90000, "open": 96.0, "high": 96.3, "low": 95.8, "close": 96.1},
            {"time": 90300, "open": 96.1, "high": 96.4, "low": 95.9, "close": 96.2},
            {"time": 90600, "open": 96.2, "high": 96.5, "low": 96.0, "close": 96.1},
            {"time": 90900, "open": 96.0, "high": 96.1, "low": 94.7, "close": 94.8},
            {"time": 91200, "open": 94.8, "high": 97.0, "low": 94.3, "close": 96.8},
            {"time": 91500, "open": 96.6, "high": 96.7, "low": 95.8, "close": 96.2},
        ]

        signals, _ = generate_hierarchical_signals(
            ltf_bars,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal["direction"], "buy")
        self.assertEqual(signal["signal_type"], "failed_break_reversal")
        self.assertEqual(signal["entry"], 96.0)
        self.assertEqual(signal["entry_time"], 91500)
        self.assertEqual(signal["order_block_time"], 90900)
        self.assertTrue(signal["cisd_confirmed"])

    def test_golden_support_sweep_sequence_emits_buy_on_ob_retest(self):
        offset = 3891.4
        raw_bars = [
            (3994.74, 3995.95, 3992.47, 3992.86),
            (3992.89, 3998.27, 3992.8, 3997.24),
            (3997.31, 3997.31, 3988.63, 3988.82),
            (3988.8, 3991.2, 3985.41, 3987.66),
            (3987.59, 3990.97, 3983.1, 3989.09),
            (3988.97, 3995.71, 3986.61, 3992.68),
            (3992.48, 3992.56, 3984.16, 3985.95),
            (3985.96, 3991.5, 3983.26, 3990.11),
            (3990.11, 3995.61, 3988.97, 3990.89),
            (3990.89, 3990.89, 3984.89, 3985.56),
            (3985.42, 3992.17, 3983.86, 3989.66),
            (3989.77, 3990.93, 3985.82, 3986.92),
            (3986.59, 3989.51, 3983.23, 3984.02),
            (3983.87, 3987.81, 3983.35, 3985.22),
            (3985.21, 3985.3, 3977.93, 3981.73),
            (3981.32, 3993.68, 3979.21, 3993.28),
            (3993.45, 3996.76, 3992.69, 3995.45),
            (3995.56, 4000.07, 3995.13, 3997.66),
            (3997.57, 3997.6, 3993.6, 3993.97),
            (3993.97, 3994.65, 3987.25, 3987.64),
            (3987.85, 3990.4, 3984.86, 3986.19),
        ]
        ltf_bars = [
            {
                "time": 90000 + index * 300,
                "open": candle[0],
                "high": candle[1],
                "low": candle[2],
                "close": candle[3],
            }
            for index, candle in enumerate(raw_bars)
        ]
        h1_bars = [
            {**bar, "open": bar["open"] + offset, "high": bar["high"] + offset,
             "low": bar["low"] + offset, "close": bar["close"] + offset}
            for bar in self.h1_bars
        ]
        h4_bars = [
            {**bar, "open": bar["open"] + offset, "high": bar["high"] + offset,
             "low": bar["low"] + offset, "close": bar["close"] + offset}
            for bar in self.h4_bars
        ]

        signals, _ = generate_hierarchical_signals(
            ltf_bars,
            h1_bars,
            h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        matches = [
            signal for signal in signals
            if signal["direction"] == "buy"
            and signal["signal_type"] == "failed_break_reversal"
            and signal["entry_time"] == ltf_bars[-1]["time"]
        ]
        self.assertEqual(len(matches), 1)
        self.assertAlmostEqual(matches[0]["entry"], 3985.21)
        self.assertAlmostEqual(matches[0]["key_level"], 3986.4)
        self.assertAlmostEqual(matches[0]["order_block_low"], 3977.93)
        self.assertAlmostEqual(matches[0]["order_block_high"], 3985.21)
        self.assertTrue(matches[0]["cisd_confirmed"])

    def test_bearish_liquidity_sweep_generates_sell_order_block(self):
        h4_bars = [
            {"time": index * 14400, "open": 104, "high": high, "low": low, "close": 104}
            for index, (high, low) in enumerate([
                (106, 100), (107, 101), (110, 102), (107, 101), (106, 100),
            ])
        ]
        h1_bars = [
            {"time": index * 3600, "open": 103, "high": high, "low": low, "close": 103}
            for index, (high, low) in enumerate([
                (102, 99), (103, 100), (105, 101), (103, 100), (102, 99),
            ])
        ]
        ltf_bars = [
            {"time": 71100, "open": 105.2, "high": 105.4, "low": 105.0, "close": 105.1},
            {"time": 71400, "open": 105.1, "high": 105.3, "low": 104.9, "close": 105.15},
            {"time": 71700, "open": 105.2, "high": 105.4, "low": 105.0, "close": 105.1},
            {"time": 72000, "open": 105.1, "high": 105.5, "low": 104.8, "close": 104.9},
            {"time": 72300, "open": 104.5, "high": 105.2, "low": 104.4, "close": 105.0},
            {"time": 72600, "open": 104.65, "high": 104.7, "low": 103.5, "close": 103.6},
            {"time": 72900, "open": 104.45, "high": 104.6, "low": 104.4, "close": 104.4},
        ]

        signals, _ = generate_hierarchical_signals(
            ltf_bars,
            h1_bars,
            h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "sell")
        self.assertEqual(signals[0]["h4_key_level"], 110)
        self.assertEqual(signals[0]["h1_key_level"], 105)
        self.assertEqual(signals[0]["signal_strength"], "MSNR + OB + CISD + FVG")

    def test_repeated_resistance_sweep_replaces_stale_pending_sell_setup(self):
        h4_bars = [
            {"time": index * 14400, "open": 104, "high": 106, "low": 100, "close": 104}
            for index in range(5)
        ]
        h1_bars = [
            {"time": index * 3600, "open": 103, "high": 105, "low": 99, "close": 103}
            for index in range(5)
        ]
        ltf_values = [
            (105.0, 105.2, 104.6, 104.8),
            (104.8, 105.1, 104.5, 104.7),
            (104.7, 105.3, 104.4, 104.8),
            (104.8, 105.4, 104.5, 104.9),
            (104.9, 106.2, 104.7, 105.0),
            (105.0, 106.4, 104.6, 104.9),
            (104.9, 105.2, 103.5, 103.7),
            (103.7, 104.2, 103.2, 103.5),
        ]
        ltf_bars = [
            {
                "time": 86400 + index * 300,
                "open": candle[0],
                "high": candle[1],
                "low": candle[2],
                "close": candle[3],
                "volume": 1,
            }
            for index, candle in enumerate(ltf_values)
        ]
        resistance = [{
            "price": 105.0,
            "direction": "resistance",
            "source": "H4/H1 confluence",
            "h4_price": 105.0,
            "h1_price": 105.0,
            "zone_low": 104.0,
            "zone_high": 106.0,
            "available_time": 0,
        }]

        with patch("engine._confluent_h4_h1_levels", return_value=resistance):
            signals, _ = generate_hierarchical_signals(
                ltf_bars,
                h1_bars,
                h4_bars,
                atr_len=1,
                atr_buffer=0,
                include_watch_signals=True,
            )

        sell_signals = [signal for signal in signals if signal["direction"] == "sell"]
        for signal in sell_signals:
            self.assertEqual(signal["key_level"], 105.0)

    def test_order_block_without_cisd_or_fvg_gets_base_grade(self):
        ltf_bars = [
            {"time": 71100, "open": 95.4, "high": 95.5, "low": 95.2, "close": 95.4},
            {"time": 71400, "open": 95.3, "high": 95.4, "low": 95.1, "close": 95.25},
            {"time": 71700, "open": 95.4, "high": 95.6, "low": 95.2, "close": 95.4},
            {"time": 72000, "open": 95.5, "high": 95.7, "low": 94.5, "close": 95.2},
            {"time": 72300, "open": 96.9, "high": 97.0, "low": 96.0, "close": 96.3},
            {"time": 72600, "open": 95.3, "high": 97.2, "low": 95.6, "close": 96.6},
            {"time": 72900, "open": 96.5, "high": 97.1, "low": 96.8, "close": 97.0},
        ]

        signals, _ = generate_hierarchical_signals(
            ltf_bars,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(len(signals), 1)
        self.assertFalse(signals[0]["cisd_confirmed"])
        self.assertFalse(signals[0]["fvg_confirmed"])
        self.assertEqual(signals[0]["signal_strength"], "MSNR + OB")

    def test_backtest_uses_same_hierarchical_signals_and_levels(self):
        result = run_hierarchical_backtest(
            self.ltf_bars,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )
        live_signals, _ = generate_hierarchical_signals(
            self.ltf_bars,
            self.h1_bars,
            self.h4_bars,
            atr_len=1,
            atr_buffer=0,
        )

        self.assertEqual(result["signals"], live_signals)
        self.assertEqual([item["target_r"] for item in result["results"]], [1, 2, 3, 4, 5, 6])
        self.assertEqual(result["results"][0]["trades"][0]["h4_key_level"], 90)


class LiquidityCisdStrategyTests(unittest.TestCase):
    session_start = int(dt.datetime(2024, 1, 2, 1, 0, tzinfo=dt.timezone.utc).timestamp())

    def setUp(self):
        self.bars = [
            {"time": self.session_start, "open": 101.0, "high": 101.4, "low": 100.4, "close": 101.0},
            {"time": self.session_start + 60, "open": 100.5, "high": 100.7, "low": 99.9, "close": 100.2},
            {"time": self.session_start + 120, "open": 100.2, "high": 100.3, "low": 100.05, "close": 100.1},
            {"time": self.session_start + 180, "open": 100.2, "high": 100.6, "low": 100.15, "close": 100.4},
        ]

    def level_for(self, minutes, direction="support", price=100.0):
        if minutes != 60:
            return []
        return [{
            "price": price,
            "direction": direction,
            "source": "HTF swing low" if direction == "support" else "HTF swing high",
            "zone_low": price - 0.5,
            "zone_high": price + 0.5,
            "available_time": 0,
        }]

    def test_support_sweep_then_bullish_opposing_candle_cisd_emits_buy(self):
        with patch("engine._strategy_key_levels", side_effect=lambda _bars, minutes, _offset: self.level_for(minutes)):
            signals, levels = generate_liquidity_cisd_signals(
                self.bars, [], [], [], atr_len=1, atr_buffer=0
            )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "buy")
        self.assertEqual(signals[0]["entry_time"], self.session_start + 180)
        self.assertEqual(signals[0]["entry"], 100.4)
        self.assertEqual(signals[0]["setup"], "HTF sweep + 1m CISD")
        self.assertEqual(signals[0]["key_source"], "H1 swing low")
        self.assertEqual(signals[0]["session_names"], ["Asia"])
        self.assertEqual(levels[0]["source"], "H1 swing low")

    def test_resistance_sweep_then_bearish_cisd_emits_sell(self):
        bearish_bars = [
            {
                **bar,
                "open": 200 - bar["open"],
                "high": 200 - bar["low"],
                "low": 200 - bar["high"],
                "close": 200 - bar["close"],
            }
            for bar in self.bars
        ]
        with patch("engine._strategy_key_levels", side_effect=lambda _bars, minutes, _offset: self.level_for(minutes, "resistance")):
            signals, _ = generate_liquidity_cisd_signals(
                bearish_bars, [], [], [], atr_len=1, atr_buffer=0
            )

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "sell")
        self.assertEqual(signals[0]["entry_time"], self.session_start + 180)

    def test_requires_configured_session_and_cisd_after_the_sweep(self):
        outside_session = [
            {**bar, "time": bar["time"] + 2 * 60 * 60}
            for bar in self.bars
        ]
        no_cisd = self.bars[:3] + [
            {"time": self.session_start + 180, "open": 100.1, "high": 100.25, "low": 100.0, "close": 100.2},
        ]
        with patch("engine._strategy_key_levels", side_effect=lambda _bars, minutes, _offset: self.level_for(minutes)):
            session_signals, _ = generate_liquidity_cisd_signals(
                outside_session, [], [], [], atr_len=1, atr_buffer=0
            )
            unconfirmed_signals, _ = generate_liquidity_cisd_signals(
                no_cisd, [], [], [], atr_len=1, atr_buffer=0
            )

        self.assertEqual(session_signals, [])
        self.assertEqual(unconfirmed_signals, [])

    def test_backtest_reports_session_performance_for_each_target(self):
        later_bars = self.bars + [
            {"time": self.session_start + 240, "open": 100.4, "high": 101.0, "low": 100.3, "close": 100.9},
        ]
        with patch("engine._strategy_key_levels", side_effect=lambda _bars, minutes, _offset: self.level_for(minutes)):
            result = run_liquidity_cisd_backtest(
                later_bars, [], [], [], atr_len=1, atr_buffer=0, start_time=self.session_start
            )

        self.assertEqual([item["target_r"] for item in result["results"]], [1, 2, 3, 4, 5, 6])
        self.assertTrue(any(
            item["target_r"] == 1 and item["session"] == "Asia" and item["summary"]["trades"] == 1
            for item in result["session_results"]
        ))


class SweepBosStrategyTests(unittest.TestCase):
    session_opening_scan = int(dt.datetime(2024, 1, 2, 0, 30, tzinfo=dt.timezone.utc).timestamp())

    def setUp(self):
        self.bars = [
            {"time": self.session_opening_scan, "open": 101.0, "high": 102.0, "low": 100.0, "close": 101.0},
            {"time": self.session_opening_scan + 300, "open": 101.0, "high": 102.0, "low": 100.0, "close": 101.0},
            {"time": self.session_opening_scan + 600, "open": 101.0, "high": 101.5, "low": 100.0, "close": 101.0},
            {"time": self.session_opening_scan + 900, "open": 100.2, "high": 101.0, "low": 99.0, "close": 100.5},
            {"time": self.session_opening_scan + 1200, "open": 100.5, "high": 103.0, "low": 100.4, "close": 102.5},
        ]

    def run_strategy(self, bars, **kwargs):
        return generate_sweep_bos_signals(
            bars,
            atr_len=1,
            sweep_len=3,
            bos_len=2,
            confirm_bars=10,
            **kwargs,
        )

    def test_scan_starts_thirty_minutes_before_each_configured_session(self):
        test_cases = [
            (dt.datetime(2024, 1, 2, 0, 30, tzinfo=dt.timezone.utc), ("Asia",)),
            (dt.datetime(2024, 1, 2, 7, 30, tzinfo=dt.timezone.utc), ("London",)),
            (dt.datetime(2024, 1, 2, 12, 50, tzinfo=dt.timezone.utc), ("IB",)),
            (dt.datetime(2024, 1, 2, 13, 30, tzinfo=dt.timezone.utc), ("New York", "IB")),
        ]
        for timestamp, expected in test_cases:
            with self.subTest(session=expected):
                self.assertEqual(
                    _sweep_bos_sessions(int(timestamp.timestamp())),
                    expected,
                )

        before_asia_scan = int(dt.datetime(2024, 1, 2, 0, 25, tzinfo=dt.timezone.utc).timestamp())
        self.assertEqual(_sweep_bos_sessions(before_asia_scan), ())

    def test_sweep_then_bos_emits_buy_during_half_hour_before_session(self):
        signals, levels = self.run_strategy(self.bars, atr_buffer=0.15)

        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal["direction"], "buy")
        self.assertEqual(signal["entry_time"], self.session_opening_scan + 1200)
        self.assertEqual(signal["entry"], 102.5)
        self.assertAlmostEqual(signal["stop"], 99.0 - 2.6 * 0.15)
        self.assertEqual(signal["setup"], "M5 Sweep + BOS")
        self.assertEqual(signal["session_names"], ["Asia"])
        self.assertEqual([level["direction"] for level in levels], ["resistance", "support"])

    def test_bearish_sweep_then_bos_emits_sell(self):
        bearish_bars = [
            {
                **bar,
                "open": 200 - bar["open"],
                "high": 200 - bar["low"],
                "low": 200 - bar["high"],
                "close": 200 - bar["close"],
            }
            for bar in self.bars
        ]
        signals, _ = self.run_strategy(bearish_bars, atr_buffer=0)

        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["direction"], "sell")
        self.assertEqual(signals[0]["entry_time"], self.session_opening_scan + 1200)

    def test_sweep_outside_pre_session_scan_does_not_create_signal(self):
        bars = [
            {**bar, "time": bar["time"] - 20 * 60}
            for bar in self.bars
        ]
        signals, _ = self.run_strategy(bars, atr_buffer=0)

        self.assertEqual(signals, [])

    def test_bos_must_arrive_within_configured_confirmation_bars(self):
        delayed = self.bars[:4] + [
            {"time": self.session_opening_scan + (index + 4) * 300, "open": 100.5, "high": 101.0, "low": 100.1, "close": 100.5}
            for index in range(3)
        ] + [
            {"time": self.session_opening_scan + 7 * 300, "open": 100.5, "high": 103.0, "low": 100.4, "close": 102.5}
        ]
        signals, _ = generate_sweep_bos_signals(
            delayed,
            atr_len=1,
            sweep_len=3,
            bos_len=2,
            confirm_bars=2,
            atr_buffer=0,
        )

        self.assertEqual(signals, [])

    def test_backtest_compares_five_targets_and_groups_sessions(self):
        later = self.bars + [
            {"time": self.session_opening_scan + 1500, "open": 102.5, "high": 105.5, "low": 102.0, "close": 105.0},
        ]
        result = run_sweep_bos_backtest(
            later,
            atr_len=1,
            atr_buffer=0,
            sweep_len=3,
            bos_len=2,
            confirm_bars=10,
            start_time=self.session_opening_scan,
        )

        self.assertEqual([item["target_r"] for item in result["results"]], [1, 2, 3, 4, 5])
        self.assertTrue(any(
            item["target_r"] == 1 and item["session"] == "Asia" and item["summary"]["trades"] == 1
            for item in result["session_results"]
        ))


if __name__ == "__main__":
    unittest.main()