"""
Task service - orchestrates task creation and processing workflow.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Dict, Any, Optional, Callable
import logging
from datetime import datetime
from pathlib import Path
import json
import hashlib
from time import perf_counter

import redis.asyncio as redis

from ..repositories.task_repository import TaskRepository
from ..repositories.source_repository import SourceRepository
from ..repositories.clip_repository import ClipRepository
from ..repositories.cache_repository import CacheRepository
from ..repositories.task_artifact_repository import TaskArtifactRepository
from .video_service import VideoService
from ..config import Config, get_config
from ..clip_editor import (
    trim_clip_file,
    split_clip_file,
    merge_clip_files,
    overlay_custom_captions,
)
from ..video_utils import VALID_OUTPUT_FORMATS, parse_timestamp_to_seconds
from ..clip_cleanup import normalize_clip_cleanup_settings
from ..ai import TRANSCRIPT_ANALYSIS_CACHE_VERSION
from ..clip_source_map import (
    copy_clip_source_ranges,
    load_clip_source_ranges,
    save_clip_source_ranges,
    source_range_bounds,
    split_source_ranges,
    total_source_duration,
    trim_source_ranges,
)

logger = logging.getLogger(__name__)

TASK_STAGE_LABELS = {
    "queue": "Queue",
    "download": "Download",
    "transcribe": "Transcribe",
    "analyze": "Analyze",
    "render": "Render",
    "complete": "Complete",
}


class TaskService:
    """Service for task workflow orchestration."""

    def __init__(self, db: AsyncSession, config: Config | None = None):
        self.db = db
        self.task_repo = TaskRepository()
        self.source_repo = SourceRepository()
        self.clip_repo = ClipRepository()
        self.cache_repo = CacheRepository()
        self.artifact_repo = TaskArtifactRepository()
        self.video_service = VideoService()
        self.config = config or get_config()

    @staticmethod
    def _build_cache_key(url: str, source_type: str, processing_mode: str) -> str:
        payload = (
            f"{source_type}|{processing_mode}|"
            f"{TRANSCRIPT_ANALYSIS_CACHE_VERSION}|{url.strip()}"
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _is_stale_queued_task(self, task: Dict[str, Any]) -> bool:
        """Detect queued tasks that have likely stalled due to worker issues."""
        if task.get("status") != "queued":
            return False

        created_at = task.get("created_at")
        updated_at = task.get("updated_at") or created_at

        if not created_at or not updated_at:
            return False

        now = (
            datetime.now(updated_at.tzinfo)
            if getattr(updated_at, "tzinfo", None)
            else datetime.utcnow()
        )
        age_seconds = (now - updated_at).total_seconds()
        return age_seconds >= self.config.queued_task_timeout_seconds

    @staticmethod
    def _stage_for_progress(progress: int, message: str = "") -> str:
        normalized = (message or "").lower()
        if "download" in normalized:
            return "download"
        if "analyz" in normalized or "usable clip" in normalized or "no clip" in normalized:
            return "analyze"
        if "transcript" in normalized:
            return "transcribe"
        if "clip" in normalized or "render" in normalized or progress >= 70:
            return "render"
        if progress >= 50:
            return "analyze"
        if progress >= 30:
            return "transcribe"
        if progress >= 10:
            return "download"
        return "queue"

    @classmethod
    def _stage_progress_payload(
        cls, current_stage: str, progress: int, failed_stage: Optional[str] = None
    ) -> str:
        stages = ["queue", "download", "transcribe", "analyze", "render", "complete"]
        current_index = stages.index(current_stage) if current_stage in stages else 0
        payload: Dict[str, Dict[str, Any]] = {}
        for index, stage in enumerate(stages):
            state = "pending"
            if current_stage == "complete" or index < current_index:
                state = "done"
            elif index == current_index:
                state = "active"
            if failed_stage == stage:
                state = "failed"
            payload[stage] = {"state": state, "progress": progress if index == current_index else None}
        return json.dumps(payload)

    @classmethod
    def stage_progress_dict(
        cls, current_stage: str, progress: int, failed_stage: Optional[str] = None
    ) -> Dict[str, Dict[str, Any]]:
        return json.loads(cls._stage_progress_payload(current_stage, progress, failed_stage))

    @staticmethod
    def resume_action_label(task: Dict[str, Any]) -> str:
        stage = task.get("resume_from_stage") or task.get("failed_stage")
        label = TASK_STAGE_LABELS.get(str(stage), "Last Stage")
        if task.get("status") == "cancelled":
            return f"Resume from {label}"
        return f"Retry from {label}"

    @staticmethod
    def _artifact_text(artifact: Optional[Dict[str, Any]]) -> Optional[str]:
        if not artifact:
            return None
        value = artifact.get("text_value")
        return value if isinstance(value, str) and value else None

    @staticmethod
    def _artifact_file_path(artifact: Optional[Dict[str, Any]]) -> Optional[str]:
        if not artifact:
            return None
        value = artifact.get("file_path")
        return value if isinstance(value, str) and value else None

    @staticmethod
    def _artifact_json(artifact: Optional[Dict[str, Any]]) -> Any:
        if not artifact:
            return None
        return artifact.get("json_value")

    @staticmethod
    def validate_candidate_segments(
        candidates: Any,
        allowed_candidates: Optional[list[Dict[str, Any]]] = None,
    ) -> list[Dict[str, Any]]:
        """Normalize edited render candidates before saving or rendering."""
        if not isinstance(candidates, list):
            raise ValueError("edited_candidates must be an array")

        allowed_by_order = {}
        if allowed_candidates:
            allowed_by_order = {
                index + 1: candidate
                for index, candidate in enumerate(allowed_candidates)
                if isinstance(candidate, dict)
            }

        normalized: list[Dict[str, Any]] = []
        seen_orders: set[int] = set()
        for index, candidate in enumerate(candidates, start=1):
            if not isinstance(candidate, dict):
                raise ValueError("Each edited candidate must be an object")

            raw_order = candidate.get("candidate_order") or index
            try:
                candidate_order = int(raw_order)
            except (TypeError, ValueError):
                raise ValueError("candidate_order must be a number")
            if candidate_order <= 0 or candidate_order in seen_orders:
                raise ValueError("candidate_order must be unique and positive")
            seen_orders.add(candidate_order)

            base = allowed_by_order.get(candidate_order, {})
            start_time = str(candidate.get("start_time") or base.get("start_time") or "").strip()
            end_time = str(candidate.get("end_time") or base.get("end_time") or "").strip()
            if not start_time or not end_time:
                raise ValueError("Edited candidates need start_time and end_time")

            start_seconds = parse_timestamp_to_seconds(start_time)
            end_seconds = parse_timestamp_to_seconds(end_time)
            if end_seconds <= start_seconds:
                raise ValueError(
                    f"Candidate {candidate_order} end_time must be after start_time"
                )
            if end_seconds - start_seconds < 3:
                raise ValueError(
                    f"Candidate {candidate_order} must be at least 3 seconds long"
                )

            normalized.append(
                {
                    **base,
                    "candidate_order": candidate_order,
                    "start_time": start_time,
                    "end_time": end_time,
                    "text": str(candidate.get("text") or base.get("text") or "").strip(),
                    "reasoning": str(
                        candidate.get("reasoning") or base.get("reasoning") or ""
                    ).strip(),
                    "relevance_score": candidate.get(
                        "relevance_score", base.get("relevance_score", 0.0)
                    ),
                    "virality_score": candidate.get(
                        "virality_score", base.get("virality_score", 0)
                    ),
                    "hook_score": candidate.get("hook_score", base.get("hook_score", 0)),
                    "engagement_score": candidate.get(
                        "engagement_score", base.get("engagement_score", 0)
                    ),
                    "value_score": candidate.get(
                        "value_score", base.get("value_score", 0)
                    ),
                    "shareability_score": candidate.get(
                        "shareability_score", base.get("shareability_score", 0)
                    ),
                    "hook_type": candidate.get("hook_type", base.get("hook_type")),
                }
            )

        if not normalized:
            raise ValueError("Select at least one candidate to render")

        normalized.sort(key=lambda item: int(item["candidate_order"]))
        return normalized

    async def create_task_with_source(
        self,
        user_id: str,
        url: str,
        title: Optional[str] = None,
        font_family: str = "TikTokSans-Regular",
        font_size: int = 24,
        font_color: str = "#FFFFFF",
        caption_template: str = "default",
        include_broll: bool = False,
        processing_mode: str = "fast",
    ) -> str:
        """
        Create a new task with associated source.
        Returns the task ID.
        """
        # Validate user exists
        if not await self.task_repo.user_exists(self.db, user_id):
            raise ValueError(f"User {user_id} not found")

        # Determine source type
        source_type = self.video_service.determine_source_type(url)

        # Get or generate title
        if not title:
            if source_type == "youtube":
                title = await self.video_service.get_video_title(url)
            elif source_type == "local_watch":
                title = Path(url.removeprefix("watch://")).stem or "Watched Video"
            else:
                title = "Uploaded Video"

        # Create source
        source_id = await self.source_repo.create_source(
            self.db, source_type=source_type, title=title, url=url
        )

        # Create task
        task_id = await self.task_repo.create_task(
            self.db,
            user_id=user_id,
            source_id=source_id,
            status="queued",  # Changed from "processing" to "queued"
            font_family=font_family,
            font_size=font_size,
            font_color=font_color,
            caption_template=caption_template,
            include_broll=include_broll,
            processing_mode=processing_mode,
        )

        logger.info(f"Created task {task_id} for user {user_id}")
        return task_id

    async def process_task(
        self,
        task_id: str,
        url: str,
        source_type: str,
        font_family: str = "TikTokSans-Regular",
        font_size: int = 24,
        font_color: str = "#FFFFFF",
        caption_template: str = "default",
        processing_mode: str = "fast",
        output_format: str = "vertical",
        add_subtitles: bool = True,
        progress_callback: Optional[Callable] = None,
        should_cancel: Optional[Callable] = None,
        clip_ready_callback: Optional[Callable] = None,
        cleanup_settings: Optional[Dict[str, Any]] = None,
        render_candidates: bool = False,
        selected_candidate_orders: Optional[list[int]] = None,
        edited_candidate_segments: Optional[list[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Process a task: download video, analyze, create clips.
        Returns processing results.
        """
        try:
            logger.info(f"Starting processing for task {task_id}")
            started_at = datetime.utcnow()
            stage_timings: Dict[str, float] = {}
            cache_key = self._build_cache_key(url, source_type, processing_mode)

            cache_entry = await self.cache_repo.get_cache(self.db, cache_key)
            artifacts = await self.artifact_repo.get_artifacts_by_task(
                self.db, task_id
            )
            artifact_video_path = self._artifact_file_path(artifacts.get("video_path"))
            if artifact_video_path and not Path(artifact_video_path).exists():
                logger.warning(
                    "Saved video artifact for task %s is missing: %s",
                    task_id,
                    artifact_video_path,
                )
                artifact_video_path = None
            cached_transcript = (
                self._artifact_text(artifacts.get("transcript"))
                or (cache_entry.get("transcript_text") if cache_entry else None)
            )
            cached_analysis_json = (
                self._artifact_text(artifacts.get("analysis"))
                or (cache_entry.get("analysis_json") if cache_entry else None)
            )
            saved_render_segments = self._artifact_json(artifacts.get("render_segments"))
            cache_hit = bool(
                cache_entry
                and cache_entry.get("transcript_text")
                and cache_entry.get("analysis_json")
            )

            if cached_transcript and not self._artifact_text(artifacts.get("transcript")):
                await self.artifact_repo.upsert_artifact(
                    self.db,
                    task_id,
                    "transcript",
                    text_value=cached_transcript,
                )
            if cached_analysis_json and not self._artifact_text(artifacts.get("analysis")):
                try:
                    analysis_payload = json.loads(cached_analysis_json)
                except json.JSONDecodeError:
                    analysis_payload = None
                await self.artifact_repo.upsert_artifact(
                    self.db,
                    task_id,
                    "analysis",
                    text_value=cached_analysis_json,
                    json_value=analysis_payload,
                )

            await self.task_repo.update_task_runtime_metadata(
                self.db,
                task_id,
                started_at=started_at,
                cache_hit=cache_hit,
            )

            # Update status to processing
            await self.task_repo.update_task_status(
                self.db,
                task_id,
                "processing",
                progress=0,
                progress_message="Starting...",
                current_stage="queue",
                failed_stage="",
                stage_progress_json=self._stage_progress_payload("queue", 0),
            )

            # Progress callback wrapper
            async def update_progress(
                progress: int, message: str, status: str = "processing"
            ):
                current_stage = (
                    "complete"
                    if status == "completed"
                    else self._stage_for_progress(progress, message)
                )
                await self.task_repo.update_task_status(
                    self.db,
                    task_id,
                    status,
                    progress=progress,
                    progress_message=message,
                    current_stage=current_stage,
                    stage_progress_json=self._stage_progress_payload(
                        current_stage, progress
                    ),
                )
                if progress_callback:
                    await progress_callback(
                        progress,
                        message,
                        status,
                        {
                            "current_stage": current_stage,
                            "failed_stage": None,
                            "resume_from_stage": None,
                            "stages": self.stage_progress_dict(
                                current_stage, progress
                            ),
                        },
                    )

            async def save_artifact(artifact_type: str, payload: Dict[str, Any]):
                await self.artifact_repo.upsert_artifact(
                    self.db,
                    task_id,
                    artifact_type,
                    text_value=payload.get("text_value"),
                    json_value=payload.get("json_value"),
                    file_path=payload.get("file_path"),
                )

            # Process video with progress updates
            pipeline_start = perf_counter()
            result = await self.video_service.process_video_complete(
                url=url,
                source_type=source_type,
                task_id=task_id,
                font_family=font_family,
                font_size=font_size,
                font_color=font_color,
                caption_template=caption_template,
                processing_mode=processing_mode,
                output_format=output_format,
                add_subtitles=add_subtitles,
                cached_video_path=artifact_video_path,
                cached_transcript=cached_transcript,
                cached_analysis_json=cached_analysis_json,
                progress_callback=update_progress,
                artifact_callback=save_artifact,
                should_cancel=should_cancel,
            )
            stage_timings["pipeline_seconds"] = round(
                perf_counter() - pipeline_start, 3
            )

            normalized_cleanup_settings = normalize_clip_cleanup_settings(
                **(cleanup_settings or {})
            )

            # Render clips incrementally: render, save, notify one at a time
            segments_to_render = result.get("segments_to_render", [])
            if not segments_to_render:
                await self.cache_repo.upsert_cache(
                    self.db,
                    cache_key=cache_key,
                    source_url=url,
                    source_type=source_type,
                    video_path=result.get("video_path"),
                    transcript_text=result.get("transcript"),
                    analysis_json=None,
                )
                raise ValueError(
                    "No usable clip segments were selected for this video."
                )

            await self.cache_repo.upsert_cache(
                self.db,
                cache_key=cache_key,
                source_url=url,
                source_type=source_type,
                video_path=result.get("video_path"),
                transcript_text=result.get("transcript"),
                analysis_json=result.get("analysis_json"),
            )

            if not render_candidates:
                await self.task_repo.update_task_status(
                    self.db,
                    task_id,
                    "analysis_ready",
                    progress=70,
                    progress_message="Review clip candidates before rendering",
                    current_stage="analyze",
                    failed_stage="",
                    resume_from_stage="render",
                    stage_progress_json=self._stage_progress_payload("analyze", 70),
                )
                if progress_callback:
                    await progress_callback(
                        70,
                        "Review clip candidates before rendering",
                        "analysis_ready",
                        {
                            "current_stage": "analyze",
                            "resume_from_stage": "render",
                            "stages": self.stage_progress_dict("analyze", 70),
                        },
                    )

                return {
                    "task_id": task_id,
                    "status": "analysis_ready",
                    "candidates_count": len(segments_to_render),
                    "segments": result["segments"],
                    "summary": result.get("summary"),
                    "key_topics": result.get("key_topics"),
                }

            if edited_candidate_segments is not None:
                segments_to_render = self.validate_candidate_segments(
                    edited_candidate_segments,
                    segments_to_render,
                )
                await self.artifact_repo.upsert_artifact(
                    self.db,
                    task_id,
                    "render_segments",
                    json_value=segments_to_render,
                )
            elif render_candidates and isinstance(saved_render_segments, list):
                segments_to_render = self.validate_candidate_segments(
                    saved_render_segments,
                    segments_to_render,
                )

            selected_orders = {
                int(order)
                for order in (selected_candidate_orders or [])
                if isinstance(order, int) and order > 0
            }
            if selected_orders:
                filtered_segments = []
                for index, segment in enumerate(segments_to_render, start=1):
                    raw_order = segment.get("candidate_order", index)
                    try:
                        candidate_order = int(raw_order)
                    except (TypeError, ValueError):
                        candidate_order = index
                    if candidate_order in selected_orders:
                        filtered_segments.append(segment)
                segments_to_render = filtered_segments
                if not segments_to_render:
                    raise ValueError("No selected clip candidates are available to render.")

            video_path = Path(result["video_path"])
            total_clips = len(segments_to_render)
            clips_output_dir = Path(self.config.temp_dir) / "clips"
            clips_output_dir.mkdir(parents=True, exist_ok=True)

            existing_clips = await self.clip_repo.get_clips_by_task(self.db, task_id)
            existing_by_order = {
                int(clip.get("clip_order")): clip
                for clip in existing_clips
                if clip.get("clip_order") is not None
            }
            clip_ids = [clip["id"] for clip in existing_clips]
            render_start = perf_counter()

            for i, segment in enumerate(segments_to_render):
                clip_order = i + 1
                existing_clip = existing_by_order.get(clip_order)
                if existing_clip:
                    logger.info(
                        "Skipping render for task %s clip %s; existing clip %s found",
                        task_id,
                        clip_order,
                        existing_clip.get("id"),
                    )
                    continue

                # Check cancellation
                if should_cancel and await should_cancel():
                    raise Exception("Task cancelled")

                # Update progress: 70-95% spread across clips
                clip_progress = 70 + int(
                    ((i + 1) / total_clips) * 25
                ) if total_clips > 0 else 95
                await update_progress(
                    clip_progress,
                    f"Creating clip {clip_order}/{total_clips}...",
                )

                # Render single clip in thread pool
                clip_info = await self.video_service.create_single_clip(
                    video_path,
                    segment,
                    i,
                    clips_output_dir,
                    font_family,
                    font_size,
                    font_color,
                    caption_template,
                    output_format,
                    add_subtitles,
                    normalized_cleanup_settings,
                )
                if clip_info is None:
                    continue  # Skip failed clip

                # Save to DB immediately
                clip_id = await self.clip_repo.create_clip(
                    self.db,
                    task_id=task_id,
                    filename=clip_info["filename"],
                    file_path=clip_info["path"],
                    start_time=clip_info["start_time"],
                    end_time=clip_info["end_time"],
                    duration=clip_info["duration"],
                    text=clip_info.get("text", ""),
                    relevance_score=clip_info.get("relevance_score", 0.0),
                    reasoning=clip_info.get("reasoning", ""),
                    clip_order=clip_order,
                    virality_score=clip_info.get("virality_score", 0),
                    hook_score=clip_info.get("hook_score", 0),
                    engagement_score=clip_info.get("engagement_score", 0),
                    value_score=clip_info.get("value_score", 0),
                    shareability_score=clip_info.get("shareability_score", 0),
                    hook_type=clip_info.get("hook_type"),
                )
                await self.db.commit()
                clip_ids.append(clip_id)

                # Update task's clip IDs array
                await self.task_repo.update_task_clips(self.db, task_id, clip_ids)

                # Notify frontend via SSE
                if clip_ready_callback:
                    clip_record = await self.clip_repo.get_clip_by_id(
                        self.db, clip_id
                    )
                    if clip_record:
                        await clip_ready_callback(i, total_clips, clip_record)

            final_clips = await self.clip_repo.get_clips_by_task(self.db, task_id)
            if len(final_clips) < total_clips:
                raise RuntimeError(
                    f"Render incomplete: {len(final_clips)}/{total_clips} clips saved"
                )
            clip_ids = [clip["id"] for clip in final_clips]
            await self.task_repo.update_task_clips(self.db, task_id, clip_ids)

            stage_timings["render_seconds"] = round(
                perf_counter() - render_start, 3
            )

            # Mark as completed
            await self.task_repo.update_task_status(
                self.db,
                task_id,
                "completed",
                progress=100,
                progress_message="Complete!",
                current_stage="complete",
                failed_stage="",
                resume_from_stage="",
                stage_progress_json=self._stage_progress_payload("complete", 100),
            )

            if progress_callback:
                await progress_callback(100, "Complete!", "completed")

            await self.task_repo.update_task_runtime_metadata(
                self.db,
                task_id,
                completed_at=datetime.utcnow(),
                stage_timings_json=json.dumps(stage_timings),
                error_code="",
                error_message="",
            )

            logger.info(
                f"Task {task_id} completed successfully with {len(clip_ids)} clips"
            )

            return {
                "task_id": task_id,
                "clips_count": len(clip_ids),
                "segments": result["segments"],
                "summary": result.get("summary"),
                "key_topics": result.get("key_topics"),
            }

        except Exception as e:
            logger.error(f"Error processing task {task_id}: {e}")
            if str(e) == "Task cancelled":
                failed_stage = self._stage_for_progress(0, "Cancelled by user")
                await self.task_repo.update_task_status(
                    self.db,
                    task_id,
                    "cancelled",
                    progress=0,
                    progress_message="Cancelled by user",
                    failed_stage=failed_stage,
                    resume_from_stage=failed_stage,
                    stage_progress_json=self._stage_progress_payload(
                        failed_stage, 0, failed_stage
                    ),
                )
                raise
            failed_stage = self._stage_for_progress(0, str(e))
            await self.task_repo.update_task_status(
                self.db,
                task_id,
                "error",
                progress_message=str(e),
                failed_stage=failed_stage,
                resume_from_stage=failed_stage,
                stage_progress_json=self._stage_progress_payload(
                    failed_stage, 0, failed_stage
                ),
            )
            error_code = "task_error"
            message = str(e).lower()
            if "download" in message or "youtube" in message:
                error_code = "download_error"
            elif "analysis" in message:
                error_code = "analysis_error"
            elif "transcript" in message:
                error_code = "transcription_error"
            elif "cancelled" in message:
                error_code = "cancelled"

            await self.task_repo.update_task_runtime_metadata(
                self.db,
                task_id,
                completed_at=datetime.utcnow(),
                error_code=error_code,
                error_message=str(e),
                last_error_at=datetime.utcnow(),
            )
            raise

    async def get_task_with_clips(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get task details with all clips."""
        task = await self.task_repo.get_task_by_id(self.db, task_id)

        if not task:
            return None

        if self._is_stale_queued_task(task):
            timeout_seconds = self.config.queued_task_timeout_seconds
            logger.warning(
                f"Task {task_id} stuck in queued status for over {timeout_seconds}s; marking as error"
            )
            await self.task_repo.update_task_status(
                self.db,
                task_id,
                "error",
                progress=0,
                progress_message=(
                    "Task timed out while waiting in queue. "
                    "Ensure the worker service is running and healthy (docker-compose logs -f worker)."
                ),
            )
            task = await self.task_repo.get_task_by_id(self.db, task_id)
            if not task:
                return None

        # Get clips
        clips = await self.clip_repo.get_clips_by_task(self.db, task_id)
        task["clips"] = [
            {key: value for key, value in clip.items() if key != "file_path"}
            for clip in clips
        ]
        task["clips_count"] = len(clips)
        artifacts = await self.artifact_repo.get_artifacts_by_task(self.db, task_id)
        segments_artifact = artifacts.get("segments")
        candidate_payload = segments_artifact.get("json_value") if segments_artifact else None
        if isinstance(candidate_payload, list):
            task["clip_candidates"] = [
                {
                    **candidate,
                    "candidate_order": index + 1,
                }
                for index, candidate in enumerate(candidate_payload)
                if isinstance(candidate, dict)
            ]
        else:
            task["clip_candidates"] = []
        task.update(await self._load_task_source_settings(task_id))
        task["resume_action_label"] = self.resume_action_label(task)
        task["stages"] = self._task_stages_for_response(task)

        return task

    @classmethod
    def _task_stages_for_response(cls, task: Dict[str, Any]) -> Dict[str, Any]:
        stage_payload = task.get("stage_progress_json")
        if isinstance(stage_payload, str) and stage_payload.strip():
            try:
                parsed = json.loads(stage_payload)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

        current_stage = task.get("failed_stage") or task.get("current_stage") or "queue"
        progress = int(task.get("progress") or 0)
        failed_stage = current_stage if task.get("status") in {"error", "cancelled"} else None
        return cls.stage_progress_dict(str(current_stage), progress, failed_stage)

    async def get_user_tasks(
        self, user_id: str, limit: int = 50
    ) -> list[Dict[str, Any]]:
        """Get all tasks for a user."""
        return await self.task_repo.get_user_tasks(self.db, user_id, limit)

    @staticmethod
    def _normalize_library_tags(value: Any) -> list[str]:
        if isinstance(value, str):
            raw_tags = value.split(",")
        elif isinstance(value, list):
            raw_tags = value
        else:
            return []

        tags = []
        seen = set()
        for raw_tag in raw_tags:
            tag = str(raw_tag).strip().lower()
            if not tag or tag in seen:
                continue
            seen.add(tag)
            tags.append(tag[:40])
        return tags[:20]

    @staticmethod
    def _normalize_optional_text(value: Any, max_length: int) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized[:max_length] if normalized else None

    async def search_content_library(
        self,
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
    ) -> list[Dict[str, Any]]:
        """Search old sources/clips using library metadata."""
        return await self.task_repo.search_user_library(
            self.db,
            user_id,
            limit=max(1, min(200, int(limit or 100))),
            q=self._normalize_optional_text(q, 160),
            status=self._normalize_optional_text(status, 40),
            tag=self._normalize_optional_text(tag, 40),
            content_pillar=self._normalize_optional_text(content_pillar, 120),
            platform=self._normalize_optional_text(platform, 40),
            series_name=self._normalize_optional_text(series_name, 160),
            archived=archived,
        )

    async def update_content_library_metadata(
        self, task_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update searchable library metadata for a task."""
        return await self.task_repo.update_library_metadata(
            self.db,
            task_id,
            tags=self._normalize_library_tags(payload.get("tags"))
            if "tags" in payload
            else None,
            content_pillar=self._normalize_optional_text(
                payload.get("content_pillar"), 120
            )
            if "content_pillar" in payload
            else None,
            series_name=self._normalize_optional_text(payload.get("series_name"), 160)
            if "series_name" in payload
            else None,
            platform=self._normalize_optional_text(payload.get("platform"), 40)
            if "platform" in payload
            else None,
            library_status=self._normalize_optional_text(
                payload.get("library_status"), 40
            )
            if "library_status" in payload
            else None,
            pinned=bool(payload.get("pinned")) if "pinned" in payload else None,
            archived=bool(payload.get("archived")) if "archived" in payload else None,
            notes=self._normalize_optional_text(payload.get("notes"), 2000)
            if "notes" in payload
            else None,
        )

    async def get_content_library_stats(self, user_id: str) -> Dict[str, Any]:
        """Return counts, disk usage, and rough AI spend estimate for the library."""
        result = await self.db.execute(
            text("""
                SELECT
                    COUNT(DISTINCT t.id) AS tasks_count,
                    COUNT(DISTINCT gc.id) AS clips_count,
                    COALESCE(SUM(gc.duration), 0) AS rendered_seconds,
                    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'completed') AS completed_count,
                    COUNT(DISTINCT t.id) FILTER (WHERE t.cache_hit = true) AS cache_hit_count
                FROM tasks t
                LEFT JOIN generated_clips gc ON gc.task_id = t.id
                WHERE t.user_id = :user_id
            """),
            {"user_id": user_id},
        )
        row = result.fetchone()

        path_result = await self.db.execute(
            text("""
                SELECT gc.file_path AS path
                FROM generated_clips gc
                JOIN tasks t ON t.id = gc.task_id
                WHERE t.user_id = :user_id
                UNION
                SELECT ta.file_path AS path
                FROM task_artifacts ta
                JOIN tasks t ON t.id = ta.task_id
                WHERE t.user_id = :user_id AND ta.file_path IS NOT NULL
            """),
            {"user_id": user_id},
        )
        disk_bytes = 0
        missing_files = 0
        for path_row in path_result.fetchall():
            file_path = path_row.path
            if not file_path:
                continue
            try:
                candidate = Path(file_path)
                if candidate.exists() and candidate.is_file():
                    disk_bytes += candidate.stat().st_size
                else:
                    missing_files += 1
            except OSError:
                missing_files += 1

        tasks_count = int(row.tasks_count or 0)
        clips_count = int(row.clips_count or 0)
        rendered_seconds = float(row.rendered_seconds or 0)
        completed_count = int(row.completed_count or 0)
        cache_hit_count = int(row.cache_hit_count or 0)
        estimated_ai_spend = round(max(0, tasks_count - cache_hit_count) * 0.03, 2)

        return {
            "tasks_count": tasks_count,
            "clips_count": clips_count,
            "rendered_seconds": rendered_seconds,
            "completed_count": completed_count,
            "cache_hit_count": cache_hit_count,
            "disk_bytes": disk_bytes,
            "missing_files": missing_files,
            "estimated_ai_spend_usd": estimated_ai_spend,
            "estimate_note": "Rough placeholder: $0.03 per non-cache-hit task until provider token accounting lands.",
        }

    async def delete_task(self, task_id: str) -> None:
        """Delete a task and all its associated clips."""
        # Delete all clips for this task
        await self.clip_repo.delete_clips_by_task(self.db, task_id)

        # Delete the task
        await self.task_repo.delete_task(self.db, task_id)

        logger.info(f"Deleted task {task_id} and all associated clips")

    async def update_task_settings(
        self,
        task_id: str,
        font_family: str,
        font_size: int,
        font_color: str,
        caption_template: str,
        include_broll: bool,
        apply_to_existing: bool,
        cleanup_settings: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update task-level settings and optionally regenerate all clips."""
        await self.task_repo.update_task_settings(
            self.db,
            task_id,
            font_family,
            font_size,
            font_color,
            caption_template,
            include_broll,
        )

        if apply_to_existing:
            await self.regenerate_all_clips_for_task(
                task_id,
                font_family,
                font_size,
                font_color,
                caption_template,
                cleanup_settings=cleanup_settings,
            )

        return await self.get_task_with_clips(task_id) or {}

    async def regenerate_all_clips_for_task(
        self,
        task_id: str,
        font_family: str,
        font_size: int,
        font_color: str,
        caption_template: str,
        cleanup_settings: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Regenerate all clips in a task using existing segment boundaries."""
        task = await self.task_repo.get_task_by_id(self.db, task_id)
        if not task:
            raise ValueError("Task not found")

        source_url = task.get("source_url")
        source_type = task.get("source_type")
        metadata = await self._load_task_source_settings(task_id)
        output_format = metadata.get("output_format", "vertical")
        add_subtitles = metadata.get("add_subtitles", True)
        cleanup_payload = cleanup_settings or {
            "cut_long_pauses": metadata.get("cut_long_pauses"),
            "pause_threshold_ms": metadata.get("pause_threshold_ms"),
            "remove_filler_words": metadata.get("remove_filler_words"),
            "filtered_words": metadata.get("filtered_words"),
        }
        normalized_cleanup_settings = normalize_clip_cleanup_settings(
            cleanup_payload.get("cut_long_pauses"),
            cleanup_payload.get("pause_threshold_ms"),
            cleanup_payload.get("remove_filler_words"),
            cleanup_payload.get("filtered_words"),
        )
        existing_cleanup_settings = normalize_clip_cleanup_settings(
            metadata.get("cut_long_pauses"),
            metadata.get("pause_threshold_ms"),
            metadata.get("remove_filler_words"),
            metadata.get("filtered_words"),
        )
        should_recompute_cleanup = (
            cleanup_settings is not None
            and normalized_cleanup_settings != existing_cleanup_settings
        )

        if not source_url or not source_type:
            raise ValueError("Task source URL is missing; cannot regenerate clips")

        clips = await self.clip_repo.get_clips_by_task(self.db, task_id)
        if not clips:
            return

        video_path: Path
        if source_type == "youtube":
            downloaded = await self.video_service.download_video(source_url)
            if not downloaded:
                raise ValueError("Failed to download source video for regeneration")
            video_path = Path(downloaded)
        else:
            video_path = self.video_service.resolve_local_video_path(source_url)
            if not video_path.exists():
                raise ValueError("Source video file no longer exists")

        segments = []
        for clip in clips:
            source_ranges = self._get_clip_source_ranges(clip)
            bounds = source_range_bounds(source_ranges)
            if bounds:
                start_time = self._seconds_to_mmss(bounds[0])
                end_time = self._seconds_to_mmss(bounds[1])
            else:
                start_time = clip["start_time"]
                end_time = clip["end_time"]

            segments.append(
                {
                    "start_time": start_time,
                    "end_time": end_time,
                    **(
                        {"source_ranges": source_ranges}
                        if should_recompute_cleanup
                        else {"keep_ranges": source_ranges}
                    ),
                    "text": clip.get("text") or "",
                    "relevance_score": clip.get("relevance_score", 0.5),
                    "reasoning": clip.get("reasoning")
                    or "Regenerated with updated settings",
                    "virality_score": clip.get("virality_score", 0),
                    "hook_score": clip.get("hook_score", 0),
                    "engagement_score": clip.get("engagement_score", 0),
                    "value_score": clip.get("value_score", 0),
                    "shareability_score": clip.get("shareability_score", 0),
                    "hook_type": clip.get("hook_type"),
                }
            )

        clips_info = await self.video_service.create_video_clips(
            video_path,
            segments,
            font_family,
            font_size,
            font_color,
            caption_template,
            output_format,
            add_subtitles,
            normalized_cleanup_settings,
        )

        await self.clip_repo.delete_clips_by_task(self.db, task_id)

        clip_ids = []
        for i, clip_info in enumerate(clips_info):
            clip_id = await self.clip_repo.create_clip(
                self.db,
                task_id=task_id,
                filename=clip_info["filename"],
                file_path=clip_info["path"],
                start_time=clip_info["start_time"],
                end_time=clip_info["end_time"],
                duration=clip_info["duration"],
                text=clip_info.get("text") or "",
                relevance_score=clip_info.get("relevance_score", 0.5),
                reasoning=clip_info.get("reasoning")
                or "Regenerated with updated settings",
                clip_order=i + 1,
                virality_score=clip_info.get("virality_score", 0),
                hook_score=clip_info.get("hook_score", 0),
                engagement_score=clip_info.get("engagement_score", 0),
                value_score=clip_info.get("value_score", 0),
                shareability_score=clip_info.get("shareability_score", 0),
                hook_type=clip_info.get("hook_type"),
            )
            clip_ids.append(clip_id)

        await self.task_repo.update_task_clips(self.db, task_id, clip_ids)

    async def trim_clip(
        self,
        task_id: str,
        clip_id: str,
        start_offset: float,
        end_offset: float,
    ) -> Dict[str, Any]:
        clip = await self.clip_repo.get_clip_by_id(self.db, clip_id)
        if not clip or clip["task_id"] != task_id:
            raise ValueError("Clip not found")

        input_path = Path(clip["file_path"])
        if not input_path.exists():
            raise ValueError("Clip file not found")

        output_path = trim_clip_file(
            input_path, Path(self.config.temp_dir) / "clips", start_offset, end_offset
        )
        source_ranges = self._get_clip_source_ranges(clip)
        trimmed_ranges = trim_source_ranges(source_ranges, start_offset, end_offset)
        clip_duration = max(0.1, total_source_duration(trimmed_ranges))
        bounds = source_range_bounds(trimmed_ranges)
        if not bounds:
            raise ValueError("Trimmed clip has no remaining source mapping")
        start_seconds, end_seconds = bounds
        save_clip_source_ranges(output_path, trimmed_ranges)

        new_start = self._seconds_to_mmss(start_seconds)
        new_end = self._seconds_to_mmss(end_seconds)

        await self.clip_repo.update_clip(
            self.db,
            clip_id,
            output_path.name,
            str(output_path),
            new_start,
            new_end,
            clip_duration,
            clip.get("text") or "",
        )
        return (await self.clip_repo.get_clip_by_id(self.db, clip_id)) or {}

    async def split_clip(
        self, task_id: str, clip_id: str, split_time: float
    ) -> Dict[str, Any]:
        clip = await self.clip_repo.get_clip_by_id(self.db, clip_id)
        if not clip or clip["task_id"] != task_id:
            raise ValueError("Clip not found")

        input_path = Path(clip["file_path"])
        if not input_path.exists():
            raise ValueError("Clip file not found")

        first_path, second_path = split_clip_file(
            input_path, Path(self.config.temp_dir) / "clips", split_time
        )

        clamped_split = max(0.2, min(split_time, float(clip["duration"]) - 0.2))
        source_ranges = self._get_clip_source_ranges(clip)
        first_ranges, second_ranges = split_source_ranges(source_ranges, clamped_split)
        first_bounds = source_range_bounds(first_ranges)
        second_bounds = source_range_bounds(second_ranges)
        if not first_bounds or not second_bounds:
            raise ValueError("Split clip has invalid source mapping")
        save_clip_source_ranges(first_path, first_ranges)
        save_clip_source_ranges(second_path, second_ranges)
        first_duration = max(0.1, total_source_duration(first_ranges))
        second_duration = max(0.1, total_source_duration(second_ranges))

        await self.clip_repo.update_clip(
            self.db,
            clip_id,
            first_path.name,
            str(first_path),
            self._seconds_to_mmss(first_bounds[0]),
            self._seconds_to_mmss(first_bounds[1]),
            first_duration,
            clip.get("text") or "",
        )

        await self.clip_repo.create_clip(
            self.db,
            task_id=task_id,
            filename=second_path.name,
            file_path=str(second_path),
            start_time=self._seconds_to_mmss(second_bounds[0]),
            end_time=self._seconds_to_mmss(second_bounds[1]),
            duration=second_duration,
            text=clip.get("text") or "",
            relevance_score=clip.get("relevance_score", 0.5),
            reasoning=clip.get("reasoning") or "Split from original clip",
            clip_order=clip.get("clip_order", 1) + 1,
            virality_score=clip.get("virality_score", 0),
            hook_score=clip.get("hook_score", 0),
            engagement_score=clip.get("engagement_score", 0),
            value_score=clip.get("value_score", 0),
            shareability_score=clip.get("shareability_score", 0),
            hook_type=clip.get("hook_type"),
        )

        await self.clip_repo.reorder_task_clips(self.db, task_id)
        return {"message": "Clip split successfully"}

    async def merge_clips(self, task_id: str, clip_ids: list[str]) -> Dict[str, Any]:
        if len(clip_ids) < 2:
            raise ValueError("At least two clips are required to merge")

        clips = []
        for clip_id in clip_ids:
            clip = await self.clip_repo.get_clip_by_id(self.db, clip_id)
            if not clip or clip["task_id"] != task_id:
                raise ValueError("One or more clips not found")
            clips.append(clip)

        ordered = sorted(clips, key=lambda c: c.get("clip_order", 0))
        merged_path = merge_clip_files(
            [Path(c["file_path"]) for c in ordered],
            Path(self.config.temp_dir) / "clips",
        )

        merged_ranges = []
        for clip in ordered:
            merged_ranges.extend(self._get_clip_source_ranges(clip))
        merged_bounds = source_range_bounds(merged_ranges)
        if merged_bounds:
            start_time = self._seconds_to_mmss(merged_bounds[0])
            end_time = self._seconds_to_mmss(merged_bounds[1])
            duration = total_source_duration(merged_ranges)
            save_clip_source_ranges(merged_path, merged_ranges)
        else:
            start_time = ordered[0]["start_time"]
            end_time = ordered[-1]["end_time"]
            duration = sum(float(c.get("duration", 0.0)) for c in ordered)
        text = " ".join((c.get("text") or "").strip() for c in ordered if c.get("text"))

        first = ordered[0]
        await self.clip_repo.update_clip(
            self.db,
            first["id"],
            merged_path.name,
            str(merged_path),
            start_time,
            end_time,
            duration,
            text,
        )

        for clip in ordered[1:]:
            await self.clip_repo.delete_clip(self.db, clip["id"])

        await self.clip_repo.reorder_task_clips(self.db, task_id)
        return {"message": "Clips merged successfully", "clip_id": first["id"]}

    async def update_clip_captions(
        self,
        task_id: str,
        clip_id: str,
        caption_text: str,
        position: str,
        highlight_words: list[str],
    ) -> Dict[str, Any]:
        clip = await self.clip_repo.get_clip_by_id(self.db, clip_id)
        if not clip or clip["task_id"] != task_id:
            raise ValueError("Clip not found")

        input_path = Path(clip["file_path"])
        if not input_path.exists():
            raise ValueError("Clip file not found")

        output_path = overlay_custom_captions(
            input_path,
            Path(self.config.temp_dir) / "clips",
            caption_text,
            position,
            highlight_words,
        )
        copy_clip_source_ranges(input_path, output_path)

        await self.clip_repo.update_clip(
            self.db,
            clip_id,
            output_path.name,
            str(output_path),
            clip["start_time"],
            clip["end_time"],
            clip["duration"],
            caption_text,
        )
        return (await self.clip_repo.get_clip_by_id(self.db, clip_id)) or {}

    async def get_performance_metrics(self) -> Dict[str, Any]:
        """Return aggregate processing performance metrics."""
        return await self.task_repo.get_performance_metrics(self.db)

    @staticmethod
    def _seconds_to_mmss(seconds: float) -> str:
        total = max(0, int(round(seconds)))
        minutes = total // 60
        secs = total % 60
        return f"{minutes:02d}:{secs:02d}"

    @staticmethod
    def _get_clip_source_ranges(clip: Dict[str, Any]) -> list[tuple[float, float]]:
        file_path = clip.get("file_path")
        if isinstance(file_path, str) and file_path:
            persisted = load_clip_source_ranges(Path(file_path))
            if persisted:
                return persisted

        start_seconds = parse_timestamp_to_seconds(clip["start_time"])
        end_seconds = parse_timestamp_to_seconds(clip["end_time"])
        return [(start_seconds, end_seconds)]

    async def _load_task_source_settings(self, task_id: str) -> Dict[str, Any]:
        defaults = {
            "output_format": "vertical",
            "add_subtitles": True,
            **normalize_clip_cleanup_settings(),
        }
        redis_client = redis.Redis(
            host=self.config.redis_host,
            port=self.config.redis_port,
            password=self.config.redis_password,
            decode_responses=True,
        )
        try:
            payload = await redis_client.get(f"task_source:{task_id}")
        except Exception as exc:
            logger.warning(
                "Falling back to default task source settings for task %s: %s",
                task_id,
                exc,
            )
            return defaults
        finally:
            try:
                await redis_client.close()
            except Exception:
                pass

        if not payload:
            return defaults

        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            return defaults

        output_format = parsed.get("output_format", defaults["output_format"])
        if output_format not in VALID_OUTPUT_FORMATS:
            output_format = defaults["output_format"]

        add_subtitles = parsed.get("add_subtitles", defaults["add_subtitles"])
        if not isinstance(add_subtitles, bool):
            add_subtitles = defaults["add_subtitles"]

        return {
            "output_format": output_format,
            "add_subtitles": add_subtitles,
            **normalize_clip_cleanup_settings(
                parsed.get("cut_long_pauses"),
                parsed.get("pause_threshold_ms"),
                parsed.get("remove_filler_words"),
                parsed.get("filtered_words"),
            ),
        }
