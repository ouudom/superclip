"""
Task artifact repository for durable per-task pipeline resume data.
"""

from typing import Any, Dict, Optional
from uuid import uuid4
import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class TaskArtifactRepository:
    """Persist task-scoped artifacts like downloaded video, transcript, and analysis."""

    @staticmethod
    async def upsert_artifact(
        db: AsyncSession,
        task_id: str,
        artifact_type: str,
        *,
        text_value: Optional[str] = None,
        json_value: Optional[Dict[str, Any] | list[Any]] = None,
        file_path: Optional[str] = None,
    ) -> None:
        await db.execute(
            text(
                """
                INSERT INTO task_artifacts (
                    id, task_id, artifact_type, text_value, json_value, file_path, created_at, updated_at
                )
                VALUES (
                    :id, :task_id, :artifact_type, :text_value, CAST(:json_value AS JSONB), :file_path, NOW(), NOW()
                )
                ON CONFLICT (task_id, artifact_type)
                DO UPDATE SET
                    text_value = COALESCE(EXCLUDED.text_value, task_artifacts.text_value),
                    json_value = COALESCE(EXCLUDED.json_value, task_artifacts.json_value),
                    file_path = COALESCE(EXCLUDED.file_path, task_artifacts.file_path),
                    updated_at = NOW()
                """
            ),
            {
                "id": str(uuid4()),
                "task_id": task_id,
                "artifact_type": artifact_type,
                "text_value": text_value,
                "json_value": json.dumps(json_value) if json_value is not None else None,
                "file_path": file_path,
            },
        )
        await db.commit()

    @staticmethod
    async def get_artifacts_by_task(
        db: AsyncSession, task_id: str
    ) -> Dict[str, Dict[str, Any]]:
        result = await db.execute(
            text(
                """
                SELECT artifact_type, text_value, json_value, file_path, updated_at
                FROM task_artifacts
                WHERE task_id = :task_id
                """
            ),
            {"task_id": task_id},
        )

        artifacts: Dict[str, Dict[str, Any]] = {}
        for row in result.fetchall():
            artifacts[row.artifact_type] = {
                "text_value": row.text_value,
                "json_value": row.json_value,
                "file_path": row.file_path,
                "updated_at": row.updated_at,
            }
        return artifacts
