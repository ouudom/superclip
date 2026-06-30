ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS current_stage VARCHAR(40),
ADD COLUMN IF NOT EXISTS failed_stage VARCHAR(40),
ADD COLUMN IF NOT EXISTS resume_from_stage VARCHAR(40),
ADD COLUMN IF NOT EXISTS stage_progress_json TEXT,
ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS task_artifacts (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    task_id VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    artifact_type VARCHAR(60) NOT NULL,
    text_value TEXT,
    json_value JSONB,
    file_path TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, artifact_type)
);

CREATE INDEX IF NOT EXISTS idx_tasks_current_stage ON tasks(current_stage);
CREATE INDEX IF NOT EXISTS idx_tasks_failed_stage ON tasks(failed_stage);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_id ON task_artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_type ON task_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_file_path ON task_artifacts(file_path);

DROP TRIGGER IF EXISTS update_task_artifacts_updated_at ON task_artifacts;
CREATE TRIGGER update_task_artifacts_updated_at
BEFORE UPDATE ON task_artifacts
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
