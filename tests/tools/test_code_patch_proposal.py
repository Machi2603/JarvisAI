import pytest

from openjarvis.tools.code_patch_proposal import validate_patch_path


def test_code_patch_paths_are_limited_to_source_directories():
    assert (
        validate_patch_path("src/openjarvis/example.py") == "src/openjarvis/example.py"
    )
    with pytest.raises(ValueError):
        validate_patch_path("../deploy/docker/.env")
    with pytest.raises(ValueError):
        validate_patch_path("deploy/docker/Dockerfile")
