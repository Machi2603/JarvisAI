"""Fast local intent classification for Jarvis interface commands."""

from __future__ import annotations

import re
import unicodedata

OPEN_CAMERA = (
    "abre la cámara", "activa la cámara", "enciende la cámara", "pon la cámara",
    "abre mi webcam", "activa la webcam", "quiero usar la cámara",
    "quiero ver la cámara", "muéstrame por la cámara", "modo cámara",
    "modo vision", "activa el modo visión", "abre la vista de cámara",
    "quiero control con la mano", "activa el control por mano",
    "quiero que veas lo que hago", "necesito la webcam", "pon la cam",
    "puedes verme", "quiero mostrarte algo", "mira lo que estoy haciendo",
    "necesito que veas esto", "te enseño algo por la cámara", "mira con la cámara",
)
CLOSE_CAMERA = (
    "cierra la cámara", "apaga la cámara", "quita la cámara", "sal del modo cámara",
    "desactiva la cámara", "cierra la webcam", "apaga la webcam", "quita la webcam",
    "vuelve al modo normal", "sal de la vista de cámara",
)
OPEN_BROWSER = (
    "abre el navegador", "abre el browser", "abre jarvis browser",
    "muestra el navegador", "abre una ventana del navegador",
    "quiero navegar", "abre internet", "navega por internet",
    "busca en internet", "busca en la web", "haz una búsqueda web",
)
CLOSE_BROWSER = (
    "cierra el navegador", "cierra jarvis browser", "oculta el navegador",
    "quita el navegador", "cierra la ventana del navegador",
)
OTHER = (
    "qué hora es", "abre el navegador", "busca restaurantes", "pon música",
    "qué cámara me recomiendas", "busca una cámara para comprar",
    "la cámara tiene buena calidad", "no abras la cámara",
    "háblame de cámaras", "quiero cambiar la cámara de fotos", "graba un vídeo",
    "qué modelo de webcam es mejor", "abre mis documentos", "cuéntame un chiste",
    "cómo funciona una cámara", "quiero hacer una foto", "apaga la webcam",
)


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFD", text.casefold())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _matches(text: str, phrases: tuple[str, ...]) -> bool:
    return any(_normalise(phrase) in text for phrase in phrases)


def detect_intent(text: str) -> tuple[str, float]:
    """Recognise explicit interface commands without a heavyweight ML runtime."""
    normalized = _normalise(text)
    for label, phrases in (
        ("close_camera", CLOSE_CAMERA),
        ("close_browser", CLOSE_BROWSER),
        ("open_camera", OPEN_CAMERA),
        ("open_browser", OPEN_BROWSER),
    ):
        if _matches(normalized, phrases):
            return label, 1.0
    return "none", 0.0
