# Phase 1 Personal Mode Stripdown

Date: 2026-06-30

Goal:

- Make runtime personal/self-hosted first.
- Remove shared SaaS behavior.
- Keep auth.
- Keep DB columns until Phase 2.

## Completed

Removed runtime billing:

- Deleted frontend billing API routes.
- Deleted backend billing route.
- Deleted backend billing service.
- Removed billing router registration.
- Removed billing check from task creation.
- Removed billing summary endpoint and frontend calls.
- Removed paid-plan gate from home page.
- Removed paid-plan gate from custom font upload.
- Removed billing panel from settings.
- Removed billing tests and coverage target.

Removed waitlist:

- Deleted frontend waitlist API route.

Removed email notifications:

- Deleted Resend email services.
- Removed completion email send from task processing.
- Removed completion email toggle from settings.
- Removed completion email copy from home page.
- Removed Resend config fields.

Removed DataFast:

- Deleted DataFast helper and identity component.
- Removed DataFast script injection.
- Removed DataFast rewrites.
- Removed tracking calls from auth, feedback, settings, and task creation.

Removed marketing entry:

- Deleted landing page component.
- Unauthenticated home now shows simple personal sign-in/create-account screen.

Added personal-server defaults:

- First signup is allowed and promoted to admin owner.
- Later public signup is blocked by default.
- `ALLOW_PUBLIC_SIGNUP=true` reopens signup if needed.
- `DISABLE_SIGN_UP=true` hard-blocks all signup.
- Worker concurrency now reads `WORKER_MAX_JOBS`.
- Default self-host worker concurrency is `1`.

Updated MCP:

- Removed billing summary tool.
- API key verification now checks `/tasks/`.

## Files Deleted

- `frontend/src/app/api/billing/checkout/route.ts`
- `frontend/src/app/api/billing/checkout/route.test.ts`
- `frontend/src/app/api/billing/portal/route.ts`
- `frontend/src/app/api/billing/webhook/route.ts`
- `frontend/src/app/api/billing/webhook/route.test.ts`
- `frontend/src/app/api/tasks/billing-summary/route.ts`
- `frontend/src/app/api/waitlist/route.ts`
- `frontend/src/components/datafast-identity.tsx`
- `frontend/src/components/landing-page.tsx`
- `frontend/src/lib/billing-plans.ts`
- `frontend/src/lib/datafast.ts`
- `frontend/src/lib/stripe.ts`
- `frontend/src/server/billing-plans.ts`
- `frontend/src/server/stripe.ts`
- `backend/src/api/routes/billing.py`
- `backend/src/services/billing_service.py`
- `backend/src/services/email_service.py`
- `backend/src/services/subscription_email_service.py`
- `backend/src/services/task_completion_email_service.py`
- `backend/tests/unit/test_billing_service.py`

## Files Updated

- `.env.example`
- `backend/.env.example`
- `docker-compose.yml`
- `frontend/Dockerfile`

## Verification

Passed:

- Python syntax compile for touched backend/MCP files.
- Search for deleted imports/routes returned no runtime hits.

Blocked:

- Full frontend tests/lint.
- Full backend tests.
- Full lockfile refresh.

Reason:

- `frontend/node_modules` missing.
- `backend/.venv` missing.
- `pnpm install --lockfile-only --ignore-scripts` hit DNS/network block.

Manual lock note:

- Removed `resend` and `stripe` from `frontend/package.json`.
- Removed top-level `resend` and `stripe` importer entries from `frontend/pnpm-lock.yaml`.
- Deeper orphan lock entries remain until next successful `pnpm install --lockfile-only`.
- `backend/uv.lock` still contains orphan `resend` entries until next successful `uv lock`.
- Root docs like `README.md`, `QUICKSTART.md`, and `backend/README.md` still contain old hosted/SaaS setup notes.

## Deferred To Phase 2

- Drop billing columns from DB.
- Drop `stripe_webhook_events`.
- Remove notification columns.
- Regenerate Prisma client.
- Refresh lockfiles fully.
- Clean old migrations/docs.
