-- Phase 8: local agent workspace for Codex/Claude handoff.

CREATE TABLE IF NOT EXISTS agent_tasks (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id VARCHAR(36) REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    agent_type VARCHAR(60) NOT NULL DEFAULT 'codex',
    status VARCHAR(40) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_id ON agent_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_task_id ON agent_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at ON agent_tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
    id VARCHAR(36) PRIMARY KEY,
    agent_task_id VARCHAR(36) NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id VARCHAR(36) REFERENCES tasks(id) ON DELETE CASCADE,
    agent_key VARCHAR(80) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'draft',
    prompt_text TEXT NOT NULL,
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_text TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_task_id ON agent_runs(agent_task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id ON agent_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_key ON agent_runs(agent_key);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS agent_artifacts (
    id VARCHAR(36) PRIMARY KEY,
    agent_run_id VARCHAR(36) NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    artifact_type VARCHAR(60) NOT NULL,
    text_value TEXT,
    json_value JSONB,
    file_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_agent_run_id ON agent_artifacts(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_artifact_type ON agent_artifacts(artifact_type);
