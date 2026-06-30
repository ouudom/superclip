"""Workflow preset repository."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class WorkflowRepository:
    @staticmethod
    def _row_to_dict(row: Any) -> dict[str, Any]:
        return {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "source_type": row.source_type,
            "output_target": row.output_target,
            "config_json": row.config_json,
            "is_default": bool(row.is_default),
            "updated_by": row.updated_by,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    async def list_workflows(self, db: AsyncSession) -> list[dict[str, Any]]:
        result = await db.execute(
            text("""
                SELECT id, name, description, source_type, output_target, config_json,
                       is_default, updated_by, created_at, updated_at
                FROM workflows
                ORDER BY is_default DESC, name ASC
            """)
        )
        return [self._row_to_dict(row) for row in result.fetchall()]

    async def get_workflow(self, db: AsyncSession, workflow_id: str) -> dict[str, Any] | None:
        result = await db.execute(
            text("""
                SELECT id, name, description, source_type, output_target, config_json,
                       is_default, updated_by, created_at, updated_at
                FROM workflows
                WHERE id = :workflow_id
            """),
            {"workflow_id": workflow_id},
        )
        row = result.fetchone()
        return self._row_to_dict(row) if row else None

    async def create_workflow(
        self,
        db: AsyncSession,
        *,
        name: str,
        description: str | None,
        source_type: str,
        output_target: str,
        config_json: str,
        is_default: bool,
        updated_by: str | None,
    ) -> dict[str, Any]:
        workflow_id = str(uuid4())
        if is_default:
            await db.execute(text("UPDATE workflows SET is_default = false"))
        await db.execute(
            text("""
                INSERT INTO workflows (
                    id, name, description, source_type, output_target, config_json,
                    is_default, updated_by, created_at, updated_at
                )
                VALUES (
                    :id, :name, :description, :source_type, :output_target, :config_json,
                    :is_default, :updated_by, NOW(), NOW()
                )
            """),
            {
                "id": workflow_id,
                "name": name,
                "description": description,
                "source_type": source_type,
                "output_target": output_target,
                "config_json": config_json,
                "is_default": is_default,
                "updated_by": updated_by,
            },
        )
        await db.commit()
        workflow = await self.get_workflow(db, workflow_id)
        if not workflow:
            raise RuntimeError("Workflow was not saved")
        return workflow

    async def update_workflow(
        self,
        db: AsyncSession,
        workflow_id: str,
        *,
        name: str,
        description: str | None,
        source_type: str,
        output_target: str,
        config_json: str,
        is_default: bool,
        updated_by: str | None,
    ) -> dict[str, Any] | None:
        if is_default:
            await db.execute(
                text("UPDATE workflows SET is_default = false WHERE id <> :workflow_id"),
                {"workflow_id": workflow_id},
            )
        result = await db.execute(
            text("""
                UPDATE workflows
                SET name = :name,
                    description = :description,
                    source_type = :source_type,
                    output_target = :output_target,
                    config_json = :config_json,
                    is_default = :is_default,
                    updated_by = :updated_by,
                    updated_at = NOW()
                WHERE id = :workflow_id
            """),
            {
                "workflow_id": workflow_id,
                "name": name,
                "description": description,
                "source_type": source_type,
                "output_target": output_target,
                "config_json": config_json,
                "is_default": is_default,
                "updated_by": updated_by,
            },
        )
        await db.commit()
        if result.rowcount == 0:
            return None
        return await self.get_workflow(db, workflow_id)

    async def delete_workflow(self, db: AsyncSession, workflow_id: str) -> bool:
        result = await db.execute(
            text("DELETE FROM workflows WHERE id = :workflow_id"),
            {"workflow_id": workflow_id},
        )
        await db.commit()
        return result.rowcount > 0
