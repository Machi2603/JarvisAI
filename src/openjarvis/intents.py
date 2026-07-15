"""Fast local intent classification for Jarvis interface commands."""

from __future__ import annotations

from functools import lru_cache

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
OTHER = (
    "qué hora es", "abre el navegador", "busca restaurantes", "pon música",
    "qué cámara me recomiendas", "busca una cámara para comprar",
    "la cámara tiene buena calidad", "no abras la cámara",
    "háblame de cámaras", "quiero cambiar la cámara de fotos", "graba un vídeo",
    "qué modelo de webcam es mejor", "abre mis documentos", "cuéntame un chiste",
    "cómo funciona una cámara", "quiero hacer una foto", "apaga la webcam",
)


@lru_cache(maxsize=1)
def _model():
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline

    texts = [*OPEN_CAMERA, *CLOSE_CAMERA, *OTHER]
    labels = [
        *(["open_camera"] * len(OPEN_CAMERA)),
        *(["close_camera"] * len(CLOSE_CAMERA)),
        *(["none"] * len(OTHER)),
    ]
    model = make_pipeline(
        TfidfVectorizer(
            analyzer="char_wb", ngram_range=(2, 5), strip_accents="unicode"
        ),
        LogisticRegression(C=4.0, max_iter=500),
    )
    return model.fit(texts, labels)


def detect_intent(text: str) -> tuple[str, float]:
    """Return a high-confidence interface intent or ``none``."""
    model = _model()
    probabilities = model.predict_proba([text])[0]
    index = int(probabilities.argmax())
    label = str(model.classes_[index])
    confidence = float(probabilities[index])
    threshold = 0.5 if label == "close_camera" else 0.68
    if label in {"open_camera", "close_camera"} and confidence >= threshold:
        return label, confidence
    return "none", confidence
