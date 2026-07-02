"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, ExternalLink, RefreshCw, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth-client";
import { formatSupportMessage, parseApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

interface PublishItem {
  clip_id: string;
  task_id: string;
  platform: string;
  post_status: string;
  caption: string;
  hashtags: string[];
  checklist: Record<string, boolean>;
  published_url?: string | null;
  published_at?: string | null;
  export_path?: string | null;
  notes?: string | null;
  source_title: string;
  clip_filename: string;
  clip_order: number;
  duration: number;
  virality_score: number;
  video_url: string;
}

interface PublishDraft {
  post_status: string;
  caption: string;
  hashtags: string;
  published_url: string;
  published_at: string;
  notes: string;
  checklist: Record<string, boolean>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const PLATFORMS = ["all", "tiktok", "reels", "shorts"];
const STATUSES = ["all", "draft", "ready", "posted", "archived"];
const PLATFORM_LABELS: Record<string, string> = {
  all: "All platforms",
  tiktok: "Short video",
  reels: "Reels",
  shorts: "Shorts",
};
const CHECKLIST_LABELS: Record<string, string> = {
  caption_copied: "Caption copied",
  video_exported: "Video exported",
  uploaded: "Uploaded",
  cover_checked: "Cover checked",
  posted: "Posted",
};

function getClipUrl(url: string) {
  if (url.startsWith("http")) return url;
  return `${API_URL}${url}`;
}

async function buildSupportError(response: Response, fallbackMessage: string) {
  const parsed = await parseApiError(response, fallbackMessage);
  return formatSupportMessage(parsed);
}

function draftFromItem(item: PublishItem): PublishDraft {
  return {
    post_status: item.post_status || "draft",
    caption: item.caption || "",
    hashtags: (item.hashtags || []).join(" "),
    published_url: item.published_url || "",
    published_at: item.published_at ? item.published_at.slice(0, 16) : "",
    notes: item.notes || "",
    checklist: item.checklist || {},
  };
}

function itemKey(item: PublishItem) {
  return `${item.clip_id}:${item.platform}`;
}

function platformLabel(platform: string) {
  return PLATFORM_LABELS[platform] || platform;
}

export default function PublishingPage() {
  const { data: session, isPending } = useSession();
  const [items, setItems] = useState<PublishItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PublishDraft>>({});
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => itemKey(item) === selectedKey) || items[0] || null,
    [items, selectedKey],
  );
  const selectedDraft = selectedItem ? drafts[itemKey(selectedItem)] || draftFromItem(selectedItem) : null;

  const loadItems = useCallback(async () => {
    if (!session?.user?.id) return;
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (platform !== "all") params.set("platform", platform);
    if (status !== "all") params.set("status", status);
    try {
      const response = await fetch(`/api/publishing/items?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to load publishing queue"));
      }
      const data = await response.json();
      const nextItems = (data.items || []) as PublishItem[];
      setItems(nextItems);
      setDrafts((current) => {
        const next = { ...current };
        for (const item of nextItems) {
          const key = itemKey(item);
          if (!next[key]) next[key] = draftFromItem(item);
        }
        return next;
      });
      setSelectedKey((current) =>
        current && nextItems.some((item) => itemKey(item) === current)
          ? current
          : nextItems[0]
            ? itemKey(nextItems[0])
            : null,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load publishing queue");
    } finally {
      setIsLoading(false);
    }
  }, [platform, session?.user?.id, status]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const updateDraft = (key: string, patch: Partial<PublishDraft>) => {
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] || (selectedItem ? draftFromItem(selectedItem) : {
          post_status: "draft",
          caption: "",
          hashtags: "",
          published_url: "",
          published_at: "",
          notes: "",
          checklist: {},
        })),
        ...patch,
      },
    }));
  };

  const saveItem = async (item: PublishItem) => {
    const key = itemKey(item);
    const draft = drafts[key] || draftFromItem(item);
    setSavingKey(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/publishing/clips/${item.clip_id}/platforms/${item.platform}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_status: draft.post_status,
          caption: draft.caption,
          hashtags: draft.hashtags,
          checklist: draft.checklist,
          published_url: draft.published_url,
          published_at: draft.published_at,
          notes: draft.notes,
        }),
      });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to save publish metadata"));
      }
      const data = await response.json();
      const saved = data.item as PublishItem;
      setItems((current) => current.map((currentItem) => (itemKey(currentItem) === key ? saved : currentItem)));
      setDrafts((current) => ({ ...current, [key]: draftFromItem(saved) }));
      setNotice("Publish metadata saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save publish metadata");
    } finally {
      setSavingKey(null);
    }
  };

  const exportItem = async (item: PublishItem) => {
    const key = itemKey(item);
    setSavingKey(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/publishing/clips/${item.clip_id}/platforms/${item.platform}/export`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to export clip"));
      }
      const data = await response.json();
      const exported = data.item as PublishItem;
      setItems((current) => current.map((currentItem) => (itemKey(currentItem) === key ? exported : currentItem)));
      setDrafts((current) => ({
        ...current,
        [key]: {
          ...(current[key] || draftFromItem(exported)),
          checklist: { ...(current[key]?.checklist || exported.checklist), video_exported: true },
        },
      }));
      setNotice(`Exported to ${exported.export_path}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export clip");
    } finally {
      setSavingKey(null);
    }
  };

  const copyCaption = async (item: PublishItem) => {
    const key = itemKey(item);
    const draft = drafts[key] || draftFromItem(item);
    const text = `${draft.caption}\n\n${draft.hashtags}`.trim();
    await navigator.clipboard.writeText(text);
    updateDraft(key, { checklist: { ...draft.checklist, caption_copied: true } });
    setNotice("Caption copied.");
  };

  if (isPending || isLoading) {
    return (
      <StudioShell title="Exports" subtitle="Load publishing queue">
        <div className="space-y-4">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </StudioShell>
    );
  }

  if (!session?.user) {
    return (
      <StudioShell title="Exports" subtitle="Sign in to manage publishing">
        <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="mb-4 text-sm text-slate-600">Sign in to manage publishing.</p>
          <Link href="/sign-in">
            <Button className="bg-slate-950 hover:bg-slate-800">Sign in</Button>
          </Link>
        </div>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Exports"
      subtitle="Manual export, captions, checklist, posted URL."
      actions={<Button variant="outline" className="bg-white" onClick={() => void loadItems()}><RefreshCw className="h-4 w-4" />Refresh</Button>}
    >
      <main className="space-y-6">

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-900">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((value) => <SelectItem key={value} value={value}>{platformLabel(value)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-end text-sm text-stone-500">{items.length} publish items</div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          <section className="space-y-3">
            {items.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-sm text-stone-500">
                  No rendered clips match filters.
                </CardContent>
              </Card>
            ) : (
              items.map((item) => {
                const key = itemKey(item);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={cn(
                      "w-full rounded-md border p-4 text-left transition",
                      selectedKey === key
                        ? "border-stone-900 bg-white"
                        : "border-stone-200 bg-stone-50 hover:border-stone-400",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.source_title}</p>
                        <p className="text-xs text-stone-500">Clip {item.clip_order} · {Math.round(item.duration)}s</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Badge variant="outline">{platformLabel(item.platform)}</Badge>
                        <Badge>{item.post_status}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
                      <span>Score {item.virality_score || 0}</span>
                      {item.export_path && <span>Exported</span>}
                      {item.published_url && <span>Posted</span>}
                    </div>
                  </button>
                );
              })
            )}
          </section>

          <section>
            {selectedItem && selectedDraft ? (
              <Card>
                <CardContent className="space-y-5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">{selectedItem.source_title}</h2>
                      <p className="text-sm text-stone-500">{selectedItem.clip_filename}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a href={getClipUrl(selectedItem.video_url)} download={selectedItem.clip_filename}>
                        <Button variant="outline" size="sm">
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </Button>
                      </a>
                      <Button variant="outline" size="sm" onClick={() => exportItem(selectedItem)} disabled={savingKey === itemKey(selectedItem)}>
                        <Download className="mr-2 h-4 w-4" />
                        Export
                      </Button>
                    </div>
                  </div>

                  <video controls src={getClipUrl(selectedItem.video_url)} className="aspect-[9/16] max-h-[520px] w-full rounded-md bg-black object-contain" />

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={selectedDraft.post_status}
                        onValueChange={(value) => updateDraft(itemKey(selectedItem), { post_status: value })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.filter((value) => value !== "all").map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Posted URL</Label>
                      <Input
                        value={selectedDraft.published_url}
                        onChange={(event) => updateDraft(itemKey(selectedItem), { published_url: event.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Caption</Label>
                      <Button variant="outline" size="sm" onClick={() => copyCaption(selectedItem)}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy
                      </Button>
                    </div>
                    <Textarea
                      value={selectedDraft.caption}
                      onChange={(event) => updateDraft(itemKey(selectedItem), { caption: event.target.value })}
                      rows={5}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Hashtags</Label>
                    <Input
                      value={selectedDraft.hashtags}
                      onChange={(event) => updateDraft(itemKey(selectedItem), { hashtags: event.target.value })}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {Object.entries(CHECKLIST_LABELS).map(([field, label]) => (
                      <label key={field} className="flex items-center gap-2 rounded-md border border-stone-200 bg-white p-3 text-sm">
                        <Checkbox
                          checked={Boolean(selectedDraft.checklist[field])}
                          onCheckedChange={(checked) =>
                            updateDraft(itemKey(selectedItem), {
                              checklist: { ...selectedDraft.checklist, [field]: Boolean(checked) },
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={selectedDraft.notes}
                      onChange={(event) => updateDraft(itemKey(selectedItem), { notes: event.target.value })}
                      rows={3}
                    />
                  </div>

                  {selectedItem.export_path && (
                    <p className="break-all rounded-md bg-stone-100 p-3 text-xs text-stone-600">
                      Export: {selectedItem.export_path}
                    </p>
                  )}
                  {selectedDraft.published_url && (
                    <a href={selectedDraft.published_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-700">
                      <ExternalLink className="h-4 w-4" />
                      Open posted URL
                    </a>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        updateDraft(itemKey(selectedItem), {
                          post_status: "posted",
                          checklist: { ...selectedDraft.checklist, uploaded: true, posted: true },
                        })
                      }
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Mark Posted
                    </Button>
                    <Button onClick={() => saveItem(selectedItem)} disabled={savingKey === itemKey(selectedItem)}>
                      <Save className="mr-2 h-4 w-4" />
                      {savingKey === itemKey(selectedItem) ? "Saving" : "Save"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-sm text-stone-500">
                  Select a clip.
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </main>
    </StudioShell>
  );
}
