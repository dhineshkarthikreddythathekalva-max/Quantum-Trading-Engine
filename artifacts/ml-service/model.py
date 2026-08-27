"""
XGBoost Model — binary outcome prediction for candidate signals.

Predicts: given a candidate signal from the existing strategy,
how likely is it to result in a win at the specified expiry?

Supports separate models per expiry horizon (30s, 1m, 2m, 5m).
Includes probability calibration and model versioning.
"""

from __future__ import annotations
import json
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
import joblib
import xgboost as xgb
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import accuracy_score, log_loss, brier_score_loss

from feature_engine import get_feature_names

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

# Supported expiry horizons
EXPIRY_HORIZONS = ["30s", "1m", "2m", "5m"]


class XGBoostModel:
    """Wrapper around XGBoost for a single expiry horizon."""

    def __init__(self, expiry: str = "1m"):
        self.expiry = expiry
        self.model: xgb.XGBClassifier | None = None
        self.calibrator: CalibratedClassifierCV | None = None
        self.version: int = 0
        self.metadata: dict[str, Any] = {}
        self._model_path = MODEL_DIR / f"xgb_{expiry}.joblib"
        self._meta_path = MODEL_DIR / f"xgb_{expiry}_meta.json"
        self._load()

    def _load(self):
        """Load model from disk if available."""
        if self._model_path.exists():
            try:
                data = joblib.load(self._model_path)
                self.model = data.get("model")
                self.calibrator = data.get("calibrator")
                self.version = data.get("version", 0)
            except Exception:
                self.model = None
                self.calibrator = None

        if self._meta_path.exists():
            try:
                self.metadata = json.loads(self._meta_path.read_text())
            except Exception:
                self.metadata = {}

    def _save(self):
        """Persist model to disk."""
        joblib.dump({
            "model": self.model,
            "calibrator": self.calibrator,
            "version": self.version,
            "expiry": self.expiry,
        }, self._model_path)

        self._meta_path.write_text(json.dumps({
            "version": self.version,
            "expiry": self.expiry,
            "trained_at": self.metadata.get("trained_at", time.time()),
            "metrics": self.metadata.get("metrics", {}),
            "feature_count": len(get_feature_names()),
        }, indent=2))

    def is_trained(self) -> bool:
        return self.model is not None

    def predict_proba(self, features: dict[str, float]) -> tuple[float, float]:
        """
        Predict CALL and PUT probabilities for a single candidate.

        Returns (call_prob, put_prob).
        If model is not trained, returns neutral (0.5, 0.5).
        """
        if not self.is_trained():
            return 0.5, 0.5

        feature_names = get_feature_names()
        x = np.array([[features.get(f, 0.0) for f in feature_names]], dtype=float)

        # Replace NaN/Inf with 0
        x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)

        try:
            if self.calibrator is not None:
                proba = self.calibrator.predict_proba(x)[0]
            else:
                proba = self.model.predict_proba(x)[0]
            call_prob = float(proba[1])  # class 1 = win for CALL direction
            put_prob = float(proba[0])   # class 0 = win for PUT direction
            return call_prob, put_prob
        except Exception:
            return 0.5, 0.5

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        feature_names: list[str] | None = None,
        calibrate: bool = True,
    ) -> dict[str, Any]:
        """
        Train the XGBoost model.

        Args:
            X: Feature matrix (n_samples, n_features)
            y: Labels (0 = loss, 1 = win)
            feature_names: Optional feature names for XGBoost
            calibrate: Whether to apply probability calibration

        Returns:
            Training metrics dict
        """
        if len(X) < 50:
            return {"error": "Insufficient training data", "samples": len(X)}

        # XGBoost parameters tuned for binary classification
        params = {
            "n_estimators": 200,
            "max_depth": 6,
            "learning_rate": 0.05,
            "min_child_weight": 5,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "reg_alpha": 0.1,
            "reg_lambda": 1.0,
            "scale_pos_weight": 1.0,
            "objective": "binary:logistic",
            "eval_metric": "logloss",
            "random_state": 42,
            "use_label_encoder": False,
            "verbosity": 0,
        }

        # Adjust scale_pos_weight for class imbalance
        pos_count = np.sum(y == 1)
        neg_count = np.sum(y == 0)
        if neg_count > 0 and pos_count > 0:
            params["scale_pos_weight"] = neg_count / pos_count

        self.model = xgb.XGBClassifier(**params)

        # Split: 80% train, 20% validation (chronological)
        split_idx = int(len(X) * 0.8)
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]

        # Train with early stopping
        self.model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

        # Probability calibration (isotonic regression, leakage-safe)
        self.calibrator = None
        if calibrate and len(X_val) >= 20:
            try:
                self.calibrator = CalibratedClassifierCV(
                    self.model, method="isotonic", cv="prefit"
                )
                self.calibrator.fit(X_val, y_val)
            except Exception:
                self.calibrator = None

        # Metrics
        y_pred = self.model.predict(X)
        y_proba = self.model.predict_proba(X)[:, 1]

        metrics = {
            "accuracy": float(accuracy_score(y, y_pred)),
            "log_loss": float(log_loss(y, y_proba)),
            "samples": len(X),
            "positive_rate": float(np.mean(y)),
            "features": X.shape[1],
        }

        # Brier score
        try:
            metrics["brier_score"] = float(brier_score_loss(y, y_proba))
        except Exception:
            pass

        # Validation metrics
        y_val_pred = self.model.predict(X_val)
        y_val_proba = self.model.predict_proba(X_val)[:, 1]
        metrics["val_accuracy"] = float(accuracy_score(y_val, y_val_pred))
        metrics["val_log_loss"] = float(log_loss(y_val, y_val_proba))

        # Feature importance
        importances = self.model.feature_importances_
        if feature_names and len(feature_names) == len(importances):
            top_idx = np.argsort(importances)[::-1][:10]
            metrics["top_features"] = [
                {"name": feature_names[i], "importance": float(importances[i])}
                for i in top_idx
            ]

        # Save
        self.version += 1
        self.metadata = {
            "trained_at": time.time(),
            "metrics": metrics,
        }
        self._save()

        return metrics

    def predict_batch(self, X: np.ndarray) -> list[tuple[float, float]]:
        """Predict probabilities for multiple candidates."""
        if not self.is_trained():
            return [(0.5, 0.5)] * len(X)

        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        try:
            if self.calibrator is not None:
                proba = self.calibrator.predict_proba(X)
            else:
                proba = self.model.predict_proba(X)
            return [(float(p[1]), float(p[0])) for p in proba]
        except Exception:
            return [(0.5, 0.5)] * len(X)


class ModelManager:
    """Manages XGBoost models across all expiry horizons."""

    def __init__(self):
        self.models: dict[str, XGBoostModel] = {}
        for expiry in EXPIRY_HORIZONS:
            self.models[expiry] = XGBoostModel(expiry)

    def get_model(self, expiry: str) -> XGBoostModel:
        """Get model for specific expiry, fallback to '1m'."""
        if expiry in self.models:
            return self.models[expiry]
        return self.models.get("1m", XGBoostModel("1m"))

    def predict(
        self,
        features: dict[str, float],
        expiry: str = "1m",
    ) -> tuple[float, float]:
        """Predict CALL/PUT probabilities for a candidate."""
        model = self.get_model(expiry)
        return model.predict_proba(features)

    def any_trained(self) -> bool:
        """Check if any model has been trained."""
        return any(m.is_trained() for m in self.models.values())

    def get_status(self) -> dict[str, Any]:
        """Get status of all models."""
        status = {}
        for expiry, model in self.models.items():
            status[expiry] = {
                "trained": model.is_trained(),
                "version": model.version,
                "metrics": model.metadata.get("metrics", {}),
            }
        return status
