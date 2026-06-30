"""
Worker tasks - background jobs processed by arq workers.
"""

import logging
from typing import Dict, Any
import json

from arq import cron

from ..observability import configure_logging, set_trace_id

configure_logging()

logger = logging.getLogger(__name__)


async def process_video_task(
    ctx: Dict[str, Any],
    task_id: str,
    url: str,
    source_type: str,
    user_id: str,
    font_family: str = "TikTokSans-Regular",
    font_size: int = 24,
    font_color: str = "#FFFFFF",
    caption_template: str = "default",
    processing_mode: str = "fast",
    output_format: str = "vertical",
    add_subtitles: bool = True,
    cleanup_settings: Dict[str, Any] | None = None,
    render_candidates: bool = False,
    selected_candidate_orders: list[int] | None = None,
    edited_candidate_segments: list[dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """
    Background worker task to process a video.

    Args:
        ctx: arq context (provides Redis connection and other utilities)
        task_id: Task ID to update
        url: Video URL or file path
        source_type: "youtube" or "upload"
        user_id: User ID who created the task
        font_family: Font family for subtitles
        font_size: Font size for subtitles
        font_color: Font color for subtitles

    Returns:
        Dict with processing results
    """
    from ..database import AsyncSessionLocal
    from ..runtime_settings import load_runtime_settings_cache
    from ..services.task_service import TaskService
    from ..workers.progress import ProgressTracker

    set_trace_id(f"task-{task_id}")
    logger.info(f"Worker processing task {task_id}")

    # Create progress tracker
    progress = ProgressTracker(ctx["redis"], task_id)

    async with AsyncSessionLocal() as db:
        await load_runtime_settings_cache(db)
        task_service = TaskService(db)

        try:
            # Progress callback
            async def update_progress(
                percent: int,
                message: str,
                status: str = "processing",
                metadata: dict | None = None,
            ):
                job_try = int(ctx.get("job_try", 1))
                max_tries = int(getattr(WorkerSettings, "max_tries", 3))
                payload = {
                    "retry_count": max(0, job_try - 1),
                    "max_retries": max_tries,
                }
                if metadata:
                    payload.update(metadata)
                await progress.update(percent, message, status, payload)
                logger.info(f"Task {task_id}: {percent}% - {message}")

            async def should_cancel() -> bool:
                cancelled = await ctx["redis"].get(f"task_cancel:{task_id}")
                return bool(cancelled)

            async def clip_ready_callback(
                clip_index: int, total_clips: int, clip_data: dict
            ):
                await progress.clip_ready(clip_index, total_clips, clip_data)

            # Process the video
            result = await task_service.process_task(
                task_id=task_id,
                url=url,
                source_type=source_type,
                font_family=font_family,
                font_size=font_size,
                font_color=font_color,
                caption_template=caption_template,
                processing_mode=processing_mode,
                output_format=output_format,
                add_subtitles=add_subtitles,
                progress_callback=update_progress,
                should_cancel=should_cancel,
                clip_ready_callback=clip_ready_callback,
                cleanup_settings=cleanup_settings,
                render_candidates=render_candidates,
                selected_candidate_orders=selected_candidate_orders,
                edited_candidate_segments=edited_candidate_segments,
            )

            logger.info(f"Task {task_id} completed successfully")
            return result

        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}", exc_info=True)
            try:
                job_try = int(ctx.get("job_try", 1))
                max_tries = int(getattr(WorkerSettings, "max_tries", 3))
                await task_service.task_repo.update_task_runtime_metadata(
                    db,
                    task_id,
                    retry_count=max(0, job_try - 1),
                    max_retries=max_tries,
                )
                if job_try < max_tries:
                    retry_message = (
                        f"{e}. Retrying attempt {job_try + 1}/{max_tries}..."
                    )
                    await task_service.task_repo.update_task_status(
                        db,
                        task_id,
                        "retrying",
                        progress=0,
                        progress_message=retry_message,
                    )
                    await progress.update(
                        0,
                        retry_message,
                        "retrying",
                        {
                            "retry_count": job_try,
                            "max_retries": max_tries,
                        },
                    )
                if job_try >= max_tries:
                    payload = {
                        "task_id": task_id,
                        "error": str(e),
                        "tries": job_try,
                    }
                    await ctx["redis"].set(
                        f"dead_letter:{task_id}", json.dumps(payload)
                    )
                    await ctx["redis"].sadd("tasks:dead_letter", task_id)
                    await progress.error("Task failed permanently after retries")
            except Exception:
                logger.exception("Failed to persist dead-letter payload")
            # Error will be caught by arq and task status will be updated
            raise


async def cleanup_temp_files(ctx: Dict[str, Any]) -> Dict[str, int]:
    """Cron job: remove old unreferenced files from TEMP_DIR."""
    from ..database import AsyncSessionLocal
    from ..services.temp_cleanup_service import TempCleanupService
    from ..config import get_config

    async with AsyncSessionLocal() as db:
        result = await TempCleanupService(get_config()).cleanup(db)
        logger.info("Temp cleanup result: %s", result)
        return result


# Worker configuration for arq
class WorkerSettings:
    """Configuration for arq worker."""

    from ..config import Config
    from arq.connections import RedisSettings

    config = Config()

    # Functions to run
    functions = [process_video_task]
    queue_name = "supoclip_tasks"

    # Redis settings from environment
    redis_settings = RedisSettings(
        host=config.redis_host, port=config.redis_port, password=config.redis_password, database=0
    )

    # Retry settings
    max_tries = 3  # Retry failed jobs up to 3 times
    job_timeout = 10800  # 3 hour timeout for video processing

    # Worker pool settings
    max_jobs = config.worker_max_jobs
    cron_jobs = [cron(cleanup_temp_files, hour=3, minute=0)]
