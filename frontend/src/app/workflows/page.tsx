"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Play, Save, Trash2 } from "lucide-react";
import { StudioShell } from "@/components/studio-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth-client";
import { formatSupportMessage, parseApiError } from "@/lib/api-error";

interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  source_type: string;
  output_target: string;
  config: Record<string, unknown>;
  is_default: boolean;
  updated_at: string;
}

interface WorkflowDraft {
  name: string;
  description: string;
  source_type: string;
  output_target: string;
  is_default: boolean;
  processing_mode: string;
  output_format: string;
  add_subtitles: boolean;
  include_broll: boolean;
  cut_long_pauses: boolean;
  pause_threshold_ms: string;
  remove_filler_words: boolean;
  filtered_words: string;
  target_candidates: string;
  platforms: string[];
  transcribe_model_profile: string;
  analyze_prompt_version: string;
  review_manual: boolean;
  render_profile: string;
  caption_template: string;
  font_family: string;
  font_size: string;
  font_color: string;
}

const EMPTY_DRAFT: WorkflowDraft = {
  name: "",
  description: "",
  source_type: "youtube",
  output_target: "shorts",
  is_default: false,
  processing_mode: "fast",
  output_format: "vertical",
  add_subtitles: true,
  include_broll: false,
  cut_long_pauses: false,
  pause_threshold_ms: "900",
  remove_filler_words: false,
  filtered_words: "",
  target_candidates: "4",
  platforms: ["shorts", "reels", "tiktok"],
  transcribe_model_profile: "default_transcription",
  analyze_prompt_version: "clip_candidates",
  review_manual: true,
  render_profile: "final",
  caption_template: "default",
  font_family: "TikTokSans-Regular",
  font_size: "24",
  font_color: "#FFFFFF",
};

async function buildSupportError(response: Response, fallbackMessage: string) {
  const parsed = await parseApiError(response, fallbackMessage);
  return formatSupportMessage(parsed);
}

function draftFromWorkflow(workflow: Workflow): WorkflowDraft {
  const config = workflow.config || {};
  const steps = Array.isArray(config.steps) ? config.steps : [];
  const stepConfig = (key: string) =>
    steps.find((step) => typeof step === "object" && step && (step as { key?: unknown }).key === key) as
      | Record<string, unknown>
      | undefined;
  const platforms = Array.isArray(config.platforms)
    ? config.platforms.filter((platform): platform is string => typeof platform === "string")
    : ["shorts", "reels", "tiktok"];

  return {
    name: workflow.name,
    description: workflow.description || "",
    source_type: workflow.source_type || "youtube",
    output_target: workflow.output_target || "shorts",
    is_default: workflow.is_default,
    processing_mode: typeof config.processing_mode === "string" ? config.processing_mode : "fast",
    output_format: typeof config.output_format === "string" ? config.output_format : "vertical",
    add_subtitles: typeof config.add_subtitles === "boolean" ? config.add_subtitles : true,
    include_broll: typeof config.include_broll === "boolean" ? config.include_broll : false,
    cut_long_pauses: typeof config.cut_long_pauses === "boolean" ? config.cut_long_pauses : false,
    pause_threshold_ms:
      typeof config.pause_threshold_ms === "number" ? String(config.pause_threshold_ms) : "900",
    remove_filler_words:
      typeof config.remove_filler_words === "boolean" ? config.remove_filler_words : false,
    filtered_words: Array.isArray(config.filtered_words)
      ? config.filtered_words.filter((word): word is string => typeof word === "string").join(", ")
      : "",
    target_candidates:
      typeof config.target_candidates === "number" ? String(config.target_candidates) : "4",
    platforms,
    transcribe_model_profile:
      typeof stepConfig("transcribe")?.model_profile === "string"
        ? String(stepConfig("transcribe")?.model_profile)
        : "default_transcription",
    analyze_prompt_version:
      typeof stepConfig("analyze")?.prompt_version === "string"
        ? String(stepConfig("analyze")?.prompt_version)
        : "clip_candidates",
    review_manual:
      typeof stepConfig("review")?.manual === "boolean" ? Boolean(stepConfig("review")?.manual) : true,
    render_profile:
      typeof stepConfig("render")?.render_profile === "string"
        ? String(stepConfig("render")?.render_profile)
        : "final",
    caption_template: typeof config.caption_template === "string" ? config.caption_template : "default",
    font_family: typeof config.font_family === "string" ? config.font_family : "TikTokSans-Regular",
    font_size: typeof config.font_size === "number" ? String(config.font_size) : "24",
    font_color: typeof config.font_color === "string" ? config.font_color : "#FFFFFF",
  };
}

function csvToWords(value: string) {
  return value
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
}

export default function WorkflowsPage() {
  const { data: session, isPending } = useSession();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(EMPTY_DRAFT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedId) || null,
    [selectedId, workflows],
  );

  const loadWorkflows = async () => {
    if (!session?.user?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workflows", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to load presets"));
      }
      const data = await response.json();
      const nextWorkflows = (data.workflows || []) as Workflow[];
      setWorkflows(nextWorkflows);
      if (!selectedId && nextWorkflows.length > 0) {
        setSelectedId(nextWorkflows[0].id);
        setDraft(draftFromWorkflow(nextWorkflows[0]));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load presets");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const selectWorkflow = (workflow: Workflow) => {
    setSelectedId(workflow.id);
    setDraft(draftFromWorkflow(workflow));
    setNotice(null);
    setError(null);
  };

  const createNew = () => {
    setSelectedId(null);
    setDraft({ ...EMPTY_DRAFT });
    setNotice(null);
    setError(null);
  };

  const duplicateSelected = () => {
    const source = selectedWorkflow;
    if (!source) return;
    setSelectedId(null);
    setDraft({
      ...draftFromWorkflow(source),
      name: `${source.name} Copy`,
      is_default: false,
    });
  };

  const buildConfig = () => {
    const pauseThreshold = Number(draft.pause_threshold_ms);
    const targetCandidates = Number(draft.target_candidates);
    const fontSize = Number(draft.font_size);

    if (!Number.isFinite(pauseThreshold) || pauseThreshold < 250 || pauseThreshold > 3000) {
      throw new Error("Pause threshold must be 250-3000 ms.");
    }
    if (!Number.isFinite(targetCandidates) || targetCandidates < 1 || targetCandidates > 20) {
      throw new Error("Target candidates must be 1-20.");
    }
    if (!Number.isFinite(fontSize) || fontSize < 12 || fontSize > 72) {
      throw new Error("Font size must be 12-72.");
    }

    return {
      ...(selectedWorkflow?.config || {}),
      processing_mode: draft.processing_mode,
      output_format: draft.output_format,
      add_subtitles: draft.add_subtitles,
      include_broll: draft.include_broll,
      cut_long_pauses: draft.cut_long_pauses,
      pause_threshold_ms: Math.round(pauseThreshold),
      remove_filler_words: draft.remove_filler_words,
      filtered_words: csvToWords(draft.filtered_words),
      target_candidates: Math.round(targetCandidates),
      caption_template: draft.caption_template,
      font_family: draft.font_family,
      font_size: Math.round(fontSize),
      font_color: /^#[0-9A-Fa-f]{6}$/.test(draft.font_color) ? draft.font_color : "#FFFFFF",
      steps: [
        { key: "transcribe", model_profile: draft.transcribe_model_profile },
        { key: "analyze", prompt_version: draft.analyze_prompt_version },
        { key: "review", manual: draft.review_manual },
        { key: "render", render_profile: draft.render_profile },
      ],
      platforms: draft.platforms,
    };
  };

  const togglePlatform = (platform: string, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      platforms: checked
        ? Array.from(new Set([...current.platforms, platform]))
        : current.platforms.filter((item) => item !== platform),
    }));
  };

  const saveWorkflow = async () => {
    setIsSaving(true);
    setNotice(null);
    setError(null);
    try {
      const config = buildConfig();
      const response = await fetch(
        selectedId ? `/api/workflows/${selectedId}` : "/api/workflows",
        {
          method: selectedId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name,
            description: draft.description,
            source_type: draft.source_type,
            output_target: draft.output_target,
            is_default: draft.is_default,
            config,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to save preset"));
      }
      const data = await response.json();
      await loadWorkflows();
      setSelectedId(data.workflow.id);
      setDraft(draftFromWorkflow(data.workflow));
      setNotice("Preset saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save preset");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteWorkflow = async () => {
    if (!selectedId) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/workflows/${selectedId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to delete preset"));
      }
      setSelectedId(null);
      setDraft({ ...EMPTY_DRAFT });
      await loadWorkflows();
      setNotice("Preset deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete preset");
    } finally {
      setIsSaving(false);
    }
  };

  if (isPending) {
    return (
      <StudioShell title="Presets" subtitle="Load presets">
        <div className="space-y-4">
          <Skeleton className="h-10 w-52" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </StudioShell>
    );
  }

  if (!session?.user) {
    return (
      <StudioShell title="Presets" subtitle="Sign in to manage presets">
        <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-4 font-[var(--font-syne)] text-2xl font-bold text-slate-950">Sign in required</h1>
          <Link href="/sign-in">
            <Button className="bg-slate-950 hover:bg-slate-800">Sign in</Button>
          </Link>
        </div>
      </StudioShell>
    );
  }

  if (isLoading) {
    return (
      <StudioShell title="Presets" subtitle="Load presets">
        <div className="space-y-4">
          <Skeleton className="h-10 w-52" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Presets"
      subtitle="Save repeatable source-to-candidate patterns with model, prompt, and render settings."
      actions={<Button onClick={createNew} className="bg-slate-950 hover:bg-slate-800">New preset</Button>}
    >

      <main className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          {workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() => selectWorkflow(workflow)}
              className={`w-full rounded-lg border bg-white p-4 text-left transition ${
                selectedId === workflow.id ? "border-stone-900" : "border-stone-200 hover:border-stone-400"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {workflow.is_default && <Badge>Default</Badge>}
                <Badge variant="outline">{workflow.output_target}</Badge>
              </div>
              <p className="font-semibold text-stone-950">{workflow.name}</p>
              <p className="mt-1 text-sm text-stone-500">
                {workflow.description || "No description"}
              </p>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {error && (
            <Alert className="border-red-200 bg-red-50 text-red-900">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Preset name"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    value={draft.source_type}
                    onValueChange={(value) => setDraft((current) => ({ ...current, source_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="youtube">YouTube</SelectItem>
                      <SelectItem value="upload">Upload</SelectItem>
                      <SelectItem value="video_url">Video URL</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={draft.output_target}
                    onValueChange={(value) => setDraft((current) => ({ ...current, output_target: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shorts">Shorts</SelectItem>
                      <SelectItem value="tiktok">TikTok</SelectItem>
                      <SelectItem value="reels">Reels</SelectItem>
                      <SelectItem value="multi">Multi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Description"
                className="min-h-20"
              />
              <div className="grid gap-4 xl:grid-cols-2">
                <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-950">Generation</h2>
                    <p className="text-xs text-slate-500">Candidate search and output defaults.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Mode</Label>
                      <Select
                        value={draft.processing_mode}
                        onValueChange={(value) => setDraft((current) => ({ ...current, processing_mode: value }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fast">Fast</SelectItem>
                          <SelectItem value="balanced">Balanced</SelectItem>
                          <SelectItem value="quality">Quality</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Format</Label>
                      <Select
                        value={draft.output_format}
                        onValueChange={(value) => setDraft((current) => ({ ...current, output_format: value }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vertical">Vertical</SelectItem>
                          <SelectItem value="vertical_pan">Vertical pan</SelectItem>
                          <SelectItem value="vertical_split">Split screen</SelectItem>
                          <SelectItem value="original">Original</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Target clips</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={draft.target_candidates}
                        onChange={(event) => setDraft((current) => ({ ...current, target_candidates: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Caption style</Label>
                      <Input
                        value={draft.caption_template}
                        onChange={(event) => setDraft((current) => ({ ...current, caption_template: event.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {["shorts", "reels", "tiktok"].map((platform) => (
                      <label key={platform} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold capitalize text-slate-700">
                        <Checkbox
                          checked={draft.platforms.includes(platform)}
                          onCheckedChange={(checked) => togglePlatform(platform, Boolean(checked))}
                        />
                        {platform}
                      </label>
                    ))}
                  </div>
                </section>

                <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-950">Cleanup</h2>
                    <p className="text-xs text-slate-500">Captions, pauses, filler words, and B-roll.</p>
                  </div>
                  <div className="space-y-3">
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <span className="text-sm font-semibold text-slate-700">Add subtitles</span>
                      <Switch
                        checked={draft.add_subtitles}
                        onCheckedChange={(checked) => setDraft((current) => ({ ...current, add_subtitles: checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <span className="text-sm font-semibold text-slate-700">Include B-roll</span>
                      <Switch
                        checked={draft.include_broll}
                        onCheckedChange={(checked) => setDraft((current) => ({ ...current, include_broll: checked }))}
                      />
                    </label>
                    <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                      <Checkbox
                        checked={draft.cut_long_pauses}
                        onCheckedChange={(checked) => setDraft((current) => ({ ...current, cut_long_pauses: Boolean(checked) }))}
                      />
                      Cut long pauses
                    </label>
                    {draft.cut_long_pauses && (
                      <div className="space-y-2">
                        <Label>Pause threshold ms</Label>
                        <Input
                          type="number"
                          min={250}
                          max={3000}
                          step={50}
                          value={draft.pause_threshold_ms}
                          onChange={(event) => setDraft((current) => ({ ...current, pause_threshold_ms: event.target.value }))}
                        />
                      </div>
                    )}
                    <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                      <Checkbox
                        checked={draft.remove_filler_words}
                        onCheckedChange={(checked) => setDraft((current) => ({ ...current, remove_filler_words: Boolean(checked) }))}
                      />
                      Remove filler words
                    </label>
                    {draft.remove_filler_words && (
                      <Textarea
                        value={draft.filtered_words}
                        onChange={(event) => setDraft((current) => ({ ...current, filtered_words: event.target.value }))}
                        placeholder="basically, literally, to be honest"
                        className="min-h-20"
                      />
                    )}
                  </div>
                </section>

                <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-950">Pipeline</h2>
                    <p className="text-xs text-slate-500">Model, prompt, review, and render profiles.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Transcribe profile</Label>
                      <Input
                        value={draft.transcribe_model_profile}
                        onChange={(event) => setDraft((current) => ({ ...current, transcribe_model_profile: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Analyze prompt</Label>
                      <Input
                        value={draft.analyze_prompt_version}
                        onChange={(event) => setDraft((current) => ({ ...current, analyze_prompt_version: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Render profile</Label>
                      <Input
                        value={draft.render_profile}
                        onChange={(event) => setDraft((current) => ({ ...current, render_profile: event.target.value }))}
                      />
                    </div>
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <span className="text-sm font-semibold text-slate-700">Manual review</span>
                      <Switch
                        checked={draft.review_manual}
                        onCheckedChange={(checked) => setDraft((current) => ({ ...current, review_manual: checked }))}
                      />
                    </label>
                  </div>
                </section>

                <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-950">Caption Look</h2>
                    <p className="text-xs text-slate-500">Default text styling for generated clips.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_96px_96px]">
                    <div className="space-y-2">
                      <Label>Font</Label>
                      <Input
                        value={draft.font_family}
                        onChange={(event) => setDraft((current) => ({ ...current, font_family: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Size</Label>
                      <Input
                        type="number"
                        min={12}
                        max={72}
                        value={draft.font_size}
                        onChange={(event) => setDraft((current) => ({ ...current, font_size: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Color</Label>
                      <input
                        type="color"
                        value={draft.font_color}
                        onChange={(event) => setDraft((current) => ({ ...current, font_color: event.target.value }))}
                        className="h-10 w-full rounded-md border border-slate-200 bg-white p-1"
                      />
                    </div>
                  </div>
                </section>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={draft.is_default ? "default" : "outline"}
                    onClick={() => setDraft((current) => ({ ...current, is_default: !current.is_default }))}
                  >
                    <Check className="h-4 w-4" />
                    Default
                  </Button>
                  <Button variant="outline" onClick={duplicateSelected} disabled={!selectedWorkflow}>
                    <Copy className="h-4 w-4" />
                    Duplicate
                  </Button>
                  {selectedWorkflow && (
                    <Link href={`/?preset=${selectedWorkflow.id}`}>
                      <Button variant="outline">
                        <Play className="h-4 w-4" />
                        Use preset
                      </Button>
                    </Link>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedId && (
                    <Button variant="outline" onClick={deleteWorkflow} disabled={isSaving}>
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  )}
                  <Button onClick={saveWorkflow} disabled={isSaving || !draft.name.trim()}>
                    <Save className="h-4 w-4" />
                    {isSaving ? "Saving" : "Save"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </StudioShell>
  );
}
