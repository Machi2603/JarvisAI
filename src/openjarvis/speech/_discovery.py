"""Auto-discover available speech-to-text backends."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from openjarvis.core.config import JarvisConfig
    from openjarvis.speech._stubs import SpeechBackend
    from openjarvis.speech.tts import TTSBackend

# Priority order: local first, then cloud
DISCOVERY_ORDER = [
    "faster-whisper",
    "openai",
    "deepgram",
]


def _create_backend(
    key: str,
    config: "JarvisConfig",
) -> Optional["SpeechBackend"]:
    """Try to instantiate a speech backend by registry key."""
    from openjarvis.core.registry import SpeechRegistry

    if not SpeechRegistry.contains(key):
        return None

    try:
        backend_cls = SpeechRegistry.get(key)

        if key == "faster-whisper":
            return backend_cls(
                model_size=config.speech.model,
                device=config.speech.device,
                compute_type=config.speech.compute_type,
            )
        elif key == "openai":
            api_key = os.environ.get("OPENAI_API_KEY", "")
            if not api_key:
                return None
            return backend_cls(api_key=api_key)
        elif key == "deepgram":
            api_key = os.environ.get("DEEPGRAM_API_KEY", "")
            if not api_key:
                return None
            return backend_cls(api_key=api_key)
        else:
            return backend_cls()
    except Exception:
        return None


def get_speech_backend(config: "JarvisConfig") -> Optional["SpeechBackend"]:
    """Resolve the speech backend from config.

    If ``config.speech.backend`` is ``"auto"``, tries backends in
    priority order and returns the first healthy one.
    """
    # Trigger registration of built-in backends
    import openjarvis.speech  # noqa: F401

    backend_key = config.speech.backend

    if backend_key != "auto":
        return _create_backend(backend_key, config)

    # Auto-discovery: try each in priority order
    for key in DISCOVERY_ORDER:
        backend = _create_backend(key, config)
        if backend is not None:
            return backend

    return None


def get_tts_backend(config: "JarvisConfig") -> Optional["TTSBackend"]:
    """Resolve the text-to-speech backend from ``config.speech.tts_backend``.

    Returns a ready-to-use backend instance, or ``None`` if the configured
    backend is not installed/registered. The instance is lazy: the underlying
    model only loads on the first synthesize/health call.
    """
    # Trigger registration of built-in TTS backends.
    import openjarvis.speech  # noqa: F401
    from openjarvis.core.registry import TTSRegistry

    key = (config.speech.tts_backend or "kokoro").strip()
    if not TTSRegistry.contains(key):
        return None
    try:
        backend_cls = TTSRegistry.get(key)
        return backend_cls(device=config.speech.device)
    except TypeError:
        # Backends without a device kwarg (e.g. cloud TTS).
        try:
            return TTSRegistry.get(key)()
        except Exception:
            return None
    except Exception:
        return None
