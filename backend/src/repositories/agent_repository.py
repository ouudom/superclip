"""Agent workspace repository."""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class AgentRepository:
    @staticmethod
    def _task_row(row: Any) -> dict[str, Any]:
        return {
            "id": row.id,
            "user_id": row.user_id,
            "task_id": row.task_id,
            "title": row.title,
            "agent_type": row.agent_type,
            "status": row.status,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    def _run_row(row: Any) -> dict[str, Any]:
        return {
            "id": row.id,
            "agent_task_id": row.agent_task_id,
            "user_id": row.user_id,
            "task_id": row.task_id,
            "agent_key": row.agent_key,
            "status": row.status,
            "prompt_text": row.prompt_text,
            "context_json": row.context_json,
            "output_text": row.output_text,
            "error_message": row.error_message,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "agent_task_title": getattr(row, "agent_task_title", None),
        }

    async def list_runs(
        self, db: AsyncSession, user_id: str, *, task_id: str | None = None, limit: int = 30
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"user_id": user_id, "limit": max(1, min(limit, 100))}
        where = "ar.user_id = :user_id"
        if task_id:
            where += " AND ar.task_id = :task_id"
            params["task_id"] = task_id
        result = await db.execute(
            text(f"""
                SELECT ar.*, at.title AS agent_task_title
                FROM agent_runs ar
                LEFT JOIN agent_tasks at ON at.id = ar.agent_task_id
                WHERE {where}
                ORDER BY ar.created_at DESC
                LIMIT :limit
            """),
            params,
        )
        return [self._run_row(row) for row in result.fetchall()]

    async def get_run(
        self, db: AsyncSession, user_id: str, run_id: str
    ) -> dict[str, Any] | None:
        result = await db.execute(
            text("""
                SELECT ar.*, at.title AS agent_task_title
                FROM agent_runs ar
                LEFT JOIN agent_tasks at ON at.id = ar.agent_task_id
                WHERE ar.id = :run_id AND ar.user_id = :user_id
            """),
            {"run_id": run_id, "user_id": user_id},
        )
        row = result.fetchone()
        return self._run_row(row) if row else None

    async def create_agent_task(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        task_id: str | None,
        title: str,
        agent_type: str,
        status: str = "draft",
    ) -> dict[str, Any]:
        agent_task_id = str(uuid4())
        await db.execute(
            text("""
                INSERT INTO agent_tasks (
                    id, user_id, task_id, title, agent_type, status, created_at, updated_at
                )
                VALUES (
                    :id, :user_id, :task_id, :title, :agent_type, :status, NOW(), NOW()
                )
            """),
            {
                "id": agent_task_id,
                "user_id": user_id,
                "task_id": task_id,
                "title": title,
                "agent_type": agent_type,
                "status": status,
            },
        )
        await db.commit()
        result = await db.execute(
            text("SELECT * FROM agent_tasks WHERE id = :id"),
            {"id": agent_task_id},
        )
        row = result.fetchone()
        if not row:
            raise RuntimeError("Agent task was not saved")
        return self._task_row(row)

    async def create_run(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        agent_task_id: str,
        task_id: str | None,
        agent_key: str,
        status: str,
        prompt_text: str,
        context_json: dict[str, Any],
        output_text: str | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        run_id = str(uuid4())
        await db.execute(
            text("""
                INSERT INTO agent_runs (
                    id, agent_task_id, user_id, task_id, agent_key, status,
                    prompt_text, context_json, output_text, error_message,
                    created_at, updated_at
                )
                VALUES (
                    :id, :agent_task_id, :user_id, :task_id, :agent_key, :status,
                    :prompt_text, CAST(:context_json AS JSONB), :output_text, :error_message,
                    NOW(), NOW()
                )
            """),
            {
                "id": run_id,
                "agent_task_id": agent_task_id,
                "user_id": user_id,
                "task_id": task_id,
                "agent_key": agent_key,
                "status": status,
                "prompt_text": prompt_text,
                "context_json": json.dumps(context_json, default=str),
                "output_text": output_text,
                "error_message": error_message,
            },
        )
        await db.commit()
        run = await self.get_run(db, user_id, run_id)
        if not run:
            raise RuntimeError("Agent run was not saved")
        return run

    async def update_run(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        run_id: str,
        status: str | None = None,
        output_text: str | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any] | None:
        result = await db.execute(
            text("""
                UPDATE agent_runs
                SET status = COALESCE(:status, status),
                    output_text = COALESCE(:output_text, output_text),
                    error_message = COALESCE(:error_message, error_message),
                    updated_at = NOW()
                WHERE id = :run_id AND user_id = :user_id
                RETURNING *
            """),
            {
                "run_id": run_id,
                "user_id": user_id,
                "status": status,
                "output_text": output_text,
                "error_message": error_message,
            },
        )
        row = result.fetchone()
        if row and status:
            await db.execute(
                text("""
                    UPDATE agent_tasks
                    SET status = :status, updated_at = NOW()
                    WHERE id = :agent_task_id AND user_id = :user_id
                """),
                {
                    "status": status,
                    "agent_task_id": row.agent_task_id,
                    "user_id": user_id,
                },
            )
        await db.commit()
        return self._run_row(row) if row else None

    async def create_artifact(
        self,
        db: AsyncSession,
        *,
        agent_run_id: str,
        artifact_type: str,
        text_value: str | None = None,
        json_value: dict[str, Any] | list[Any] | None = None,
        file_path: str | None = None,
    ) -> dict[str, Any]:
        artifact_id = str(uuid4())
        await db.execute(
            text("""
                INSERT INTO agent_artifacts (
                    id, agent_run_id, artifact_type, text_value, json_value, file_path,
                    created_at, updated_at
                )
                VALUES (
                    :id, :agent_run_id, :artifact_type, :text_value,
                    CAST(:json_value AS JSONB), :file_path, NOW(), NOW()
                )
            """),
            {
                "id": artifact_id,
                "agent_run_id": agent_run_id,
                "artifact_type": artifact_type,
                "text_value": text_value,
                "json_value": json.dumps(json_value) if json_value is not None else None,
                "file_path": file_path,
            },
        )
        await db.commit()
        return {"id": artifact_id, "agent_run_id": agent_run_id}
