"""Agent workspace service."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..repositories.agent_repository import AgentRepository
from ..repositories.task_artifact_repository import TaskArtifactRepository
from .task_service import TaskService


AGENT_TEMPLATES: dict[str, dict[str, str]] = {
    "diagnose_failed_task": {
        "name": "Diagnose Failed Task",
        "description": "Explain failure cause and propose exact resume/retry fix.",
        "agent_type": "codex",
    },
    "improve_clip_candidates": {
        "name": "Improve Clip Candidates",
        "description": "Review transcript/candidates and propose stronger Shorts/Reels/TikTok cuts.",
        "agent_type": "claude",
    },
    "generate_workflow": {
        "name": "Generate Workflow",
        "description": "Create a reusable workflow preset from this source and content goal.",
        "agent_type": "claude",
    },
    "content_pattern": {
        "name": "Content Pattern",
        "description": "Extract hooks, topics, audience promises, series ideas, and posting angles.",
        "agent_type": "claude",
    },
    "implementation_prompt": {
        "name": "Implementation Prompt",
        "description": "Prepare a Codex-ready implementation brief for improving this project.",
        "agent_type": "codex",
    },
}


class AgentService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = AgentRepository()
        self.task_service = TaskService(db)
        self.artifact_repo = TaskArtifactRepository()

    @staticmethod
    def list_templates() -> list[dict[str, str]]:
        return [{"key": key, **value} for key, value in AGENT_TEMPLATES.items()]

    @staticmethod
    def _safe_json(value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value

    @staticmethod
    def _format_json(payload: Any) -> str:
        return json.dumps(payload, indent=2, ensure_ascii=False, default=str)

    async def build_task_context(self, user_id: str, task_id: str) -> dict[str, Any]:
        task = await self.task_service.get_task_with_clips(task_id)
        if not task or task.get("user_id") != user_id:
            raise ValueError("Task not found")

        artifacts = await self.artifact_repo.get_artifacts_by_task(self.db, task_id)
        context_artifacts: dict[str, Any] = {}
        for artifact_type, artifact in artifacts.items():
            context_artifacts[artifact_type] = {
                "text_value": artifact.get("text_value"),
                "json_value": artifact.get("json_value"),
                "file_path": artifact.get("file_path"),
                "updated_at": artifact.get("updated_at"),
            }

        return {
            "task": {
                key: value
                for key, value in task.items()
                if key
                not in {
                    "stages",
                    "clips",
                    "clip_candidates",
                }
            },
            "stages": task.get("stages"),
            "clip_candidates": task.get("clip_candidates", []),
            "clips": task.get("clips", []),
            "artifacts": context_artifacts,
        }

    def build_context_markdown(self, context: dict[str, Any]) -> str:
        task = context.get("task") or {}
        clips = context.get("clips") or []
        candidates = context.get("clip_candidates") or []
        artifacts = context.get("artifacts") or {}
        transcript = (artifacts.get("transcript") or {}).get("text_value") or ""
        transcript_preview = transcript[:6000]

        lines = [
            f"# SupoClip Task Context: {task.get('source_title') or task.get('id')}",
            "",
            "## Task",
            self._format_json(task),
            "",
            "## Stages",
            self._format_json(context.get("stages") or {}),
            "",
            "## Clip Candidates",
            self._format_json(candidates[:12]),
            "",
            "## Rendered Clips",
            self._format_json(clips[:20]),
            "",
            "## Transcript Preview",
            transcript_preview or "(none)",
        ]
        if transcript and len(transcript) > len(transcript_preview):
            lines.append("\n[Transcript truncated for prompt handoff.]")
        return "\n".join(lines)

    def build_prompt(
        self,
        *,
        template_key: str,
        context: dict[str, Any],
        goal: str | None = None,
    ) -> str:
        if template_key not in AGENT_TEMPLATES:
            raise ValueError("Unknown agent template")
        goal_text = (goal or "").strip() or "Improve this personal self-hosted content engine."
        context_markdown = self.build_context_markdown(context)

        instructions = {
            "diagnose_failed_task": (
                "Find root cause. Explain failed stage. Give resume/retry path that preserves existing artifacts. "
                "List exact code or ops changes if needed."
            ),
            "improve_clip_candidates": (
                "Select stronger clips for TikTok/Reels/Shorts. Prefer hooks, tension, useful insight, clean boundaries. "
                "Return JSON array with start_time, end_time, title, reason, score, platform_angle."
            ),
            "generate_workflow": (
                "Create reusable SupoClip workflow JSON. Include processing_mode, output_format, target_candidates, "
                "prompt guidance, library metadata, and review/render steps."
            ),
            "content_pattern": (
                "Extract repeatable content patterns: hooks, pillars, series, title formulas, CTA ideas, and repurpose plan."
            ),
            "implementation_prompt": (
                "Write Codex implementation prompt. Include objective, constraints, affected files, acceptance checks, "
                "migration impact, and risks."
            ),
        }[template_key]

        return "\n\n".join(
            [
                "You are helping improve SupoClip, a personal self-hosted AI clipping engine.",
                f"Goal: {goal_text}",
                f"Task: {AGENT_TEMPLATES[template_key]['name']}",
                f"Instructions: {instructions}",
                "Return concise, actionable output. Preserve existing task artifacts. Do not suggest SaaS/team/billing features.",
                context_markdown,
            ]
        )

    async def create_run(
        self,
        *,
        user_id: str,
        template_key: str,
        task_id: str | None,
        goal: str | None,
        output_text: str | None = None,
    ) -> dict[str, Any]:
        if template_key not in AGENT_TEMPLATES:
            raise ValueError("Unknown agent template")
        context = (
            await self.build_task_context(user_id, task_id)
            if task_id
            else {"task": None, "clips": [], "clip_candidates": [], "artifacts": {}}
        )
        prompt_text = self.build_prompt(
            template_key=template_key, context=context, goal=goal
        )
        template = AGENT_TEMPLATES[template_key]
        title_source = (context.get("task") or {}).get("source_title") or "Project"
        agent_task = await self.repo.create_agent_task(
            self.db,
            user_id=user_id,
            task_id=task_id,
            title=f"{template['name']}: {title_source}"[:180],
            agent_type=template["agent_type"],
            status="completed" if output_text else "draft",
        )
        run = await self.repo.create_run(
            self.db,
            user_id=user_id,
            agent_task_id=agent_task["id"],
            task_id=task_id,
            agent_key=template_key,
            status="completed" if output_text else "draft",
            prompt_text=prompt_text,
            context_json=context,
            output_text=output_text,
        )
        await self.repo.create_artifact(
            self.db,
            agent_run_id=run["id"],
            artifact_type="prompt",
            text_value=prompt_text,
        )
        return run

    async def list_runs(
        self, user_id: str, *, task_id: str | None = None, limit: int = 30
    ) -> list[dict[str, Any]]:
        return await self.repo.list_runs(self.db, user_id, task_id=task_id, limit=limit)

    async def get_run(self, user_id: str, run_id: str) -> dict[str, Any] | None:
        return await self.repo.get_run(self.db, user_id, run_id)

    async def update_run(
        self,
        *,
        user_id: str,
        run_id: str,
        status: str | None,
        output_text: str | None,
        error_message: str | None,
    ) -> dict[str, Any] | None:
        run = await self.repo.update_run(
            self.db,
            user_id=user_id,
            run_id=run_id,
            status=status,
            output_text=output_text,
            error_message=error_message,
        )
        if run and output_text:
            await self.repo.create_artifact(
                self.db,
                agent_run_id=run_id,
                artifact_type="output",
                text_value=output_text,
            )
        return run
