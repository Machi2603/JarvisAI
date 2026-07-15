from openjarvis.tools.current_time import CurrentTimeTool


def test_current_time_uses_requested_timezone():
    result = CurrentTimeTool().execute(timezone="Europe/Madrid")

    assert result.success
    assert result.content
