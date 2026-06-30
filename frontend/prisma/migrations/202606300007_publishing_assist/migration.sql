-- Phase 10: manual publishing assist.

CREATE TABLE IF NOT EXISTS clip_publish_metadata (
    id VARCHAR(36) PRIMARY KEY,
    clip_id VARCHAR(36) NOT NULL REFERENCES generated_clips(id) ON DELETE CASCADE,
    task_id VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    platform VARCHAR(40) NOT NULL,
    post_status VARCHAR(40) NOT NULL DEFAULT 'draft',
    caption TEXT,
    hashtags TEXT[] NOT NULL DEFAULT '{}',
    checklist_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_url TEXT,
    published_at TIMESTAMPTZ,
    export_path TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (clip_id, platform),
    CHECK (platform IN ('tiktok', 'reels', 'shorts')),
    CHECK (post_status IN ('draft', 'ready', 'posted', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_clip_publish_metadata_clip_id ON clip_publish_metadata(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_publish_metadata_task_id ON clip_publish_metadata(task_id);
CREATE INDEX IF NOT EXISTS idx_clip_publish_metadata_platform ON clip_publish_metadata(platform);
CREATE INDEX IF NOT EXISTS idx_clip_publish_metadata_post_status ON clip_publish_metadata(post_status);
CREATE INDEX IF NOT EXISTS idx_clip_publish_metadata_published_at ON clip_publish_metadata(published_at DESC);
