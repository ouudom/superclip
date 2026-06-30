DROP TABLE IF EXISTS stripe_webhook_events;

ALTER TABLE users
DROP COLUMN IF EXISTS notify_on_completion,
DROP COLUMN IF EXISTS plan,
DROP COLUMN IF EXISTS subscription_status,
DROP COLUMN IF EXISTS stripe_customer_id,
DROP COLUMN IF EXISTS stripe_subscription_id,
DROP COLUMN IF EXISTS billing_period_start,
DROP COLUMN IF EXISTS billing_period_end,
DROP COLUMN IF EXISTS trial_ends_at;

ALTER TABLE tasks
DROP COLUMN IF EXISTS completion_notification_sent_at;

CREATE TABLE IF NOT EXISTS owner_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_profiles (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name VARCHAR(100) NOT NULL UNIQUE,
    provider VARCHAR(40) NOT NULL,
    model VARCHAR(160) NOT NULL,
    purpose VARCHAR(80) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    settings_json TEXT NOT NULL DEFAULT '{}',
    updated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompt_versions (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name VARCHAR(120) NOT NULL,
    purpose VARCHAR(80) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    prompt_text TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    updated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, version)
);

CREATE TABLE IF NOT EXISTS workflows (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    source_type VARCHAR(40) NOT NULL DEFAULT 'youtube',
    output_target VARCHAR(40) NOT NULL DEFAULT 'shorts',
    config_json TEXT NOT NULL DEFAULT '{}',
    is_default BOOLEAN NOT NULL DEFAULT false,
    updated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_owner_settings_updated_by ON owner_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_model_profiles_purpose ON model_profiles(purpose);
CREATE INDEX IF NOT EXISTS idx_model_profiles_is_default ON model_profiles(is_default);
CREATE INDEX IF NOT EXISTS idx_model_profiles_updated_by ON model_profiles(updated_by);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_purpose ON prompt_versions(purpose);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_is_active ON prompt_versions(is_active);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_updated_by ON prompt_versions(updated_by);
CREATE INDEX IF NOT EXISTS idx_workflows_source_type ON workflows(source_type);
CREATE INDEX IF NOT EXISTS idx_workflows_output_target ON workflows(output_target);
CREATE INDEX IF NOT EXISTS idx_workflows_is_default ON workflows(is_default);
CREATE INDEX IF NOT EXISTS idx_workflows_updated_by ON workflows(updated_by);
