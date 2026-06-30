"""
Task repository - handles all database operations for tasks.
"""

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional, Dict, Any, List
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class TaskRepository:
    """Repository for task-related database operations."""

    @staticmethod
    async def create_task(
        db: AsyncSession,
        user_id: str,
        source_id: str,
        status: str = "processing",
        font_family: str = "TikTokSans-Regular",
        font_size: int = 24,
        font_color: str = "#FFFFFF",
        caption_template: str = "default",
        include_broll: bool = False,
        processing_mode: str = "fast",
    ) -> str:
        """Create a new task and return its ID."""
        task_id = str(uuid4())
        try:
            result = await db.execute(
                text("""
                    INSERT INTO tasks (
                        id, user_id, source_id, status, font_family, font_size, font_color,
                        caption_template, include_broll, processing_mode,
                        created_at, updated_at
                    )
                    VALUES (
                        :task_id, :user_id, :source_id, :status, :font_family, :font_size, :font_color,
                        :caption_template, :include_broll, :processing_mode,
                        NOW(), NOW()
                    )
                    RETURNING id
                """),
                {
                    "task_id": task_id,
                    "user_id": user_id,
                    "source_id": source_id,
                    "status": status,
                    "font_family": font_family,
                    "font_size": font_size,
                    "font_color": font_color,
                    "caption_template": caption_template,
                    "include_broll": include_broll,
                    "processing_mode": processing_mode,
                },
            )
        except Exception:
            await db.rollback()
            result = await db.execute(
                text("""
                    INSERT INTO tasks (
                        id, user_id, source_id, status, font_family, font_size, font_color,
                        created_at, updated_at
                    )
                    VALUES (
                        :task_id, :user_id, :source_id, :status, :font_family, :font_size, :font_color,
                        NOW(), NOW()
                    )
                    RETURNING id
                """),
                {
                    "task_id": task_id,
                    "user_id": user_id,
                    "source_id": source_id,
                    "status": status,
                    "font_family": font_family,
                    "font_size": font_size,
                    "font_color": font_color,
                },
            )
        await db.commit()
        task_id = result.scalar()
        if not task_id:
            raise RuntimeError("Failed to create task: no ID returned")
        logger.info(f"Created task {task_id} for user {user_id}")
        return str(task_id)

    @staticmethod
    async def get_task_by_id(
        db: AsyncSession, task_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get task by ID with source information."""
        try:
            result = await db.execute(
                text("""
                    SELECT t.*, s.title as source_title, s.type as source_type, s.url as source_url
                    FROM tasks t
                    LEFT JOIN sources s ON t.source_id = s.id
                    WHERE t.id = :task_id
                """),
                {"task_id": task_id},
            )
        except Exception:
            await db.rollback()
            result = await db.execute(
                text("""
                    SELECT t.*, s.title as source_title, s.type as source_type
                    FROM tasks t
                    LEFT JOIN sources s ON t.source_id = s.id
                    WHERE t.id = :task_id
                """),
                {"task_id": task_id},
            )
        row = result.fetchone()

        if not row:
            return None

        return {
            "id": row.id,
            "user_id": row.user_id,
            "source_id": row.source_id,
            "source_title": row.source_title,
            "source_type": row.source_type,
            "status": row.status,
            "progress": getattr(row, "progress", None),
            "progress_message": getattr(row, "progress_message", None),
            "generated_clips_ids": row.generated_clips_ids,
            "font_family": row.font_family,
            "font_size": row.font_size,
            "font_color": row.font_color,
            "caption_template": getattr(row, "caption_template", "default"),
            "include_broll": getattr(row, "include_broll", False),
            "processing_mode": getattr(row, "processing_mode", "fast"),
            "cache_hit": getattr(row, "cache_hit", False),
            "error_code": getattr(row, "error_code", None),
            "error_message": getattr(row, "error_message", None),
            "current_stage": getattr(row, "current_stage", None),
            "failed_stage": getattr(row, "failed_stage", None),
            "resume_from_stage": getattr(row, "resume_from_stage", None),
            "stage_progress_json": getattr(row, "stage_progress_json", None),
            "retry_count": getattr(row, "retry_count", 0),
            "max_retries": getattr(row, "max_retries", 3),
            "last_error_at": getattr(row, "last_error_at", None),
            "stage_timings_json": getattr(row, "stage_timings_json", None),
            "started_at": getattr(row, "started_at", None),
            "completed_at": getattr(row, "completed_at", None),
            "source_url": getattr(row, "source_url", None),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    async def update_task_runtime_metadata(
        db: AsyncSession,
        task_id: str,
        cache_hit: Optional[bool] = None,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
        stage_timings_json: Optional[str] = None,
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        last_error_at: Optional[datetime] = None,
        retry_count: Optional[int] = None,
        max_retries: Optional[int] = None,
    ) -> None:
        params: Dict[str, Any] = {"task_id": task_id}
        set_parts = []

        if cache_hit is not None:
            set_parts.append("cache_hit = :cache_hit")
            params["cache_hit"] = cache_hit

        if error_code is not None:
            set_parts.append("error_code = :error_code")
            params["error_code"] = error_code

        if error_message is not None:
            set_parts.append("error_message = :error_message")
            params["error_message"] = error_message

        if stage_timings_json is not None:
            set_parts.append("stage_timings_json = :stage_timings_json")
            params["stage_timings_json"] = stage_timings_json

        if started_at is not None:
            set_parts.append("started_at = :started_at")
            params["started_at"] = started_at

        if completed_at is not None:
            set_parts.append("completed_at = :completed_at")
            params["completed_at"] = completed_at

        if last_error_at is not None:
            set_parts.append("last_error_at = :last_error_at")
            params["last_error_at"] = last_error_at

        if retry_count is not None:
            set_parts.append("retry_count = :retry_count")
            params["retry_count"] = retry_count

        if max_retries is not None:
            set_parts.append("max_retries = :max_retries")
            params["max_retries"] = max_retries

        if not set_parts:
            return

        set_parts.append("updated_at = NOW()")
        query = f"UPDATE tasks SET {', '.join(set_parts)} WHERE id = :task_id"
        await db.execute(text(query), params)
        await db.commit()

    @staticmethod
    async def get_performance_metrics(db: AsyncSession) -> Dict[str, Any]:
        result = await db.execute(
            text(
                """
                SELECT
                    processing_mode,
                    COUNT(*) AS total_tasks,
                    AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) AS avg_seconds,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) AS p50_seconds,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) AS p95_seconds,
                    SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END) AS cache_hits
                FROM tasks
                WHERE started_at IS NOT NULL AND completed_at IS NOT NULL
                GROUP BY processing_mode
                ORDER BY processing_mode
                """
            )
        )

        rows = result.fetchall()
        metrics = []
        for row in rows:
            total = int(row.total_tasks or 0)
            cache_hits = int(row.cache_hits or 0)
            metrics.append(
                {
                    "processing_mode": row.processing_mode,
                    "total_tasks": total,
                    "avg_seconds": float(row.avg_seconds or 0),
                    "p50_seconds": float(row.p50_seconds or 0),
                    "p95_seconds": float(row.p95_seconds or 0),
                    "cache_hit_rate": (cache_hits / total) if total else 0,
                }
            )

        return {"modes": metrics}

    @staticmethod
    async def update_task_settings(
        db: AsyncSession,
        task_id: str,
        font_family: str,
        font_size: int,
        font_color: str,
        caption_template: str,
        include_broll: bool,
    ) -> None:
        """Update task styling settings."""
        try:
            await db.execute(
                text(
                    """
                    UPDATE tasks
                    SET font_family = :font_family,
                        font_size = :font_size,
                        font_color = :font_color,
                        caption_template = :caption_template,
                        include_broll = :include_broll,
                        updated_at = NOW()
                    WHERE id = :task_id
                    """
                ),
                {
                    "task_id": task_id,
                    "font_family": font_family,
                    "font_size": font_size,
                    "font_color": font_color,
                    "caption_template": caption_template,
                    "include_broll": include_broll,
                },
            )
        except Exception:
            await db.rollback()
            await db.execute(
                text(
                    """
                    UPDATE tasks
                    SET font_family = :font_family,
                        font_size = :font_size,
                        font_color = :font_color,
                        updated_at = NOW()
                    WHERE id = :task_id
                    """
                ),
                {
                    "task_id": task_id,
                    "font_family": font_family,
                    "font_size": font_size,
                    "font_color": font_color,
                },
            )
        await db.commit()

    @staticmethod
    async def update_task_status(
        db: AsyncSession,
        task_id: str,
        status: str,
        progress: Optional[int] = None,
        progress_message: Optional[str] = None,
        current_stage: Optional[str] = None,
        failed_stage: Optional[str] = None,
        resume_from_stage: Optional[str] = None,
        stage_progress_json: Optional[str] = None,
    ) -> None:
        """Update task status and optional progress."""
        params = {
            "task_id": task_id,
            "status": status,
            "progress": progress,
            "progress_message": progress_message,
            "current_stage": current_stage,
            "failed_stage": failed_stage,
            "resume_from_stage": resume_from_stage,
            "stage_progress_json": stage_progress_json,
        }

        # Build dynamic query based on what's provided
        set_parts = ["status = :status"]

        if progress is not None:
            set_parts.append("progress = :progress")

        if progress_message is not None:
            set_parts.append("progress_message = :progress_message")

        if current_stage is not None:
            set_parts.append("current_stage = :current_stage")

        if failed_stage is not None:
            set_parts.append("failed_stage = :failed_stage")

        if resume_from_stage is not None:
            set_parts.append("resume_from_stage = :resume_from_stage")

        if stage_progress_json is not None:
            set_parts.append("stage_progress_json = :stage_progress_json")

        set_parts.append("updated_at = NOW()")

        query = f"UPDATE tasks SET {', '.join(set_parts)} WHERE id = :task_id"

        await db.execute(text(query), params)
        await db.commit()
        logger.info(
            f"Updated task {task_id} status to {status}"
            + (f" (progress: {progress}%)" if progress else "")
        )

    @staticmethod
    async def update_task_clips(
        db: AsyncSession, task_id: str, clip_ids: List[str]
    ) -> None:
        """Update task with generated clip IDs."""
        await db.execute(
            text(
                "UPDATE tasks SET generated_clips_ids = :clip_ids, updated_at = NOW() WHERE id = :task_id"
            ),
            {"clip_ids": clip_ids, "task_id": task_id},
        )
        await db.commit()
        logger.info(f"Updated task {task_id} with {len(clip_ids)} clips")

    @staticmethod
    async def get_user_tasks(
        db: AsyncSession, user_id: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get all tasks for a user."""
        result = await db.execute(
            text("""
                SELECT t.*, s.title as source_title, s.type as source_type,
                       (SELECT COUNT(*) FROM generated_clips WHERE task_id = t.id) as clips_count
                FROM tasks t
                LEFT JOIN sources s ON t.source_id = s.id
                WHERE t.user_id = :user_id
                ORDER BY t.created_at DESC
                LIMIT :limit
            """),
            {"user_id": user_id, "limit": limit},
        )

        tasks = []
        for row in result.fetchall():
            tasks.append(
                {
                    "id": row.id,
                    "user_id": row.user_id,
                    "source_id": row.source_id,
                    "source_title": row.source_title,
                    "source_type": row.source_type,
                    "status": row.status,
                    "processing_mode": getattr(row, "processing_mode", "fast"),
                    "clips_count": row.clips_count,
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
            )

        return tasks

    @staticmethod
    async def search_user_library(
        db: AsyncSession,
        user_id: str,
        *,
        limit: int = 100,
        q: str | None = None,
        status: str | None = None,
        tag: str | None = None,
        content_pillar: str | None = None,
        platform: str | None = None,
        series_name: str | None = None,
        archived: bool = False,
    ) -> List[Dict[str, Any]]:
        """Search content library rows with task, source, clip, and metadata fields."""
        where_parts = ["t.user_id = :user_id", "COALESCE(m.archived, false) = :archived"]
        params: Dict[str, Any] = {
            "user_id": user_id,
            "limit": limit,
            "archived": archived,
        }

        if q:
            where_parts.append(
                """
                (
                    s.title ILIKE :q
                    OR s.type ILIKE :q
                    OR COALESCE(m.content_pillar, '') ILIKE :q
                    OR COALESCE(m.series_name, '') ILIKE :q
                    OR array_to_string(COALESCE(m.tags, ARRAY[]::text[]), ' ') ILIKE :q
                    OR EXISTS (
                        SELECT 1 FROM generated_clips gc_search
                        WHERE gc_search.task_id = t.id
                        AND COALESCE(gc_search.text, '') ILIKE :q
                    )
                )
                """
            )
            params["q"] = f"%{q.strip()}%"
        if status and status != "all":
            where_parts.append("t.status = :status")
            params["status"] = status
        if tag:
            where_parts.append(":tag = ANY(COALESCE(m.tags, ARRAY[]::text[]))")
            params["tag"] = tag.strip().lower()
        if content_pillar:
            where_parts.append("m.content_pillar = :content_pillar")
            params["content_pillar"] = content_pillar.strip()
        if platform:
            where_parts.append("m.platform = :platform")
            params["platform"] = platform.strip()
        if series_name:
            where_parts.append("m.series_name = :series_name")
            params["series_name"] = series_name.strip()

        result = await db.execute(
            text(f"""
                SELECT
                    t.id,
                    t.user_id,
                    t.source_id,
                    t.status,
                    t.created_at,
                    t.updated_at,
                    t.completed_at,
                    t.cache_hit,
                    s.title AS source_title,
                    s.type AS source_type,
                    COALESCE(m.tags, ARRAY[]::text[]) AS tags,
                    m.content_pillar,
                    m.series_name,
                    m.platform,
                    COALESCE(m.library_status, 'draft') AS library_status,
                    COALESCE(m.pinned, false) AS pinned,
                    COALESCE(m.archived, false) AS archived,
                    m.notes,
                    COUNT(gc.id) AS clips_count,
                    COALESCE(SUM(gc.duration), 0) AS total_duration,
                    COALESCE(MAX(gc.virality_score), 0) AS best_virality_score,
                    COALESCE(AVG(gc.relevance_score), 0) AS average_relevance_score
                FROM tasks t
                LEFT JOIN sources s ON t.source_id = s.id
                LEFT JOIN task_library_metadata m ON m.task_id = t.id
                LEFT JOIN generated_clips gc ON gc.task_id = t.id
                WHERE {' AND '.join(where_parts)}
                GROUP BY
                    t.id,
                    s.title,
                    s.type,
                    m.tags,
                    m.content_pillar,
                    m.series_name,
                    m.platform,
                    m.library_status,
                    m.pinned,
                    m.archived,
                    m.notes
                ORDER BY COALESCE(m.pinned, false) DESC, t.updated_at DESC
                LIMIT :limit
            """),
            params,
        )

        return [
            {
                "id": row.id,
                "user_id": row.user_id,
                "source_id": row.source_id,
                "source_title": row.source_title,
                "source_type": row.source_type,
                "status": row.status,
                "clips_count": int(row.clips_count or 0),
                "total_duration": float(row.total_duration or 0),
                "best_virality_score": int(row.best_virality_score or 0),
                "average_relevance_score": float(row.average_relevance_score or 0),
                "tags": list(row.tags or []),
                "content_pillar": row.content_pillar,
                "series_name": row.series_name,
                "platform": row.platform,
                "library_status": row.library_status,
                "pinned": bool(row.pinned),
                "archived": bool(row.archived),
                "notes": row.notes,
                "cache_hit": bool(row.cache_hit),
                "completed_at": row.completed_at,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
            for row in result.fetchall()
        ]

    @staticmethod
    async def update_library_metadata(
        db: AsyncSession,
        task_id: str,
        *,
        tags: list[str] | None = None,
        content_pillar: str | None = None,
        series_name: str | None = None,
        platform: str | None = None,
        library_status: str | None = None,
        pinned: bool | None = None,
        archived: bool | None = None,
        notes: str | None = None,
    ) -> Dict[str, Any]:
        """Upsert library metadata for a task."""
        await db.execute(
            text("""
                INSERT INTO task_library_metadata (task_id, created_at, updated_at)
                VALUES (:task_id, NOW(), NOW())
                ON CONFLICT (task_id)
                DO NOTHING
            """),
            {"task_id": task_id},
        )

        set_parts = []
        params: Dict[str, Any] = {"task_id": task_id}
        fields = {
            "tags": tags,
            "content_pillar": content_pillar,
            "series_name": series_name,
            "platform": platform,
            "library_status": library_status,
            "pinned": pinned,
            "archived": archived,
            "notes": notes,
        }
        for field, value in fields.items():
            if value is not None:
                if field == "tags":
                    set_parts.append(f"{field} = CAST(:{field} AS TEXT[])")
                else:
                    set_parts.append(f"{field} = :{field}")
                params[field] = value
        if set_parts:
            set_parts.append("updated_at = NOW()")
            await db.execute(
                text(
                    f"""
                    UPDATE task_library_metadata
                    SET {', '.join(set_parts)}
                    WHERE task_id = :task_id
                    """
                ),
                params,
            )
        await db.commit()

        result = await db.execute(
            text("""
                SELECT task_id, tags, content_pillar, series_name, platform,
                       library_status, pinned, archived, notes, updated_at
                FROM task_library_metadata
                WHERE task_id = :task_id
            """),
            {"task_id": task_id},
        )
        row = result.fetchone()
        return {
            "task_id": row.task_id,
            "tags": list(row.tags or []),
            "content_pillar": row.content_pillar,
            "series_name": row.series_name,
            "platform": row.platform,
            "library_status": row.library_status,
            "pinned": bool(row.pinned),
            "archived": bool(row.archived),
            "notes": row.notes,
            "updated_at": row.updated_at,
        }

    @staticmethod
    async def user_exists(db: AsyncSession, user_id: str) -> bool:
        """Check if a user exists in the database."""
        result = await db.execute(
            text("SELECT 1 FROM users WHERE id = :user_id"), {"user_id": user_id}
        )
        return result.fetchone() is not None

    @staticmethod
    async def delete_task(db: AsyncSession, task_id: str) -> None:
        """Delete a task by ID."""
        await db.execute(
            text("DELETE FROM tasks WHERE id = :task_id"), {"task_id": task_id}
        )
        await db.commit()
        logger.info(f"Deleted task {task_id}")
