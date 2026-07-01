"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileVideo,
  Loader2,
  Play,
  Sparkles,
  Subtitles,
  Upload,
  Wand2,
  Youtube,
} from "lucide-react";

import { StudioShell } from "@/components/studio-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatSupportMessage, parseApiError } from "@/lib/api-error";
import { isLandingOnlyModeEnabled } from "@/lib/app-flags";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type SourceType = "youtube" | "upload";
type OutputFormat = "vertical" | "vertical_pan" | "vertical_split" | "original";

interface FontOption {
  name: string;
  display_name: string;
  format?: string;
}

interface WorkflowPreset {
  id: string;
  name: string;
  description?: string | null;
  output_target: string;
  is_default: boolean;
  config: {
    processing_mode?: string;
    output_format?: OutputFormat;
    add_subtitles?: boolean;
    include_broll?: boolean;
    cut_long_pauses?: boolean;
    pause_threshold_ms?: number;
    remove_filler_words?: boolean;
    filtered_words?: string[];
    caption_template?: string;
    font_family?: string;
    font_size?: number;
    font_color?: string;
  };
}

type DirectUploadAuthorization = {
  directUpload: true;
  uploadUrl: string;
  headers: Record<string, string>;
};

type ProxyUploadAuthorization = {
  directUpload: false;
  reason: "signed_backend_auth_required";
};

type UploadAuthorization = DirectUploadAuthorization | ProxyUploadAuthorization;

const MAX_VIDEO_UPLOAD_BYTES = 1_000_000_000;

const statusCopy: Record<string, { label: string; className: string }> = {
  completed: { label: "Ready", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  processing: { label: "Generating", className: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  queued: { label: "Queued", className: "border-amber-200 bg-amber-50 text-amber-700" },
  retrying: { label: "Retrying", className: "border-amber-200 bg-amber-50 text-amber-700" },
  error: { label: "Error", className: "border-red-200 bg-red-50 text-red-700" },
  cancelled: { label: "Cancelled", className: "border-slate-200 bg-slate-50 text-slate-600" },
};

const extractYouTubeVideoId = (value: string): string | null => {
  const input = value.trim();
  if (!input) return null;

  try {
    const parsed = new URL(input);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id && id.length === 11 ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const id = parsed.searchParams.get("v");
      if (id && id.length === 11) return id;
      const parts = parsed.pathname.split("/").filter(Boolean);
      const embedId = parts[0] === "embed" ? parts[1] : null;
      return embedId && embedId.length === 11 ? embedId : null;
    }
  } catch {
    return null;
  }

  return null;
};

const getYouTubeThumbnailUrl = (value: string): string | null => {
  const videoId = extractYouTubeVideoId(value);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
};

async function requestUploadAuthorization(): Promise<UploadAuthorization> {
  const response = await fetch("/api/upload/authorization", {
    method: "POST",
    cache: "no-store",
  });

  if (!response.ok) {
    const uploadError = await parseApiError(response, `Upload authorization error: ${response.status}`);
    throw new Error(formatSupportMessage(uploadError));
  }

  return response.json() as Promise<UploadAuthorization>;
}

async function uploadVideoFileViaProxy(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("video", file);

  const uploadResponse = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    const fallbackMessage =
      uploadResponse.status === 413
        ? "Uploaded file is too large. Please upload a video under 1 GB."
        : `Upload error: ${uploadResponse.status}`;
    const uploadError = await parseApiError(uploadResponse, fallbackMessage);
    throw new Error(formatSupportMessage(uploadError));
  }

  const uploadResult = await uploadResponse.json();
  if (typeof uploadResult.video_path !== "string" || !uploadResult.video_path) {
    throw new Error("Upload finished without a video path. Please try again.");
  }

  return uploadResult.video_path;
}

async function uploadVideoFile(file: File): Promise<string> {
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error("Uploaded file is too large. Please upload a video under 1 GB.");
  }

  const uploadAuthorization = await requestUploadAuthorization();
  if (!uploadAuthorization.directUpload) return uploadVideoFileViaProxy(file);

  const formData = new FormData();
  formData.append("video", file);

  const uploadResponse = await fetch(uploadAuthorization.uploadUrl, {
    method: "POST",
    headers: uploadAuthorization.headers,
    body: formData,
  });

  if (!uploadResponse.ok) {
    const fallbackMessage =
      uploadResponse.status === 413
        ? "Uploaded file is too large. Please upload a video under 1 GB."
        : `Upload error: ${uploadResponse.status}`;
    const uploadError = await parseApiError(uploadResponse, fallbackMessage);
    throw new Error(formatSupportMessage(uploadError));
  }

  const uploadResult = await uploadResponse.json();
  if (typeof uploadResult.video_path !== "string" || !uploadResult.video_path) {
    throw new Error("Upload finished without a video path. Please try again.");
  }

  return uploadResult.video_path;
}

function TaskStatus({ status }: { status: string }) {
  const config = statusCopy[status] || {
    label: status,
    className: "border-slate-200 bg-white text-slate-600",
  };

  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold", config.className)}>
      {config.label}
    </span>
  );
}

function LandingOnly() {
  return (
    <div className="min-h-screen bg-white px-4 py-12">
      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg bg-slate-950 text-white">
          <Sparkles className="h-7 w-7" />
        </div>
        <h1 className="font-[var(--font-syne)] text-5xl font-bold tracking-tight text-slate-950">
          SupoClip
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          Turn long videos into TikTok-ready clips with captions, clean cuts, and simple downloads.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/sign-in">
            <Button className="bg-slate-950 hover:bg-slate-800">Sign in</Button>
          </Link>
          <Link href="/sign-up">
            <Button variant="outline">Create account</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const { data: session, isPending } = useSession();
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<File | null>(null);

  const [sourceType, setSourceType] = useState<SourceType>("youtube");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const [fontFamily, setFontFamily] = useState("TikTokSans-Regular");
  const [fontSize, setFontSize] = useState(24);
  const [fontColor, setFontColor] = useState("#FFFFFF");
  const [availableFonts, setAvailableFonts] = useState<FontOption[]>([]);
  const [captionTemplate, setCaptionTemplate] = useState("default");
  const [availableTemplates, setAvailableTemplates] = useState<
    Array<{ id: string; name: string; description: string; animation: string; font_family?: string; font_size?: number; font_color?: string }>
  >([]);
  const [includeBroll, setIncludeBroll] = useState(false);
  const [brollAvailable, setBrollAvailable] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("vertical");
  const [addSubtitles, setAddSubtitles] = useState(true);
  const [cutLongPauses, setCutLongPauses] = useState(false);
  const [pauseThresholdMs, setPauseThresholdMs] = useState("900");
  const [removeFillerWords, setRemoveFillerWords] = useState(false);
  const [filteredWords, setFilteredWords] = useState("");
  const [workflows, setWorkflows] = useState<WorkflowPreset[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("none");
  const [isLoadingLatest, setIsLoadingLatest] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const thumbnailUrl = sourceType === "youtube" ? getYouTubeThumbnailUrl(url) : null;
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
  const sourceReady = sourceType === "youtube" ? Boolean(url.trim()) : Boolean(fileRef.current);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshFonts = useCallback(async () => {
    try {
      const response = await fetch("/api/fonts", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const fonts: FontOption[] = data.fonts || [];
      setAvailableFonts(fonts);

      const styleElement = document.createElement("style");
      styleElement.id = "custom-fonts";
      styleElement.innerHTML = fonts
        .map((font) => {
          const format = font.format === "otf" ? "opentype" : "truetype";
          return `
            @font-face {
              font-family: '${font.name}';
              src: url('/api/fonts/${font.name}') format('${format}');
              font-weight: normal;
              font-style: normal;
            }
          `;
        })
        .join("\n");

      const existingStyle = document.getElementById("custom-fonts");
      existingStyle?.remove();
      document.head.appendChild(styleElement);
    } catch (fontError) {
      console.error("Failed to load fonts:", fontError);
    }
  }, []);

  const applyWorkflowConfig = useCallback((workflow: WorkflowPreset) => {
    const config = workflow.config || {};
    if (config.output_format) setOutputFormat(config.output_format);
    if (typeof config.add_subtitles === "boolean") setAddSubtitles(config.add_subtitles);
    if (typeof config.include_broll === "boolean") setIncludeBroll(config.include_broll);
    if (typeof config.cut_long_pauses === "boolean") setCutLongPauses(config.cut_long_pauses);
    if (typeof config.pause_threshold_ms === "number") setPauseThresholdMs(String(config.pause_threshold_ms));
    if (typeof config.remove_filler_words === "boolean") setRemoveFillerWords(config.remove_filler_words);
    if (Array.isArray(config.filtered_words)) setFilteredWords(config.filtered_words.join(", "));
    if (config.caption_template) setCaptionTemplate(config.caption_template);
    if (config.font_family) setFontFamily(config.font_family);
    if (typeof config.font_size === "number") setFontSize(config.font_size);
    if (config.font_color) setFontColor(config.font_color);
  }, []);

  useEffect(() => {
    if (isLandingOnlyModeEnabled) return;
    void refreshFonts();
  }, [refreshFonts]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const loadWorkflows = async () => {
      try {
        const response = await fetch("/api/workflows", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const nextWorkflows = (data.workflows || []) as WorkflowPreset[];
        setWorkflows(nextWorkflows);
        const requestedWorkflowId = searchParams.get("workflow");
        const initialWorkflow =
          nextWorkflows.find((workflow) => workflow.id === requestedWorkflowId) ||
          nextWorkflows.find((workflow) => workflow.is_default);
        if (initialWorkflow) {
          setSelectedWorkflowId(initialWorkflow.id);
          applyWorkflowConfig(initialWorkflow);
        }
      } catch (workflowError) {
        console.error("Failed to load workflows:", workflowError);
      }
    };

    void loadWorkflows();
  }, [applyWorkflowConfig, searchParams, session?.user?.id]);

  useEffect(() => {
    if (isLandingOnlyModeEnabled) return;

    const loadTemplates = async () => {
      try {
        const response = await fetch(`${apiUrl}/caption-templates`);
        if (response.ok) {
          const data = await response.json();
          setAvailableTemplates(data.templates || []);
        }
      } catch (templateError) {
        console.error("Failed to load caption templates:", templateError);
      }
    };

    const checkBrollStatus = async () => {
      try {
        const response = await fetch(`${apiUrl}/broll/status`);
        if (response.ok) {
          const data = await response.json();
          setBrollAvailable(Boolean(data.configured));
        }
      } catch (brollError) {
        console.error("Failed to check B-roll:", brollError);
      }
    };

    void loadTemplates();
    void checkBrollStatus();
  }, [apiUrl]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const loadPreferences = async () => {
      try {
        const response = await fetch("/api/preferences", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        setFontFamily(data.fontFamily || "TikTokSans-Regular");
        setFontSize(data.fontSize || 24);
        setFontColor(data.fontColor || "#FFFFFF");
      } catch (preferenceError) {
        console.error("Failed to load preferences:", preferenceError);
      }
    };

    void loadPreferences();
  }, [session?.user?.id]);

  const sourceSummary = useMemo(() => {
    if (sourceType === "upload") return fileName || "Upload a video file";
    return url.trim() || "Paste a YouTube link";
  }, [fileName, sourceType, url]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    fileRef.current = file;
    setFileName(file?.name || null);
  };

  const handleWorkflowChange = (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    const workflow = workflows.find((item) => item.id === workflowId);
    if (workflow) applyWorkflowConfig(workflow);
  };

  const handleTemplateChange = (templateId: string) => {
    setCaptionTemplate(templateId);
    const selectedTemplate = availableTemplates.find((template) => template.id === templateId);
    if (!selectedTemplate) return;
    if (selectedTemplate.font_family) setFontFamily(selectedTemplate.font_family);
    if (typeof selectedTemplate.font_size === "number") setFontSize(selectedTemplate.font_size);
    if (selectedTemplate.font_color) setFontColor(selectedTemplate.font_color);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session?.user?.id || !sourceReady) return;

    setIsLoading(true);
    setError(null);
    setProgress(8);
    setStatusMessage(sourceType === "upload" ? "Uploading source" : "Creating task");

    const normalizedColor = /^#[0-9A-Fa-f]{6}$/.test(fontColor) ? fontColor : "#FFFFFF";
    const normalizedPauseThreshold = Number.isFinite(Number(pauseThresholdMs))
      ? Math.max(250, Math.min(3000, Math.round(Number(pauseThresholdMs))))
      : 900;
    const normalizedFilteredWords = filteredWords
      .split(",")
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);

    try {
      let videoUrl = url;
      if (sourceType === "upload" && fileRef.current) {
        videoUrl = await uploadVideoFile(fileRef.current);
        setProgress(45);
        setStatusMessage("Source uploaded");
      }

      const response = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: {
            url: videoUrl,
            title: null,
          },
          font_options: {
            font_family: fontFamily,
            font_size: fontSize,
            font_color: normalizedColor,
          },
          caption_template: captionTemplate,
          include_broll: includeBroll,
          processing_mode: selectedWorkflow?.config.processing_mode || "fast",
          output_format: outputFormat,
          add_subtitles: addSubtitles,
          cut_long_pauses: cutLongPauses,
          pause_threshold_ms: normalizedPauseThreshold,
          remove_filler_words: removeFillerWords,
          filtered_words: normalizedFilteredWords,
          workflow_id: selectedWorkflowId === "none" ? undefined : selectedWorkflowId,
        }),
      });

      if (!response.ok) {
        const startError = await parseApiError(response, `API error: ${response.status}`);
        throw new Error(formatSupportMessage(startError));
      }

      const result = await response.json();
      setProgress(100);
      setStatusMessage("Opening generation");
      window.location.href = `/tasks/${result.task_id}`;
    } catch (submitError) {
      console.error("Error processing video:", submitError);
      setError(submitError instanceof Error ? submitError.message : "Failed to process video. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isLandingOnlyModeEnabled) return <LandingOnly />;

  if (!mounted || isPending) {
    return (
      <StudioShell title="Create clips" subtitle="Load studio">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-[520px] rounded-lg" />
          <Skeleton className="h-[520px] rounded-lg" />
        </div>
      </StudioShell>
    );
  }

  if (!session?.user) {
    return (
      <StudioShell title="Create clips" subtitle="Sign in to generate TikTok clips">
        <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Sparkles className="mx-auto h-10 w-10 text-cyan-600" />
          <h2 className="mt-4 font-[var(--font-syne)] text-2xl font-bold text-slate-950">Studio locked</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Sign in to upload videos, generate clips, and download outputs.
          </p>
          <Link href="/sign-in" className="mt-6 inline-block">
            <Button className="bg-slate-950 hover:bg-slate-800">Sign in</Button>
          </Link>
        </div>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Create clips"
      subtitle="Paste a link or upload a video. SupoClip finds TikTok-ready moments."
      actions={
        <Link href="/list">
          <Button variant="outline" className="hidden bg-white sm:inline-flex">
            Projects
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-6">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-[var(--font-syne)] text-2xl font-bold text-slate-950">
                      New TikTok source
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">Both YouTube links and uploads use same generation path.</p>
                  </div>
                  <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                    <button
                      type="button"
                      onClick={() => setSourceType("youtube")}
                      className={cn(
                        "flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-bold transition",
                        sourceType === "youtube" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500",
                      )}
                    >
                      <Youtube className="h-4 w-4 text-red-500" />
                      Link
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceType("upload")}
                      className={cn(
                        "flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-bold transition",
                        sourceType === "upload" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500",
                      )}
                    >
                      <Upload className="h-4 w-4 text-cyan-600" />
                      Upload
                    </button>
                  </div>
                </div>

                <div className="mt-6">
                  {sourceType === "youtube" ? (
                    <div className="space-y-3">
                      <Label htmlFor="youtube-url">YouTube URL</Label>
                      <div className="flex gap-2">
                        <Input
                          id="youtube-url"
                          value={url}
                          onChange={(event) => setUrl(event.target.value)}
                          placeholder="https://youtube.com/watch?v=..."
                          className="h-12 rounded-lg border-slate-200 bg-white text-base"
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex min-h-48 w-full flex-col items-center justify-center rounded-lg border border-dashed border-cyan-300 bg-cyan-50/50 px-6 py-10 text-center transition hover:border-cyan-500 hover:bg-cyan-50"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      <FileVideo className="h-10 w-10 text-cyan-600" />
                      <span className="mt-4 text-sm font-bold text-slate-950">
                        {fileName || "Choose video file"}
                      </span>
                      <span className="mt-1 text-xs text-slate-500">MP4, MOV, WebM up to 1 GB</span>
                    </button>
                  )}
                </div>

                {error && (
                  <Alert className="mt-5 border-red-200 bg-red-50 text-red-900">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {isLoading && (
                  <div className="mt-5 rounded-lg border border-cyan-200 bg-cyan-50 p-4">
                    <div className="mb-3 flex items-center justify-between text-sm font-bold text-cyan-900">
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {statusMessage || "Creating task"}
                      </span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 bg-slate-950 p-4 lg:border-l lg:border-t-0">
                <div className="relative flex aspect-[9/16] min-h-[380px] items-center justify-center overflow-hidden rounded-lg bg-slate-900">
                  {thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnailUrl}
                      alt="YouTube preview"
                      className="absolute inset-0 h-full w-full object-cover opacity-80"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-[linear-gradient(135deg,#08111f,#0e7490_52%,#bef264)]" />
                  )}
                  <div className="absolute inset-x-5 bottom-5 rounded-lg border border-white/20 bg-white/90 p-4 shadow-2xl backdrop-blur">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase text-cyan-700">
                      <Play className="h-3.5 w-3.5" />
                      Source
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-slate-950">{sourceSummary}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Import", "Fetch source and prepare media"],
              ["Transcript", "Detect speech and timing"],
              ["Moments", "Find short-form hooks"],
            ].map(([label, detail], index) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-lime-50 text-sm font-black text-lime-700">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-sm font-bold text-slate-950">{label}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Workflow</Label>
                <Select value={selectedWorkflowId} onValueChange={handleWorkflowChange}>
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue placeholder="Default workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Default fast clips</SelectItem>
                    {workflows.map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Format</Label>
                  <Select value={outputFormat} onValueChange={(value) => setOutputFormat(value as OutputFormat)}>
                    <SelectTrigger className="h-11 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vertical">Vertical</SelectItem>
                      <SelectItem value="vertical_pan">Vertical pan</SelectItem>
                      <SelectItem value="vertical_split">Split screen</SelectItem>
                      <SelectItem value="original">Original</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Font size</Label>
                  <Input
                    type="number"
                    min={12}
                    max={72}
                    value={fontSize}
                    onChange={(event) => setFontSize(Number(event.target.value) || 24)}
                    className="h-11 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Caption style</Label>
                <Select value={captionTemplate} onValueChange={handleTemplateChange}>
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue placeholder="Caption style" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                    {availableTemplates.length === 0 && <SelectItem value="default">Default</SelectItem>}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div className="space-y-2">
                  <Label>Font</Label>
                  <Select value={fontFamily} onValueChange={setFontFamily}>
                    <SelectTrigger className="h-11 rounded-lg">
                      <SelectValue placeholder="Font family" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFonts.map((font) => (
                        <SelectItem key={font.name} value={font.name}>
                          {font.display_name}
                        </SelectItem>
                      ))}
                      {availableFonts.length === 0 && <SelectItem value="TikTokSans-Regular">TikTok Sans</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <input
                    type="color"
                    value={fontColor}
                    onChange={(event) => setFontColor(event.target.value)}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white p-1"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Subtitles className="h-4 w-4 text-cyan-600" />
                    Add subtitles
                  </span>
                  <Switch checked={addSubtitles} onCheckedChange={setAddSubtitles} />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-700">Include B-roll</span>
                  <Switch checked={includeBroll} onCheckedChange={setIncludeBroll} disabled={!brollAvailable} />
                </label>
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                  <Checkbox checked={cutLongPauses} onCheckedChange={(checked) => setCutLongPauses(Boolean(checked))} />
                  Cut long pauses
                </label>
                {cutLongPauses && (
                  <Input
                    type="number"
                    min={250}
                    max={3000}
                    step={50}
                    value={pauseThresholdMs}
                    onChange={(event) => setPauseThresholdMs(event.target.value)}
                    className="h-10 rounded-lg"
                    aria-label="Pause threshold"
                  />
                )}
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                  <Checkbox
                    checked={removeFillerWords}
                    onCheckedChange={(checked) => setRemoveFillerWords(Boolean(checked))}
                  />
                  Remove filler words
                </label>
                {removeFillerWords && (
                  <Textarea
                    value={filteredWords}
                    onChange={(event) => setFilteredWords(event.target.value)}
                    placeholder="basically, literally, to be honest"
                    className="min-h-20 rounded-lg"
                  />
                )}
              </div>

              <Button
                type="submit"
                className="h-12 w-full rounded-lg bg-slate-950 text-base font-bold hover:bg-slate-800"
                disabled={isLoading || !sourceReady}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Generate clips
                {!isLoading && <ArrowRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </aside>
      </form>
    </StudioShell>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <StudioShell title="Create clips" subtitle="Load studio">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Skeleton className="h-[520px] rounded-lg" />
            <Skeleton className="h-[520px] rounded-lg" />
          </div>
        </StudioShell>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
