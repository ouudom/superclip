"""Workflow preset service."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..repositories.workflow_repository import WorkflowRepository

DEFAULT_WORKFLOW_CONFIG = {
    "processing_mode": "fast",
    "output_format": "vertical",
    "add_subtitles": True,
    "include_broll": False,
    "cut_long_pauses": False,
    "pause_threshold_ms": 900,
    "remove_filler_words": False,
    "filtered_words": [],
    "target_candidates": 4,
    "steps": [
        {"key": "transcribe", "model_profile": "default_transcription"},
        {"key": "analyze", "prompt_version": "clip_candidates"},
        {"key": "review", "manual": True},
        {"key": "render", "render_profile": "final"},
    ],
}


class WorkflowService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.workflow_repo = WorkflowRepository()

    @staticmethod
    def parse_config(config_json: str | None) -> dict[str, Any]:
        if not config_json:
            return dict(DEFAULT_WORKFLOW_CONFIG)
        try:
            payload = json.loads(config_json)
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        return {**DEFAULT_WORKFLOW_CONFIG, **payload}

    @classmethod
    def serialize_config(cls, payload: Any) -> str:
        if not isinstance(payload, dict):
            payload = {}
        config = {**DEFAULT_WORKFLOW_CONFIG, **payload}
        return json.dumps(config, separators=(",", ":"))

    @classmethod
    def workflow_response(cls, workflow: dict[str, Any]) -> dict[str, Any]:
        return {
            **workflow,
            "config": cls.parse_config(workflow.get("config_json")),
        }

    @staticmethod
    def _clean_text(value: Any, max_length: int, default: str = "") -> str:
        cleaned = str(value or default).strip()
        return cleaned[:max_length]

    async def list_workflows(self) -> list[dict[str, Any]]:
        workflows = await self.workflow_repo.list_workflows(self.db)
        return [self.workflow_response(workflow) for workflow in workflows]

    async def get_workflow(self, workflow_id: str) -> dict[str, Any] | None:
        workflow = await self.workflow_repo.get_workflow(self.db, workflow_id)
        return self.workflow_response(workflow) if workflow else None

    async def get_workflow_config(self, workflow_id: str | None) -> dict[str, Any]:
        if not workflow_id:
            return {}
        workflow = await self.workflow_repo.get_workflow(self.db, workflow_id)
        if not workflow:
            return {}
        return self.parse_config(workflow.get("config_json"))

    async def save_workflow(
        self,
        payload: dict[str, Any],
        *,
        updated_by: str | None,
        workflow_id: str | None = None,
    ) -> dict[str, Any]:
        name = self._clean_text(payload.get("name"), 120)
        if not name:
            raise ValueError("Workflow name is required")
        config = payload.get("config")
        if config is None and isinstance(payload.get("config_json"), str):
            config_json = payload["config_json"]
        else:
            config_json = self.serialize_config(config)
        source_type = self._clean_text(payload.get("source_type"), 40, "youtube") or "youtube"
        output_target = self._clean_text(payload.get("output_target"), 40, "shorts") or "shorts"
        description = self._clean_text(payload.get("description"), 2000) or None
        is_default = bool(payload.get("is_default"))

        if workflow_id:
            workflow = await self.workflow_repo.update_workflow(
                self.db,
                workflow_id,
                name=name,
                description=description,
                source_type=source_type,
                output_target=output_target,
                config_json=config_json,
                is_default=is_default,
                updated_by=updated_by,
            )
            if not workflow:
                raise ValueError("Workflow not found")
            return self.workflow_response(workflow)

        workflow = await self.workflow_repo.create_workflow(
            self.db,
            name=name,
            description=description,
            source_type=source_type,
            output_target=output_target,
            config_json=config_json,
            is_default=is_default,
            updated_by=updated_by,
        )
        return self.workflow_response(workflow)

    async def delete_workflow(self, workflow_id: str) -> bool:
        return await self.workflow_repo.delete_workflow(self.db, workflow_id)
