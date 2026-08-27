"""
A+ Quality Scoring Engine — 0-100 score for candidate signals.

Combines:
- XGBoost probability (25%)
- Multi-timeframe alignment (15%)
- Market structure (15%)
- Entry quality (15%)
- Momentum (10%)
- Candle quality (8%)
- Support/resistance (5%)
- Volatility/regime (7%)

All weights are configurable. Dynamic thresholds based on regime.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

from feature_engine import extract_features


@dataclass
class QualityWeights:
    """Configurable weight composition for A+ score."""
    xgboost_prob: float = 0.25
    mtf_alignment: float = 0.15
    market_structure: float = 0.15
    entry_quality: float = 0.15
    momentum: float = 0.10
    candle_quality: float = 0.08
    support_resistance: float = 0.05
    volatility_regime: float = 0.07

    def normalize(self):
        """Ensure weights sum to 1.0."""
        total = (self.xgboost_prob + self.mtf_alignment + self.market_structure +
                 self.entry_quality + self.momentum + self.candle_quality +
                 self.support_resistance + self.volatility_regime)
        if total > 0:
            self.xgboost_prob /= total
            self.mtf_alignment /= total
            self.market_structure /= total
            self.entry_quality /= total
            self.momentum /= total
            self.candle_quality /= total
            self.support_resistance /= total
            self.volatility_regime /= total


@dataclass
class RegimeThresholds:
    """Dynamic quality thresholds per market regime."""
    trending: float = 82.0
    normal: float = 85.0
    ranging: float = 86.0
    choppy: float = 90.0


@dataclass
class APlusResult:
    """Result of A+ quality evaluation."""
    score: float  # 0-100
    decision: str  # "A_PLUS_SIGNAL" or "REJECTED"
    threshold_used: float
    regime: str
    direction: str  # "CALL" or "PUT"
    call_probability: float
    put_probability: float
    component_scores: dict[str, float]
    reasons: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": round(self.score, 2),
            "decision": self.decision,
            "threshold_used": round(self.threshold_used, 2),
            "regime": self.regime,
            "direction": self.direction,
            "call_probability": round(self.call_probability, 4),
            "put_probability": round(self.put_probability, 4),
            "component_scores": {k: round(v, 2) for k, v in self.component_scores.items()},
            "reasons": self.reasons,
        }


class APlusScorer:
    """Evaluates candidate signals and produces A+ quality scores."""

    def __init__(
        self,
        weights: QualityWeights | None = None,
        thresholds: RegimeThresholds | None = None,
    ):
        self.weights = weights or QualityWeights()
        self.weights.normalize()
        self.thresholds = thresholds or RegimeThresholds()

    def _score_xgboost(self, call_prob: float, put_prob: float, direction: str) -> float:
        """Score from XGBoost probability (0-100)."""
        if direction == "CALL":
            return call_prob * 100
        else:
            return put_prob * 100

    def _score_mtf(self, features: dict[str, float]) -> float:
        """Multi-timeframe alignment score (0-100)."""
        alignment = features.get("mtf_alignment", 0.0)
        # alignment is -1 to +1, convert to 0-100
        return (abs(alignment) * 100)

    def _score_structure(self, features: dict[str, float]) -> float:
        """Market structure score (0-100)."""
        score = 50.0  # neutral baseline

        # Higher highs / lower lows
        if features.get("higher_highs", 0) > 0:
            score += 15
        if features.get("lower_lows", 0) > 0:
            score += 15

        # Trend direction alignment
        trend_dir = features.get("trend_direction", 0)
        score += trend_dir * 10

        # ADX strength
        adx = features.get("adx", 25)
        if adx > 30:
            score += 10
        elif adx > 20:
            score += 5

        return max(0, min(100, score))

    def _score_entry_quality(self, features: dict[str, float]) -> float:
        """Entry quality score based on strategy alignment and confirmation."""
        score = 50.0

        # Strategy alignment
        strategy_aligned = features.get("strategy_aligned", 0)
        score += strategy_aligned * 20

        # Strategy confirmations
        confirmations = features.get("strategy_confirmations", 0)
        score += min(20, confirmations * 7)

        # RSI not overbought/oversold in wrong direction
        rsi = features.get("rsi14", 50)
        score += 10 if 30 < rsi < 70 else -5

        # Price near EMA (good entry)
        price_vs_ema20 = abs(features.get("price_vs_ema20", 0))
        if price_vs_ema20 < 0.002:
            score += 10  # Near EMA = good pullback entry

        return max(0, min(100, score))

    def _score_momentum(self, features: dict[str, float]) -> float:
        """Momentum score (0-100)."""
        score = 50.0

        # RSI contribution
        rsi = features.get("rsi14", 50)
        if 40 <= rsi <= 60:
            score += 10  # neutral zone = good
        elif rsi < 30 or rsi > 70:
            score -= 10  # extreme = risky

        # MACD contribution
        macd_hist = features.get("macd_hist", 0)
        score += min(15, max(-15, macd_hist * 1000))

        # Stochastic
        stoch_k = features.get("stoch_k", 50)
        if 20 <= stoch_k <= 80:
            score += 5

        # ROC
        roc = features.get("roc5", 0)
        score += min(10, max(-10, roc * 100))

        return max(0, min(100, score))

    def _score_candle_quality(self, features: dict[str, float]) -> float:
        """Candle quality score (0-100)."""
        score = 50.0

        body_ratio = features.get("body_range_ratio", 0.5)
        rejection = features.get("rejection_strength", 1.0)

        # Strong body candle (decisive move)
        if body_ratio > 0.6:
            score += 20
        elif body_ratio < 0.2:
            score -= 10  # Very small body = indecision

        # Rejection wicks (reversal signals)
        if rejection > 1.5:
            score += 15  # Strong rejection

        # Close position
        close_pos = features.get("close_position", 0.5)
        is_bull = features.get("is_bull_candle", 0)
        if is_bull and close_pos > 0.7:
            score += 10  # Bull candle closing near high
        elif not is_bull and close_pos < 0.3:
            score += 10  # Bear candle closing near low

        return max(0, min(100, score))

    def _score_support_resistance(self, features: dict[str, float]) -> float:
        """Support/resistance proximity score (0-100)."""
        score = 50.0

        sr_pos = features.get("sr_position", 0.5)
        support_dist = features.get("support_distance", 0.5)
        resistance_dist = features.get("resistance_distance", 0.5)

        # Near support = good for CALL, near resistance = good for PUT
        if support_dist < 0.2:
            score += 20  # Near support
        elif resistance_dist < 0.2:
            score += 20  # Near resistance

        # Not in dead zone (middle of range)
        if 0.3 < sr_pos < 0.7:
            score += 5

        return max(0, min(100, score))

    def _score_volatility(self, features: dict[str, float]) -> float:
        """Volatility/regime score (0-100)."""
        score = 50.0

        atr_pct = features.get("atr_pct", 0)
        range_expansion = features.get("range_expansion", 1.0)

        # Moderate volatility is best
        if 0.001 < atr_pct < 0.005:
            score += 20
        elif atr_pct > 0.01:
            score -= 15  # Too volatile
        elif atr_pct < 0.0005:
            score -= 10  # Too quiet

        # Range expansion (expanding = opportunity)
        if 1.0 < range_expansion < 2.0:
            score += 10
        elif range_expansion > 3.0:
            score -= 10  # Abnormal expansion

        return max(0, min(100, score))

    def _classify_regime(self, features: dict[str, float]) -> str:
        """Classify market regime from features."""
        adx = features.get("adx", 25)
        vol_expansion = features.get("volatility_expansion", 1.0)
        trend_strength = features.get("trend_strength", 0.5)

        if vol_expansion > 1.8:
            return "CHOPPY"
        elif adx > 25 and trend_strength > 0.5:
            return "TRENDING"
        elif adx < 20:
            return "RANGING"
        else:
            return "NORMAL"

    def _get_threshold(self, regime: str) -> float:
        """Get dynamic threshold for regime."""
        mapping = {
            "TRENDING": self.thresholds.trending,
            "NORMAL": self.thresholds.normal,
            "RANGING": self.thresholds.ranging,
            "CHOPPY": self.thresholds.choppy,
        }
        return mapping.get(regime, self.thresholds.normal)

    def evaluate(
        self,
        features: dict[str, float],
        direction: str,
        call_prob: float = 0.5,
        put_prob: float = 0.5,
    ) -> APlusResult:
        """
        Evaluate a candidate signal and produce A+ quality score.

        Args:
            features: Extracted feature dictionary
            direction: "CALL" or "PUT"
            call_prob: XGBoost CALL probability
            put_prob: XGBoost PUT probability

        Returns:
            APlusResult with score, decision, and component breakdown
        """
        reasons: list[str] = []

        # Classify regime
        regime = self._classify_regime(features)
        threshold = self._get_threshold(regime)

        # Compute component scores
        components = {
            "xgboost_prob": self._score_xgboost(call_prob, put_prob, direction),
            "mtf_alignment": self._score_mtf(features),
            "market_structure": self._score_structure(features),
            "entry_quality": self._score_entry_quality(features),
            "momentum": self._score_momentum(features),
            "candle_quality": self._score_candle_quality(features),
            "support_resistance": self._score_support_resistance(features),
            "volatility_regime": self._score_volatility(features),
        }

        # Weighted composite
        score = (
            components["xgboost_prob"] * self.weights.xgboost_prob +
            components["mtf_alignment"] * self.weights.mtf_alignment +
            components["market_structure"] * self.weights.market_structure +
            components["entry_quality"] * self.weights.entry_quality +
            components["momentum"] * self.weights.momentum +
            components["candle_quality"] * self.weights.candle_quality +
            components["support_resistance"] * self.weights.support_resistance +
            components["volatility_regime"] * self.weights.volatility_regime
        )

        score = max(0, min(100, score))

        # Decision
        decision = "A_PLUS_SIGNAL" if score >= threshold else "REJECTED"

        # Build reasons
        reasons.append(f"Regime: {regime} (threshold: {threshold})")
        reasons.append(f"XGBoost: {direction} = {call_prob:.1%}" if direction == "CALL"
                       else f"XGBoost: {direction} = {put_prob:.1%}")
        reasons.append(f"MTF alignment: {components['mtf_alignment']:.1f}/100")
        reasons.append(f"Structure: {components['market_structure']:.1f}/100")
        reasons.append(f"Entry quality: {components['entry_quality']:.1f}/100")
        reasons.append(f"Momentum: {components['momentum']:.1f}/100")
        reasons.append(f"Candle: {components['candle_quality']:.1f}/100")
        reasons.append(f"S/R: {components['support_resistance']:.1f}/100")
        reasons.append(f"Volatility: {components['volatility_regime']:.1f}/100")

        if decision == "A_PLUS_SIGNAL":
            reasons.append(f"✅ PASSED — Score {score:.1f} >= threshold {threshold}")
        else:
            reasons.append(f"❌ REJECTED — Score {score:.1f} < threshold {threshold}")

        return APlusResult(
            score=score,
            decision=decision,
            threshold_used=threshold,
            regime=regime,
            direction=direction,
            call_probability=call_prob,
            put_probability=put_prob,
            component_scores=components,
            reasons=reasons,
        )

    def get_config(self) -> dict[str, Any]:
        """Return current configuration for display/optimization."""
        return {
            "weights": {
                "xgboost_prob": self.weights.xgboost_prob,
                "mtf_alignment": self.weights.mtf_alignment,
                "market_structure": self.weights.market_structure,
                "entry_quality": self.weights.entry_quality,
                "momentum": self.weights.momentum,
                "candle_quality": self.weights.candle_quality,
                "support_resistance": self.weights.support_resistance,
                "volatility_regime": self.weights.volatility_regime,
            },
            "thresholds": {
                "trending": self.thresholds.trending,
                "normal": self.thresholds.normal,
                "ranging": self.thresholds.ranging,
                "choppy": self.thresholds.choppy,
            },
        }

    def update_config(
        self,
        weights: dict[str, float] | None = None,
        thresholds: dict[str, float] | None = None,
    ):
        """Update weights and/or thresholds (for optimization)."""
        if weights:
            for k, v in weights.items():
                if hasattr(self.weights, k):
                    setattr(self.weights, k, v)
            self.weights.normalize()

        if thresholds:
            for k, v in thresholds.items():
                if hasattr(self.thresholds, k):
                    setattr(self.thresholds, k, v)
