"""Invisible Windows audio satellite for Jarvis."""

from __future__ import annotations

import argparse
import asyncio
import ctypes
import io
import ipaddress
import json
import logging
import math
import os
import queue
import threading
import time
import webbrowser
from dataclasses import dataclass, field
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import numpy as np

RATE = 16_000
FRAME_SAMPLES = 1_280  # 80 ms, openWakeWord's native streaming interval.
LOGGER = logging.getLogger("jarvis.satellite")
KOKORO_VOICE_IDS = frozenset({
    "em_alex", "em_santa", "ef_dora", "af_heart", "af_bella", "am_adam", "am_michael",
})


def selected_voice(value: Any) -> str:
    """Accept only voices bundled with the local Kokoro runtime."""
    return value if isinstance(value, str) and value in KOKORO_VOICE_IDS else "em_alex"


@dataclass(slots=True)
class SatelliteConfig:
    repo_root: Path
    server_url: str = "http://127.0.0.1:8000"
    websocket_host: str = "127.0.0.1"
    websocket_port: int = 8765
    microphone: str | int | None = None
    speaker: str | int | None = None
    wake_threshold: float = 0.5
    vad_threshold: float = 0.5
    end_silence_seconds: float = 0.8
    speech_start_timeout: float = 5.0
    max_command_seconds: float = 16.0
    refractory_seconds: float = 2.0
    target_rms: float = 0.075
    max_gain: float = 4.0
    noise_reduction: float = 0.65
    whisper_model: str = "large-v3"
    language: str = "es"


@dataclass(slots=True)
class CommandCapture:
    """Collect post-wake frames until Silero reports trailing silence."""

    config: SatelliteConfig
    frames: list[np.ndarray] = field(default_factory=list)
    started: bool = False
    elapsed_samples: int = 0
    silent_samples: int = 0

    def add(self, frame: np.ndarray, voice_score: float) -> np.ndarray | None:
        self.elapsed_samples += len(frame)
        if voice_score >= self.config.vad_threshold:
            self.started = True
            self.silent_samples = 0
        elif self.started:
            self.silent_samples += len(frame)

        if self.started:
            self.frames.append(frame.copy())

        timed_out = self.elapsed_samples >= int(self.config.max_command_seconds * RATE)
        no_start = not self.started and self.elapsed_samples >= int(
            self.config.speech_start_timeout * RATE
        )
        finished = self.started and self.silent_samples >= int(
            self.config.end_silence_seconds * RATE
        )
        if not (timed_out or no_start or finished):
            return None
        if not self.frames:
            return np.empty(0, dtype=np.int16)
        audio = np.concatenate(self.frames)
        if self.silent_samples:
            audio = audio[: -min(self.silent_samples, len(audio))]
        return audio


class AutomaticGain:
    """Small real-time DC removal and smoothly limited automatic gain."""

    def __init__(self, target_rms: float, max_gain: float) -> None:
        self.target_rms = target_rms
        self.max_gain = max_gain
        self.gain = 1.0

    def process(self, frame: np.ndarray) -> np.ndarray:
        samples = frame.astype(np.float32) / 32768.0
        samples -= float(samples.mean())
        rms = float(np.sqrt(np.mean(samples * samples)))
        desired = 1.0 if rms < 1e-4 else min(self.max_gain, self.target_rms / rms)
        self.gain += (desired - self.gain) * 0.08
        return np.clip(samples * self.gain, -1, 1).astype(np.float32)


def load_api_key(repo_root: Path) -> str:
    key = os.environ.get("OPENJARVIS_API_KEY", "").strip()
    if key:
        return key
    env_file = repo_root / "deploy" / "docker" / ".env"
    if not env_file.exists():
        return ""
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENJARVIS_API_KEY="):
            return line.partition("=")[2].strip().strip('"').strip("'")
    return ""


def focus_or_open_jarvis(url: str) -> None:
    """Bring an existing Jarvis window forward, or open the browser fallback."""
    if os.name != "nt":
        webbrowser.open(url)
        return
    user32 = ctypes.windll.user32
    found: list[int] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def visitor(hwnd: int, _param: int) -> bool:
        length = user32.GetWindowTextLengthW(hwnd)
        title = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, title, length + 1)
        normalized = title.value.strip().lower()
        if (
            normalized == "jarvis"
            or "openjarvis" in normalized
            or "j.a.r.v.i.s" in normalized
        ):
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(visitor, 0)
    if found:
        user32.ShowWindow(found[0], 9)  # SW_RESTORE
        user32.SetForegroundWindow(found[0])
    elif os.environ.get("JARVIS_DESKTOP") != "1":
        webbrowser.open(url)


class WindowsSatellite:
    def __init__(self, config: SatelliteConfig) -> None:
        self.config = config
        self.loop: asyncio.AbstractEventLoop | None = None
        self.clients: set[Any] = set()
        self.pending_transcript = ""
        self.state = "starting"
        self.frames: queue.Queue[np.ndarray] = queue.Queue(maxsize=100)
        self.stop_event = threading.Event()
        self.stop_playback = threading.Event()
        self.speaking = threading.Event()
        self.capture: CommandCapture | None = None
        self.last_activity = 0.0
        self.wake_model: Any = None
        self.vad: Any = None
        self.whisper: Any = None
        self.gain = AutomaticGain(config.target_rms, config.max_gain)

    def emit(self, message: dict[str, Any]) -> None:
        if message.get("type") == "state":
            self.state = str(message["state"])
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self._broadcast(message), self.loop)

    async def _broadcast(self, message: dict[str, Any]) -> None:
        if not self.clients:
            if message.get("type") == "transcript":
                self.pending_transcript = str(message.get("text", ""))
            return
        payload = json.dumps(message)
        await asyncio.gather(
            *(client.send(payload) for client in tuple(self.clients)),
            return_exceptions=True,
        )

    async def websocket_handler(self, websocket: Any) -> None:
        host = websocket.remote_address[0] if websocket.remote_address else ""
        if not host or not ipaddress.ip_address(host).is_loopback:
            await websocket.close(code=1008, reason="Loopback clients only")
            return
        self.clients.add(websocket)
        try:
            await websocket.send(json.dumps({"type": "state", "state": self.state}))
            if self.pending_transcript:
                await websocket.send(
                    json.dumps({"type": "transcript", "text": self.pending_transcript})
                )
                self.pending_transcript = ""
            async for raw in websocket:
                try:
                    message = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    continue
                if message.get("type") == "speak" and message.get("text"):
                    asyncio.create_task(
                        asyncio.to_thread(
                            self.speak,
                            str(message["text"]),
                            selected_voice(message.get("voice_id")),
                        )
                    )
                elif message.get("type") == "stop_speaking":
                    self.stop_playback.set()
        finally:
            self.clients.discard(websocket)

    def _load_models(self) -> None:
        from faster_whisper import WhisperModel
        from openwakeword.model import Model
        from openwakeword.utils import download_models
        from openwakeword.vad import VAD

        download_models(["hey_jarvis"])
        self.wake_model = Model(
            wakeword_models=["hey_jarvis"],
            inference_framework="onnx",
            vad_threshold=self.config.vad_threshold,
        )
        self.vad = VAD()
        download_root = str(self.config.repo_root / ".satellite-models")
        try:
            LOGGER.info(
                "Loading Faster-Whisper %s on CUDA float16",
                self.config.whisper_model,
            )
            self.whisper = WhisperModel(
                self.config.whisper_model,
                device="cuda",
                compute_type="float16",
                download_root=download_root,
            )
        except RuntimeError:
            LOGGER.warning("CUDA Whisper unavailable; falling back to CPU int8")
            self.whisper = WhisperModel(
                self.config.whisper_model,
                device="cpu",
                compute_type="int8",
                download_root=download_root,
            )

    def _audio_callback(
        self, indata: bytes, frames: int, _time: Any, status: Any
    ) -> None:
        if status:
            LOGGER.warning("Microphone status: %s", status)
        frame = np.frombuffer(indata, dtype="<i2", count=frames).copy()
        try:
            self.frames.put_nowait(frame)
        except queue.Full:
            try:
                self.frames.get_nowait()
                self.frames.put_nowait(frame)
            except queue.Empty:
                pass

    def _prepare_command(self, audio: np.ndarray) -> np.ndarray:
        from noisereduce import reduce_noise

        samples = audio.astype(np.float32) / 32768.0
        if len(samples) >= RATE // 2 and self.config.noise_reduction > 0:
            samples = reduce_noise(
                y=samples,
                sr=RATE,
                stationary=True,
                prop_decrease=self.config.noise_reduction,
            ).astype(np.float32)
        peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
        if peak > 0:
            samples *= min(1.0 / peak * 0.9, self.config.max_gain)
        return np.clip(samples, -1, 1)

    def _transcribe(self, audio: np.ndarray) -> str:
        clean = self._prepare_command(audio)
        segments, _info = self.whisper.transcribe(
            clean,
            language=self.config.language,
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
            condition_on_previous_text=False,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()

    def _acknowledge(self) -> None:
        import sounddevice as sd

        duration = 0.12
        t = np.arange(int(RATE * duration), dtype=np.float32) / RATE
        tone = (0.12 * np.sin(2 * math.pi * 880 * t)).astype(np.float32)
        sd.play(tone, RATE, device=self.config.speaker, blocking=True)

    def _wake(self) -> None:
        self.last_activity = time.monotonic()
        self.emit({"type": "state", "state": "listening"})
        focus_or_open_jarvis(self.config.server_url)
        self._acknowledge()
        self.vad.reset_states()
        self.capture = CommandCapture(self.config)
        self.wake_model.reset()

    def _handle_frame(self, raw: np.ndarray) -> None:
        if self.speaking.is_set():
            return
        enhanced = self.gain.process(raw)
        pcm = (enhanced * 32767).astype(np.int16)
        if self.capture is None:
            if time.monotonic() - self.last_activity < self.config.refractory_seconds:
                return
            predictions = self.wake_model.predict(pcm)
            if float(predictions.get("hey_jarvis", 0.0)) >= self.config.wake_threshold:
                self._wake()
            return

        voice_score = float(self.vad.predict(pcm, frame_size=640))
        command = self.capture.add(pcm, voice_score)
        if command is None:
            return
        self.capture = None
        if not len(command):
            self.emit({"type": "state", "state": "idle"})
            return
        self.emit({"type": "state", "state": "transcribing"})
        try:
            transcript = self._transcribe(command)
            if transcript:
                self.emit({"type": "transcript", "text": transcript})
            else:
                self.emit({"type": "error", "message": "No speech recognized"})
        except Exception as exc:
            LOGGER.exception("Transcription failed")
            self.emit({"type": "error", "message": f"Transcription failed: {exc}"})
        finally:
            self.last_activity = time.monotonic()
            self.emit({"type": "state", "state": "idle"})

    def audio_worker(self) -> None:
        import sounddevice as sd

        self._load_models()
        self.emit({"type": "state", "state": "idle"})
        with sd.RawInputStream(
            samplerate=RATE,
            blocksize=FRAME_SAMPLES,
            channels=1,
            dtype="int16",
            device=self.config.microphone,
            callback=self._audio_callback,
        ):
            LOGGER.info("Microphone active; waiting for Hey Jarvis")
            while not self.stop_event.is_set():
                try:
                    self._handle_frame(self.frames.get(timeout=0.2))
                except queue.Empty:
                    continue

    def guarded_audio_worker(self) -> None:
        """Keep background failures visible to the UI and the rotating log."""
        try:
            self.audio_worker()
        except Exception as exc:
            LOGGER.exception("Audio worker stopped")
            self.emit({"type": "error", "message": f"Audio satellite failed: {exc}"})

    def speak(self, text: str, voice_id: str = "em_alex") -> None:
        import httpx
        import sounddevice as sd
        import soundfile as sf

        self.stop_playback.clear()
        self.speaking.set()
        self.emit({"type": "state", "state": "speaking"})
        try:
            key = load_api_key(self.config.repo_root)
            headers = {"Authorization": f"Bearer {key}"} if key else {}
            response = httpx.post(
                f"{self.config.server_url}/v1/speech/synthesize",
                headers=headers,
                json={"text": text, "voice_id": selected_voice(voice_id)},
                timeout=120,
            )
            response.raise_for_status()
            audio, rate = sf.read(
                io.BytesIO(response.content), dtype="float32", always_2d=True
            )
            block = 2_048
            with sd.OutputStream(
                samplerate=rate,
                channels=audio.shape[1],
                dtype="float32",
                device=self.config.speaker,
            ) as output:
                for start in range(0, len(audio), block):
                    if self.stop_playback.is_set():
                        break
                    chunk = audio[start : start + block]
                    output.write(chunk)
                    level = min(1.0, float(np.sqrt(np.mean(chunk * chunk))) * 3)
                    self.emit({"type": "level", "level": level})
        except Exception as exc:
            LOGGER.exception("Native TTS playback failed")
            self.emit({"type": "error", "message": f"Voice playback failed: {exc}"})
        finally:
            self.emit({"type": "level", "level": 0})
            self.speaking.clear()
            self.last_activity = time.monotonic()
            self.emit({"type": "state", "state": "idle"})

    async def run(self) -> None:
        from websockets.asyncio.server import serve

        self.loop = asyncio.get_running_loop()
        worker = threading.Thread(
            target=self.guarded_audio_worker, name="jarvis-audio", daemon=True
        )
        worker.start()
        async with serve(
            self.websocket_handler,
            self.config.websocket_host,
            self.config.websocket_port,
        ):
            LOGGER.info(
                "Satellite WebSocket listening on ws://%s:%s",
                self.config.websocket_host,
                self.config.websocket_port,
            )
            try:
                await asyncio.Future()
            finally:
                self.stop_event.set()
                worker.join(timeout=3)


def configure_logging(repo_root: Path, console: bool = False) -> None:
    log_dir = repo_root / "logs"
    log_dir.mkdir(exist_ok=True)
    handlers: list[logging.Handler] = [
        RotatingFileHandler(
            log_dir / "jarvis-satellite.log",
            maxBytes=2_000_000,
            backupCount=2,
            encoding="utf-8",
        )
    ]
    if console:
        handlers.append(logging.StreamHandler())
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
    )


def acquire_single_instance() -> Any:
    if os.name != "nt":
        return None
    handle = ctypes.windll.kernel32.CreateMutexW(
        None, False, "Local\\OpenJarvisAudioSatellite"
    )
    if ctypes.windll.kernel32.GetLastError() == 183:
        raise SystemExit("Jarvis audio satellite is already running")
    return handle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--microphone", default=os.environ.get("JARVIS_MICROPHONE") or None
    )
    parser.add_argument("--speaker", default=os.environ.get("JARVIS_SPEAKER") or None)
    parser.add_argument("--diagnose", action="store_true")
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    root = args.repo_root.resolve()
    configure_logging(root, console=args.diagnose)
    config = SatelliteConfig(
        repo_root=root, microphone=args.microphone, speaker=args.speaker
    )
    if args.diagnose:
        import ctranslate2
        import sounddevice as sd

        print(sd.query_devices())
        print("CUDA compute types:", ctranslate2.get_supported_compute_types("cuda"))
        return
    if args.prepare:
        WindowsSatellite(config)._load_models()
        print("Hey Jarvis and Whisper large-v3 are ready")
        return
    _mutex = acquire_single_instance()
    try:
        asyncio.run(WindowsSatellite(config).run())
    except Exception:
        LOGGER.exception("Satellite stopped unexpectedly")
        raise
    finally:
        _ = _mutex


if __name__ == "__main__":
    main()
