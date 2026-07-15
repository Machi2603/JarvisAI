"""REST endpoints for the proactive-agent approval queue."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

from openjarvis.tools.approval_store import (
    STATUS_APPROVED,
    STATUS_DENIED,
    STATUS_EXECUTED,
    ApprovalStore,
    PendingAction,
)

try:
    from fastapi import APIRouter, HTTPException
except ImportError:
    raise ImportError("fastapi is required for approval routes")

logger = logging.getLogger(__name__)

router = APIRouter()

# Singleton that shares the same DB file as ProactiveAgent (WAL mode is safe)
_store: Optional[ApprovalStore] = None


def _get_store() -> ApprovalStore:
    global _store
    if _store is None:
        _store = ApprovalStore()
    return _store


def _serialize(action: PendingAction) -> Dict[str, Any]:
    return {
        "id": action.id,
        "action_type": action.action_type,
        "description": action.description,
        "payload": action.payload,
        "permission_key": action.permission_key,
        "tier": action.tier,
        "status": action.status,
        "created_at": action.created_at,
        "expires_at": action.expires_at,
    }


@router.get("/v1/approvals/pending")
async def list_pending_approvals() -> Dict[str, Any]:
    store = _get_store()
    store.expire_stale()
    actions = store.list_pending()
    return {"actions": [_serialize(a) for a in actions], "count": len(actions)}


@router.post("/v1/approvals/{action_id}/approve")
async def approve_action(action_id: str) -> Dict[str, Any]:
    store = _get_store()
    action = store.get_action(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.action_type == "code_patch":
        workspace = os.environ.get("OPENJARVIS_WORKSPACE", "").strip()
        if not workspace:
            raise HTTPException(
                status_code=503, detail="Code workspace is not configured"
            )
        from openjarvis.tools.apply_patch import ApplyPatchTool
        from openjarvis.tools.code_patch_proposal import validate_patch_path

        try:
            relative = validate_patch_path(str(action.payload.get("path", "")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        root = Path(workspace).resolve()
        target = (root / relative).resolve()
        if target != root and root not in target.parents:
            raise HTTPException(
                status_code=400, detail="Patch target escaped the workspace"
            )
        result = ApplyPatchTool().execute(
            path=str(target),
            patch=str(action.payload.get("patch", "")),
            backup=False,
        )
        if not result.success:
            raise HTTPException(status_code=400, detail=result.content)
        store.update_status(action_id, STATUS_EXECUTED)
        logger.info("Code patch %s approved and applied", action_id)
        return {"status": "executed", "id": action_id}
    store.update_status(action_id, STATUS_APPROVED)
    logger.info("Action %s approved via UI", action_id)
    return {"status": "approved", "id": action_id}


@router.post("/v1/approvals/{action_id}/deny")
async def deny_action(action_id: str) -> Dict[str, Any]:
    store = _get_store()
    action = store.get_action(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    store.update_status(action_id, STATUS_DENIED)
    logger.info("Action %s denied via UI", action_id)
    return {"status": "denied", "id": action_id}


__all__ = ["router"]
