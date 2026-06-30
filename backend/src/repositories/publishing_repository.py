"""Publishing metadata repository."""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class PublishingRepository:
    @staticmethod
    def _row_to_dict(row: Any) -> dict[str, Any]:
        return {
            "id": row.id,
            "clip_id": row.clip_id,
            "task_id": row.task_id,
            "platform": row.platform,
            "post_status": row.post_status,
            "caption": row.caption,
            "hashtags": list(row.hashtags or []),
            "checklist": row.checklist_json or {},
            "published_url": row.published_url,
            "published_at": row.published_at,
            "export_path": row.export_path,
            "notes": row.notes,
            "source_title": row.source_title,
            "source_type": row.source_type,
            "clip_filename": row.clip_filename,
            "clip_file_path": row.clip_file_path,
            "clip_order": row.clip_order,
            "clip_text": row.clip_text,
            "duration": row.duration,
            "virality_score": row.virality_score or 0,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    async def list_publish_items(
        self,
        db: AsyncSession,
        user_id: str,
        *,
        platform: str | None,
        post_status: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        platforms = [platform] if platform else ["tiktok", "reels", "shorts"]
        result = await db.execute(
            text("""
                WITH selected_platforms AS (
                    SELECT unnest(CAST(:platforms AS text[])) AS platform
                )
                SELECT
                    COALESCE(cpm.id, '') AS id,
                    gc.id AS clip_id,
                    gc.task_id AS task_id,
                    sp.platform,
                    COALESCE(cpm.post_status, 'draft') AS post_status,
                    cpm.caption,
                    COALESCE(cpm.hashtags, '{}') AS hashtags,
                    COALESCE(cpm.checklist_json, '{}'::jsonb) AS checklist_json,
                    cpm.published_url,
                    cpm.published_at,
                    cpm.export_path,
                    cpm.notes,
                    s.title AS source_title,
                    s.type AS source_type,
                    gc.filename AS clip_filename,
                    gc.file_path AS clip_file_path,
                    gc.clip_order,
                    gc.text AS clip_text,
                    gc.duration,
                    gc.virality_score,
                    COALESCE(cpm.created_at, gc.created_at) AS created_at,
                    COALESCE(cpm.updated_at, gc.updated_at) AS updated_at
                FROM generated_clips gc
                JOIN tasks t ON t.id = gc.task_id
                LEFT JOIN sources s ON s.id = t.source_id
                CROSS JOIN selected_platforms sp
                LEFT JOIN clip_publish_metadata cpm
                    ON cpm.clip_id = gc.id AND cpm.platform = sp.platform
                WHERE t.user_id = :user_id
                  AND (:post_status IS NULL OR COALESCE(cpm.post_status, 'draft') = :post_status)
                ORDER BY COALESCE(cpm.updated_at, gc.created_at) DESC, gc.clip_order ASC
                LIMIT :limit
            """),
            {
                "user_id": user_id,
                "platforms": platforms,
                "post_status": post_status,
                "limit": max(1, min(limit, 300)),
            },
        )
        return [self._row_to_dict(row) for row in result.fetchall()]

    async def get_publish_item(
        self, db: AsyncSession, user_id: str, clip_id: str, platform: str
    ) -> dict[str, Any] | None:
        result = await db.execute(
            text("""
                WITH selected_platforms AS (SELECT :platform AS platform)
                SELECT
                    COALESCE(cpm.id, '') AS id,
                    gc.id AS clip_id,
                    gc.task_id AS task_id,
                    sp.platform,
                    COALESCE(cpm.post_status, 'draft') AS post_status,
                    cpm.caption,
                    COALESCE(cpm.hashtags, '{}') AS hashtags,
                    COALESCE(cpm.checklist_json, '{}'::jsonb) AS checklist_json,
                    cpm.published_url,
                    cpm.published_at,
                    cpm.export_path,
                    cpm.notes,
                    s.title AS source_title,
                    s.type AS source_type,
                    gc.filename AS clip_filename,
                    gc.file_path AS clip_file_path,
                    gc.clip_order,
                    gc.text AS clip_text,
                    gc.duration,
                    gc.virality_score,
                    COALESCE(cpm.created_at, gc.created_at) AS created_at,
                    COALESCE(cpm.updated_at, gc.updated_at) AS updated_at
                FROM generated_clips gc
                JOIN tasks t ON t.id = gc.task_id
                LEFT JOIN sources s ON s.id = t.source_id
                CROSS JOIN selected_platforms sp
                LEFT JOIN clip_publish_metadata cpm
                    ON cpm.clip_id = gc.id AND cpm.platform = sp.platform
                WHERE t.user_id = :user_id AND gc.id = :clip_id
            """),
            {"user_id": user_id, "clip_id": clip_id, "platform": platform},
        )
        row = result.fetchone()
        return self._row_to_dict(row) if row else None

    async def upsert_publish_metadata(
        self,
        db: AsyncSession,
        *,
        clip_id: str,
        task_id: str,
        platform: str,
        post_status: str,
        caption: str | None,
        hashtags: list[str],
        checklist: dict[str, Any],
        published_url: str | None,
        published_at: str | None,
        export_path: str | None,
        notes: str | None,
    ) -> dict[str, Any]:
        await db.execute(
            text("""
                INSERT INTO clip_publish_metadata (
                    id, clip_id, task_id, platform, post_status, caption, hashtags,
                    checklist_json, published_url, published_at, export_path, notes,
                    created_at, updated_at
                )
                VALUES (
                    :id, :clip_id, :task_id, :platform, :post_status, :caption,
                    CAST(:hashtags AS TEXT[]), CAST(:checklist_json AS JSONB),
                    :published_url,
                    CASE WHEN :published_at = '' THEN NULL ELSE CAST(:published_at AS TIMESTAMPTZ) END,
                    :export_path, :notes, NOW(), NOW()
                )
                ON CONFLICT (clip_id, platform)
                DO UPDATE SET
                    post_status = EXCLUDED.post_status,
                    caption = EXCLUDED.caption,
                    hashtags = EXCLUDED.hashtags,
                    checklist_json = EXCLUDED.checklist_json,
                    published_url = EXCLUDED.published_url,
                    published_at = EXCLUDED.published_at,
                    export_path = COALESCE(EXCLUDED.export_path, clip_publish_metadata.export_path),
                    notes = EXCLUDED.notes,
                    updated_at = NOW()
            """),
            {
                "id": str(uuid4()),
                "clip_id": clip_id,
                "task_id": task_id,
                "platform": platform,
                "post_status": post_status,
                "caption": caption,
                "hashtags": hashtags,
                "checklist_json": json.dumps(checklist),
                "published_url": published_url,
                "published_at": published_at or "",
                "export_path": export_path,
                "notes": notes,
            },
        )
        await db.commit()
        item = await self.get_publish_item(db, "", clip_id, platform)
        return item or {}

    async def update_export_path(
        self,
        db: AsyncSession,
        *,
        clip_id: str,
        task_id: str,
        platform: str,
        export_path: str,
    ) -> None:
        await db.execute(
            text("""
                INSERT INTO clip_publish_metadata (
                    id, clip_id, task_id, platform, checklist_json, export_path, created_at, updated_at
                )
                VALUES (
                    :id, :clip_id, :task_id, :platform,
                    '{"video_exported": true}'::jsonb, :export_path, NOW(), NOW()
                )
                ON CONFLICT (clip_id, platform)
                DO UPDATE SET
                    checklist_json = jsonb_set(
                        COALESCE(clip_publish_metadata.checklist_json, '{}'::jsonb),
                        '{video_exported}',
                        'true'::jsonb,
                        true
                    ),
                    export_path = EXCLUDED.export_path,
                    updated_at = NOW()
            """),
            {
                "id": str(uuid4()),
                "clip_id": clip_id,
                "task_id": task_id,
                "platform": platform,
                "export_path": export_path,
            },
        )
        await db.commit()
