# Phase 0 Baseline Audit

Date: 2026-06-30

Scope:

- Personal home-server SupoClip.
- Keep auth.
- Remove SaaS/shared features later.
- No behavior changes in Phase 0.

## Phase 0 Status

Done:

- SaaS file inventory.
- DB field inventory.
- Frontend billing/pricing UI inventory.
- Backend route/startup inventory.
- Test risk inventory.
- Phase 1 removal order.

Not done:

- No dependency install.
- No test execution.
- No route removal.
- No DB migration.

Reason:

- `frontend/node_modules` missing.
- `backend/.venv` missing.
- Phase 0 is audit-only.

## Current Product Shape

Current repo still acts like mixed product:

- Self-host clipper.
- Hosted SaaS.
- Billing/subscription app.
- Waitlist/marketing app remnants.
- Email notification system.
- Analytics/tracking system.
- MCP client with billing helper.

Target product:

- Single-owner content engine.
- Home server.
- Auth retained.
- No billing.
- No team.
- No waitlist.
- No outbound email notifications.
- YouTube + uploads first.

## Keep

- Better Auth login/session.
- Admin page for runtime AI keys/settings.
- API keys for local MCP/agent use.
- Task creation/list/detail/editor.
- Upload flow.
- YouTube flow.
- Worker queue.
- Postgres.
- Redis.
- Generated clips table.
- Processing cache.
- Feedback route optional, but not core.

## Remove Later

High confidence removals:

- Stripe dependency and helpers.
- Billing API routes.
- Billing backend route.
- Billing service.
- Subscription lifecycle email service.
- Task completion email service.
- Resend dependency and env.
- Waitlist route.
- DataFast tracking.
- Billing UI on home/settings.
- Billing tests.
- Billing docs.
- `stripe_webhook_events` table/model.
- Billing fields on `users`.

Keep temporarily during Phase 1:

- Old billing DB columns.
- Old Prisma migration files.
- Existing `plan` fields if removal causes migration churn.

Reason:

- DB cleanup safer after app boots without SaaS code.

## Billing/Stripe Inventory

Frontend routes:

- `frontend/src/app/api/billing/checkout/route.ts`
- `frontend/src/app/api/billing/portal/route.ts`
- `frontend/src/app/api/billing/webhook/route.ts`
- `frontend/src/app/api/tasks/billing-summary/route.ts`

Frontend tests:

- `frontend/src/app/api/billing/checkout/route.test.ts`
- `frontend/src/app/api/billing/webhook/route.test.ts`

Frontend helpers:

- `frontend/src/lib/billing-plans.ts`
- `frontend/src/lib/stripe.ts`
- `frontend/src/lib/monetization.ts`
- `frontend/src/server/billing-plans.ts`
- `frontend/src/server/stripe.ts`

Frontend UI:

- `frontend/src/app/page.tsx`
- `frontend/src/app/settings/page.tsx`
- `frontend/src/components/landing-page.tsx`
- `frontend/src/lib/blog-posts.ts`
- `frontend/src/app/blog/[slug]/page.tsx`
- `frontend/src/app/privacy/page.tsx`

Backend:

- `backend/src/api/routes/billing.py`
- `backend/src/services/billing_service.py`
- `backend/src/services/subscription_email_service.py`
- `backend/src/api/routes/tasks.py`
- `backend/src/api/routes/media.py`
- `backend/src/main.py`
- `backend/src/main_refactored.py`
- `backend/src/config.py`
- `backend/src/models.py`

Backend tests:

- `backend/tests/unit/test_billing_service.py`
- `backend/tests/fixtures/factories.py`

MCP:

- `mcp/src/supoclip_mcp/server.py`
- `mcp/README.md`

Docs/root:

- `README.md`
- `QUICKSTART.md`
- `.env.example`
- `docker-compose.yml`
- `docs/api-reference.md`
- `docs/app-guide.md`
- `docs/architecture.md`
- `docs/configuration.md`
- `docs/development.md`
- `docs/setup.md`
- `docs/troubleshooting.md`
- `docs/README.md`
- `backend/README.md`
- `init.sql`

Dependencies:

- `frontend/package.json`: `stripe`
- `backend/pyproject.toml`: `resend`
- `frontend/pnpm-lock.yaml`: Stripe package entries
- `backend/uv.lock`: Resend package entries

## Waitlist Inventory

Current waitlist surface:

- `frontend/src/app/api/waitlist/route.ts`
- `README.md`
- `QUICKSTART.md`
- `docs/api-reference.md`
- `docs/development.md`
- `docs/architecture.md`
- `docs/setup.md`
- `docs/README.md`
- `AGENTS.md`
- `CLAUDE.md`

Note:

- Repo guidance mentions `waitlist/`.
- Current checkout has no `waitlist/` directory.
- Only frontend API route remains.

## Email Notification Inventory

Backend services:

- `backend/src/services/email_service.py`
- `backend/src/services/subscription_email_service.py`
- `backend/src/services/task_completion_email_service.py`

Backend route:

- `backend/src/api/routes/billing.py`

Backend config/env:

- `backend/src/config.py`: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `docker-compose.yml`: Resend env injected into services
- `.env.example`: Resend keys

DB:

- `users.notify_on_completion`
- `tasks.completion_notification_sent_at`
- `backend/migrations/002_add_completion_notification_fields.sql`
- `frontend/prisma/migrations/20260317120000_add_task_completion_notifications/migration.sql`

Frontend:

- `frontend/src/app/settings/page.tsx`: completion email toggle
- `frontend/src/app/page.tsx`: completion email copy
- `frontend/src/app/api/preferences/route.ts`
- `frontend/src/app/api/preferences/route.test.ts`

Decision:

- Remove email sending.
- Keep local completion state only if UI needs it.
- Remove user preference toggle.

## DataFast Inventory

Files:

- `frontend/src/lib/datafast.ts`
- `frontend/src/components/datafast-identity.tsx`
- `frontend/src/app/layout.tsx`
- `frontend/src/app/page.tsx`
- `frontend/src/app/settings/page.tsx`
- `frontend/src/components/auth/sign-in.tsx`
- `frontend/src/components/auth/sign-up.tsx`
- `frontend/src/components/feedback-button.tsx`
- `frontend/next.config.ts`

Env/docs:

- `NEXT_PUBLIC_DATAFAST_WEBSITE_ID`
- `NEXT_PUBLIC_DATAFAST_DOMAIN`
- `NEXT_PUBLIC_DATAFAST_ALLOW_LOCALHOST`
- `README.md`
- `docs/configuration.md`
- `docs/setup.md`

Decision:

- Remove tracking script.
- Remove `track(...)` calls.
- Remove DataFast rewrites.
- Remove DataFast env docs.

## Backend Startup Inventory

Current startup registers billing:

- `backend/src/main.py`
  - imports `billing_router`
  - includes `app.include_router(billing_router)`

Likely refactor target:

- remove billing router import/include.
- ensure app boots without Resend/Stripe concepts.

Also inspect:

- `backend/src/main_refactored.py`

## Task Creation Risk

Hard blocker before removing billing service:

- `backend/src/api/routes/tasks.py`
  - imports `BillingService`
  - imports `BillingLimitExceeded`
  - calls `await billing_service.assert_can_create_task(user_id)`
  - returns HTTP 402 on limit/subscription failure
  - exposes `GET /tasks/billing/summary`

Phase 1 fix:

- Remove billing import.
- Remove `assert_can_create_task`.
- Remove 402 billing branch.
- Remove `/tasks/billing/summary`.
- Make frontend stop requesting billing summary first, or keep compatibility stub briefly.

Recommended order:

1. Frontend stops reading billing summary.
2. Backend task creation stops checking billing.
3. Billing routes removed.
4. Billing service removed.
5. Billing tests removed.

## Media Route Risk

`backend/src/api/routes/media.py` uses billing summary to infer storage/plan behavior.

Phase 1:

- Remove BillingService dependency.
- Replace with personal-mode default behavior.
- No plan-based media limits.

## Frontend UI Risk

`frontend/src/app/page.tsx` has billing state and gates task creation UI.

Remove:

- billing summary fetch.
- plan badge.
- upgrade-required state.
- paid plan checks.
- billing progress bars.
- billing copy.
- checkout/portal links.
- DataFast task/billing tracking calls.

`frontend/src/app/settings/page.tsx` has billing panel and completion email toggle.

Remove:

- billing summary fetch.
- checkout/portal actions.
- billing section.
- completion email preference.
- DataFast calls.

## DB SaaS Fields

Current SaaS fields in `users`:

- `plan`
- `subscription_status`
- `stripe_customer_id`
- `stripe_subscription_id`
- `billing_period_start`
- `billing_period_end`
- `trial_ends_at`

Current email notification fields:

- `users.notify_on_completion`
- `tasks.completion_notification_sent_at`

Current Stripe table:

- `stripe_webhook_events`

Recommendation:

- Phase 1: leave columns/table.
- Phase 2: add personal schema migration that removes SaaS fields.

## DB Drift Found

`init.sql` has tables/columns not fully mirrored in `frontend/prisma/schema.prisma`:

- `generated_clips`
- `processing_cache`
- `api_keys`
- `tasks.processing_mode`
- `tasks.started_at`
- `tasks.completed_at`
- `tasks.cache_hit`
- `tasks.error_code`
- `tasks.stage_timings_json`

Risk:

- Prisma schema does not describe full backend DB.
- Future migrations may accidentally drop or ignore backend-owned tables.

Phase 2 target:

- Decide single source of truth.
- Prefer backend migrations for pipeline tables.
- Keep Prisma focused on Better Auth/user/settings if desired.
- Or mirror all tables in Prisma before new migrations.

## Tests That Will Change

Remove or rewrite:

- `backend/tests/unit/test_billing_service.py`
- `frontend/src/app/api/billing/checkout/route.test.ts`
- `frontend/src/app/api/billing/webhook/route.test.ts`

Update:

- `backend/tests/unit/test_task_service.py`
- `backend/tests/integration/test_health_and_tasks.py`
- `frontend/src/app/api/tasks/create/route.test.ts`
- `frontend/src/app/api/tasks/route.test.ts`
- `frontend/src/app/api/preferences/route.test.ts`
- `frontend/e2e/app.spec.ts`

Coverage config risk:

- `backend/pyproject.toml` forces coverage on `src.services.billing_service`.
- Removing billing service requires coverage config update.

## Test Baseline

Available commands:

- `cd backend && uv sync && uv run pytest`
- `cd frontend && pnpm install && pnpm test`
- `cd frontend && pnpm lint`

Not run:

- Backend tests.
- Frontend tests.
- Frontend lint.

Reason:

- Dependencies not installed.
- Network install not requested in Phase 0.

## Phase 1 Removal Checklist

Start here:

- [ ] Remove billing summary fetch/state from `frontend/src/app/page.tsx`.
- [ ] Remove billing UI from `frontend/src/app/page.tsx`.
- [ ] Remove billing summary fetch/actions/UI from `frontend/src/app/settings/page.tsx`.
- [ ] Remove completion email toggle/copy from settings/home.
- [ ] Remove DataFast script from `frontend/src/app/layout.tsx`.
- [ ] Remove `track(...)` calls from frontend.
- [ ] Remove DataFast rewrites from `frontend/next.config.ts`.
- [ ] Remove billing check from `backend/src/api/routes/tasks.py`.
- [ ] Remove `/tasks/billing/summary`.
- [ ] Remove billing dependency from `backend/src/api/routes/media.py`.
- [ ] Remove billing router registration from `backend/src/main.py`.
- [ ] Remove billing router registration from `backend/src/main_refactored.py` if present.
- [ ] Remove frontend billing API routes.
- [ ] Remove waitlist API route.
- [ ] Remove email services.
- [ ] Remove billing service.
- [ ] Remove billing/email tests.
- [ ] Update backend coverage config.
- [ ] Update env/docs after code compiles.

Stop before:

- DB column drops.
- Prisma migration cleanup.
- Lockfile dependency pruning.

Those belong to Phase 2.

## Phase 0 Verdict

Ready for Phase 1.

Main risk:

- Billing is embedded in task creation and media behavior.

Best strategy:

- Strip frontend billing dependence first.
- Strip backend task/media billing second.
- Leave DB fields until Phase 2.
