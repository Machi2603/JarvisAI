"""Queue source patches for explicit approval instead of applying them."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec
from openjarvis.tools.approval_store import TIER_HIGH
from openjarvis.tools.proactive_tools import get_store

_ALLOWED_PREFIXES = ("src/", "frontend/src/", "tests/")
_MAX_PATCH_CHARS = 200_000


def validate_patch_path(path: str) -> str:
    """Return a safe workspace-relative source path."""
    normalized = Path(path).as_posix().lstrip("./")
    if Path(path).is_absolute() or ".." in Path(path).parts:
        raise ValueError("Patch path must be relative to the workspace")
    if not normalized.startswith(_ALLOWED_PREFIXES):
        raise ValueError("Patch path must be inside src, frontend/src, or tests")
    return normalized


@ToolRegistry.register("propose_code_patch")
class ProposeCodePatchTool(BaseTool):
    tool_id = "propose_code_patch"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="propose_code_patch",
            description=(
                "Propose a unified-diff source patch for user approval. "
                "The code is not changed until the user presses Approve."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative target file.",
                    },
                    "patch": {
                        "type": "string",
                        "description": "Unified diff containing at least one hunk.",
                    },
                    "description": {
                        "type": "string",
                        "description": "Short explanation of the fix.",
                    },
                },
                "required": ["path", "patch", "description"],
            },
            category="filesystem",
        )

    def execute(self, **params: Any) -> ToolResult:
        try:
            path = validate_patch_path(str(params.get("path", "")))
        except ValueError as exc:
            return ToolResult(tool_name=self.tool_id, content=str(exc), success=False)
        patch = str(params.get("patch", ""))
        if not patch or len(patch) > _MAX_PATCH_CHARS:
            return ToolResult(
                tool_name=self.tool_id,
                content="Patch is empty or too large",
                success=False,
            )
        action = get_store().queue_action(
            action_type="code_patch",
            description=str(params.get("description", "Proposed code patch")),
            payload={"path": path, "patch": patch},
            permission_key=f"code_patch:{path}",
            tier=TIER_HIGH,
        )
        return ToolResult(
            tool_name=self.tool_id,
            content=f"Patch queued for approval: {action.id}",
            success=True,
            metadata={"action_id": action.id, "status": action.status},
        )


__all__ = ["ProposeCodePatchTool", "validate_patch_path"]
