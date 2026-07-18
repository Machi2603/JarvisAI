"""Read-only visual state for Jarvis' Playwright browser."""

from __future__ import annotations

import base64

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/v1/browser", tags=["browser"])


@router.post("/open")
async def open_browser():
    """Start the shared Playwright session so the desktop viewer can show it."""
    try:
        from openjarvis.tools.browser import _session

        url, title = _session.run(lambda page: (page.url, page.title()))
        return {"url": url, "title": title}
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Playwright is not installed") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Browser unavailable: {exc}") from exc


@router.post("/close")
async def close_browser():
    """Release the current browser page; a later open creates a fresh one."""
    from openjarvis.tools.browser import _session

    _session.reset()
    return {"closed": True}


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
