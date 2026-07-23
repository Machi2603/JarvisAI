from openjarvis.windows_satellite import selected_voice


def test_selected_voice_accepts_only_bundled_kokoro_voices() -> None:
    assert selected_voice("am_michael") == "am_michael"
    assert selected_voice("not-a-voice") == "em_alex"
    assert selected_voice(None) == "em_alex"
