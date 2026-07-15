import pytest

from openjarvis.intents import detect_intent


@pytest.mark.parametrize(
    "text",
    ["pon la webcam", "quiero usar la cámara", "activa el modo visión"],
)
def test_open_camera_intent(text):
    assert detect_intent(text)[0] == "open_camera"


def test_camera_discussion_does_not_open_camera():
    assert detect_intent("qué cámara me recomiendas")[0] == "none"


def test_close_camera_intent():
    assert detect_intent("sal del modo cámara")[0] == "close_camera"
