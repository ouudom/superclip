"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Archive, Clock, Database, DollarSign, Pin, Search, Tags } from "lucide-react";
import { StudioShell } from "@/components/studio-shell";
import { useSession } from "@/lib/auth-client";
import { formatSupportMessage, parseApiError } from "@/lib/api-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface LibraryItem {
  id: string;
  source_title: string;
  source_type: string;
  status: string;
  clips_count: number;
  total_duration: number;
  best_virality_score: number;
  average_relevance_score: number;
  tags: string[];
  content_pillar?: string | null;
  series_name?: string | null;
  platform?: string | null;
  library_status: string;
  pinned: boolean;
  archived: boolean;
  notes?: string | null;
  cache_hit: boolean;
  created_at: string;
  updated_at: string;
}

interface LibraryStats {
  tasks_count: number;
  clips_count: number;
  rendered_seconds: number;
  completed_count: number;
  cache_hit_count: number;
  disk_bytes: number;
  missing_files: number;
  estimated_ai_spend_usd: number;
  estimate_note: string;
}

interface MetadataDraft {
  tags: string;
  content_pillar: string;
  series_name: string;
  platform: string;
  library_status: string;
  notes: string;
}

const STATUS_OPTIONS = ["all", "completed", "analysis_ready", "processing", "queued", "error", "cancelled"];
const LIBRARY_STATUS_OPTIONS = ["draft", "review", "ready", "posted", "keep"];
const PLATFORM_OPTIONS = ["", "tiktok", "reels", "shorts", "multi"];

async function buildSupportError(response: Response, fallbackMessage: string) {
  const parsed = await parseApiError(response, fallbackMessage);
  return formatSupportMessage(parsed);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function draftFromItem(item: LibraryItem): MetadataDraft {
  return {
    tags: (item.tags || []).join(", "),
    content_pillar: item.content_pillar || "",
    series_name: item.series_name || "",
    platform: item.platform || "",
    library_status: item.library_status || "draft",
    notes: item.notes || "",
  };
}

export default function LibraryPage() {
  const { data: session, isPending } = useSession();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [drafts, setDrafts] = useState<Record<string, MetadataDraft>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("");
  const [platform, setPlatform] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    if (!session?.user?.id) return;

    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (query.trim()) params.set("q", query.trim());
    if (status !== "all") params.set("status", status);
    if (tag.trim()) params.set("tag", tag.trim().toLowerCase());
    if (platform) params.set("platform", platform);
    if (showArchived) params.set("archived", "true");

    try {
      const [itemsResponse, statsResponse] = await Promise.all([
        fetch(`/api/tasks/library?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/tasks/library/stats", { cache: "no-store" }),
      ]);
      if (!itemsResponse.ok) {
        throw new Error(await buildSupportError(itemsResponse, "Failed to load library"));
      }
      if (!statsResponse.ok) {
        throw new Error(await buildSupportError(statsResponse, "Failed to load library stats"));
      }

      const itemsData = await itemsResponse.json();
      const statsData = await statsResponse.json();
      const nextItems = (itemsData.items || []) as LibraryItem[];
      setItems(nextItems);
      setStats(statsData);
      setDrafts((current) => {
        const next = { ...current };
        for (const item of nextItems) {
          if (!next[item.id]) next[item.id] = draftFromItem(item);
        }
        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load library");
    } finally {
      setIsLoading(false);
    }
  }, [platform, query, session?.user?.id, showArchived, status, tag]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const uniqueTags = useMemo(() => {
    const allTags = items.flatMap((item) => item.tags || []);
    return Array.from(new Set(allTags)).sort();
  }, [items]);

  const updateDraft = (taskId: string, field: keyof MetadataDraft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [taskId]: {
        ...(current[taskId] || {
          tags: "",
          content_pillar: "",
          series_name: "",
          platform: "",
          library_status: "draft",
          notes: "",
        }),
        [field]: value,
      },
    }));
  };

  const patchMetadata = async (taskId: string, payload: Record<string, unknown>) => {
    setSavingTaskId(taskId);
    setNotice(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/library`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to save library metadata"));
      }
      await loadLibrary();
      setNotice("Library updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save library metadata");
    } finally {
      setSavingTaskId(null);
    }
  };

  const saveDraft = async (item: LibraryItem) => {
    const draft = drafts[item.id] || draftFromItem(item);
    await patchMetadata(item.id, {
      tags: draft.tags,
      content_pillar: draft.content_pillar,
      series_name: draft.series_name,
      platform: draft.platform,
      library_status: draft.library_status,
      notes: draft.notes,
    });
  };

  if (isPending || isLoading) {
    return (
      <StudioShell title="Clips" subtitle="Load library">
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </StudioShell>
    );
  }

  if (!session?.user) {
    return (
      <StudioShell title="Clips" subtitle="Sign in to view your content library">
        <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-4 font-[var(--font-syne)] text-2xl font-bold text-slate-950">Sign in required</h1>
          <Link href="/sign-in">
            <Button className="bg-slate-950 hover:bg-slate-800">Sign in</Button>
          </Link>
        </div>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Clips"
      subtitle="Search old sources, tag clips, track storage, estimate AI spend."
      actions={<Button onClick={() => void loadLibrary()} variant="outline" className="bg-white">Refresh</Button>}
    >
      <main className="space-y-5">
        {error && (
          <Alert className="border-red-200 bg-red-50 text-red-900">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <Database className="h-4 w-4" />
                Disk
              </div>
              <p className="mt-2 text-2xl font-semibold text-stone-950">
                {formatBytes(stats?.disk_bytes || 0)}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {stats?.missing_files || 0} missing file refs
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <Tags className="h-4 w-4" />
                Clips
              </div>
              <p className="mt-2 text-2xl font-semibold text-stone-950">
                {stats?.clips_count || 0}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {formatDuration(stats?.rendered_seconds || 0)} rendered
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <Clock className="h-4 w-4" />
                Sources
              </div>
              <p className="mt-2 text-2xl font-semibold text-stone-950">
                {stats?.tasks_count || 0}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {stats?.completed_count || 0} complete
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <DollarSign className="h-4 w-4" />
                AI Spend
              </div>
              <p className="mt-2 text-2xl font-semibold text-stone-950">
                ${(stats?.estimated_ai_spend_usd || 0).toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {stats?.cache_hit_count || 0} cache hits
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px_160px_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search source, clip text, tag, pillar, series"
                  className="pl-9"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all" ? "All status" : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={platform || "__all"} onValueChange={(value) => setPlatform(value === "__all" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All platforms</SelectItem>
                  {PLATFORM_OPTIONS.filter(Boolean).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="tag"
              />
              <div className="flex gap-2">
                <Button onClick={() => void loadLibrary()}>Search</Button>
                <Button
                  variant={showArchived ? "default" : "outline"}
                  onClick={() => setShowArchived((current) => !current)}
                >
                  <Archive className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {uniqueTags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {uniqueTags.slice(0, 12).map((itemTag) => (
                  <button
                    key={itemTag}
                    type="button"
                    onClick={() => setTag(itemTag)}
                    className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-600 hover:border-stone-400"
                  >
                    {itemTag}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {items.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-sm text-stone-500">No library items match current filters.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const draft = drafts[item.id] || draftFromItem(item);
              return (
                <Card
                  key={item.id}
                  className={cn(
                    "border-stone-200",
                    item.pinned && "border-stone-900",
                    item.archived && "opacity-70",
                  )}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {item.pinned && (
                            <Badge className="bg-stone-900 text-white">
                              <Pin className="mr-1 h-3 w-3" />
                              Pinned
                            </Badge>
                          )}
                          <Badge variant="outline">{item.source_type}</Badge>
                          <Badge variant="outline">{item.status}</Badge>
                          <Badge variant="outline">{item.library_status}</Badge>
                          {item.best_virality_score > 0 && (
                            <Badge>{item.best_virality_score} viral</Badge>
                          )}
                        </div>
                        <Link href={`/tasks/${item.id}`}>
                          <h2 className="truncate text-base font-semibold text-stone-950 hover:text-stone-600">
                            {item.source_title || "Untitled source"}
                          </h2>
                        </Link>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                          <span>{item.clips_count} clips</span>
                          <span>{formatDuration(item.total_duration)} total</span>
                          <span>{new Date(item.updated_at).toLocaleString()}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(item.tags || []).map((itemTag) => (
                            <Badge key={itemTag} variant="outline" className="bg-stone-50">
                              {itemTag}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="grid w-full gap-2 lg:w-[520px]">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            value={draft.tags}
                            onChange={(event) => updateDraft(item.id, "tags", event.target.value)}
                            placeholder="tags: trust, ai, hooks"
                          />
                          <Input
                            value={draft.content_pillar}
                            onChange={(event) => updateDraft(item.id, "content_pillar", event.target.value)}
                            placeholder="content pillar"
                          />
                          <Input
                            value={draft.series_name}
                            onChange={(event) => updateDraft(item.id, "series_name", event.target.value)}
                            placeholder="series"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Select
                              value={draft.platform || "__none"}
                              onValueChange={(value) =>
                                updateDraft(item.id, "platform", value === "__none" ? "" : value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Platform" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">No platform</SelectItem>
                                {PLATFORM_OPTIONS.filter(Boolean).map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={draft.library_status}
                              onValueChange={(value) => updateDraft(item.id, "library_status", value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Status" />
                              </SelectTrigger>
                              <SelectContent>
                                {LIBRARY_STATUS_OPTIONS.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Textarea
                          value={draft.notes}
                          onChange={(event) => updateDraft(item.id, "notes", event.target.value)}
                          placeholder="notes"
                          className="min-h-20"
                        />
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="outline"
                            onClick={() => void patchMetadata(item.id, { pinned: !item.pinned })}
                            disabled={savingTaskId === item.id}
                          >
                            <Pin className="h-4 w-4" />
                            {item.pinned ? "Unpin" : "Pin"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => void patchMetadata(item.id, { archived: !item.archived })}
                            disabled={savingTaskId === item.id}
                          >
                            <Archive className="h-4 w-4" />
                            {item.archived ? "Restore" : "Archive"}
                          </Button>
                          <Button
                            onClick={() => void saveDraft(item)}
                            disabled={savingTaskId === item.id}
                          >
                            {savingTaskId === item.id ? "Saving" : "Save"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </StudioShell>
  );
}
