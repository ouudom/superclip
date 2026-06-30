INSERT INTO workflows (
    name,
    description,
    source_type,
    output_target,
    config_json,
    is_default,
    created_at,
    updated_at
)
VALUES
(
    'Podcast to 5 Shorts',
    'Balanced review flow for long conversations. Find several self-contained shorts before render.',
    'youtube',
    'shorts',
    '{
        "processing_mode": "balanced",
        "output_format": "vertical",
        "add_subtitles": true,
        "include_broll": false,
        "cut_long_pauses": true,
        "pause_threshold_ms": 900,
        "remove_filler_words": true,
        "target_candidates": 5,
        "platforms": ["shorts", "reels", "tiktok"],
        "steps": [
            {"key": "transcribe", "model_profile": "default_transcription"},
            {"key": "analyze", "prompt_version": "clip_candidates"},
            {"key": "review", "manual": true},
            {"key": "render", "render_profile": "final"}
        ]
    }',
    true,
    NOW(),
    NOW()
),
(
    'Tutorial to 3 Tips',
    'Extract clear educational tips with subtitles and clean pauses.',
    'youtube',
    'shorts',
    '{
        "processing_mode": "balanced",
        "output_format": "vertical_split",
        "add_subtitles": true,
        "include_broll": false,
        "cut_long_pauses": true,
        "pause_threshold_ms": 800,
        "remove_filler_words": true,
        "target_candidates": 3,
        "content_pillar": "education",
        "steps": [
            {"key": "transcribe", "model_profile": "default_transcription"},
            {"key": "analyze", "prompt_version": "tutorial_tips"},
            {"key": "review", "manual": true},
            {"key": "render", "render_profile": "final"}
        ]
    }',
    false,
    NOW(),
    NOW()
),
(
    'Talking Head to TikTok Pack',
    'Fast talking-head clips for TikTok/Reels with vertical pan framing.',
    'youtube',
    'tiktok',
    '{
        "processing_mode": "fast",
        "output_format": "vertical_pan",
        "add_subtitles": true,
        "include_broll": false,
        "cut_long_pauses": true,
        "pause_threshold_ms": 700,
        "remove_filler_words": true,
        "target_candidates": 4,
        "platforms": ["tiktok", "reels"],
        "steps": [
            {"key": "transcribe", "model_profile": "default_transcription"},
            {"key": "analyze", "prompt_version": "talking_head_hooks"},
            {"key": "review", "manual": true},
            {"key": "render", "render_profile": "draft"}
        ]
    }',
    false,
    NOW(),
    NOW()
),
(
    'Long YouTube to Shorts Series',
    'Turn one long source into a named Shorts series with more candidate review.',
    'youtube',
    'shorts',
    '{
        "processing_mode": "quality",
        "output_format": "vertical",
        "add_subtitles": true,
        "include_broll": true,
        "cut_long_pauses": true,
        "pause_threshold_ms": 900,
        "remove_filler_words": true,
        "target_candidates": 8,
        "library_status": "review",
        "steps": [
            {"key": "transcribe", "model_profile": "default_transcription"},
            {"key": "analyze", "prompt_version": "series_candidates"},
            {"key": "review", "manual": true},
            {"key": "package", "prompt_version": "series_package"},
            {"key": "render", "render_profile": "final"}
        ]
    }',
    false,
    NOW(),
    NOW()
)
ON CONFLICT (name)
DO UPDATE SET
    description = EXCLUDED.description,
    source_type = EXCLUDED.source_type,
    output_target = EXCLUDED.output_target,
    config_json = EXCLUDED.config_json,
    is_default = EXCLUDED.is_default,
    updated_at = NOW();
