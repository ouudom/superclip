from datetime import datetime
from typing import List, Optional
from sqlalchemy import (
    Column,
    String,
    DateTime,
    ForeignKey,
    CheckConstraint,
    ARRAY,
    Boolean,
    Float,
    Integer,
    Text,
    text as sql_text,
)
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
import uuid

from .database import Base


def generate_uuid_string():
    """Generate a UUID as a string for compatibility with Prisma"""
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    emailVerified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    createdAt: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updatedAt: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        default=func.now(),
    )

    # Additional fields for backend compatibility
    first_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    last_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("'false'")
    )

    # Relationships
    tasks: Mapped[List["Task"]] = relationship(
        "Task", back_populates="user", cascade="all, delete-orphan"
    )
    agent_tasks: Mapped[List["AgentTask"]] = relationship(
        "AgentTask", back_populates="user", cascade="all, delete-orphan"
    )
    agent_runs: Mapped[List["AgentRun"]] = relationship(
        "AgentRun", back_populates="user", cascade="all, delete-orphan"
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    setting_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    encrypted_value: Mapped[str] = mapped_column(Text, nullable=False)
    prefer_admin_value: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("'false'")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OwnerSetting(Base):
    __tablename__ = "owner_settings"

    setting_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ModelProfile(Base):
    __tablename__ = "model_profiles"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    model: Mapped[str] = mapped_column(String(160), nullable=False)
    purpose: Mapped[str] = mapped_column(String(80), nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("'false'")
    )
    settings_json: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=sql_text("'{}'")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PromptVersion(Base):
    __tablename__ = "prompt_versions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    purpose: Mapped[str] = mapped_column(String(80), nullable=False)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("'1'")
    )
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=sql_text("'{}'")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("'true'")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint("version > 0", name="check_prompt_version_positive"),
    )


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=sql_text("'youtube'")
    )
    output_target: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=sql_text("'shorts'")
    )
    config_json: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=sql_text("'{}'")
    )
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("'false'")
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    source_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("sources.id", ondelete="SET NULL"), nullable=True
    )
    generated_clips_ids: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(String(36)), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), server_default=sql_text("'pending'"), nullable=False
    )
    progress: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default=sql_text("'0'")
    )
    progress_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Font customization fields
    font_family: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, server_default=sql_text("'TikTokSans-Regular'")
    )
    font_size: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default=sql_text("'24'")
    )
    font_color: Mapped[Optional[str]] = mapped_column(
        String(7), nullable=True, server_default=sql_text("'#FFFFFF'")
    )  # Hex color code

    # Caption template and B-roll options
    caption_template: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, server_default=sql_text("'default'")
    )
    include_broll: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True, server_default=sql_text("'false'")
    )
    processing_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=sql_text("'fast'")
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cache_hit: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("'false'")
    )
    error_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    current_stage: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    failed_stage: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    resume_from_stage: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    stage_progress_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("'0'")
    )
    max_retries: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("'3'")
    )
    last_error_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    stage_timings_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="tasks")
    source: Mapped[Optional["Source"]] = relationship("Source", back_populates="tasks")
    generated_clips: Mapped[List["GeneratedClip"]] = relationship(
        "GeneratedClip", back_populates="task", cascade="all, delete-orphan"
    )
    publish_metadata: Mapped[List["ClipPublishMetadata"]] = relationship(
        "ClipPublishMetadata", back_populates="task", cascade="all, delete-orphan"
    )
    artifacts: Mapped[List["TaskArtifact"]] = relationship(
        "TaskArtifact", back_populates="task", cascade="all, delete-orphan"
    )
    library_metadata: Mapped[Optional["TaskLibraryMetadata"]] = relationship(
        "TaskLibraryMetadata", back_populates="task", cascade="all, delete-orphan"
    )
    agent_tasks: Mapped[List["AgentTask"]] = relationship(
        "AgentTask", back_populates="task", cascade="all, delete-orphan"
    )
    agent_runs: Mapped[List["AgentRun"]] = relationship(
        "AgentRun", back_populates="task", cascade="all, delete-orphan"
    )


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Add check constraint for type enum
    __table_args__ = (
        CheckConstraint(
            "type IN ('youtube', 'video_url', 'local_watch', 'podcast_rss', 'twitch_vod', 'google_drive')",
            name="check_source_type",
        ),
    )

    # Relationships - Source can have multiple tasks
    tasks: Mapped[List["Task"]] = relationship("Task", back_populates="source")

    def decide_source_type(self, source_url: str) -> str:
        """Decide which type of source this is."""
        if "youtube" in source_url:
            return "youtube"
        elif source_url.startswith("watch://"):
            return "local_watch"
        else:
            return "video_url"


class GeneratedClip(Base):
    __tablename__ = "generated_clips"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    start_time: Mapped[str] = mapped_column(String(20), nullable=False)  # MM:SS format
    end_time: Mapped[str] = mapped_column(String(20), nullable=False)  # MM:SS format
    duration: Mapped[float] = mapped_column(
        Float, nullable=False
    )  # Duration in seconds
    text: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Transcript text for this clip
    relevance_score: Mapped[float] = mapped_column(Float, nullable=False)
    reasoning: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # AI reasoning for selection
    clip_order: Mapped[int] = mapped_column(
        Integer, nullable=False
    )  # Order within the task

    # Virality score breakdown
    virality_score: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default=sql_text("'0'")
    )
    hook_score: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default=sql_text("'0'")
    )
    engagement_score: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default=sql_text("'0'")
    )
    value_score: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default=sql_text("'0'")
    )
    shareability_score: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default=sql_text("'0'")
    )
    hook_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    task: Mapped["Task"] = relationship("Task", back_populates="generated_clips")
    publish_metadata: Mapped[List["ClipPublishMetadata"]] = relationship(
        "ClipPublishMetadata", back_populates="clip", cascade="all, delete-orphan"
    )


class ClipPublishMetadata(Base):
    __tablename__ = "clip_publish_metadata"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    clip_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("generated_clips.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[str] = mapped_column(String(40), nullable=False)
    post_status: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=sql_text("'draft'")
    )
    caption: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hashtags: Mapped[List[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sql_text("'{}'")
    )
    checklist_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    published_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    export_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    clip: Mapped["GeneratedClip"] = relationship(
        "GeneratedClip", back_populates="publish_metadata"
    )
    task: Mapped["Task"] = relationship("Task", back_populates="publish_metadata")


class TaskLibraryMetadata(Base):
    __tablename__ = "task_library_metadata"

    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    tags: Mapped[List[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sql_text("'{}'")
    )
    content_pillar: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    series_name: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    platform: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    library_status: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=sql_text("'draft'")
    )
    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("'false'")
    )
    archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("'false'")
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    task: Mapped["Task"] = relationship("Task", back_populates="library_metadata")


class ProcessingCache(Base):
    __tablename__ = "processing_cache"

    cache_key: Mapped[str] = mapped_column(String(255), primary_key=True)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    video_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    transcript_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    analysis_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TaskArtifact(Base):
    __tablename__ = "task_artifacts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    artifact_type: Mapped[str] = mapped_column(String(60), nullable=False)
    text_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    json_value: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    task: Mapped["Task"] = relationship("Task", back_populates="artifacts")

    __table_args__ = (
        CheckConstraint(
            "artifact_type <> ''",
            name="check_task_artifact_type_not_empty",
        ),
    )


class AgentTask(Base):
    __tablename__ = "agent_tasks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    agent_type: Mapped[str] = mapped_column(
        String(60), nullable=False, server_default=sql_text("'codex'")
    )
    status: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=sql_text("'draft'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship("User", back_populates="agent_tasks")
    task: Mapped[Optional["Task"]] = relationship("Task", back_populates="agent_tasks")
    runs: Mapped[List["AgentRun"]] = relationship(
        "AgentRun", back_populates="agent_task", cascade="all, delete-orphan"
    )


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    agent_task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agent_tasks.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    agent_key: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=sql_text("'draft'")
    )
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    context_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    output_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    agent_task: Mapped["AgentTask"] = relationship("AgentTask", back_populates="runs")
    user: Mapped["User"] = relationship("User", back_populates="agent_runs")
    task: Mapped[Optional["Task"]] = relationship("Task", back_populates="agent_runs")
    artifacts: Mapped[List["AgentArtifact"]] = relationship(
        "AgentArtifact", back_populates="agent_run", cascade="all, delete-orphan"
    )


class AgentArtifact(Base):
    __tablename__ = "agent_artifacts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid_string
    )
    agent_run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False
    )
    artifact_type: Mapped[str] = mapped_column(String(60), nullable=False)
    text_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    json_value: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    agent_run: Mapped["AgentRun"] = relationship("AgentRun", back_populates="artifacts")
