-- Phase 9.1: local watched-folder sources.

ALTER TABLE sources DROP CONSTRAINT IF EXISTS check_source_type;
ALTER TABLE sources
    ADD CONSTRAINT check_source_type
    CHECK (type IN ('youtube', 'video_url', 'local_watch', 'podcast_rss', 'twitch_vod', 'google_drive'));
