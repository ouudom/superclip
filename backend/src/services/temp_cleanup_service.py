"""
Periodic cleanup for old unreferenced temp files.
"""

from pathlib import Path
from time import time
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Config

logger = logging.getLogger(__name__)


class TempCleanupService:
    def __init__(self, config: Config):
        self.config = config

    async def collect_referenced_paths(self, db: AsyncSession) -> set[Path]:
        result = await db.execute(
            text(
                """
                SELECT file_path AS path FROM generated_clips WHERE file_path IS NOT NULL
                UNION
                SELECT file_path AS path FROM task_artifacts WHERE file_path IS NOT NULL
                UNION
                SELECT video_path AS path FROM processing_cache WHERE video_path IS NOT NULL
                """
            )
        )
        return {Path(row.path).resolve() for row in result.fetchall() if row.path}

    async def cleanup(self, db: AsyncSession) -> dict[str, int]:
        if not self.config.temp_cleanup_enabled:
            return {"deleted_files": 0, "deleted_dirs": 0, "skipped_referenced": 0}

        temp_root = Path(self.config.temp_dir).resolve()
        if not temp_root.exists() or not temp_root.is_dir():
            return {"deleted_files": 0, "deleted_dirs": 0, "skipped_referenced": 0}

        referenced_paths = await self.collect_referenced_paths(db)
        cutoff = time() - (self.config.temp_cleanup_max_age_hours * 3600)
        deleted_files = 0
        deleted_dirs = 0
        skipped_referenced = 0

        for path in sorted(temp_root.rglob("*"), key=lambda item: len(item.parts), reverse=True):
            try:
                resolved = path.resolve()
                if not resolved.is_relative_to(temp_root):
                    continue

                if resolved in referenced_paths:
                    skipped_referenced += 1
                    continue

                if path.is_file() and path.stat().st_mtime < cutoff:
                    path.unlink()
                    deleted_files += 1
                elif path.is_dir():
                    try:
                        path.rmdir()
                        deleted_dirs += 1
                    except OSError:
                        pass
            except FileNotFoundError:
                continue
            except Exception:
                logger.exception("Temp cleanup failed for %s", path)

        return {
            "deleted_files": deleted_files,
            "deleted_dirs": deleted_dirs,
            "skipped_referenced": skipped_referenced,
        }
