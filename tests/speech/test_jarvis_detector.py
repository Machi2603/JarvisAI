from openjarvis.speech.jarvis_detector import update_wake_streak


def test_wake_word_requires_consecutive_high_scores():
    streak = update_wake_streak(0.95, 0)
    assert streak == 1
    assert update_wake_streak(0.4, streak) == 0
    assert update_wake_streak(0.95, update_wake_streak(0.96, 0)) == 2
