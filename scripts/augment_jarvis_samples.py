"""Create realistic, bounded augmentations for wake-word clips."""

from __future__ import annotations

import argparse
import wave
from pathlib import Path

import numpy as np


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as source:
        assert source.getframerate() == 16000 and source.getnchannels() == 1
        return np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768


def write_wav(path: Path, samples: np.ndarray) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000)
        out.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())


def augment(samples: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    speed = rng.uniform(0.88, 1.12)
    positions = np.arange(0, len(samples), speed)
    changed = np.interp(positions, np.arange(len(samples)), samples)
    delay = int(rng.uniform(0.01, 0.07) * 16000)
    if len(changed) > delay:
        changed[delay:] += changed[:-delay] * rng.uniform(0.03, 0.18)
    noise = rng.normal(0, rng.uniform(0.002, 0.018), len(changed))
    gain = 10 ** (rng.uniform(-7, 4) / 20)
    return (changed + noise) * gain


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--copies", type=int, default=20)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(42); count = 0
    for source in sorted(args.input.glob("*.wav")):
        samples = read_wav(source)
        for copy in range(args.copies):
            write_wav(args.output / f"{source.stem}_{copy:02}.wav", augment(samples.copy(), rng)); count += 1
    print(f"Created {count} augmented clips")


if __name__ == "__main__":
    main()
