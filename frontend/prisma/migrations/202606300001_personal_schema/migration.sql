DROP TABLE IF EXISTS "stripe_webhook_events";

ALTER TABLE "users"
DROP COLUMN IF EXISTS "notify_on_completion",
DROP COLUMN IF EXISTS "plan",
DROP COLUMN IF EXISTS "subscription_status",
DROP COLUMN IF EXISTS "stripe_customer_id",
DROP COLUMN IF EXISTS "stripe_subscription_id",
DROP COLUMN IF EXISTS "billing_period_start",
DROP COLUMN IF EXISTS "billing_period_end",
DROP COLUMN IF EXISTS "trial_ends_at";

ALTER TABLE "tasks"
DROP COLUMN IF EXISTS "completion_notification_sent_at";

CREATE TABLE IF NOT EXISTS "owner_settings" (
    "setting_key" VARCHAR(100) PRIMARY KEY,
    "value_json" TEXT NOT NULL,
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "owner_settings_updated_by_fkey"
        FOREIGN KEY ("updated_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "model_profiles" (
    "id" TEXT PRIMARY KEY,
    "name" VARCHAR(100) NOT NULL UNIQUE,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(160) NOT NULL,
    "purpose" VARCHAR(80) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "settings_json" TEXT NOT NULL DEFAULT '{}',
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "model_profiles_updated_by_fkey"
        FOREIGN KEY ("updated_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "prompt_versions" (
    "id" TEXT PRIMARY KEY,
    "name" VARCHAR(120) NOT NULL,
    "purpose" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "prompt_text" TEXT NOT NULL,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prompt_versions_updated_by_fkey"
        FOREIGN KEY ("updated_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "prompt_versions_name_version_key" UNIQUE ("name", "version")
);

CREATE TABLE IF NOT EXISTS "workflows" (
    "id" TEXT PRIMARY KEY,
    "name" VARCHAR(120) NOT NULL UNIQUE,
    "description" TEXT,
    "source_type" VARCHAR(40) NOT NULL DEFAULT 'youtube',
    "output_target" VARCHAR(40) NOT NULL DEFAULT 'shorts',
    "config_json" TEXT NOT NULL DEFAULT '{}',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflows_updated_by_fkey"
        FOREIGN KEY ("updated_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "owner_settings_updated_by_idx" ON "owner_settings"("updated_by");
CREATE INDEX IF NOT EXISTS "model_profiles_purpose_idx" ON "model_profiles"("purpose");
CREATE INDEX IF NOT EXISTS "model_profiles_is_default_idx" ON "model_profiles"("is_default");
CREATE INDEX IF NOT EXISTS "model_profiles_updated_by_idx" ON "model_profiles"("updated_by");
CREATE INDEX IF NOT EXISTS "prompt_versions_purpose_idx" ON "prompt_versions"("purpose");
CREATE INDEX IF NOT EXISTS "prompt_versions_is_active_idx" ON "prompt_versions"("is_active");
CREATE INDEX IF NOT EXISTS "prompt_versions_updated_by_idx" ON "prompt_versions"("updated_by");
CREATE INDEX IF NOT EXISTS "workflows_source_type_idx" ON "workflows"("source_type");
CREATE INDEX IF NOT EXISTS "workflows_output_target_idx" ON "workflows"("output_target");
CREATE INDEX IF NOT EXISTS "workflows_is_default_idx" ON "workflows"("is_default");
CREATE INDEX IF NOT EXISTS "workflows_updated_by_idx" ON "workflows"("updated_by");
