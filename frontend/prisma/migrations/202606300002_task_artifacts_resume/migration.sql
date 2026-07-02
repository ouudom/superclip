ALTER TABLE "tasks"
ADD COLUMN IF NOT EXISTS "error_message" TEXT,
ADD COLUMN IF NOT EXISTS "current_stage" VARCHAR(40),
ADD COLUMN IF NOT EXISTS "failed_stage" VARCHAR(40),
ADD COLUMN IF NOT EXISTS "resume_from_stage" VARCHAR(40),
ADD COLUMN IF NOT EXISTS "stage_progress_json" TEXT,
ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "max_retries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS "last_error_at" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "task_artifacts" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4()::text,
    "task_id" TEXT NOT NULL,
    "artifact_type" VARCHAR(60) NOT NULL,
    "text_value" TEXT,
    "json_value" JSONB,
    "file_path" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_artifacts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'task_artifacts_task_id_artifact_type_key'
    ) THEN
        ALTER TABLE "task_artifacts"
        ADD CONSTRAINT "task_artifacts_task_id_artifact_type_key"
        UNIQUE ("task_id", "artifact_type");
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'task_artifacts_task_id_fkey'
    ) THEN
        ALTER TABLE "task_artifacts"
        ADD CONSTRAINT "task_artifacts_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tasks_current_stage_idx" ON "tasks"("current_stage");
CREATE INDEX IF NOT EXISTS "tasks_failed_stage_idx" ON "tasks"("failed_stage");
CREATE INDEX IF NOT EXISTS "task_artifacts_task_id_idx" ON "task_artifacts"("task_id");
CREATE INDEX IF NOT EXISTS "task_artifacts_artifact_type_idx" ON "task_artifacts"("artifact_type");
CREATE INDEX IF NOT EXISTS "task_artifacts_file_path_idx" ON "task_artifacts"("file_path");

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_task_artifacts_updated_at ON "task_artifacts";
CREATE TRIGGER update_task_artifacts_updated_at
BEFORE UPDATE ON "task_artifacts"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
