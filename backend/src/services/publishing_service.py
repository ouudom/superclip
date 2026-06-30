"""Manual publishing assist service."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_config
from ..repositories.publishing_repository import PublishingRepository

PLATFORMS = {"tiktok", "reels", "shorts"}
POST_STATUSES = {"draft", "ready", "posted", "archived"}
DEFAULT_CHECKLIST = {
    "caption_copied": False,
    "video_exported": False,
    "uploaded": False,
    "cover_checked": False,
    "posted": False,
}


class PublishingService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = PublishingRepository()

    @staticmethod
    def normalize_platform(value: Any | None) -> str | None:
        if value is None or value == "all":
            return None
        platform = str(value).strip().lower()
        if platform not in PLATFORMS:
            raise ValueError("Unsupported platform")
        return platform

    @staticmethod
    def normalize_status(value: Any | None) -> str | None:
        if value is None or value == "all":
            return None
        status = str(value).strip().lower()
        if status not in POST_STATUSES:
            raise ValueError("Unsupported post status")
        return status

    @staticmethod
    def _clean_text(value: Any, max_length: int | None = None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return None
        return cleaned[:max_length] if max_length else cleaned

    @staticmethod
    def _normalize_hashtags(value: Any) -> list[str]:
        if isinstance(value, str):
            raw_items = re.split(r"[\s,]+", value)
        elif isinstance(value, list):
            raw_items = value
        else:
            raw_items = []
        tags: list[str] = []
        seen = set()
        for item in raw_items:
            tag = str(item).strip().lower()
            if not tag:
                continue
            if not tag.startswith("#"):
                tag = f"#{tag}"
            tag = re.sub(r"[^#a-z0-9_]", "", tag)
            if len(tag) <= 1 or tag in seen:
                continue
            seen.add(tag)
            tags.append(tag[:40])
        return tags[:20]

    @staticmethod
    def _default_caption(item: dict[str, Any]) -> str:
        source_title = str(item.get("source_title") or "Clip").strip()
        clip_text = " ".join(str(item.get("clip_text") or "").split())
        base = clip_text[:220] if clip_text else source_title
        suffix = "#shorts #reels #tiktok"
        return f"{base}\n\n{suffix}".strip()

    @staticmethod
    def _default_hashtags(item: dict[str, Any]) -> list[str]:
        source_type = str(item.get("source_type") or "").lower()
        tags = ["#shorts", "#reels", "#tiktok"]
        if source_type == "youtube":
            tags.append("#youtube")
        return tags

    def _with_defaults(self, item: dict[str, Any]) -> dict[str, Any]:
        checklist = {**DEFAULT_CHECKLIST, **(item.get("checklist") or {})}
        caption = item.get("caption") or self._default_caption(item)
        hashtags = item.get("hashtags") or self._default_hashtags(item)
        return {
            **item,
            "caption": caption,
            "hashtags": hashtags,
            "checklist": checklist,
            "video_url": f"/tasks/{item['task_id']}/clips/{item['clip_id']}/file",
        }

    async def list_items(
        self,
        user_id: str,
        *,
        platform: str | None = None,
        post_status: str | None = None,
        limit: int = 120,
    ) -> list[dict[str, Any]]:
        normalized_platform = self.normalize_platform(platform)
        normalized_status = self.normalize_status(post_status)
        items = await self.repo.list_publish_items(
            self.db,
            user_id,
            platform=normalized_platform,
            post_status=normalized_status,
            limit=limit,
        )
        return [self._with_defaults(item) for item in items]

    async def save_metadata(
        self,
        user_id: str,
        clip_id: str,
        platform: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_platform = self.normalize_platform(platform)
        if not normalized_platform:
            raise ValueError("Platform is required")
        item = await self.repo.get_publish_item(self.db, user_id, clip_id, normalized_platform)
        if not item:
            raise ValueError("Clip not found")
        status = self.normalize_status(payload.get("post_status")) or item["post_status"]
        checklist = payload.get("checklist")
        if not isinstance(checklist, dict):
            checklist = item.get("checklist") or {}
        if status == "posted":
            checklist = {**DEFAULT_CHECKLIST, **checklist, "posted": True, "uploaded": True}
        saved = await self.repo.upsert_publish_metadata(
            self.db,
            clip_id=clip_id,
            task_id=item["task_id"],
            platform=normalized_platform,
            post_status=status,
            caption=self._clean_text(payload.get("caption")),
            hashtags=self._normalize_hashtags(payload.get("hashtags")),
            checklist={**DEFAULT_CHECKLIST, **checklist},
            published_url=self._clean_text(payload.get("published_url"), 2000),
            published_at=self._clean_text(payload.get("published_at"), 80),
            export_path=self._clean_text(payload.get("export_path"), 2000),
            notes=self._clean_text(payload.get("notes")),
        )
        item = await self.repo.get_publish_item(self.db, user_id, clip_id, normalized_platform)
        return self._with_defaults(item or saved)

    @staticmethod
    def _safe_name(value: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-._")
        return cleaned[:120] or "clip"

    async def export_clip(self, user_id: str, clip_id: str, platform: str) -> dict[str, Any]:
        normalized_platform = self.normalize_platform(platform)
        if not normalized_platform:
            raise ValueError("Platform is required")
        item = await self.repo.get_publish_item(self.db, user_id, clip_id, normalized_platform)
        if not item:
            raise ValueError("Clip not found")
        source_path = Path(item["clip_file_path"])
        if not source_path.exists():
            raise ValueError("Clip file is missing")
        export_root = Path(get_config().publish_export_dir).expanduser().resolve()
        status = str(item.get("post_status") or "draft")
        target_dir = export_root / normalized_platform / status
        target_dir.mkdir(parents=True, exist_ok=True)
        source_title = self._safe_name(str(item.get("source_title") or "source"))
        filename = self._safe_name(str(item.get("clip_filename") or source_path.name))
        target_path = target_dir / f"{source_title}-{filename}"
        shutil.copy2(source_path, target_path)
        await self.repo.update_export_path(
            self.db,
            clip_id=clip_id,
            task_id=item["task_id"],
            platform=normalized_platform,
            export_path=str(target_path),
        )
        refreshed = await self.repo.get_publish_item(self.db, user_id, clip_id, normalized_platform)
        return self._with_defaults(refreshed or {**item, "export_path": str(target_path)})
