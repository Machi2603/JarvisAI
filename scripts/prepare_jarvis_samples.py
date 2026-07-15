"""Split one continuous wake-word recording into normalized WAV clips."""

from __future__ import annotations

import argparse
import wave
from pathlib import Path

import av
import numpy as np


def segments(samples: np.ndarray, rate: int) -> list[tuple[int, int]]:
    hop = max(1, rate // 50)  # 20 ms
    usable = samples[: len(samples) // hop * hop].reshape(-1, hop)
    energy = np.sqrt(np.mean(usable * usable, axis=1))
    floor, peak = np.percentile(energy, [20, 90])
    threshold = max(0.008, floor + (peak - floor) * 0.28)
    active = energy > threshold
    result: list[tuple[int, int]] = []
    start: int | None = None
    silence = 0
    for index, is_active in enumerate(active):
        if is_active:
            if start is None:
                start = index
            silence = 0
        elif start is not None:
            silence += 1
            if silence >= 18:  # 360 ms gap ends a word
                end = index - silence + 1
                if 8 <= end - start <= 150:  # 160 ms–3 s
                    result.append((max(0, start - 8) * hop, min(len(samples), (end + 8) * hop)))
                start = None
                silence = 0
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    container = av.open(args.input)
    stream = container.streams.audio[0]
    resampler = av.audio.resampler.AudioResampler(format="fltp", layout="mono", rate=16000)
    chunks = []
    for frame in container.decode(stream):
        for resampled in resampler.resample(frame):
            chunks.append(resampled.to_ndarray().reshape(-1))
    samples = np.concatenate(chunks).astype(np.float32)
    args.output.mkdir(parents=True, exist_ok=True)
    for index, (start, end) in enumerate(segments(samples, 16000), 1):
        clip = samples[start:end]
        clip /= max(0.01, float(np.max(np.abs(clip)))) * 1.05
        pcm = (np.clip(clip, -1, 1) * 32767).astype("<i2")
        with wave.open(str(args.output / f"jarvis_{index:03}.wav"), "wb") as out:
            out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000); out.writeframes(pcm.tobytes())
    print(f"Created {index if samples.size else 0} clips in {args.output}")


if __name__ == "__main__":
    main()
