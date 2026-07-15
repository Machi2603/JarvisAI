"""Local date and time tool."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
MONTHS = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)

@ToolRegistry.register("current_time")
class CurrentTimeTool(BaseTool):
    tool_id = "current_time"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="current_time",
            description="Get the current local date and time.",
            parameters={
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "IANA timezone, optional.",
                    }
                },
            },
            category="system",
        )

    def execute(self, **params) -> ToolResult:
        timezone = params.get("timezone")
        try:
            now = (
                datetime.now(ZoneInfo(timezone))
                if timezone
                else datetime.now().astimezone()
            )
        except ZoneInfoNotFoundError:
            return ToolResult(
                tool_name=self.tool_id,
                content=f"Unknown timezone: {timezone}",
                success=False,
            )
        return ToolResult(
            tool_name=self.tool_id,
            content=(
                f"{WEEKDAYS[now.weekday()]}, {now.day} de {MONTHS[now.month - 1]} "
                f"de {now.year}, {now:%H:%M} ({now:%Z})"
            ),
            success=True,
        )
