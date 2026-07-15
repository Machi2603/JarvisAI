"""Read-only visual state for Jarvis' Playwright browser."""

from __future__ import annotations

import base64

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/v1/browser", tags=["browser"])


@router.get("/state")
async def browser_state():
    try:
        from openjarvis.tools.browser import _session

        url, title, screenshot = _session.run(
            lambda page: (page.url, page.title(), page.screenshot())
        )
        image = base64.b64encode(screenshot).decode("ascii")
        return {"url": url, "title": title, "screenshot": image}
    except ImportError as exc:
        raise HTTPException(
            status_code=503, detail="Playwright is not installed"
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"Browser unavailable: {exc}"
        ) from exc
