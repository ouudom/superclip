"""Source ingestion routes."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth_headers import resolve_authenticated_user_id
from ...clip_cleanup import normalize_clip_cleanup_settings
from ...config import get_config
from ...database import get_db
from ...services.task_service import TaskService
from ...services.video_service import WATCH_URL_PREFIX
from ...video_utils import VALID_OUTPUT_FORMATS
from ...workers.job_queue import JobQueue
from .tasks import _merge_task_source_metadata, _save_task_source_metadata

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sources", tags=["sources"])

WATCHED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


async def _get_user_id(request: Request, db: AsyncSession) -> str:
    return await resolve_authenticated_user_id(request, db, get_config())


def _watch_dir() -> Path:
    return Path(get_config().watched_source_dir).expanduser().resolve()


def _watched_file_payload(path: Path, watch_dir: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "filename": path.name,
        "title": path.stem,
        "extension": path.suffix.lower(),
        "size_bytes": stat.st_size,
        "modified_at": stat.st_mtime,
        "source_url": f"{WATCH_URL_PREFIX}{path.name}",
        "directory": str(watch_dir),
    }


@router.get("/watched")
async def list_watched_sources(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List videos in the configured watched source folder."""
    await _get_user_id(request, db)
    watch_dir = _watch_dir()
    if not watch_dir.exists():
        return {
            "configured": False,
            "directory": str(watch_dir),
            "files": [],
            "message": "Watched source folder does not exist.",
        }
    if not watch_dir.is_dir():
        raise HTTPException(status_code=400, detail="WATCHED_SOURCE_DIR is not a directory")

    files = [
        _watched_file_payload(path, watch_dir)
        for path in sorted(watch_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True)
        if path.is_file() and path.suffix.lower() in WATCHED_VIDEO_EXTENSIONS
    ]
    return {
        "configured": True,
        "directory": str(watch_dir),
        "files": files,
        "total": len(files),
    }


@router.post("/watched/import")
async def import_watched_source(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a task from a watched-folder video."""
    user_id = await _get_user_id(request, db)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")

    filename = Path(str(payload.get("filename") or "")).name
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required")

    watch_dir = _watch_dir()
    source_path = (watch_dir / filename).resolve()
    if watch_dir not in source_path.parents:
        raise HTTPException(status_code=400, detail="Invalid watched source filename")
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail="Watched source file not found")
    if source_path.suffix.lower() not in WATCHED_VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported watched source file type")

    runtime_config = get_config()
    processing_mode = str(payload.get("processing_mode") or runtime_config.default_processing_mode)
    if processing_mode not in {"fast", "balanced", "quality"}:
        processing_mode = runtime_config.default_processing_mode
    output_format = str(payload.get("output_format") or "vertical")
    if output_format not in VALID_OUTPUT_FORMATS:
        output_format = "vertical"
    add_subtitles = payload.get("add_subtitles", True)
    if not isinstance(add_subtitles, bool):
        add_subtitles = True
    cleanup_settings = normalize_clip_cleanup_settings(
        payload.get("cut_long_pauses"),
        payload.get("pause_threshold_ms"),
        payload.get("remove_filler_words"),
        payload.get("filtered_words"),
    )

    task_service = TaskService(db)
    source_url = f"{WATCH_URL_PREFIX}{filename}"
    title = str(payload.get("title") or source_path.stem).strip() or source_path.stem
    try:
        task_id = await task_service.create_task_with_source(
            user_id=user_id,
            url=source_url,
            title=title,
            font_family=str(payload.get("font_family") or "THEBOLDFONT"),
            font_size=int(payload.get("font_size") or 24),
            font_color=str(payload.get("font_color") or "#FFFFFF"),
            caption_template=str(payload.get("caption_template") or "default"),
            include_broll=bool(payload.get("include_broll", False)),
            processing_mode=processing_mode,
        )
        source_type = task_service.video_service.determine_source_type(source_url)
        queue_adapter = getattr(request.app.state, "queue_adapter", JobQueue)
        job_id = await queue_adapter.enqueue_processing_job(
            "process_video_task",
            processing_mode,
            task_id,
            source_url,
            source_type,
            user_id,
            str(payload.get("font_family") or "THEBOLDFONT"),
            int(payload.get("font_size") or 24),
            str(payload.get("font_color") or "#FFFFFF"),
            str(payload.get("caption_template") or "default"),
            processing_mode,
            output_format,
            add_subtitles,
            cleanup_settings,
        )
        await _save_task_source_metadata(
            task_id,
            _merge_task_source_metadata(
                {"source_kind": "watched_folder", "watched_filename": filename},
                source_url=source_url,
                source_type=source_type,
                output_format=output_format,
                add_subtitles=add_subtitles,
                cleanup_settings=cleanup_settings,
            ),
        )
        return {
            "task_id": task_id,
            "job_id": job_id,
            "source_url": source_url,
            "source_type": source_type,
            "message": "Watched source imported and queued",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Error importing watched source %s: %s", filename, exc)
        raise HTTPException(status_code=500, detail=f"Error importing watched source: {exc}")
