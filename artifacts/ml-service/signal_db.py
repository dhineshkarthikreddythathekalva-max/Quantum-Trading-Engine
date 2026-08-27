"""
Signal Result Database — stores every candidate and final signal.

Captures:
- timestamp, asset, timeframe, expiry, direction, entry price
- expiry price, result (win/loss/pending)
- existing strategy score, XGBoost probability, A+ score
- market regime, component scores

Used for:
1. Training data collection
2. Performance analytics
3. Model improvement
"""

from __future__ import annotations
import json
import time
import sqlite3
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent / "data" / "signals.db"


class SignalDB:
    """SQLite-backed signal storage."""

    def __init__(self, db_path: str | Path | None = None):
        self.db_path = Path(db_path) if db_path else DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL NOT NULL,
                    asset TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    expiry TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    expiry_price REAL,
                    result TEXT DEFAULT 'pending',
                    strategy_score REAL DEFAULT 0,
                    strategy_direction INTEGER DEFAULT 0,
                    strategy_confirmations INTEGER DEFAULT 0,
                    xgboost_call_prob REAL DEFAULT 0.5,
                    xgboost_put_prob REAL DEFAULT 0.5,
                    aplus_score REAL DEFAULT 0,
                    aplus_decision TEXT DEFAULT 'PENDING',
                    regime TEXT DEFAULT 'UNKNOWN',
                    mtf_score REAL DEFAULT 0,
                    structure_score REAL DEFAULT 0,
                    entry_quality_score REAL DEFAULT 0,
                    momentum_score REAL DEFAULT 0,
                    candle_score REAL DEFAULT 0,
                    sr_score REAL DEFAULT 0,
                    volatility_score REAL DEFAULT 0,
                    threshold_used REAL DEFAULT 85,
                    features_json TEXT DEFAULT '{}',
                    metadata_json TEXT DEFAULT '{}'
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_signals_asset
                ON signals(asset)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_signals_timestamp
                ON signals(timestamp)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_signals_result
                ON signals(result)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_signals_expiry
                ON signals(expiry)
            """)
            conn.commit()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self.db_path))

    def store_candidate(
        self,
        asset: str,
        timeframe: str,
        expiry: str,
        direction: str,
        entry_price: float,
        strategy_score: float = 0,
        strategy_direction: int = 0,
        strategy_confirmations: int = 0,
        xgboost_call_prob: float = 0.5,
        xgboost_put_prob: float = 0.5,
        aplus_score: float = 0,
        aplus_decision: str = "PENDING",
        regime: str = "UNKNOWN",
        component_scores: dict[str, float] | None = None,
        threshold_used: float = 85,
        features: dict[str, float] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        """Store a candidate signal (before outcome is known)."""
        cs = component_scores or {}
        with self._conn() as conn:
            cursor = conn.execute("""
                INSERT INTO signals (
                    timestamp, asset, timeframe, expiry, direction, entry_price,
                    strategy_score, strategy_direction, strategy_confirmations,
                    xgboost_call_prob, xgboost_put_prob,
                    aplus_score, aplus_decision, regime,
                    mtf_score, structure_score, entry_quality_score,
                    momentum_score, candle_score, sr_score, volatility_score,
                    threshold_used, features_json, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                time.time(), asset, timeframe, expiry, direction, entry_price,
                strategy_score, strategy_direction, strategy_confirmations,
                xgboost_call_prob, xgboost_put_prob,
                aplus_score, aplus_decision, regime,
                cs.get("mtf_alignment", 0), cs.get("market_structure", 0),
                cs.get("entry_quality", 0), cs.get("momentum", 0),
                cs.get("candle_quality", 0), cs.get("support_resistance", 0),
                cs.get("volatility_regime", 0),
                threshold_used,
                json.dumps(features or {}),
                json.dumps(metadata or {}),
            ))
            conn.commit()
            return cursor.lastrowid or 0

    def update_result(self, signal_id: int, result: str, expiry_price: float = 0):
        """Update the outcome of a signal (win/loss)."""
        with self._conn() as conn:
            conn.execute("""
                UPDATE signals
                SET result = ?, expiry_price = ?
                WHERE id = ?
            """, (result, expiry_price, signal_id))
            conn.commit()

    def get_training_data(
        self,
        asset: str | None = None,
        expiry: str | None = None,
        min_timestamp: float | None = None,
    ) -> list[dict[str, Any]]:
        """Get resolved signals as training data."""
        query = "SELECT * FROM signals WHERE result IN ('win', 'loss')"
        params: list[Any] = []

        if asset:
            query += " AND asset = ?"
            params.append(asset)
        if expiry:
            query += " AND expiry = ?"
            params.append(expiry)
        if min_timestamp:
            query += " AND timestamp >= ?"
            params.append(min_timestamp)

        query += " ORDER BY timestamp ASC"

        with self._conn() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(query, params).fetchall()
            return [dict(row) for row in rows]

    def get_stats(self) -> dict[str, Any]:
        """Get overall performance statistics."""
        with self._conn() as conn:
            conn.row_factory = sqlite3.Row

            # Overall
            total = conn.execute("SELECT COUNT(*) as c FROM signals").fetchone()["c"]
            decided = conn.execute(
                "SELECT COUNT(*) as c FROM signals WHERE result IN ('win', 'loss')"
            ).fetchone()["c"]
            wins = conn.execute(
                "SELECT COUNT(*) as c FROM signals WHERE result = 'win'"
            ).fetchone()["c"]
            losses = conn.execute(
                "SELECT COUNT(*) as c FROM signals WHERE result = 'loss'"
            ).fetchone()["c"]
            pending = conn.execute(
                "SELECT COUNT(*) as c FROM signals WHERE result = 'pending'"
            ).fetchone()["c"]

            # A+ filtered stats
            aplus_total = conn.execute(
                "SELECT COUNT(*) as c FROM signals WHERE aplus_decision = 'A_PLUS_SIGNAL'"
            ).fetchone()["c"]
            aplus_wins = conn.execute(
                "SELECT COUNT(*) as c FROM signals WHERE aplus_decision = 'A_PLUS_SIGNAL' AND result = 'win'"
            ).fetchone()["c"]
            aplus_losses = conn.execute(
                "SELECT COUNT(*) as c FROM signals WHERE aplus_decision = 'A_PLUS_SIGNAL' AND result = 'loss'"
            ).fetchone()["c"]

            # By asset
            by_asset = {}
            for row in conn.execute(
                "SELECT asset, COUNT(*) as total, "
                "SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins, "
                "SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) as losses "
                "FROM signals WHERE result IN ('win','loss') GROUP BY asset"
            ).fetchall():
                by_asset[row["asset"]] = {
                    "total": row["total"],
                    "wins": row["wins"],
                    "losses": row["losses"],
                    "win_rate": round(row["wins"] / row["total"] * 100, 1) if row["total"] > 0 else 0,
                }

            # By expiry
            by_expiry = {}
            for row in conn.execute(
                "SELECT expiry, COUNT(*) as total, "
                "SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins, "
                "SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) as losses "
                "FROM signals WHERE result IN ('win','loss') GROUP BY expiry"
            ).fetchall():
                by_expiry[row["expiry"]] = {
                    "total": row["total"],
                    "wins": row["wins"],
                    "losses": row["losses"],
                    "win_rate": round(row["wins"] / row["total"] * 100, 1) if row["total"] > 0 else 0,
                }

            # By regime
            by_regime = {}
            for row in conn.execute(
                "SELECT regime, COUNT(*) as total, "
                "SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins, "
                "SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) as losses "
                "FROM signals WHERE result IN ('win','loss') GROUP BY regime"
            ).fetchall():
                by_regime[row["regime"]] = {
                    "total": row["total"],
                    "wins": row["wins"],
                    "losses": row["losses"],
                    "win_rate": round(row["wins"] / row["total"] * 100, 1) if row["total"] > 0 else 0,
                }

            # Signals per hour (last 24h)
            day_ago = time.time() - 86400
            signals_24h = conn.execute(
                "SELECT COUNT(*) as c FROM signals WHERE timestamp >= ?", (day_ago,)
            ).fetchone()["c"]

            return {
                "total_signals": total,
                "decided": decided,
                "wins": wins,
                "losses": losses,
                "pending": pending,
                "win_rate": round(wins / decided * 100, 1) if decided > 0 else 0,
                "signals_per_day": signals_24h,
                "signals_per_hour": round(signals_24h / 24, 1),
                "aplus_stats": {
                    "total": aplus_total,
                    "wins": aplus_wins,
                    "losses": aplus_losses,
                    "win_rate": round(aplus_wins / (aplus_wins + aplus_losses) * 100, 1)
                    if (aplus_wins + aplus_losses) > 0 else 0,
                },
                "by_asset": by_asset,
                "by_expiry": by_expiry,
                "by_regime": by_regime,
            }

    def get_recent(self, limit: int = 50) -> list[dict[str, Any]]:
        """Get recent signals."""
        with self._conn() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM signals ORDER BY timestamp DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]
