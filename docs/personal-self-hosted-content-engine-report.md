# Personal Self-Hosted Content Engine Report

Date: 2026-06-30

Goal: turn SupoClip into your own home-server content engine. One user. Auth kept. No SaaS baggage. Cheap cloud AI by default, local AI optional. YouTube + uploads now. More sources later. Outputs: TikTok, Reels, Shorts.

## North Star

Build this:

> Private content OS that ingests long videos, finds clips, lets you edit/approve them, renders platform-ready shorts, writes captions/hooks/hashtags, stores reusable workflows, and can hand tasks to Claude Code or Codex agents.

Not this:

> Multi-tenant SaaS clip generator with billing, waitlist, team plans, lifecycle emails, and growth analytics.

## Research-Backed Direction

### Market Research

Competitor pattern:

- OpusClip sells full workflow, not only clipping: virality score, animated captions, auto-posting, editor, brand templates, filler/silence removal, B-roll, 10+ import sources, XML export, multi-aspect output, scheduler, custom fonts, speech enhancement, API, team workspace.
- Descript sells editing control: text-based video editing, captions, filler removal, translation/dubbing, stock media, brand studio, collaboration, and AI assistant workflows.
- YouTube itself is adding Shorts creation tools: longer Shorts, templates, remixing, trends, and AI video generation.

Meaning:

- Plain "AI clip generator" is commodity.
- Your personal version wins by becoming a private workflow engine.
- Best moat: local library + reusable workflows + agent automation + review-before-render + no SaaS limits.

Personal target:

- One owner.
- Home server.
- Cheap cloud AI.
- Local optional.
- Outputs ready for TikTok, Reels, Shorts.
- Manual publishing first.
- Automation later.

Do not chase:

- Team workspace.
- Billing.
- Social growth analytics dashboards.
- Public template marketplace.
- Enterprise security.

Chase:

- Better clip choices.
- Faster review.
- More reusable formats.
- Lower render waste.
- Better metadata/captions/hooks.
- Durable content library.

### Platform Direction

YouTube Shorts:

- YouTube announced Shorts up to 3 minutes starting October 15, 2024.
- Square or taller videos qualify.
- YouTube is pushing templates, remixing from existing YouTube content, trend discovery, and AI-generated Shorts assets.

Implication:

- Stop treating 60 seconds as hard ceiling.
- Add platform duration presets:
  - `short`: 15-35s.
  - `standard`: 35-60s.
  - `story`: 60-120s.
  - `deep`: 120-180s.
- Let workflow choose duration.
- Keep TikTok/Reels short by default, but support 3-minute Shorts.

TikTok:

- TikTok Creative Center exposes trends, top ads, creative tools, automation, and API surfaces.
- Trend awareness matters more than generic hashtags.

Implication:

- Add trend research fields to content packages.
- Keep hashtags topic-specific.
- Add "trend note" and "sound idea" fields, even if manual at first.

Instagram Reels:

- Reels discovery favors short, shareable, consistent posts.
- Reels series/linked storytelling direction means episodic content matters.

Implication:

- Add `series_name`, `episode_number`, and `content_pillar`.
- Generate related clips as a batch, not only one-off clips.

AI platform direction:

- Platforms are adding AI creation inside their apps.
- Generic AI-generated filler will flood feeds.

Implication:

- SupoClip should emphasize source-grounded clips from real long-form material.
- Use AI for finding, packaging, and editing. Not fake content by default.

### Technical Improvements

Main technical strategy:

- Strip SaaS first.
- Then split analysis/render.
- Then introduce content engine tables.
- Then add agent integration.

Key technical changes:

- `PERSONAL_MODE=true` becomes first-class.
- Single owner auth.
- Signup locked after owner creation.
- No billing route registration.
- No waitlist route.
- No email notification services.
- No DataFast.
- Worker concurrency tuned for your laptop server.
- Schema simplified and aligned.
- Content candidates persisted before render.
- Rendering becomes explicit job, not automatic side effect.
- Prompts, model profiles, and workflows become database records.
- Agent tasks/runs/artifacts become database records.

Main risks:

- DB drift between Prisma and SQL.
- ffmpeg jobs too slow on CPU.
- Disk fills with source videos.
- Cloud AI cost invisible.
- Pipeline gets too big before review UI exists.

Guardrails:

- One schema owner.
- Worker max jobs `1`.
- Disk dashboard.
- Cost dashboard.
- Draft render before final render.
- Cleanup policy.
- Phase gates.

### Content Generation Improvements

Current pipeline:

- Transcript.
- LLM finds relevant segments.
- Render clips.

Better pipeline:

1. Ingest source.
2. Transcribe.
3. Chapter source.
4. Generate candidate spans.
5. Score candidate spans.
6. Deduplicate overlaps.
7. Save candidates.
8. Review/edit candidates.
9. Generate content package.
10. Render approved clips.
11. Store final clip + metadata.

Content package should include:

- Platform target.
- Title variants.
- Hook/opening text.
- Post caption.
- Hashtags.
- Thumbnail text.
- B-roll ideas.
- Sound/trend notes.
- Series info.
- Publish checklist.

Generation modes:

- `extract`: grounded clip spans only.
- `package`: metadata/copy around approved clips.
- `remix`: alternative hooks/captions.
- `review`: critique clip quality.
- `agent`: send structured work to Codex/Claude Code.

Quality rules:

- Never invent claims.
- Keep transcript span grounded.
- Prefer complete thought.
- Start with hook.
- End with payoff.
- Avoid sponsor/intro/filler.
- Avoid rendering until approved.

## Phased Implementation Plan

### Phase 0: Baseline Audit

Goal:

- Know exact SaaS/shared surface before cutting.
- Implementation artifact: [Phase 0 Baseline Audit](./phase-0-baseline-audit.md).

Build:

- Inventory billing/waitlist/email/DataFast files.
- Inventory DB fields tied to SaaS.
- Inventory frontend UI that references plans/pricing.
- Inventory backend routes included in app startup.
- Inventory tests that will fail after stripdown.

Done when:

- Removal checklist exists.
- No surprise shared feature remains hidden.

Risk:

- Removing billing breaks task creation if billing checks are embedded.

### Phase 1: Personal Mode Stripdown

Goal:

- Make app clean for one owner on home server.
- Implementation artifact: [Phase 1 Personal Mode Stripdown](./phase-1-personal-mode-stripdown.md).

Build:

- Add `PERSONAL_MODE=true`.
- Add `ALLOW_PUBLIC_SIGNUP=false`.
- First account becomes owner.
- Disable signup after owner exists.
- Disable billing routes.
- Disable waitlist route.
- Disable email services.
- Remove/hide pricing UI.
- Remove/hide billing settings.
- Remove DataFast tracking.
- Set worker max jobs from env.
- Default home-server worker concurrency to `1`.

DB:

- Keep old billing columns temporarily.
- Stop using them.

Done when:

- App boots without Stripe, Resend, DataFast.
- You can sign in as owner.
- You can create task.
- No billing/waitlist UI visible.

### Phase 2: Schema Simplification

Goal:

- Clean DB around personal content engine.

Build:

- Pick schema source.
- Remove unused SaaS tables/columns.
- Add migration checks.
- Align Prisma and SQL.

Remove:

- `stripe_webhook_events`.
- Stripe customer/subscription columns.
- plan/subscription fields.
- completion notification fields.

Add:

- `owner_settings`.
- `model_profiles`.
- `prompt_versions`.
- `workflows`.

Done when:

- Fresh DB boots.
- Existing personal DB migrates.
- Backend tests pass.
- Prisma generation works.

### Phase 3: Analyze Before Render

Goal:

- Stop wasting compute on bad clips.

Build:

- Add `clip_candidates`.
- Add `analysis_ready` task status.
- Store transcript.
- Store analysis JSON.
- Store candidate spans.
- Candidate review UI.
- Approve/reject/trim candidate.
- Render approved only.

UI:

- Candidate card.
- Transcript excerpt.
- Score breakdown.
- Reason.
- Duration.
- Platform target.
- Approve/reject buttons.
- Trim controls.

Done when:

- You can analyze a YouTube video without rendering.
- You can approve 1 candidate.
- Only approved candidate renders.

### Phase 4: Platform Presets

Goal:

- Produce clips shaped for TikTok/Reels/Shorts.

Build:

- `platform_presets`.
- Duration presets:
  - TikTok fast: 15-45s.
  - Reels standard: 20-60s.
  - Shorts story: 15-180s.
- Aspect presets:
  - 9:16 default.
  - 1:1 optional.
  - original optional.
- Caption presets per platform.
- Render profiles:
  - draft.
  - final.

Done when:

- Candidate can target one or more platforms.
- Render output uses preset.
- Shorts can render up to 180s.

### Phase 5: Content Packages

Goal:

- Turn clips into ready-to-post assets.

Build:

- Add `content_packages`.
- Generate:
  - title variants.
  - opening hook text.
  - post caption.
  - hashtags.
  - thumbnail text.
  - B-roll notes.
  - trend/sound notes.
- Add package editor.
- Add publish checklist.

Done when:

- Approved clip produces a complete posting package.
- You can edit and save package.
- Package links to generated clip.

### Phase 6: Content Library

Goal:

- Make old sources/clips useful.

Build:

- Search by source, topic, platform, status.
- Tags/content pillars.
- Series fields.
- Pin/archive.
- Cleanup rules.
- Disk usage page.
- Cost dashboard.

Done when:

- You can find old clips.
- You can track disk use.
- You can see monthly AI spend estimate.

### Phase 7: Workflow Presets

Goal:

- Repeat good content patterns.

Build:

- Workflow builder.
- Saved presets:
  - "Podcast to 5 Shorts."
  - "Tutorial to 3 tips."
  - "Talking head to TikTok pack."
  - "Long YouTube to Shorts series."
- Per-step model choice.
- Per-step prompt version.
- Batch run workflow.

Done when:

- You can run same workflow on new source.
- Workflow creates candidates + packages consistently.

### Phase 8: Agent Layer

Goal:

- Let Codex/Claude Code improve and operate engine.

Build:

- Add `agent_tasks`.
- Add `agent_runs`.
- Add `artifacts`.
- Export task context as Markdown/JSON.
- Prepared prompts:
  - improve prompt.
  - diagnose failed task.
  - generate workflow.
  - summarize content pattern.
  - propose implementation.
- Store agent outputs back in app.

Done when:

- App can create agent task.
- You can copy/send context to Codex/Claude Code.
- Result is saved as artifact.

### Phase 9: More Sources

Goal:

- Move beyond YouTube/uploads.

Build in order:

1. Local watched folder.
2. Podcast RSS.
3. Direct video URL.
4. Twitch/VOD.
5. Google Drive/manual import.

Done when:

- Each source maps into same `sources -> transcript -> candidates -> packages -> renders` pipeline.

### Phase 10: Publishing Assist

Goal:

- Help publish, without building fragile automation too early.

Build first:

- Export folder by platform.
- Copy caption button.
- Posting checklist.
- Posted/manual status.
- URL field after publish.

Build later:

- Scheduler.
- Platform APIs.
- Analytics import.

Done when:

- You can track what is drafted, ready, posted.

## Product Shape

Keep:

- Auth, but single-owner mode.
- YouTube ingestion.
- Upload ingestion.
- Task list.
- Clip generation.
- Captions.
- Face crop.
- B-roll.
- Admin/runtime settings.
- API keys only if useful for your own automations.
- MCP only if useful for Claude/Codex workflows.

Remove:

- Billing/Stripe.
- Waitlist.
- Marketing-hosted mode.
- Multi-user account model.
- Team features.
- Email notifications.
- Subscription emails.
- DataFast analytics.
- Plan limits.

Replace with:

- Personal dashboard.
- Local usage/cost dashboard.
- Content library.
- Workflow presets.
- Agent task queue.
- Manual review before render.
- Platform publishing checklist.

## Best Architecture

Use 4 services:

- `frontend`: Next.js app.
- `backend`: FastAPI API.
- `worker`: ARQ video/AI worker.
- `postgres` + `redis`.

Keep Docker Compose. Home server friendly.

Add later:

- `ollama`: optional local LLM.
- `whisper`: optional local transcription service, only if AssemblyAI cost/privacy becomes problem.
- `storage`: local disk first. S3/R2 optional later.

Do not add Kubernetes. Bad fit for your hardware.

## Hardware Reality

Your server:

- Lenovo IdeaPad 3 14ITL05.
- i5-1135G7.
- 12 GB RAM.
- Intel Iris Xe.
- 512 GB disk.
- Ubuntu 24.04.4 LTS.

Implications:

- CPU-only video work OK, but slow for many renders.
- No serious local LLM for best quality.
- No heavy local Whisper large model by default.
- Cloud AI default is right.
- Use queue concurrency `1` or `2`, not `4`.
- Store originals carefully; disk fills fast.
- Generate proxy previews before final render.
- Cache aggressively.

Recommended defaults:

- Worker max jobs: `1`.
- Fast mode default for exploration.
- Quality mode only for final renders.
- Limit source videos to sane size/duration.
- Auto-clean temp files.
- Keep rendered outputs, transcripts, analysis JSON.
- Delete raw downloads after configurable days unless pinned.

## Remove Shared/SaaS Features

### Frontend Remove

Remove or hide:

- `frontend/src/app/api/billing/*`
- `frontend/src/app/api/waitlist/route.ts`
- Billing buttons in settings/homepage.
- Pricing sections in landing page.
- Signup copy aimed at hosted users.
- Plan/usage prompts.
- DataFast tracking.
- Waitlist calls.

Keep:

- `/sign-in`
- `/sign-up` only for first owner setup, then disable public signup.
- `/settings`
- `/admin`
- `/list`
- `/tasks/[id]`

Better flow:

- First boot: create owner account.
- After owner exists: signup disabled.
- Login required.
- Optional `ALLOW_PUBLIC_SIGNUP=false`.

### Backend Remove

Remove or disable:

- `backend/src/api/routes/billing.py`
- `backend/src/services/billing_service.py`
- `backend/src/services/email_service.py`
- `backend/src/services/subscription_email_service.py`
- `backend/src/services/task_completion_email_service.py`
- Billing checks before task creation.
- Resend config.
- Stripe config.
- Subscription lifecycle code.

Keep:

- `tasks.py`
- `media.py`
- `admin.py`
- `api_keys.py` if using automations.
- `feedback.py` optional; better replace with local notes.

### Database Remove

Remove fields:

- `users.plan`
- `users.subscription_status`
- `users.stripe_customer_id`
- `users.stripe_subscription_id`
- `users.billing_period_start`
- `users.billing_period_end`
- `users.trial_ends_at`
- `tasks.completion_notification_sent_at`
- `stripe_webhook_events`

Keep:

- `users.is_admin`, or replace with `owner` boolean.
- `api_keys`, if automation needed.
- `app_settings`.

Add:

- `owner_settings`
- `content_sources`
- `clip_candidates`
- `render_jobs`
- `content_assets`
- `content_packages`
- `agent_runs`
- `agent_tasks`

## New Database Shape

### Core Tables

`users`

- Single owner account.
- Keep Better Auth compatibility.
- Remove billing fields.

`sources`

- One row per YouTube/upload/source URL.
- Add:
  - `provider`
  - `external_id`
  - `channel_name`
  - `duration_seconds`
  - `language`
  - `thumbnail_url`
  - `local_original_path`
  - `pinned`
  - `metadata_json`

`tasks`

- One ingestion/analysis/render workflow.
- Add:
  - `workflow_id`
  - `stage`
  - `attempt`
  - `cost_estimate_cents`
  - `actual_cost_cents`
  - `model_profile_id`
  - `agent_run_id`

`clip_candidates`

- Store AI-selected spans before render.
- Fields:
  - `source_id`
  - `task_id`
  - `start_seconds`
  - `end_seconds`
  - `text`
  - `score_json`
  - `reasoning`
  - `status`: `draft`, `approved`, `rejected`, `rendered`
  - `platform_targets`

`generated_clips`

- Keep, but enrich.
- Add:
  - `candidate_id`
  - `platform`
  - `aspect_ratio`
  - `caption_preset_id`
  - `render_profile_id`
  - `thumbnail_path`
  - `metadata_json`

`content_packages`

- One approved clip plus text assets.
- Fields:
  - `clip_id`
  - `platform`
  - `title`
  - `caption`
  - `hashtags`
  - `thumbnail_text`
  - `post_status`: `draft`, `ready`, `posted`, `archived`
  - `notes`

### Workflow Tables

`workflows`

- Reusable pipelines.
- Example: "YouTube podcast to 5 Shorts."
- Fields:
  - `name`
  - `source_types`
  - `analysis_profile_id`
  - `render_profile_id`
  - `caption_preset_id`
  - `platform_targets`
  - `steps_json`

`model_profiles`

- Cloud default, local optional.
- Fields:
  - `name`
  - `provider`: `openai`, `anthropic`, `google`, `ollama`
  - `model`
  - `purpose`: `analysis`, `copywriting`, `broll`, `review`
  - `cost_mode`
  - `enabled`

`prompt_versions`

- Store prompts like real assets.
- Fields:
  - `name`
  - `purpose`
  - `version`
  - `prompt_text`
  - `schema_json`
  - `active`

### Agent Tables

`agent_tasks`

- Work items for Claude Code/Codex.
- Fields:
  - `title`
  - `goal`
  - `context_json`
  - `input_artifact_ids`
  - `desired_output`
  - `status`
  - `priority`

`agent_runs`

- Actual agent execution log.
- Fields:
  - `agent`: `codex`, `claude_code`, `manual`
  - `task_id`
  - `prompt`
  - `result_summary`
  - `files_changed_json`
  - `artifacts_json`
  - `status`

`artifacts`

- Store transcripts, reports, scripts, prompt outputs, generated captions.
- Fields:
  - `type`
  - `path`
  - `json`
  - `source_id`
  - `clip_id`
  - `agent_run_id`

Why:

- Codex/Claude can read one task, produce files/artifacts, then app can show results.
- Agents become part of content engine, not random terminal runs.

## New User Flow

### 1. Ingest

- Paste YouTube URL or upload file.
- Choose workflow preset.
- Choose model profile.
- Start analysis.

### 2. Analyze

System generates:

- Transcript.
- Chapters.
- Clip candidates.
- Hook scores.
- Topic tags.
- B-roll ideas.
- Platform fit.

No final rendering yet.

### 3. Review

You see:

- Candidate list.
- Transcript span.
- Score.
- Reason.
- Duration.
- Platform target.
- Approve/reject.
- Trim start/end.
- Merge/split.

### 4. Package

For approved candidates:

- Generate title variants.
- Generate post captions.
- Generate hashtags.
- Generate thumbnail text.
- Pick caption template.
- Pick platform.

### 5. Render

Render only approved clips.

Modes:

- Draft render: fast, lower quality.
- Final render: slower, best quality.

### 6. Publish Prep

App produces:

- Clip file.
- Title.
- Caption.
- Hashtags.
- Thumbnail suggestion.
- Posting checklist.

Manual upload first. Auto-post later.

## Content Engine Features

### Must Build First

- Candidate review before render.
- Clip candidate database table.
- Platform presets.
- Content package generator.
- Brand/caption presets.
- Cost tracker.
- Cleanup rules.

### Next

- Content library search.
- "Regenerate copy" button.
- "Find more clips like this."
- Topic/tag system.
- Batch render.
- Draft vs final render.
- Agent task queue.

### Later

- Auto-post scheduler.
- Analytics import.
- More sources: podcast RSS, local folders, Twitch, Zoom, Google Drive.
- Sponsor/CTA remover.
- Speaker-aware clipping.
- Scene/change detection.
- Reusable series formats.

## AI Flow

Default:

- Cloud transcription: AssemblyAI.
- Cloud LLM: strong reasoning model for analysis.
- Cheaper/faster model for captions and hashtags.

Optional local:

- Ollama for cheap draft analysis.
- Whisper local for private transcription.

Recommended model routing:

- Transcript: AssemblyAI.
- Candidate selection: best cloud model.
- Copy variants: cheaper cloud model.
- Cleanup/dedup/tagging: cheap cloud or local.
- Final quality review: best cloud model.

Add provider abstraction:

- `ai_providers`
- `model_profiles`
- `prompt_versions`
- per-step model choice.

Do not hardcode one model into pipeline.

## Claude Code And Codex Support

Purpose:

- Let agents improve prompts, analyze failed tasks, generate reports, create workflow presets, write scripts, or modify code.

Needed app features:

- Agent task table.
- Export task context as Markdown/JSON.
- Store agent output as artifact.
- Link agent run to source/task/clip.
- "Send to Codex" and "Send to Claude Code" prepared prompt buttons.

Useful agent workflows:

- "Review failed render logs and suggest fix."
- "Generate new clip selection prompt for podcast clips."
- "Create 10 reusable content workflows."
- "Analyze these 20 clips and identify best pattern."
- "Write implementation PR for platform presets."

DB support:

- Agent runs need durable context.
- Prompt versions need history.
- Content artifacts need file paths.

## Implementation Checklist

P0:

- Add `PERSONAL_MODE=true`.
- Disable billing routes.
- Disable waitlist route.
- Hide pricing.
- Remove Stripe env from personal docs.
- Disable email notifications.
- Set worker concurrency to `1`.
- Add owner-only signup lock.

P1:

- Add `clip_candidates`.
- Add `content_packages`.
- Add `workflows`.
- Add `model_profiles`.
- Add `prompt_versions`.
- Split analyze/render.
- Build candidate review UI.

P2:

- Add platform presets.
- Add brand presets.
- Add draft/final render modes.
- Add local cost dashboard.
- Add cleanup/pinning rules.

P3:

- Add `agent_tasks`.
- Add `agent_runs`.
- Add artifacts.
- Add Codex/Claude handoff prompts.
- Add more sources.

## Config Recommendation

Personal `.env` should be small:

```env
PERSONAL_MODE=true
SELF_HOST=true
ALLOW_PUBLIC_SIGNUP=false

DATABASE_URL=postgresql://supoclip:supoclip_password@postgres:5432/supoclip
REDIS_HOST=redis
REDIS_PORT=6379

BETTER_AUTH_SECRET=change_this
BACKEND_AUTH_SECRET=change_this_too

ASSEMBLY_AI_API_KEY=your_key
LLM=openai:gpt-5.2
OPENAI_API_KEY=your_key

OLLAMA_BASE_URL=http://ollama:11434/v1
ENABLE_LOCAL_AI=false

WORKER_MAX_JOBS=1
TEMP_RETENTION_DAYS=3
OUTPUT_RETENTION_DAYS=365
```

Remove:

- Stripe keys.
- Resend keys.
- DataFast keys.
- paid plan limits.
- hosted price vars.

## Home Server Ops

Add admin page widgets:

- Disk used by originals.
- Disk used by renders.
- Temp folder size.
- Queue length.
- Failed jobs.
- Avg render time.
- Estimated cloud AI cost this month.
- Cleanup now button.

Add retention rules:

- Delete temp downloads after 3 days.
- Keep transcripts forever.
- Keep analysis JSON forever.
- Keep final clips until manually deleted.
- Pin source to prevent cleanup.

Backups:

- Backup Postgres daily.
- Backup `outputs/`, `transcripts/`, `analysis/`.
- Do not backup temp downloads by default.

## Business Goal, Personal Version

No business SaaS now.

Better goal:

- Build personal engine first.
- Use it to produce your own content.
- Prove quality.
- Later decide if public hosted product is worth it.

If product returns later:

- Keep personal mode as core.
- Add hosted SaaS as separate layer.
- Do not mix billing/team logic into core pipeline again.

## Research Sources

- YouTube Blog, "Tall updates coming to Shorts": Shorts up to 3 minutes from October 15, 2024; templates, remixing, trends, Veo/AI direction. https://blog.youtube/news-and-events/tall-updates-coming-to-shorts/
- YouTube Help, create Shorts: platform creation flow and Shorts surface. https://support.google.com/youtube/answer/10343433
- TikTok Creative Center: trend discovery, top ads, creative tools, and API direction. https://ads.tiktok.com/business/creativecenter
- Instagram Creators, Reels: official Reels creation and creator guidance surface. https://creators.instagram.com/creators/reels
- OpusClip pricing/features: benchmark for AI clipping workflow, captions, scheduler, B-roll, XML export, teams, and API. https://www.opus.pro/pricing
- Descript pricing/features: benchmark for text-based editing, captions, translation, brand studio, and collaboration. https://www.descript.com/pricing
- AssemblyAI pricing: cloud transcription cost reference for personal cost dashboard. https://www.assemblyai.com/pricing

## Final Recommendation

Build in this order:

1. Strip SaaS.
2. Fix schema.
3. Split analyze from render.
4. Add content packages.
5. Add workflow presets.
6. Add Codex/Claude agent tables.
7. Add more sources.

Highest leverage:

> Candidate review before render + content package generator.

This turns SupoClip from "make clips" into "make posts."
