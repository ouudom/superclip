"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FolderOpen, Play, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client";
import { formatSupportMessage, parseApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

interface WatchedFile {
  filename: string;
  title: string;
  extension: string;
  size_bytes: number;
  modified_at: number;
  source_url: string;
  directory: string;
}

interface WatchedResponse {
  configured: boolean;
  directory: string;
  files: WatchedFile[];
  total: number;
  message?: string;
}

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

export default function SourcesPage() {
  const { data: session, isPending } = useSession();
  const [watched, setWatched] = useState<WatchedResponse | null>(null);
  const [selectedFilename, setSelectedFilename] = useState("");
  const [title, setTitle] = useState("");
  const [processingMode, setProcessingMode] = useState("fast");
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedFile = useMemo(
    () => watched?.files.find((file) => file.filename === selectedFilename) || null,
    [selectedFilename, watched?.files],
  );

  const loadWatched = useCallback(async () => {
    if (!session?.user?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sources/watched", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to scan watched folder"));
      }
      const data = (await response.json()) as WatchedResponse;
      setWatched(data);
      const firstFile = data.files?.[0];
      setSelectedFilename((current) =>
        current && data.files.some((file) => file.filename === current)
          ? current
          : firstFile?.filename || "",
      );
      if (firstFile) setTitle((current) => current || firstFile.title);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to scan watched folder");
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void loadWatched();
  }, [loadWatched]);

  useEffect(() => {
    if (selectedFile) setTitle(selectedFile.title);
  }, [selectedFile]);

  const importSelected = async () => {
    if (!selectedFile) return;
    setIsImporting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/sources/watched/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selectedFile.filename,
          title,
          processing_mode: processingMode,
          output_format: "vertical",
          add_subtitles: true,
        }),
      });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to import watched source"));
      }
      const data = await response.json();
      setNotice("Queued watched source.");
      if (typeof data.task_id === "string") {
        window.location.href = `/tasks/${data.task_id}`;
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import watched source");
    } finally {
      setIsImporting(false);
    }
  };

  if (isPending || isLoading) {
    return (
      <main className="min-h-screen bg-stone-50 p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 p-6">
        <Card className="max-w-md">
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-stone-600">Sign in to import sources.</p>
            <Link href="/sign-in">
              <Button>Sign in</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Home
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold">Sources</h1>
              <p className="text-sm text-stone-500">Import videos from local watched folder.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadWatched()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Scan
          </Button>
        </div>

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

        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Watched folder</p>
              <p className="truncate text-sm text-stone-500">{watched?.directory || "not configured"}</p>
              {watched?.message && <p className="mt-1 text-xs text-amber-700">{watched.message}</p>}
            </div>
            <Badge variant={watched?.configured ? "default" : "outline"}>
              {watched?.configured ? `${watched.total || 0} files` : "missing"}
            </Badge>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <section className="space-y-3">
            {(watched?.files || []).length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <FolderOpen className="mx-auto mb-3 h-8 w-8 text-stone-400" />
                  <p className="text-sm font-medium">No videos found.</p>
                  <p className="mt-1 text-sm text-stone-500">Put MP4, MOV, MKV, WEBM, AVI, or M4V files in watched folder.</p>
                </CardContent>
              </Card>
            ) : (
              watched?.files.map((file) => (
                <button
                  key={file.filename}
                  type="button"
                  onClick={() => setSelectedFilename(file.filename)}
                  className={cn(
                    "w-full rounded-md border p-4 text-left transition",
                    selectedFilename === file.filename
                      ? "border-stone-900 bg-white"
                      : "border-stone-200 bg-stone-50 hover:border-stone-400",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{file.title}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{file.extension.replace(".", "")}</Badge>
                      <Badge variant="outline">{formatBytes(file.size_bytes)}</Badge>
                    </div>
                  </div>
                  <p className="mt-1 break-all text-xs text-stone-500">{file.filename}</p>
                  <p className="mt-1 text-xs text-stone-400">
                    {new Date(file.modified_at * 1000).toLocaleString()}
                  </p>
                </button>
              ))
            )}
          </section>

          <aside>
            <Card>
              <CardContent className="space-y-4 p-4">
                <div>
                  <h2 className="font-semibold">Import</h2>
                  <p className="text-sm text-stone-500">Creates normal task. Resume/retry works same as upload.</p>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!selectedFile} />
                </div>
                <div className="space-y-2">
                  <Label>Mode</Label>
                  <Select value={processingMode} onValueChange={setProcessingMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fast">Fast</SelectItem>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="quality">Quality</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" onClick={importSelected} disabled={!selectedFile || isImporting}>
                  <Play className="mr-2 h-4 w-4" />
                  {isImporting ? "Importing" : "Import Source"}
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}
