"""
Feature Engine — extracts structured features from OHLC candle data.

Produces features for:
- Trend (EMA, slope, separation, Supertrend-like direction, structure)
- Momentum (RSI, MACD, ROC, consecutive direction)
- Volatility (ATR, range expansion/contraction)
- Candle structure (body, wicks, close position)
- Market structure (S/R distance, swing points, breakout proximity)
- Existing strategy integration (composite score, direction, confirmations)
"""

from __future__ import annotations
import numpy as np
from typing import Any


def _ema(data: np.ndarray, period: int) -> np.ndarray:
    """Exponential moving average."""
    if len(data) < period:
        return np.full_like(data, data[0] if len(data) > 0 else 0.0, dtype=float)
    k = 2.0 / (period + 1)
    result = np.zeros(len(data), dtype=float)
    result[period - 1] = np.mean(data[:period])
    for i in range(period, len(data)):
        result[i] = data[i] * k + result[i - 1] * (1 - k)
    return result


def _rsi(closes: np.ndarray, period: int = 14) -> float:
    """Relative Strength Index."""
    if len(closes) < period + 1:
        return 50.0
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            gains += d
        else:
            losses -= d
    avg_g = gains / period
    avg_l = losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        avg_g = (avg_g * (period - 1) + (d if d > 0 else 0)) / period
        avg_l = (avg_l * (period - 1) + (-d if d < 0 else 0)) / period
    if avg_l == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + avg_g / avg_l)


def _macd(closes: np.ndarray) -> tuple[float, float, float]:
    """MACD line, signal, histogram."""
    if len(closes) < 35:
        return 0.0, 0.0, 0.0
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    macd_line = ema12 - ema26
    # Start from index 25 onward (where both EMAs are warm)
    macd_valid = macd_line[25:]
    if len(macd_valid) < 9:
        return 0.0, 0.0, 0.0
    signal = _ema(macd_valid, 9)
    return float(macd_valid[-1]), float(signal[-1]), float(macd_valid[-1] - signal[-1])


def _atr(candles: list[dict], period: int = 14) -> float:
    """Average True Range."""
    if len(candles) < 2:
        return 0.0
    trs = []
    for i in range(1, len(candles)):
        c, p = candles[i], candles[i - 1]
        tr = max(c["high"] - c["low"], abs(c["high"] - p["close"]), abs(c["low"] - p["close"]))
        trs.append(tr)
    if len(trs) < period:
        return np.mean(trs) if trs else 0.0
    return np.mean(trs[-period:])


def _stochastic(candles: list[dict], k_period: int = 14, d_period: int = 3) -> tuple[float, float]:
    """Stochastic oscillator %K, %D."""
    if len(candles) < k_period + d_period:
        return 50.0, 50.0
    k_arr = []
    for i in range(k_period - 1, len(candles)):
        sl = candles[i - k_period + 1:i + 1]
        hi = max(c["high"] for c in sl)
        lo = min(c["low"] for c in sl)
        k_val = ((candles[i]["close"] - lo) / (hi - lo) * 100) if hi != lo else 50.0
        k_arr.append(k_val)
    k_arr = np.array(k_arr)
    d_arr = _ema(k_arr, d_period)
    return float(k_arr[-1]), float(d_arr[-1])


def _bb(closes: np.ndarray, period: int = 20, mult: float = 2.0) -> tuple[float, float, float, float]:
    """Bollinger Bands: upper, mid, lower, percent_b."""
    if len(closes) < period:
        p = closes[-1] if len(closes) > 0 else 0.0
        return p * 1.002, p, p * 0.998, 0.5
    s = closes[-period:]
    mid = np.mean(s)
    std = np.std(s)
    upper = mid + mult * std
    lower = mid - mult * std
    price = closes[-1]
    pct_b = (price - lower) / (upper - lower) if upper != lower else 0.5
    return float(upper), float(mid), float(lower), float(pct_b)


def extract_features(
    candles: list[dict],
    strategy_score: float = 0.0,
    strategy_direction: int = 0,
    strategy_confirmations: int = 0,
) -> dict[str, float]:
    """
    Extract all features from a list of OHLCV candles.

    Returns a flat dictionary of feature_name → float value.
    Only uses data available at candle close (no look-ahead).
    """
    if len(candles) < 20:
        return {}

    closes = np.array([c["close"] for c in candles], dtype=float)
    highs = np.array([c["high"] for c in candles], dtype=float)
    lows = np.array([c["low"] for c in candles], dtype=float)
    opens = np.array([c["open"] for c in candles], dtype=float)
    volumes = np.array([c.get("volume", 0) for c in candles], dtype=float)
    price = closes[-1]

    features: dict[str, float] = {}

    # ── Trend Features ──
    ema9_arr = _ema(closes, 9)
    ema20_arr = _ema(closes, 20)
    ema50_arr = _ema(closes, min(50, len(closes) - 1))
    ema9 = ema9_arr[-1]
    ema20 = ema20_arr[-1]
    ema50 = ema50_arr[-1]

    features["ema9"] = ema9
    features["ema20"] = ema20
    features["ema50"] = ema50
    features["price_vs_ema9"] = (price - ema9) / price if price != 0 else 0.0
    features["price_vs_ema20"] = (price - ema20) / price if price != 0 else 0.0
    features["price_vs_ema50"] = (price - ema50) / price if price != 0 else 0.0

    # EMA slope (rate of change of EMA over last 5 candles)
    if len(ema9_arr) >= 6 and ema9_arr[-6] != 0:
        features["ema9_slope"] = (ema9_arr[-1] - ema9_arr[-6]) / ema9_arr[-6]
    else:
        features["ema9_slope"] = 0.0

    if len(ema20_arr) >= 6 and ema20_arr[-6] != 0:
        features["ema20_slope"] = (ema20_arr[-1] - ema20_arr[-6]) / ema20_arr[-6]
    else:
        features["ema20_slope"] = 0.0

    # EMA separation
    features["ema9_20_sep"] = (ema9 - ema20) / price if price != 0 else 0.0
    features["ema20_50_sep"] = (ema20 - ema50) / price if price != 0 else 0.0

    # Supertrend-like direction (price vs EMA with slope confirmation)
    features["trend_direction"] = 1.0 if price > ema20 and features["ema20_slope"] > 0 else (
        -1.0 if price < ema20 and features["ema20_slope"] < 0 else 0.0
    )

    # Higher-high / lower-low structure (last 10 candles)
    swing_highs = []
    swing_lows = []
    for i in range(2, min(10, len(candles) - 2)):
        idx = len(candles) - 1 - i
        if idx < 2 or idx >= len(candles) - 2:
            continue
        if (candles[idx]["high"] > candles[idx - 1]["high"] and
            candles[idx]["high"] > candles[idx + 1]["high"]):
            swing_highs.append(candles[idx]["high"])
        if (candles[idx]["low"] < candles[idx - 1]["low"] and
            candles[idx]["low"] < candles[idx + 1]["low"]):
            swing_lows.append(candles[idx]["low"])

    if len(swing_highs) >= 2:
        features["higher_highs"] = 1.0 if swing_highs[0] > swing_highs[1] else 0.0
    else:
        features["higher_highs"] = 0.0

    if len(swing_lows) >= 2:
        features["lower_lows"] = 1.0 if swing_lows[0] < swing_lows[1] else 0.0
    else:
        features["lower_lows"] = 0.0

    # ADX approximation (simplified)
    adx_val = 25.0  # default neutral
    if len(candles) >= 28:
        trs = []
        pdms = []
        mdms = []
        for i in range(1, len(candles)):
            c, p = candles[i], candles[i - 1]
            tr = max(c["high"] - c["low"], abs(c["high"] - p["close"]), abs(c["low"] - p["close"]))
            trs.append(tr)
            pdms.append(max(c["high"] - p["high"], 0) if c["high"] - p["high"] > p["low"] - c["low"] else 0)
            mdms.append(max(p["low"] - c["low"], 0) if p["low"] - c["low"] > c["high"] - p["high"] else 0)
        if len(trs) >= 14:
            atr14 = np.mean(trs[-14:])
            pdm14 = np.mean(pdms[-14:])
            mdm14 = np.mean(mdms[-14:])
            pdi = (pdm14 / atr14 * 100) if atr14 > 0 else 0
            mdi = (mdm14 / atr14 * 100) if atr14 > 0 else 0
            dx = abs(pdi - mdi) / (pdi + mdi) * 100 if (pdi + mdi) > 0 else 0
            adx_val = dx
    features["adx"] = adx_val
    features["trend_strength"] = min(1.0, adx_val / 50.0)

    # ── Momentum Features ──
    rsi14 = _rsi(closes, 14)
    features["rsi14"] = rsi14
    features["rsi_overbought"] = 1.0 if rsi14 > 70 else 0.0
    features["rsi_oversold"] = 1.0 if rsi14 < 30 else 0.0

    # RSI slope
    if len(closes) >= 20:
        rsi_prev = _rsi(closes[:-3], 14)
        features["rsi_slope"] = rsi14 - rsi_prev
    else:
        features["rsi_slope"] = 0.0

    macd_line, macd_signal, macd_hist = _macd(closes)
    features["macd_line"] = macd_line / price if price != 0 else 0.0
    features["macd_signal"] = macd_signal / price if price != 0 else 0.0
    features["macd_hist"] = macd_hist / price if price != 0 else 0.0
    features["macd_bullish"] = 1.0 if macd_hist > 0 else 0.0

    # Rate of change
    if len(closes) >= 6 and closes[-6] != 0:
        features["roc5"] = (closes[-1] - closes[-6]) / closes[-6]
    else:
        features["roc5"] = 0.0

    if len(closes) >= 11 and closes[-11] != 0:
        features["roc10"] = (closes[-1] - closes[-11]) / closes[-11]
    else:
        features["roc10"] = 0.0

    # Consecutive candle direction
    consecutive = 0
    for i in range(len(candles) - 1, max(0, len(candles) - 6), -1):
        if candles[i]["close"] > candles[i]["open"]:
            if consecutive < 0:
                break
            consecutive += 1
        elif candles[i]["close"] < candles[i]["open"]:
            if consecutive > 0:
                break
            consecutive -= 1
        else:
            break
    features["consecutive_direction"] = consecutive / 5.0  # normalized

    # ── Volatility Features ──
    atr_val = _atr(candles, 14)
    features["atr14"] = atr_val
    features["atr_pct"] = atr_val / price if price != 0 else 0.0

    # Current candle range
    current_range = candles[-1]["high"] - candles[-1]["low"]
    features["candle_range"] = current_range
    features["candle_range_pct"] = current_range / price if price != 0 else 0.0

    # Average candle range (last 10)
    avg_range = np.mean([c["high"] - c["low"] for c in candles[-10:]])
    features["avg_candle_range"] = avg_range

    # Range expansion
    features["range_expansion"] = current_range / avg_range if avg_range > 0 else 1.0

    # Volatility regime
    if len(candles) >= 20:
        recent_ranges = [c["high"] - c["low"] for c in candles[-20:]]
        early_ranges = [c["high"] - c["low"] for c in candles[-40:-20]] if len(candles) >= 40 else recent_ranges
        recent_avg = np.mean(recent_ranges)
        early_avg = np.mean(early_ranges)
        features["volatility_expansion"] = recent_avg / early_avg if early_avg > 0 else 1.0
    else:
        features["volatility_expansion"] = 1.0

    # ── Candle Structure Features ──
    last = candles[-1]
    body = abs(last["close"] - last["open"])
    rng = last["high"] - last["low"] if last["high"] != last["low"] else 0.00001
    upper_wick = last["high"] - max(last["close"], last["open"])
    lower_wick = min(last["close"], last["open"]) - last["low"]

    features["candle_body"] = body
    features["body_range_ratio"] = body / rng
    features["upper_wick_pct"] = upper_wick / rng
    features["lower_wick_pct"] = lower_wick / rng

    # Close position within candle (0 = low, 1 = high)
    features["close_position"] = (last["close"] - last["low"]) / rng

    # Bullish/bearish candle
    features["is_bull_candle"] = 1.0 if last["close"] > last["open"] else 0.0

    # Previous candle relationship
    if len(candles) >= 2:
        prev = candles[-2]
        features["prev_bull"] = 1.0 if prev["close"] > prev["open"] else 0.0
        features["close_vs_prev_high"] = (last["close"] - prev["high"]) / price if price != 0 else 0.0
        features["close_vs_prev_low"] = (last["close"] - prev["low"]) / price if price != 0 else 0.0

    # Rejection strength (long wick relative to body)
    features["rejection_strength"] = min(2.0, (upper_wick + lower_wick) / max(body, 0.00001))

    # Stochastic
    stoch_k, stoch_d = _stochastic(candles)
    features["stoch_k"] = stoch_k
    features["stoch_d"] = stoch_d
    features["stoch_k_d_diff"] = stoch_k - stoch_d

    # Bollinger Bands
    bb_upper, bb_mid, bb_lower, bb_pct = _bb(closes)
    features["bb_pct"] = bb_pct
    features["bb_width"] = (bb_upper - bb_lower) / bb_mid if bb_mid != 0 else 0.0

    # ── Market Structure Features ──
    # Support/resistance distance
    if len(candles) >= 10:
        recent_highs = [c["high"] for c in candles[-30:]] if len(candles) >= 30 else [c["high"] for c in candles]
        recent_lows = [c["low"] for c in candles[-30:]] if len(candles) >= 30 else [c["low"] for c in candles]
        resistance = max(recent_highs)
        support = min(recent_lows)
        sr_range = resistance - support if resistance != support else 0.0001

        features["support_distance"] = (price - support) / sr_range
        features["resistance_distance"] = (resistance - price) / sr_range
        features["sr_position"] = (price - support) / sr_range  # 0 at support, 1 at resistance
    else:
        features["support_distance"] = 0.5
        features["resistance_distance"] = 0.5
        features["sr_position"] = 0.5

    # Swing high/low proximity
    if swing_highs:
        nearest_high = min(swing_highs, key=lambda h: abs(h - price))
        features["swing_high_distance"] = abs(nearest_high - price) / price if price != 0 else 0.0
    else:
        features["swing_high_distance"] = 0.01

    if swing_lows:
        nearest_low = min(swing_lows, key=lambda l: abs(l - price))
        features["swing_low_distance"] = abs(nearest_low - price) / price if price != 0 else 0.0
    else:
        features["swing_low_distance"] = 0.01

    # Breakout distance (distance from nearest S/R zone)
    features["breakout_distance"] = min(
        features["swing_high_distance"],
        features["swing_low_distance"],
    )

    # ── Volume Features ──
    if len(volumes) >= 20:
        avg_vol = np.mean(volumes[-20:])
        features["volume_ratio"] = volumes[-1] / avg_vol if avg_vol > 0 else 1.0
        features["volume_spike"] = 1.0 if volumes[-1] > avg_vol * 1.5 else 0.0
    else:
        features["volume_ratio"] = 1.0
        features["volume_spike"] = 0.0

    # ── Existing Strategy Integration ──
    features["strategy_score"] = strategy_score
    features["strategy_direction"] = float(strategy_direction)
    features["strategy_confirmations"] = float(strategy_confirmations)
    features["strategy_aligned"] = 1.0 if (
        (strategy_direction > 0 and price > ema20) or
        (strategy_direction < 0 and price < ema20)
    ) else 0.0

    # ── Multi-Timeframe Alignment ──
    # Approximate higher TFs by using longer EMAs
    if len(closes) >= 50:
        ema15m_proxy = _ema(closes, min(50, len(closes) - 1))  # proxy for 15m trend
        features["long_trend_direction"] = 1.0 if price > ema15m_proxy[-1] else -1.0
    else:
        features["long_trend_direction"] = 0.0

    if len(closes) >= 30:
        ema5m_proxy = _ema(closes, min(30, len(closes) - 1))  # proxy for 5m trend
        features["medium_trend_direction"] = 1.0 if price > ema5m_proxy[-1] else -1.0
    else:
        features["medium_trend_direction"] = 0.0

    features["short_trend_direction"] = 1.0 if price > ema9 else -1.0 if price < ema9 else 0.0

    # Weighted multi-timeframe alignment score
    mtf_score = (
        features["long_trend_direction"] * 3.0 +
        features["medium_trend_direction"] * 2.0 +
        features["short_trend_direction"] * 1.0
    ) / 6.0
    features["mtf_alignment"] = mtf_score

    return features


def get_feature_names() -> list[str]:
    """Return ordered list of all feature names."""
    # This mirrors the keys returned by extract_features
    # Used for model training consistency
    return sorted([
        # Trend
        "ema9", "ema20", "ema50",
        "price_vs_ema9", "price_vs_ema20", "price_vs_ema50",
        "ema9_slope", "ema20_slope",
        "ema9_20_sep", "ema20_50_sep",
        "trend_direction", "higher_highs", "lower_lows",
        "adx", "trend_strength",
        # Momentum
        "rsi14", "rsi_overbought", "rsi_oversold", "rsi_slope",
        "macd_line", "macd_signal", "macd_hist", "macd_bullish",
        "roc5", "roc10",
        "consecutive_direction",
        # Volatility
        "atr14", "atr_pct",
        "candle_range", "candle_range_pct",
        "avg_candle_range", "range_expansion",
        "volatility_expansion",
        # Candle structure
        "candle_body", "body_range_ratio",
        "upper_wick_pct", "lower_wick_pct",
        "close_position", "is_bull_candle",
        "prev_bull", "close_vs_prev_high", "close_vs_prev_low",
        "rejection_strength",
        "stoch_k", "stoch_d", "stoch_k_d_diff",
        "bb_pct", "bb_width",
        # Market structure
        "support_distance", "resistance_distance", "sr_position",
        "swing_high_distance", "swing_low_distance",
        "breakout_distance",
        # Volume
        "volume_ratio", "volume_spike",
        # Strategy integration
        "strategy_score", "strategy_direction",
        "strategy_confirmations", "strategy_aligned",
        # Multi-TF
        "long_trend_direction", "medium_trend_direction",
        "short_trend_direction", "mtf_alignment",
    ])
