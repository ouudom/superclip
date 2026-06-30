CREATE TABLE IF NOT EXISTS task_library_metadata (
    task_id VARCHAR(36) PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    tags TEXT[] NOT NULL DEFAULT '{}',
    content_pillar VARCHAR(120),
    series_name VARCHAR(160),
    platform VARCHAR(40),
    library_status VARCHAR(40) NOT NULL DEFAULT 'draft',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_library_metadata_tags
    ON task_library_metadata USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_task_library_metadata_pillar
    ON task_library_metadata (content_pillar);
CREATE INDEX IF NOT EXISTS idx_task_library_metadata_series
    ON task_library_metadata (series_name);
CREATE INDEX IF NOT EXISTS idx_task_library_metadata_platform
    ON task_library_metadata (platform);
CREATE INDEX IF NOT EXISTS idx_task_library_metadata_status
    ON task_library_metadata (library_status);
CREATE INDEX IF NOT EXISTS idx_task_library_metadata_pinned
    ON task_library_metadata (pinned);
CREATE INDEX IF NOT EXISTS idx_task_library_metadata_archived
    ON task_library_metadata (archived);
