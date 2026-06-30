# SupoClip Improvement Report

Date: 2026-06-30

## Executive Summary

SupoClip has strong bones: open-source positioning, self-hosting, no watermark, async video pipeline, word-timed captions, face-aware reframing, billing, API keys, MCP integration, and basic tests.

Main gap: it still feels like "clip generator" more than "creator production system." Market leaders sell workflow: ingest, select, edit, brand, publish, measure, repeat.

Best path: keep open-source/self-host as wedge, then build hosted value around reliability, output quality, team workflows, and content iteration.

## Current Product Baseline

Observed repo capabilities:

- Backend: FastAPI, ARQ worker, Redis, Postgres, AssemblyAI transcription, Pydantic AI segment analysis, ffmpeg/OpenCV/MediaPipe video processing.
- Frontend: Next.js 15, React 19, Better Auth, Prisma, Stripe billing, admin settings, feedback, task list, task detail, upload route.
- Content intelligence: clip selection prompt, virality sub-scores, B-roll opportunities, caption templates, emoji captions, cleanup filters.
- Ops: Docker Compose, GitHub Actions, backend unit/integration tests, frontend Vitest, Playwright smoke tests.
- Monetization: free/pro/scale plan model, Stripe webhooks, user plan fields.

Important mismatch:

- Project doc says no mature automated suite, but repo now has `pytest`, `Vitest`, `Playwright`, `Makefile`, and CI.
- Docs mention `waitlist/`, but current repo snapshot does not include that app.
- Prisma schema does not model generated clips, API keys, processing cache, or detailed task runtime fields even though `init.sql` does. This creates schema drift risk.

## Market Research

### Competitive Pattern

OpusClip pricing page shows the category baseline: virality score, animated captions, auto-posting, editor, brand templates, filler/silence removal, B-roll, 10+ input sources, Adobe Premiere/DaVinci XML export, multiple aspect ratios, social scheduler, custom fonts, speech enhancement, team workspace, API access, and enterprise security.

Descript competes from editing workflow: text-based editing, podcast/screen recording, captions, clips, Studio Sound, filler removal, translation/dubbing, brand studio, AI avatars, stock media, collaboration, and enterprise controls.

This means SupoClip cannot win hosted users on "AI clips" alone. It can win on:

- Open-source trust.
- No watermark.
- Self-host/private workflow.
- Developer/API/MCP control.
- Lower marginal cost for heavy creators.
- Transparent, inspectable generation.

### Platform Direction

YouTube Shorts now supports uploads up to 3 minutes for square/taller videos. This makes SupoClip's fixed 15-60 second default too narrow. Product should support clip duration strategies: `15-30s`, `30-60s`, `60-180s`, and "platform adaptive."

TikTok/Shorts/Reels discovery still rewards fast hooks, captions, trend fit, retention, and repeatable formats. SupoClip should treat content generation as an optimization loop, not one-pass extraction.

### Cost Reality

AssemblyAI Universal-2 is priced around $0.15/hour, Universal-3.5 Pro around $0.21/hour, with diarization add-ons. LLM costs vary by provider/model. Video rendering compute likely dominates at scale when users upload long files or request many variants.

Implication: pricing should meter by source minutes, rendered clips, and premium features, not only "generations." Cache hits and rerenders should be cheaper/free where possible.

## Technical Improvements

### P0: Fix Schema Drift

Problem:

- Frontend Prisma schema lacks tables/fields that backend and `init.sql` use: `generated_clips`, `processing_cache`, `api_keys`, task runtime fields.
- Dual schema source creates migration bugs.

Actions:

- Make Prisma or SQL migrations the single source of truth.
- Add missing models to `frontend/prisma/schema.prisma` or move frontend DB access away from shared app tables.
- Add migration verification in CI: bootstrap DB, run Prisma migrate/generate, run backend tests against same schema.

Impact:

- Fewer prod-only failures.
- Safer billing/auth/task changes.

### P0: Harden Processing Pipeline

Problem:

- Worker has retries and dead-letter keys, but no user/admin retry UI, no job lease dashboard, no queue metrics page.
- Long video operations can fail from ffmpeg, remote downloads, transcript timeout, rate limits, or bad input.

Actions:

- Add task retry endpoint and admin retry button.
- Persist structured failure stage: `download`, `transcribe`, `analyze`, `render`, `upload/save`.
- Add queue metrics: queued count, active jobs, failed jobs, average stage time, cache-hit rate.
- Add idempotency key per task processing attempt.
- Add per-user concurrency and source-minute limits.

Impact:

- Hosted reliability.
- Better support/debugging.
- Lower infrastructure surprise.

### P1: Split Analysis From Rendering

Problem:

- Current task flow tends toward "analyze then render all selected clips."
- Users need review before expensive rendering.

Actions:

- Add intermediate `analysis_ready` state.
- Store candidate segments before rendering.
- Let user select/edit candidates, duration, aspect ratio, caption style, then render.
- Charge/render only chosen candidates.

Impact:

- Lower compute.
- Better creator control.
- Higher perceived quality.

### P1: Add Evaluation Harness For Clip Quality

Problem:

- Prompt is detailed, but quality cannot improve predictably without benchmark videos and scoring.

Actions:

- Create `backend/evals/` with transcript fixtures and expected clip spans.
- Track span overlap, duration compliance, hallucination rate, hook strength, self-contained score.
- Test multiple LLM providers and processing modes.
- Save prompt/version metadata with each task.

Impact:

- Safer prompt edits.
- Easier model switching.
- Better viral-selection quality over time.

### P1: Improve Storage Architecture

Problem:

- Local temp files fit self-host, but hosted needs durable object storage.

Actions:

- Add storage provider interface: local, S3/R2, GCS.
- Store originals, transcripts, analysis JSON, rendered clips, thumbnails, waveform/proxy assets.
- Add lifecycle cleanup policies by plan.
- Add signed URLs for downloads/streaming.

Impact:

- Hosted scale.
- Easier enterprise/private deployments.

### P1: Frontend Product UX

Problem:

- App has task list/detail, but category winners offer editor-like control.

Actions:

- Add transcript timeline with selectable spans.
- Add clip cards with hook, score, reason, transcript excerpt, duration, aspect.
- Add batch actions: render selected, export all, regenerate candidates, change style.
- Add before-render preview using low-res/proxy assets.
- Add compare mode for caption templates.

Impact:

- More creator agency.
- Less "black box" frustration.

### P2: Observability And Security

Actions:

- Add OpenTelemetry traces across frontend API, backend, worker, ffmpeg stages.
- Add Sentry or equivalent error reporting.
- Add request IDs and user/task IDs to structured logs.
- Add upload scanning/validation: file type, duration, resolution, size, suspicious URL rules.
- Add SSRF protection for video URL ingestion.
- Add rate limits per IP/user/API key.
- Add API key scopes.

Impact:

- Safer hosted app.
- Better enterprise story.

## Business Improvements

### Positioning

Current README begins aggressive against OpusClip. Good for hacker attention, risky for mainstream trust.

Recommended positioning:

- Primary: "Open-source AI clipping for creators and teams who want control."
- Secondary: "Hosted when you want convenience. Self-hosted when privacy, cost, or customization matter."
- Proof points: no watermark, self-hostable, inspectable prompts, API/MCP, custom LLM/provider support.

### Target Segments

Start narrow:

- Podcast agencies clipping long interviews.
- Developer educators and technical YouTubers.
- B2B founders turning webinars/demos into Shorts/Reels/LinkedIn clips.
- Internal enterprise enablement teams needing private/self-hosted video workflows.

Avoid generic creator market first. Too crowded, high churn, low willingness to debug.

### Pricing

Move from simple generation count to cost-aligned usage:

- Free self-host: unlimited local, bring your own keys.
- Hosted Free: low monthly source-minute cap, watermark-free but limited exports/storage.
- Creator: source minutes + rendered clips + basic templates.
- Pro/Team: brand kits, custom fonts, team seats, scheduler, exports, API.
- Enterprise: SSO, private storage, custom models, audit logs, VPC/self-host support.

Meter:

- Source minutes processed.
- Rendered clip minutes.
- Premium transcription/model modes.
- Storage duration.
- Team/API usage.

### Distribution

Best growth loops:

- GitHub README with demo video, one-command Docker, example outputs.
- "Made with SupoClip" optional badge only for free hosted, never forced watermark.
- Template gallery: podcast, tutorial, sermon, webinar, gaming, product demo.
- Public benchmark page: SupoClip vs manual clipping time/cost.
- Creator SEO pages: "YouTube to Shorts", "Podcast to clips", "Webinar to reels", "Open-source OpusClip alternative."
- MCP/API examples for automated creator workflows.

### Trust

Add:

- Public roadmap.
- Security page.
- Data retention policy.
- Model/provider cost calculator.
- Self-host deployment guide for GPU/CPU/cloud.
- Example outputs from real long-form videos.

## Content Generation Improvements

### Candidate Generation

Current prompt selects grounded spans and scores virality. Good base.

Add multi-pass generation:

1. Segment transcript into topic chapters.
2. Identify hooks, claims, stories, examples, emotional peaks.
3. Generate candidates by platform duration target.
4. Score candidates with rubric.
5. Deduplicate overlapping spans.
6. Repair start/end to sentence boundaries.
7. Produce title/caption/hashtags per clip.

### Platform-Aware Output

Add export profiles:

- TikTok: fast hook, 15-45s, bolder captions, trend-style title.
- Reels: polished captions, 20-60s, visual consistency.
- Shorts: 15-180s, searchable title, retention-focused structure.
- LinkedIn: 30-90s, professional headline, cleaner template.

### Hook And Caption Variants

For each clip, generate:

- 5 title hooks.
- 3 on-screen opening lines.
- 3 post captions.
- Hashtags by topic, not generic spam.
- Thumbnail text.
- First-frame recommendation.

Keep source-grounded. Do not invent claims beyond transcript.

### Brand Kits

Add reusable brand assets:

- Fonts.
- Colors.
- Caption template.
- Logo bug.
- Intro/outro toggle.
- Profanity/censor preferences.
- Preferred platforms.
- Forbidden words and required vocabulary.

### Content Calendar

Add:

- Export schedule.
- Status: draft, approved, scheduled, posted.
- Platform metadata per clip.
- UTM/campaign fields.
- Performance import/manual metrics.

This shifts product from tool to workflow.

## 90-Day Roadmap

### Month 1: Reliability And Schema

- Resolve DB schema drift.
- Add task retry and structured failure stages.
- Add queue/admin metrics.
- Add source-minute/render-minute usage tracking.
- Add analysis-ready state.
- Add eval fixtures for prompt quality.

### Month 2: Creator Control

- Transcript timeline editor.
- Candidate review before rendering.
- Batch render/export.
- Duration/platform presets including 60-180s Shorts.
- Hook/title/caption/hashtag generation.
- Brand kit v1.

### Month 3: Growth And Monetization

- Public template gallery.
- Pricing aligned to minutes/render/storage/team.
- Storage provider abstraction.
- Scheduler/export integrations.
- Case-study landing pages.
- API scopes and MCP workflow examples.

## KPI Dashboard

Technical:

- Task success rate.
- Median and p95 processing time per source minute.
- Stage failure rate.
- Cache-hit rate.
- Render cost per clip.
- Queue wait time.

Product:

- Source minutes processed per user.
- Candidates accepted/rendered.
- Clips downloaded/exported.
- Regeneration rate.
- Time from upload to first export.
- Repeat weekly creators.

Business:

- Free-to-paid conversion.
- Gross margin per plan.
- Retention by segment.
- Support tickets per 100 tasks.
- Team invites.
- API/MCP active users.

Content quality:

- User-selected candidate rank.
- Manual trim frequency.
- Caption template selection.
- Hook variant selected.
- Post-export performance when user connects analytics.

## Highest-Leverage Bet

Build "review before render" plus platform-aware content pack.

Why:

- Reduces compute cost.
- Improves perceived quality.
- Creates upsell surface.
- Differentiates from black-box clip generators.
- Uses existing strengths: transcript, scores, captions, rendering.

Minimum useful version:

- Generate 10 candidates.
- Show transcript span, reason, score, duration.
- User selects 3.
- Generate titles/captions/hashtags.
- Render selected clips with chosen brand kit.

## Research Sources

- YouTube Blog: "Tall updates coming to Shorts" confirms Shorts up to 3 minutes from October 15, 2024. https://blog.youtube/news-and-events/tall-updates-coming-to-shorts/
- OpusClip pricing/features: market baseline for AI clipping, captions, virality score, B-roll, scheduler, XML export, teams, API. https://www.opus.pro/pricing
- Descript pricing/features: benchmark for creator workflow, text editing, AI tools, brand studio, translation, collaboration. https://www.descript.com/pricing
- AssemblyAI pricing: speech-to-text and add-on cost assumptions. https://www.assemblyai.com/pricing
- TikTok Creative Center: trend discovery/product direction reference. https://ads.tiktok.com/creative/creativeCenter/trends

