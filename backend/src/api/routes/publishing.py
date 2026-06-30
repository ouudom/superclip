"""Manual publishing assist routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth_headers import resolve_authenticated_user_id
from ...config import get_config
from ...database import get_db
from ...services.publishing_service import PublishingService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publishing", tags=["publishing"])


async def _get_user_id(request: Request, db: AsyncSession) -> str:
    return await resolve_authenticated_user_id(request, db, get_config())


@router.get("/items")
async def list_publish_items(
    request: Request,
    platform: str | None = None,
    status: str | None = None,
    limit: int = 120,
    db: AsyncSession = Depends(get_db),
):
    user_id = await _get_user_id(request, db)
    service = PublishingService(db)
    try:
        items = await service.list_items(
            user_id,
            platform=platform,
            post_status=status,
            limit=limit,
        )
        return {"items": items, "total": len(items)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/clips/{clip_id}/platforms/{platform}")
async def update_publish_item(
    clip_id: str,
    platform: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = await _get_user_id(request, db)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")
    service = PublishingService(db)
    try:
        item = await service.save_metadata(user_id, clip_id, platform, payload)
        return {"item": item}
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
    except Exception as exc:
        logger.error("Error updating publish item %s/%s: %s", clip_id, platform, exc)
        raise HTTPException(status_code=500, detail=f"Error updating publish item: {exc}")


@router.post("/clips/{clip_id}/platforms/{platform}/export")
async def export_publish_clip(
    clip_id: str,
    platform: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = await _get_user_id(request, db)
    service = PublishingService(db)
    try:
        item = await service.export_clip(user_id, clip_id, platform)
        return {"item": item, "message": "Clip exported"}
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() or "missing" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
    except Exception as exc:
        logger.error("Error exporting publish clip %s/%s: %s", clip_id, platform, exc)
        raise HTTPException(status_code=500, detail=f"Error exporting clip: {exc}")
