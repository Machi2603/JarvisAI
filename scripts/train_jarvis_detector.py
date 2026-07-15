"""Train a small, local, speaker-personalized Jarvis wake-word detector."""

from __future__ import annotations

import json
import wave
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from openjarvis.speech.jarvis_detector import RATE, feature


def read(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as f:
        data = (
            np.frombuffer(f.readframes(f.getnframes()), dtype="<i2").astype(np.float32)
            / 32768
        )
        if f.getframerate() != RATE:
            positions = np.arange(0, len(data), f.getframerate() / RATE)
            data = np.interp(positions, np.arange(len(data)), data)
    return data


def variants(
    samples: np.ndarray, rng: np.random.Generator, count: int
) -> list[np.ndarray]:
    result = [samples]
    for _ in range(count):
        speed = rng.uniform(0.9, 1.1)
        shifted = np.interp(
            np.arange(0, len(samples), speed), np.arange(len(samples)), samples
        )
        result.append(
            (shifted + rng.normal(0, rng.uniform(0.002, 0.015), len(shifted)))
            * 10 ** (rng.uniform(-5, 4) / 20)
        )
    return result


def window(samples: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Put a clip at a random point in the rolling one-second mic window."""
    samples = samples[:RATE]
    result = np.zeros(RATE, dtype=np.float32)
    start = rng.integers(0, RATE - len(samples) + 1)
    result[start : start + len(samples)] = samples
    return result


root = Path("training/jarvis")
rng = np.random.default_rng(7)
positives = sorted((root / "positives").glob("*.wav"))
train_pos, test_pos = positives[:-9], positives[-9:]
negatives = list((root / "negatives").glob("*.wav")) + list(
    (root / "synthetic_negatives").glob("*.wav")
)
train_x = [
    feature(window(v, rng)) for path in train_pos for v in variants(read(path), rng, 18)
]
train_y = [1] * len(train_x)
for path in negatives:
    for value in variants(read(path), rng, 2):
        train_x.append(feature(window(value, rng)))
        train_y.append(0)
model = make_pipeline(
    StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced", C=2.0)
)
model.fit(np.stack(train_x), train_y)
test_x = [feature(window(read(path), rng)) for path in test_pos for _ in range(3)]
test_x += [
    feature(window(read(path), rng)) for path in negatives[-30:] for _ in range(3)
]
test_y = [1] * (len(test_pos) * 3) + [0] * 90
score = balanced_accuracy_score(test_y, model.predict(test_x))
if score < 0.85:
    raise SystemExit(f"Held-out balanced accuracy too low: {score:.3f}")
model_dir = root / "model"
model_dir.mkdir(parents=True, exist_ok=True)
joblib.dump(model, model_dir / "jarvis_detector.joblib")
(model_dir / "metrics.json").write_text(
    json.dumps(
        {
            "balanced_accuracy": score,
            "train_examples": len(train_y),
            "test_examples": len(test_y),
        },
        indent=2,
    )
)
print((model_dir / "metrics.json").read_text())
