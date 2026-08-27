"""
ML Service — Flask API server.

Endpoints:
    GET  /health                    — Service health
    POST /predict                   — XGBoost prediction for a candidate
    POST /evaluate                  — Full A+ quality evaluation
    POST /batch-evaluate            — Batch evaluation of multiple candidates
    POST /store-signal              — Store a signal result
    PUT  /update-result/<id>        — Update signal outcome (win/loss)
    POST /train                     — Trigger model training
    GET  /model-status              — Get model training status
    GET  /report                    — Performance comparison report
    GET  /stats                     — Signal statistics
    GET  /recent?limit=50           — Recent signals
    GET  /config                    — Current A+ scorer config
    PUT  /config                    — Update A+ scorer weights/thresholds
"""

from __future__ import annotations
import os
import sys
from flask import Flask, request, jsonify
from flask_cors import CORS

from feature_engine import extract_features
from model import ModelManager
from aplus_scorer import APlusScorer, QualityWeights, RegimeThresholds
from signal_db import SignalDB
from training import TrainingPipeline


app = Flask(__name__)
CORS(app)

# ── Initialize services ──
model_manager = ModelManager()
signal_db = SignalDB()
aplus_scorer = APlusScorer()
training_pipeline = TrainingPipeline(model_manager, signal_db)

HOST = os.environ.get("ML_SERVICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("ML_SERVICE_PORT", "5002"))


# ══════════════════════════════════════════════════════════════
#  ENDPOINTS
# ══════════════════════════════════════════════════════════════

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "models_trained": model_manager.any_trained(),
        "model_status": model_manager.get_status(),
    })


@app.route("/predict", methods=["POST"])
def predict():
    """
    Predict XGBoost probabilities for a candidate signal.

    Body:
    {
        "candles": [...],           // OHLCV candle data
        "direction": "CALL",        // Candidate direction
        "expiry": "1m",            // Binary expiry
        "strategy_score": 0.75,    // Existing strategy score
        "strategy_direction": 1,   // 1=up, -1=down
        "strategy_confirmations": 3 // Number of confirmations
    }
    """
    data = request.json or {}
    candles = data.get("candles", [])
    direction = data.get("direction", "CALL")
    expiry = data.get("expiry", "1m")

    if not candles or len(candles) < 20:
        return jsonify({"error": "Need at least 20 candles"}), 400

    # Extract features
    features = extract_features(
        candles,
        strategy_score=data.get("strategy_score", 0),
        strategy_direction=data.get("strategy_direction", 0),
        strategy_confirmations=data.get("strategy_confirmations", 0),
    )

    if not features:
        return jsonify({"error": "Could not extract features"}), 400

    # XGBoost prediction
    call_prob, put_prob = model_manager.predict(features, expiry)

    return jsonify({
        "call_probability": round(call_prob, 4),
        "put_probability": round(put_prob, 4),
        "direction": direction,
        "expiry": expiry,
        "model_trained": model_manager.get_model(expiry).is_trained(),
    })


@app.route("/evaluate", methods=["POST"])
def evaluate():
    """
    Full A+ quality evaluation of a candidate signal.

    Body:
    {
        "candles": [...],
        "direction": "CALL",
        "expiry": "1m",
        "asset": "EUR/USD",
        "timeframe": "1m",
        "entry_price": 1.0845,
        "strategy_score": 0.75,
        "strategy_direction": 1,
        "strategy_confirmations": 3,
        "store": true               // Whether to store in DB
    }
    """
    data = request.json or {}
    candles = data.get("candles", [])
    direction = data.get("direction", "CALL")
    expiry = data.get("expiry", "1m")

    if not candles or len(candles) < 20:
        return jsonify({"error": "Need at least 20 candles"}), 400

    # Extract features
    features = extract_features(
        candles,
        strategy_score=data.get("strategy_score", 0),
        strategy_direction=data.get("strategy_direction", 0),
        strategy_confirmations=data.get("strategy_confirmations", 0),
    )

    if not features:
        return jsonify({"error": "Could not extract features"}), 400

    # XGBoost prediction
    call_prob, put_prob = model_manager.predict(features, expiry)

    # A+ evaluation
    result = aplus_scorer.evaluate(
        features=features,
        direction=direction,
        call_prob=call_prob,
        put_prob=put_prob,
    )

    # Optionally store in DB
    signal_id = None
    if data.get("store", True) and direction in ("CALL", "PUT"):
        signal_id = signal_db.store_candidate(
            asset=data.get("asset", "UNKNOWN"),
            timeframe=data.get("timeframe", "1m"),
            expiry=expiry,
            direction=direction,
            entry_price=data.get("entry_price", 0),
            strategy_score=data.get("strategy_score", 0),
            strategy_direction=data.get("strategy_direction", 0),
            strategy_confirmations=data.get("strategy_confirmations", 0),
            xgboost_call_prob=call_prob,
            xgboost_put_prob=put_prob,
            aplus_score=result.score,
            aplus_decision=result.decision,
            regime=result.regime,
            component_scores=result.component_scores,
            threshold_used=result.threshold_used,
            features=features,
        )

    response = result.to_dict()
    response["signal_id"] = signal_id

    return jsonify(response)


@app.route("/batch-evaluate", methods=["POST"])
def batch_evaluate():
    """
    Batch evaluation of multiple candidates.

    Body:
    {
        "candidates": [
            {
                "candles": [...],
                "direction": "CALL",
                "expiry": "1m",
                "strategy_score": 0.75,
                ...
            }
        ]
    }
    """
    data = request.json or {}
    candidates = data.get("candidates", [])
    results = []

    for candidate in candles_batch := candidates:
        candles = candidate.get("candles", [])
        direction = candidate.get("direction", "CALL")
        expiry = candidate.get("expiry", "1m")

        if not candles or len(candles) < 20:
            results.append({"error": "Need at least 20 candles", "direction": direction})
            continue

        features = extract_features(
            candles,
            strategy_score=candidate.get("strategy_score", 0),
            strategy_direction=candidate.get("strategy_direction", 0),
            strategy_confirmations=candidate.get("strategy_confirmations", 0),
        )

        if not features:
            results.append({"error": "Could not extract features", "direction": direction})
            continue

        call_prob, put_prob = model_manager.predict(features, expiry)
        result = aplus_scorer.evaluate(features, direction, call_prob, put_prob)
        results.append(result.to_dict())

    return jsonify({"results": results})


@app.route("/store-signal", methods=["POST"])
def store_signal():
    """Store a signal candidate in the database."""
    data = request.json or {}

    signal_id = signal_db.store_candidate(
        asset=data.get("asset", "UNKNOWN"),
        timeframe=data.get("timeframe", "1m"),
        expiry=data.get("expiry", "1m"),
        direction=data.get("direction", "CALL"),
        entry_price=data.get("entry_price", 0),
        strategy_score=data.get("strategy_score", 0),
        strategy_direction=data.get("strategy_direction", 0),
        strategy_confirmations=data.get("strategy_confirmations", 0),
        xgboost_call_prob=data.get("xgboost_call_prob", 0.5),
        xgboost_put_prob=data.get("xgboost_put_prob", 0.5),
        aplus_score=data.get("aplus_score", 0),
        aplus_decision=data.get("aplus_decision", "PENDING"),
        regime=data.get("regime", "UNKNOWN"),
        component_scores=data.get("component_scores"),
        threshold_used=data.get("threshold_used", 85),
        features=data.get("features"),
        metadata=data.get("metadata"),
    )

    return jsonify({"signal_id": signal_id, "status": "stored"})


@app.route("/update-result/<int:signal_id>", methods=["PUT"])
def update_result(signal_id: int):
    """Update the outcome of a stored signal."""
    data = request.json or {}
    result = data.get("result", "pending")
    expiry_price = data.get("expiry_price", 0)

    signal_db.update_result(signal_id, result, expiry_price)
    return jsonify({"status": "updated", "signal_id": signal_id, "result": result})


@app.route("/train", methods=["POST"])
def train():
    """Trigger model training."""
    data = request.json or {}
    expiry = data.get("expiry")  # None = train all
    min_samples = data.get("min_samples", 100)

    if expiry:
        result = training_pipeline.train_expiry(expiry, min_samples)
    else:
        result = training_pipeline.train_all(min_samples)

    training_pipeline.record_training()
    return jsonify(result)


@app.route("/model-status", methods=["GET"])
def model_status():
    """Get model training status."""
    return jsonify(model_manager.get_status())


@app.route("/report", methods=["GET"])
def report():
    """Get performance comparison report."""
    return jsonify(training_pipeline.get_report())


@app.route("/stats", methods=["GET"])
def stats():
    """Get signal statistics."""
    return jsonify(signal_db.get_stats())


@app.route("/recent", methods=["GET"])
def recent():
    """Get recent signals."""
    limit = request.args.get("limit", 50, type=int)
    return jsonify({"signals": signal_db.get_recent(limit)})


@app.route("/config", methods=["GET"])
def get_config():
    """Get current A+ scorer configuration."""
    return jsonify(aplus_scorer.get_config())


@app.route("/config", methods=["PUT"])
def update_config():
    """Update A+ scorer weights and thresholds."""
    data = request.json or {}
    aplus_scorer.update_config(
        weights=data.get("weights"),
        thresholds=data.get("thresholds"),
    )
    return jsonify({"status": "updated", "config": aplus_scorer.get_config()})


def main():
    print(f"[ml-service] Starting on http://{HOST}:{PORT}", flush=True)
    print(f"[ml-service] Models trained: {model_manager.any_trained()}", flush=True)
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()
