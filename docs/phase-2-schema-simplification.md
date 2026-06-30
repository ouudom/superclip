# Phase 2 Schema Simplification

Date: 2026-06-30

Goal:

- Remove SaaS schema from personal DB.
- Add base tables for content-engine configuration.
- Align Prisma, backend SQLAlchemy models, fresh DB SQL, and migration SQL.

## Completed

Removed SaaS fields:

- `users.notify_on_completion`
- `users.plan`
- `users.subscription_status`
- `users.stripe_customer_id`
- `users.stripe_subscription_id`
- `users.billing_period_start`
- `users.billing_period_end`
- `users.trial_ends_at`
- `tasks.completion_notification_sent_at`
- `stripe_webhook_events`

Added personal content-engine tables:

- `owner_settings`
- `model_profiles`
- `prompt_versions`
- `workflows`

Updated schema surfaces:

- `frontend/prisma/schema.prisma`
- `init.sql`
- `backend/src/models.py`
- `frontend/prisma/migrations/202606300001_personal_schema/migration.sql`
- `backend/src/migrations/sql/20260630_0001_personal_schema.sql`

Updated app/test code:

- Removed `plan` from admin user table.
- Removed billing fields from backend test factory.
- Removed dead completion-notification repository helpers.

## Verification

Passed:

- Python syntax compile for changed backend model/repository/test files.
- Runtime search found no app/test references to removed SaaS columns.

Blocked:

- Prisma validate/generate.
- Frontend tests.
- Backend full tests.

Reason:

- `frontend/node_modules` missing.
- `pnpm exec prisma validate` attempted install and hit DNS/network block.

## Important Note

Regenerate Prisma before applying this migration to a live DB:

- `cd frontend && pnpm install`
- `cd frontend && pnpm prisma generate`

Why:

- Existing committed generated Prisma client still reflects old columns until regenerated.

## Deferred

- Remove old generated Prisma artifacts after successful generate.
- Refresh `frontend/pnpm-lock.yaml` fully.
- Refresh `backend/uv.lock` fully.
- Clean old docs that still describe hosted SaaS setup.
- Wire `owner_settings`, `model_profiles`, `prompt_versions`, and `workflows` into UI/API.
