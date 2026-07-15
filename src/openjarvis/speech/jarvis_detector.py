"""Small local classifier for the user's personal ``Jarvis`` wake word."""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np

RATE = 16_000
WAKE_THRESHOLD = 0.5
WAKE_CONFIRMATIONS = 2


def update_wake_streak(score: float, streak: int) -> int:
    """Require repeated high scores instead of one noisy window."""
    return streak + 1 if score >= WAKE_THRESHOLD else 0


def feature(samples: np.ndarray) -> np.ndarray:
    """Return a one-second spectral fingerprint."""
    samples = np.asarray(samples, dtype=np.float32)
    left = max(0, RATE - len(samples)) // 2
    samples = np.pad(samples, (left, max(0, RATE - len(samples) - left)))[:RATE]
    frames = np.lib.stride_tricks.sliding_window_view(samples, 400)[::160][:98]
    spectrum = np.log1p(np.abs(np.fft.rfft(frames * np.hanning(400), axis=1))[:, :40])
    return spectrum.astype(np.float32).ravel()


class JarvisDetector:
    def __init__(self, model_path: Path) -> None:
        self.model = joblib.load(model_path)

    def score(self, samples: np.ndarray) -> float:
        return float(self.model.predict_proba([feature(samples)])[0, 1])
