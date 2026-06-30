"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Play, Save, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
  config_json: string;
}

const EMPTY_DRAFT: WorkflowDraft = {
  name: "",
  description: "",
  source_type: "youtube",
  output_target: "shorts",
  is_default: false,
  config_json: JSON.stringify(
    {
      processing_mode: "fast",
      output_format: "vertical",
      add_subtitles: true,
      include_broll: false,
      cut_long_pauses: false,
      pause_threshold_ms: 900,
      remove_filler_words: false,
      target_candidates: 4,
      steps: [
        { key: "transcribe", model_profile: "default_transcription" },
        { key: "analyze", prompt_version: "clip_candidates" },
        { key: "review", manual: true },
        { key: "render", render_profile: "final" },
      ],
    },
    null,
    2,
  ),
};

async function buildSupportError(response: Response, fallbackMessage: string) {
  const parsed = await parseApiError(response, fallbackMessage);
  return formatSupportMessage(parsed);
}

function draftFromWorkflow(workflow: Workflow): WorkflowDraft {
  return {
    name: workflow.name,
    description: workflow.description || "",
    source_type: workflow.source_type || "youtube",
    output_target: workflow.output_target || "shorts",
    is_default: workflow.is_default,
    config_json: JSON.stringify(workflow.config || {}, null, 2),
  };
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
        throw new Error(await buildSupportError(response, "Failed to load workflows"));
      }
      const data = await response.json();
      const nextWorkflows = (data.workflows || []) as Workflow[];
      setWorkflows(nextWorkflows);
      if (!selectedId && nextWorkflows.length > 0) {
        setSelectedId(nextWorkflows[0].id);
        setDraft(draftFromWorkflow(nextWorkflows[0]));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load workflows");
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

  const saveWorkflow = async () => {
    setIsSaving(true);
    setNotice(null);
    setError(null);
    try {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(draft.config_json) as Record<string, unknown>;
      } catch {
        throw new Error("Config must be valid JSON.");
      }
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
        throw new Error(await buildSupportError(response, "Failed to save workflow"));
      }
      const data = await response.json();
      await loadWorkflows();
      setSelectedId(data.workflow.id);
      setDraft(draftFromWorkflow(data.workflow));
      setNotice("Workflow saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save workflow");
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
        throw new Error(await buildSupportError(response, "Failed to delete workflow"));
      }
      setSelectedId(null);
      setDraft({ ...EMPTY_DRAFT });
      await loadWorkflows();
      setNotice("Workflow deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete workflow");
    } finally {
      setIsSaving(false);
    }
  };

  if (isPending || isLoading) {
    return (
      <div className="min-h-screen bg-white p-4">
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-10 w-52" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="min-h-screen bg-white p-4">
        <div className="mx-auto max-w-4xl py-24 text-center">
          <h1 className="mb-4 text-3xl font-bold text-black">Sign In Required</h1>
          <Link href="/sign-in">
            <Button>Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5">
          <div className="mb-4 flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <Link href="/library">
              <Button variant="outline" size="sm">Library</Button>
            </Link>
            <Link href="/sources">
              <Button variant="outline" size="sm">Sources</Button>
            </Link>
            <Link href="/publishing">
              <Button variant="outline" size="sm">Publishing</Button>
            </Link>
            <Link href="/agents">
              <Button variant="outline" size="sm">Agents</Button>
            </Link>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-stone-950">Workflow Presets</h1>
              <p className="mt-1 text-sm text-stone-500">
                Save repeatable source-to-candidate patterns with model, prompt, and render settings.
              </p>
            </div>
            <Button onClick={createNew}>New Workflow</Button>
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
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
                  placeholder="Workflow name"
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
              <Textarea
                value={draft.config_json}
                onChange={(event) => setDraft((current) => ({ ...current, config_json: event.target.value }))}
                className="min-h-[360px] font-mono text-xs"
                spellCheck={false}
              />
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
                    <Link href={`/?workflow=${selectedWorkflow.id}`}>
                      <Button variant="outline">
                        <Play className="h-4 w-4" />
                        Use
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
    </div>
  );
}
