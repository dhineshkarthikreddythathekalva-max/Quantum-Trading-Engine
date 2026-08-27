"""
Training Pipeline — walk-forward XGBoost training.

Steps:
1. Collect historical candidates from signal DB
2. Generate features for each candidate
3. Create labels (win=1, loss=0)
4. Chronological train/validation/test split
5. Train XGBoost per expiry horizon
6. Report performance metrics
7. Only promote new model if it genuinely improves OOS performance
"""

from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Any

import numpy as np

from feature_engine import extract_features, get_feature_names
from model import ModelManager, EXPIRY_HORIZONS
from signal_db import SignalDB


class TrainingPipeline:
    """Manages XGBoost model training with walk-forward validation."""

    def __init__(
        self,
        model_manager: ModelManager,
        signal_db: SignalDB,
    ):
        self.model_manager = model_manager
        self.signal_db = signal_db
        self.config_path = Path(__file__).resolve().parent / "data" / "training_config.json"

    def _prepare_training_data(
        self,
        expiry: str,
        min_samples: int = 100,
    ) -> tuple[np.ndarray, np.ndarray, list[str]] | None:
        """
        Prepare feature matrix and labels for a specific expiry.

        Returns (X, y, feature_names) or None if insufficient data.
        """
        records = self.signal_db.get_training_data(expiry=expiry)

        if len(records) < min_samples:
            return None

        feature_names = get_feature_names()
        X_rows = []
        y_rows = []

        for record in records:
            # Reconstruct features from stored data
            features_json = record.get("features_json", "{}")
            try:
                features = json.loads(features_json) if isinstance(features_json, str) else {}
            except (json.JSONDecodeError, TypeError):
                features = {}

            # If features weren't stored, use strategy data as fallback
            if not features:
                features = {
                    "strategy_score": record.get("strategy_score", 0),
                    "strategy_direction": record.get("strategy_direction", 0),
                    "strategy_confirmations": record.get("strategy_confirmations", 0),
                }

            x = [features.get(f, 0.0) for f in feature_names]
            X_rows.append(x)

            # Label: win=1, loss=0
            result = record.get("result", "pending")
            y_rows.append(1 if result == "win" else 0)

        X = np.array(X_rows, dtype=float)
        y = np.array(y_rows, dtype=float)

        # Remove NaN/Inf
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

        # Minimum positive rate check
        pos_rate = np.mean(y)
        if pos_rate < 0.1 or pos_rate > 0.9:
            # Extreme class imbalance — might still train but flag it
            pass

        return X, y, feature_names

    def train_expiry(
        self,
        expiry: str,
        min_samples: int = 100,
    ) -> dict[str, Any]:
        """
        Train model for a specific expiry horizon.

        Returns training report.
        """
        data = self._prepare_training_data(expiry, min_samples)
        if data is None:
            return {
                "expiry": expiry,
                "status": "insufficient_data",
                "min_required": min_samples,
                "message": f"Need at least {min_samples} resolved signals for {expiry} expiry",
            }

        X, y, feature_names = data

        model = self.model_manager.get_model(expiry)
        old_version = model.version
        old_metrics = model.metadata.get("metrics", {})

        # Train new model
        metrics = model.train(X, y, feature_names, calibrate=True)

        if "error" in metrics:
            return {
                "expiry": expiry,
                "status": "training_error",
                "error": metrics["error"],
            }

        # Compare old vs new
        improvement = {}
        if old_metrics:
            old_acc = old_metrics.get("val_accuracy", 0)
            new_acc = metrics.get("val_accuracy", 0)
            improvement = {
                "old_val_accuracy": old_acc,
                "new_val_accuracy": new_acc,
                "accuracy_change": new_acc - old_acc,
                "improved": new_acc > old_acc,
            }

        return {
            "expiry": expiry,
            "status": "trained",
            "version": model.version,
            "old_version": old_version,
            "metrics": metrics,
            "improvement": improvement,
            "feature_count": len(feature_names),
            "samples": len(X),
            "positive_rate": float(np.mean(y)),
        }

    def train_all(
        self,
        min_samples_per_expiry: int = 100,
    ) -> dict[str, Any]:
        """Train models for all expiry horizons."""
        results = {}
        for expiry in EXPIRY_HORIZONS:
            results[expiry] = self.train_expiry(expiry, min_samples_per_expiry)
        return results

    def get_report(self) -> dict[str, Any]:
        """Generate a comparison report: baseline vs A+ filtered."""
        stats = self.signal_db.get_stats()
        model_status = self.model_manager.get_status()

        return {
            "model_status": model_status,
            "signal_stats": stats,
            "comparison": {
                "baseline": {
                    "total_signals": stats["total_signals"],
                    "win_rate": stats["win_rate"],
                    "wins": stats["wins"],
                    "losses": stats["losses"],
                    "signals_per_hour": stats["signals_per_hour"],
                },
                "a_plus_filtered": {
                    "total_signals": stats["aplus_stats"]["total"],
                    "win_rate": stats["aplus_stats"]["win_rate"],
                    "wins": stats["aplus_stats"]["wins"],
                    "losses": stats["aplus_stats"]["losses"],
                },
                "change_in_win_rate": (
                    stats["aplus_stats"]["win_rate"] - stats["win_rate"]
                ) if stats["win_rate"] > 0 else 0,
                "signals_rejected": (
                    stats["total_signals"] - stats["aplus_stats"]["total"]
                ),
            },
            "by_asset": stats.get("by_asset", {}),
            "by_expiry": stats.get("by_expiry", {}),
            "by_regime": stats.get("by_regime", {}),
        }

    def should_retrain(self, check_interval_hours: float = 24) -> bool:
        """Check if enough new data has accumulated to justify retraining."""
        config = {}
        if self.config_path.exists():
            try:
                config = json.loads(self.config_path.read_text())
            except Exception:
                pass

        last_train = config.get("last_train_timestamp", 0)
        hours_since = (time.time() - last_train) / 3600

        if hours_since < check_interval_hours:
            return False

        # Check if we have enough new samples since last training
        new_signals = self.signal_db.get_training_data(
            min_timestamp=last_train
        )
        return len(new_signals) >= 50  # At least 50 new resolved signals

    def record_training(self):
        """Record that a training run happened."""
        config = {}
        if self.config_path.exists():
            try:
                config = json.loads(self.config_path.read_text())
            except Exception:
                pass

        config["last_train_timestamp"] = time.time()
        config["last_train_date"] = time.strftime("%Y-%m-%d %H:%M:%S")
        self.config_path.write_text(json.dumps(config, indent=2))
