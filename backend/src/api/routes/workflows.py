"""Workflow preset routes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth_headers import resolve_authenticated_user_id
from ...clip_cleanup import normalize_clip_cleanup_settings
from ...config import get_config
from ...database import get_db
from ...services.task_service import TaskService
from ...services.workflow_service import WorkflowService
from ...video_utils import VALID_OUTPUT_FORMATS
from ...workers.job_queue import JobQueue
from .tasks import (
    _merge_task_source_metadata,
    _normalize_font_color,
    _normalize_font_family,
    _normalize_font_size,
    _save_task_source_metadata,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workflows", tags=["workflows"])


async def _get_user_id(request: Request, db: AsyncSession) -> str:
    return await resolve_authenticated_user_id(request, db, get_config())


def _bool_from_config(value: Any, default: bool) -> bool:
    return value if isinstance(value, bool) else default


@router.get("/")
async def list_workflows(request: Request, db: AsyncSession = Depends(get_db)):
    await _get_user_id(request, db)
    service = WorkflowService(db)
    workflows = await service.list_workflows()
    return {"workflows": workflows, "total": len(workflows)}


@router.post("/")
async def create_workflow(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = await _get_user_id(request, db)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")
    service = WorkflowService(db)
    try:
        workflow = await service.save_workflow(payload, updated_by=user_id)
        return {"workflow": workflow}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{workflow_id}")
async def update_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db)
):
    user_id = await _get_user_id(request, db)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")
    service = WorkflowService(db)
    try:
        workflow = await service.save_workflow(
            payload, updated_by=user_id, workflow_id=workflow_id
        )
        return {"workflow": workflow}
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc))


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db)
):
    await _get_user_id(request, db)
    service = WorkflowService(db)
    deleted = await service.delete_workflow(workflow_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"message": "Workflow deleted"}


@router.post("/{workflow_id}/run")
async def run_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db)
):
    """Create a processing task using a saved workflow preset."""
    user_id = await _get_user_id(request, db)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")

    source = payload.get("source")
    if not isinstance(source, dict) or not source.get("url"):
        raise HTTPException(status_code=400, detail="Source URL is required")

    workflow_service = WorkflowService(db)
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    config = workflow.get("config") or {}

    task_service = TaskService(db)
    font_options = payload.get("font_options", {})
    font_family = _normalize_font_family(
        font_options.get("font_family") or config.get("font_family") or "THEBOLDFONT"
    )
    font_size = _normalize_font_size(
        font_options.get("font_size") or config.get("font_size") or 24
    )
    font_color = _normalize_font_color(
        font_options.get("font_color") or config.get("font_color") or "#FFFFFF"
    )
    caption_template = str(
        payload.get("caption_template") or config.get("caption_template") or "default"
    )
    include_broll = _bool_from_config(
        payload.get("include_broll", config.get("include_broll")), False
    )
    runtime_config = get_config()
    processing_mode = str(
        payload.get("processing_mode")
        or config.get("processing_mode")
        or runtime_config.default_processing_mode
    )
    if processing_mode not in {"fast", "balanced", "quality"}:
        processing_mode = runtime_config.default_processing_mode
    output_format = str(payload.get("output_format") or config.get("output_format") or "vertical")
    if output_format not in VALID_OUTPUT_FORMATS:
        output_format = "vertical"
    add_subtitles = _bool_from_config(
        payload.get("add_subtitles", config.get("add_subtitles")), True
    )
    cleanup_settings = normalize_clip_cleanup_settings(
        payload.get("cut_long_pauses", config.get("cut_long_pauses")),
        payload.get("pause_threshold_ms", config.get("pause_threshold_ms")),
        payload.get("remove_filler_words", config.get("remove_filler_words")),
        payload.get("filtered_words", config.get("filtered_words")),
    )

    try:
        task_id = await task_service.create_task_with_source(
            user_id=user_id,
            url=source["url"],
            title=source.get("title"),
            font_family=font_family,
            font_size=font_size,
            font_color=font_color,
            caption_template=caption_template,
            include_broll=include_broll,
            processing_mode=processing_mode,
        )
        source_type = task_service.video_service.determine_source_type(source["url"])
        queue_adapter = getattr(request.app.state, "queue_adapter", JobQueue)
        job_id = await queue_adapter.enqueue_processing_job(
            "process_video_task",
            processing_mode,
            task_id,
            source["url"],
            source_type,
            user_id,
            font_family,
            font_size,
            font_color,
            caption_template,
            processing_mode,
            output_format,
            add_subtitles,
            cleanup_settings,
        )
        await _save_task_source_metadata(
            task_id,
            _merge_task_source_metadata(
                {"workflow_id": workflow_id, "workflow_name": workflow["name"]},
                source_url=source["url"],
                source_type=source_type,
                output_format=output_format,
                add_subtitles=add_subtitles,
                cleanup_settings=cleanup_settings,
            ),
        )
        if config.get("content_pillar") or config.get("library_status"):
            await task_service.update_content_library_metadata(
                task_id,
                {
                    "content_pillar": config.get("content_pillar"),
                    "library_status": config.get("library_status") or "draft",
                    "platform": workflow.get("output_target"),
                    "notes": f"Created with workflow: {workflow['name']}",
                },
            )
        return {
            "task_id": task_id,
            "job_id": job_id,
            "workflow": workflow,
            "message": "Workflow task created and queued",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Error running workflow %s: %s", workflow_id, exc)
        raise HTTPException(status_code=500, detail=f"Error running workflow: {exc}")
