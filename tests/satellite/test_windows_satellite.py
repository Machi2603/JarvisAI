from pathlib import Path

import numpy as np

from openjarvis.windows_satellite import (
    AutomaticGain,
    CommandCapture,
    SatelliteConfig,
    WindowsSatellite,
    load_api_key,
)


def config(**overrides):
    values = {
        "repo_root": Path("."),
        "end_silence_seconds": 0.16,
        "speech_start_timeout": 0.24,
        "max_command_seconds": 1,
    }
    values.update(overrides)
    return SatelliteConfig(**values)


def test_capture_starts_on_voice_and_finishes_after_silence():
    capture = CommandCapture(config())
    frame = np.ones(1_280, dtype=np.int16)
    assert capture.add(frame, 0.1) is None
    assert capture.add(frame, 0.9) is None
    assert capture.add(frame, 0.1) is None
    result = capture.add(frame, 0.1)
    assert result is not None
    assert len(result) == 1_280


def test_capture_times_out_when_nobody_speaks():
    capture = CommandCapture(config())
    silence = np.zeros(1_280, dtype=np.int16)
    assert capture.add(silence, 0.0) is None
    assert capture.add(silence, 0.0) is None
    result = capture.add(silence, 0.0)
    assert result is not None
    assert result.size == 0


def test_gain_removes_dc_and_stays_bounded():
    gain = AutomaticGain(target_rms=0.075, max_gain=4)
    output = gain.process(np.full(1_280, 20_000, dtype=np.int16))
    assert np.max(np.abs(output)) <= 1
    assert abs(float(output.mean())) < 1e-6


def test_api_key_falls_back_to_docker_env(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENJARVIS_API_KEY", raising=False)
    env = tmp_path / "deploy" / "docker"
    env.mkdir(parents=True)
    (env / ".env").write_text("OPENJARVIS_API_KEY=test-key\n", encoding="utf-8")
    assert load_api_key(tmp_path) == "test-key"


def test_audio_worker_failure_is_reported(monkeypatch):
    satellite = WindowsSatellite(config())
    messages = []
    monkeypatch.setattr(
        satellite,
        "audio_worker",
        lambda: (_ for _ in ()).throw(RuntimeError("microphone busy")),
    )
    monkeypatch.setattr(satellite, "emit", messages.append)

    satellite.guarded_audio_worker()

    assert messages == [
        {"type": "error", "message": "Audio satellite failed: microphone busy"}
    ]
