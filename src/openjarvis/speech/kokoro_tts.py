"""Kokoro TTS backend — fully open-source, runs locally.

Requires the kokoro package: pip install kokoro
Falls back gracefully if not installed.
"""

from __future__ import annotations

import io
from typing import List

from openjarvis.core.registry import TTSRegistry
from openjarvis.speech.tts import TTSBackend, TTSResult


@TTSRegistry.register("kokoro")
class KokoroTTSBackend(TTSBackend):
    """Kokoro TTS — local open-source voice synthesis."""

    backend_id = "kokoro"

    # Kokoro selects its grapheme-to-phoneme frontend from a single-letter
    # lang_code that must match the voice's language. The first letter of the
    # voice id encodes it: 'a' American English, 'b' British, 'e' Spanish,
    # 'f' French, 'i' Italian, 'p' Portuguese, 'j' Japanese, 'z' Chinese.
    _VOICE_LANG_PREFIXES = {"a", "b", "e", "f", "h", "i", "j", "p", "z"}

    def __init__(self, *, model_path: str = "", device: str = "auto") -> None:
        self._model_path = model_path
        self._device = device
        # One pipeline per lang_code — switching voices across languages needs
        # the matching frontend, so we cache them instead of a single pipeline.
        self._pipelines: dict[str, object] = {}

    def _lang_code_for_voice(self, voice_id: str) -> str:
        prefix = voice_id[:1].lower() if voice_id else "a"
        return prefix if prefix in self._VOICE_LANG_PREFIXES else "a"

    def _ensure_pipeline(self, lang_code: str = "a"):
        cached = self._pipelines.get(lang_code)
        if cached is not None:
            return cached
        try:
            from kokoro import KPipeline
        except ImportError:
            raise RuntimeError(
                "kokoro package not installed. Install with: pip install kokoro"
            )
        pipeline = KPipeline(lang_code=lang_code)
        self._pipelines[lang_code] = pipeline
        return pipeline

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = "em_alex",
        speed: float = 1.0,
        output_format: str = "wav",
    ) -> TTSResult:
        if not voice_id:
            voice_id = "em_alex"
        pipeline = self._ensure_pipeline(self._lang_code_for_voice(voice_id))
        import numpy as np
        import soundfile as sf

        samples = []
        for _, _, audio in pipeline(text, voice=voice_id, speed=speed):
            samples.append(audio)

        if not samples:
            return TTSResult(audio=b"", format=output_format, voice_id=voice_id)

        combined = np.concatenate(samples)
        buf = io.BytesIO()
        sf.write(buf, combined, 24000, format=output_format.upper())
        buf.seek(0)

        return TTSResult(
            audio=buf.read(),
            format=output_format,
            voice_id=voice_id,
            sample_rate=24000,
            duration_seconds=len(combined) / 24000,
            metadata={"backend": "kokoro"},
        )

    def available_voices(self) -> List[str]:
        # Spanish voices first (default language for this deployment), then the
        # English ones that ship with Kokoro.
        return [
            "em_alex",
            "em_santa",
            "ef_dora",
            "af_heart",
            "af_bella",
            "am_adam",
            "am_michael",
        ]

    def health(self) -> bool:
        try:
            self._ensure_pipeline(self._lang_code_for_voice("em_alex"))
            return True
        except RuntimeError:
            return False
