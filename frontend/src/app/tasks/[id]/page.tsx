"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock3,
  Download,
  Edit2,
  Film,
  Loader2,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import DynamicVideoPlayer from "@/components/dynamic-video-player";
import { StudioShell } from "@/components/studio-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatSupportMessage, parseApiError } from "@/lib/api-error";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface Clip {
  id: string;
  filename: string;
  file_path: string;
  start_time: string;
  end_time: string;
  duration: number;
  text: string;
  relevance_score: number;
  reasoning: string;
  clip_order: number;
  created_at: string;
  video_url: string;
  virality_score: number;
  hook_score: number;
  engagement_score: number;
  value_score: number;
  shareability_score: number;
  hook_type: string | null;
}

interface ClipCandidate {
  candidate_order: number;
  start_time: string;
  end_time: string;
  text?: string;
  relevance_score?: number;
  reasoning?: string;
  virality_score?: number;
  hook_score?: number;
  engagement_score?: number;
  value_score?: number;
  shareability_score?: number;
  hook_type?: string | null;
}

type StageKey =
  | "queue"
  | "download"
  | "transcribe"
  | "analyze"
  | "render"
  | "complete";
type StageState = "pending" | "active" | "done" | "failed";
type StagePayload = Partial<
  Record<StageKey, { state?: StageState; progress?: number | null }>
>;

interface TaskDetails {
  id: string;
  user_id: string;
  source_id: string;
  source_title: string;
  source_type: string;
  status: string;
  progress?: number;
  progress_message?: string;
  error_code?: string | null;
  error_message?: string | null;
  current_stage?: StageKey | string | null;
  failed_stage?: StageKey | string | null;
  resume_from_stage?: StageKey | string | null;
  stage_progress_json?: string | null;
  stages?: StagePayload | null;
  retry_count?: number;
  max_retries?: number;
  dead_letter?: boolean;
  dead_letter_payload?: {
    error?: string;
    tries?: number;
    raw?: unknown;
  } | null;
  resume_action_label?: string;
  last_error_at?: string | null;
  clips_count: number;
  clip_candidates?: ClipCandidate[];
  created_at: string;
  updated_at: string;
}

interface ProcessingStage {
  key: StageKey;
  label: string;
  detail: string;
  startProgress: number;
  state: StageState;
  percent: number;
}

const processingStageConfig: Array<Omit<ProcessingStage, "state" | "percent">> =
  [
    { key: "queue", label: "Import", detail: "Queue source", startProgress: 0 },
    {
      key: "download",
      label: "Fetch",
      detail: "Load video",
      startProgress: 10,
    },
    {
      key: "transcribe",
      label: "Transcript",
      detail: "Time speech",
      startProgress: 30,
    },
    {
      key: "analyze",
      label: "Moments",
      detail: "Find hooks",
      startProgress: 50,
    },
    {
      key: "render",
      label: "Render",
      detail: "Create clips",
      startProgress: 70,
    },
    { key: "complete", label: "Ready", detail: "Download", startProgress: 100 },
  ];

const activeStatuses = ["queued", "processing", "retrying"];

function inferStageKey(
  status: string | undefined,
  progress: number,
  message: string,
  errorCode?: string | null,
): StageKey {
  const normalizedMessage = message.toLowerCase();
  const normalizedErrorCode = (errorCode || "").toLowerCase();

  if (status === "completed") return "complete";
  if (
    normalizedErrorCode.includes("download") ||
    normalizedMessage.includes("download")
  )
    return "download";
  if (
    normalizedErrorCode.includes("transcript") ||
    normalizedMessage.includes("transcript")
  )
    return "transcribe";
  if (
    normalizedErrorCode.includes("analysis") ||
    normalizedMessage.includes("analyz")
  )
    return "analyze";
  if (
    normalizedErrorCode.includes("render") ||
    normalizedMessage.includes("clip") ||
    progress >= 70
  )
    return "render";
  if (status === "queued" || progress < 10) return "queue";
  if (progress >= 50) return "analyze";
  if (progress >= 30) return "transcribe";
  return "download";
}

function buildProcessingStages(
  task: TaskDetails | null,
  progress: number,
  progressMessage: string,
): ProcessingStage[] {
  const status = task?.status;
  const activeProgress = Math.max(
    0,
    Math.min(100, progress || task?.progress || 0),
  );
  const activeMessage = progressMessage || task?.progress_message || "";

  if (task?.stages) {
    return processingStageConfig.map((stage) => {
      const payload = task.stages?.[stage.key];
      const state =
        payload?.state &&
        ["pending", "active", "done", "failed"].includes(payload.state)
          ? payload.state
          : "pending";
      return {
        ...stage,
        state,
        percent:
          typeof payload?.progress === "number"
            ? payload.progress
            : stage.startProgress,
      };
    });
  }

  const persistedStage =
    typeof task?.failed_stage === "string" && task.failed_stage
      ? task.failed_stage
      : typeof task?.current_stage === "string" && task.current_stage
        ? task.current_stage
        : null;
  const activeStage = processingStageConfig.some(
    (stage) => stage.key === persistedStage,
  )
    ? (persistedStage as StageKey)
    : inferStageKey(status, activeProgress, activeMessage, task?.error_code);
  const activeStageIndex = processingStageConfig.findIndex(
    (stage) => stage.key === activeStage,
  );
  const failedStageIndex =
    status === "error" || status === "cancelled" ? activeStageIndex : -1;

  return processingStageConfig.map((stage, index) => {
    let state: StageState = "pending";
    if (status === "completed" || activeProgress >= stage.startProgress)
      state = "done";
    if (index === activeStageIndex && status !== "completed") state = "active";
    if (failedStageIndex === index) state = "failed";
    return {
      ...stage,
      state,
      percent: stage.key === activeStage ? activeProgress : stage.startProgress,
    };
  });
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function parseTimestampToSeconds(timestamp: string) {
  const parts = timestamp.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(timestamp) || 0;
}

function scoreColor(score: number) {
  if (score >= 0.8) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 0.6) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-700";
}

function viralityColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-lime-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    processing: "border-cyan-200 bg-cyan-50 text-cyan-700",
    queued: "border-amber-200 bg-amber-50 text-amber-700",
    retrying: "border-amber-200 bg-amber-50 text-amber-700",
    analysis_ready: "border-lime-200 bg-lime-50 text-lime-700",
    error: "border-red-200 bg-red-50 text-red-700",
    cancelled: "border-slate-200 bg-slate-50 text-slate-600",
  };

  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-2.5 py-1 text-xs font-bold capitalize",
        map[status] || "border-slate-200 bg-white text-slate-600",
      )}
    >
      {status === "analysis_ready"
        ? "Review candidates"
        : status.replace("_", " ")}
    </span>
  );
}

function StageRail({
  stages,
  message,
  clipsReady,
}: {
  stages: ProcessingStage[];
  message: string;
  clipsReady: number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[var(--font-syne)] text-xl font-bold text-slate-950">
            Generation
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {message || "Waiting for worker update"}
          </p>
        </div>
        {clipsReady > 0 && (
          <Badge
            variant="outline"
            className="border-lime-200 bg-lime-50 text-lime-700"
          >
            {clipsReady} ready
          </Badge>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-6">
        {stages.map((stage) => (
          <div
            key={stage.key}
            className={cn(
              "rounded-lg border p-3",
              stage.state === "done" && "border-emerald-200 bg-emerald-50",
              stage.state === "active" && "border-cyan-200 bg-cyan-50",
              stage.state === "failed" && "border-red-200 bg-red-50",
              stage.state === "pending" && "border-slate-200 bg-slate-50",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-950">
                {stage.label}
              </span>
              {stage.state === "done" ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : stage.state === "active" ? (
                <Loader2 className="h-4 w-4 animate-spin text-cyan-600" />
              ) : stage.state === "failed" ? (
                <X className="h-4 w-4 text-red-600" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-slate-300" />
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">{stage.detail}</p>
            <p className="mt-3 text-xs font-bold uppercase text-slate-400">
              {stage.state}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteTaskDialog, setShowDeleteTaskDialog] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [isRenderingCandidates, setIsRenderingCandidates] = useState(false);
  const [selectedCandidateOrders, setSelectedCandidateOrders] = useState<
    number[]
  >([]);
  const [previewStartSeconds, setPreviewStartSeconds] = useState(0);
  const hasTriggeredAutoRefresh = useRef(false);

  const taskApiUrl = "/api/tasks";
  const taskId = Array.isArray(params.id) ? params.id[0] : params.id;
  const stages = useMemo(
    () => buildProcessingStages(task, progress, progressMessage),
    [task, progress, progressMessage],
  );

  const getClipUrl = (videoUrl: string) =>
    videoUrl.startsWith("/api/") ? videoUrl : `/api${videoUrl}`;
  const getSourcePreviewUrl = () =>
    `${taskApiUrl}/${taskId}/source-file#t=${Math.max(0, previewStartSeconds)}`;

  const buildSupportError = useCallback(
    async (response: Response, fallbackMessage: string) => {
      const parsed = await parseApiError(response, fallbackMessage);
      return formatSupportMessage(parsed);
    },
    [],
  );

  const triggerAutoRefresh = useCallback(() => {
    if (hasTriggeredAutoRefresh.current) return;
    hasTriggeredAutoRefresh.current = true;
    setTimeout(() => {
      window.location.reload();
    }, 700);
  }, []);

  const fetchTaskStatus = useCallback(
    async (retryCount = 0, maxRetries = 5) => {
      if (!taskId) return false;

      try {
        const taskResponse = await fetch(`${taskApiUrl}/${taskId}`, {
          cache: "no-store",
        });
        if (taskResponse.status === 404 && retryCount < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, (retryCount + 1) * 500),
          );
          return fetchTaskStatus(retryCount + 1, maxRetries);
        }
        if (!taskResponse.ok) {
          throw new Error(
            await buildSupportError(
              taskResponse,
              `Failed to fetch task: ${taskResponse.status}`,
            ),
          );
        }

        const taskData = await taskResponse.json();
        setTask(taskData);
        setProgress(taskData.progress || 0);
        setProgressMessage(taskData.progress_message || "");

        if (taskData.status === "analysis_ready") {
          const orders = (taskData.clip_candidates || [])
            .map((candidate: ClipCandidate) => candidate.candidate_order)
            .filter((order: number) => Number.isFinite(order));
          setSelectedCandidateOrders((current) =>
            current.length > 0 ? current : orders,
          );
        }

        if (
          [
            "completed",
            "processing",
            "retrying",
            "analysis_ready",
            "error",
            "cancelled",
          ].includes(taskData.status)
        ) {
          const clipsResponse = await fetch(`${taskApiUrl}/${taskId}/clips`, {
            cache: "no-store",
          });
          if (!clipsResponse.ok) {
            throw new Error(
              await buildSupportError(
                clipsResponse,
                `Failed to fetch clips: ${clipsResponse.status}`,
              ),
            );
          }
          const clipsData = await clipsResponse.json();
          const nextClips = (clipsData.clips || []) as Clip[];
          setClips((current) => {
            if (["completed", "error", "cancelled"].includes(taskData.status))
              return nextClips;
            const merged = new Map<string, Clip>();
            current.forEach((clip) => merged.set(clip.id, clip));
            nextClips.forEach((clip) => merged.set(clip.id, clip));
            return Array.from(merged.values()).sort(
              (a, b) => (a.clip_order ?? 0) - (b.clip_order ?? 0),
            );
          });
        }

        return true;
      } catch (fetchError) {
        console.error("Error fetching task data:", fetchError);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load task",
        );
        return false;
      }
    },
    [buildSupportError, taskId],
  );

  useEffect(() => {
    if (!taskId) return;

    const fetchTaskData = async () => {
      try {
        setIsLoading(true);
        await fetchTaskStatus();
      } finally {
        setIsLoading(false);
      }
    };

    void fetchTaskData();
  }, [taskId, fetchTaskStatus]);

  useEffect(() => {
    const taskStatus = task?.status;
    if (!taskId || !taskStatus || !activeStatuses.includes(taskStatus)) return;

    const eventSource = new EventSource(`${taskApiUrl}/${taskId}/progress`);

    const updateFromEvent = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data);
      setProgress(data.progress || 0);
      setProgressMessage(data.message || "");
      if (data.status) {
        setTask((current) =>
          current
            ? {
                ...current,
                status: data.status,
                progress: data.progress ?? current.progress,
                progress_message: data.message ?? current.progress_message,
                current_stage: data.current_stage ?? current.current_stage,
                failed_stage: data.failed_stage ?? current.failed_stage,
                resume_from_stage:
                  data.resume_from_stage ?? current.resume_from_stage,
                resume_action_label:
                  data.resume_action_label ?? current.resume_action_label,
                error_code: data.error_code ?? current.error_code,
                error_message: data.error_message ?? current.error_message,
                retry_count: data.retry_count ?? current.retry_count,
                max_retries: data.max_retries ?? current.max_retries,
                stages: data.stages ?? current.stages,
              }
            : current,
        );
        if (data.status === "completed") {
          void fetchTaskStatus().then(() => triggerAutoRefresh());
        } else if (
          ["analysis_ready", "error", "cancelled"].includes(data.status)
        ) {
          void fetchTaskStatus();
        }
      }
    };

    eventSource.addEventListener("status", updateFromEvent);
    eventSource.addEventListener("progress", updateFromEvent);
    eventSource.addEventListener("clip_ready", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data);
      if (data.clip) {
        setClips((current) => {
          if (current.some((clip) => clip.id === data.clip.id)) return current;
          return [...current, data.clip].sort(
            (a, b) => (a.clip_order ?? 0) - (b.clip_order ?? 0),
          );
        });
      }
    });
    eventSource.addEventListener("close", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data);
      eventSource.close();
      void fetchTaskStatus();
      if (data.status === "completed") triggerAutoRefresh();
    });
    eventSource.addEventListener("error", () => {
      setActionError("Connection interrupted. Refreshed latest task state.");
      void fetchTaskStatus();
      eventSource.close();
    });

    return () => eventSource.close();
  }, [fetchTaskStatus, task?.status, taskId, triggerAutoRefresh]);

  const handleEditTitle = async () => {
    if (!editedTitle.trim() || !session?.user?.id || !taskId) return;

    const response = await fetch(`${taskApiUrl}/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editedTitle }),
    });

    if (!response.ok) {
      setActionError(
        await buildSupportError(response, "Failed to update title"),
      );
      return;
    }

    setTask((current) =>
      current ? { ...current, source_title: editedTitle } : current,
    );
    setIsEditingTitle(false);
  };

  const handleDeleteTask = async () => {
    if (!session?.user?.id || !taskId) return;
    setIsDeleting(true);
    const response = await fetch(`${taskApiUrl}/${taskId}`, {
      method: "DELETE",
    });
    setIsDeleting(false);
    setShowDeleteTaskDialog(false);
    if (!response.ok) {
      setActionError(
        await buildSupportError(response, "Failed to delete task"),
      );
      return;
    }
    router.push("/list");
  };

  const handleCancelTask = async () => {
    if (!task?.id) return;
    const response = await fetch(`${taskApiUrl}/${task.id}/cancel`, {
      method: "POST",
    });
    if (!response.ok) {
      setActionError(
        await buildSupportError(response, "Failed to cancel task"),
      );
      return;
    }
    await fetchTaskStatus();
  };

  const handleResumeTask = async () => {
    if (!task?.id) return;
    setIsResuming(true);
    setActionError(null);
    const response = await fetch(`${taskApiUrl}/${task.id}/resume`, {
      method: "POST",
    });
    setIsResuming(false);
    if (!response.ok) {
      setActionError(
        await buildSupportError(response, "Failed to resume task"),
      );
      return;
    }
    setProgress(0);
    setProgressMessage("Re-queued by user");
    await fetchTaskStatus();
  };

  const handleToggleCandidate = (candidateOrder: number) => {
    setSelectedCandidateOrders((current) =>
      current.includes(candidateOrder)
        ? current.filter((order) => order !== candidateOrder)
        : [...current, candidateOrder].sort((a, b) => a - b),
    );
  };

  const handleRenderCandidates = async () => {
    if (!task?.id || selectedCandidateOrders.length === 0) return;
    setIsRenderingCandidates(true);
    setActionError(null);
    const response = await fetch(`${taskApiUrl}/${task.id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_orders: selectedCandidateOrders }),
    });
    setIsRenderingCandidates(false);
    if (!response.ok) {
      setActionError(
        await buildSupportError(response, "Failed to render candidates"),
      );
      return;
    }
    setProgress(70);
    setProgressMessage("Queued for rendering");
    await fetchTaskStatus();
  };

  const handleDownloadClip = (clip: Clip) => {
    const link = document.createElement("a");
    link.href = getClipUrl(clip.video_url);
    link.download = clip.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDeleteClip = async (clipId: string) => {
    if (!session?.user?.id || !task?.id) return;
    const response = await fetch(`${taskApiUrl}/${task.id}/clips/${clipId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setActionError(
        await buildSupportError(response, "Failed to delete clip"),
      );
      return;
    }
    setClips((current) => current.filter((clip) => clip.id !== clipId));
    setDeletingClipId(null);
  };

  const failureMessage =
    task?.error_message ||
    task?.progress_message ||
    progressMessage ||
    "Processing stopped.";

  if (isLoading) {
    return (
      <StudioShell title="Clip review" subtitle="Load task">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-[560px] rounded-lg" />
          <Skeleton className="h-[560px] rounded-lg" />
        </div>
      </StudioShell>
    );
  }

  if (error || !task) {
    return (
      <StudioShell title="Clip review" subtitle="Task unavailable">
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription>{error || "Task not found"}</AlertDescription>
        </Alert>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Clip review"
      subtitle="Preview generated moments. Download final clips."
      actions={
        <div className="flex items-center gap-2">
          <Link href="/list">
            <Button
              variant="outline"
              className="hidden bg-white sm:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" />
              Projects
            </Button>
          </Link>
          <Button
            variant="outline"
            className="border-red-200 bg-white text-red-700 hover:bg-red-50"
            onClick={() => setShowDeleteTaskDialog(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              {isEditingTitle ? (
                <div className="flex max-w-3xl gap-2">
                  <Input
                    value={editedTitle}
                    onChange={(event) => setEditedTitle(event.target.value)}
                    className="h-11 rounded-lg text-lg font-bold"
                    autoFocus
                  />
                  <Button
                    onClick={handleEditTitle}
                    disabled={!editedTitle.trim()}
                    className="bg-slate-950 hover:bg-slate-800"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="bg-white"
                    onClick={() => {
                      setIsEditingTitle(false);
                      setEditedTitle(task.source_title);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-[var(--font-syne)] text-2xl font-bold text-slate-950">
                    {task.source_title}
                  </h2>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      setIsEditingTitle(true);
                      setEditedTitle(task.source_title);
                    }}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                <StatusBadge status={task.status} />
                <span className="capitalize">{task.source_type}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-4 w-4" />
                  {new Date(task.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span>{clips.length} clips</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {activeStatuses.includes(task.status) && (
                <Button
                  variant="outline"
                  className="bg-white"
                  onClick={handleCancelTask}
                >
                  Cancel
                </Button>
              )}
              {(task.status === "cancelled" || task.status === "error") && (
                <Button
                  variant="outline"
                  className="bg-white"
                  onClick={handleResumeTask}
                  disabled={isResuming}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", isResuming && "animate-spin")}
                  />
                  {isResuming
                    ? "Resuming"
                    : task.resume_action_label || "Resume"}
                </Button>
              )}
              {task.status === "completed" && clips.length > 0 && (
                <Link href={`/tasks/${task.id}/edit`}>
                  <Button variant="outline" className="bg-white">
                    <Scissors className="h-4 w-4" />
                    Open editor
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </section>

        <StageRail
          stages={stages}
          message={task.progress_message || "Analysis complete"}
          clipsReady={clips.length}
        />

        {actionError && (
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        {activeStatuses.includes(task.status) && (
          <div className="space-y-6">
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-5">
              <div className="mb-3 flex items-center justify-between text-sm font-bold text-cyan-900">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {progressMessage || "Generating"}
                </span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </div>
        )}

        {task.status === "analysis_ready" && (
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-[var(--font-syne)] text-xl font-bold text-slate-950">
                    Candidate review
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Pick moments to render. Transcript editing skipped.
                  </p>
                </div>
                <Button
                  className="bg-slate-950 hover:bg-slate-800"
                  onClick={handleRenderCandidates}
                  disabled={
                    selectedCandidateOrders.length === 0 ||
                    isRenderingCandidates
                  }
                >
                  {isRenderingCandidates ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Film className="h-4 w-4" />
                  )}
                  Render {selectedCandidateOrders.length}
                </Button>
              </div>
              

              {(task.clip_candidates || []).length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center">
                  <AlertCircle className="mx-auto h-10 w-10 text-amber-600" />
                  <h3 className="mt-4 font-bold text-slate-950">
                    No candidates found
                  </h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Try another source or adjust settings later.
                  </p>
                </div>
              ) : (
                
                <div className="space-y-3">
                  {(task.clip_candidates || []).map((candidate) => {
                    const selected = selectedCandidateOrders.includes(
                      candidate.candidate_order,
                    );
                    return (
                      <div
                        key={candidate.candidate_order}
                        className={cn(
                          "rounded-lg border p-4 transition",
                          selected
                            ? "border-cyan-300 bg-cyan-50/60"
                            : "border-slate-200 bg-white hover:border-cyan-200",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() =>
                              handleToggleCandidate(candidate.candidate_order)
                            }
                            className="mt-1"
                            aria-label={`Select candidate ${candidate.candidate_order}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-bold text-slate-950">
                                Candidate {candidate.candidate_order}
                              </h3>
                              <Badge variant="outline" className="bg-white">
                                {candidate.start_time} - {candidate.end_time}
                              </Badge>
                              {typeof candidate.virality_score === "number" &&
                                candidate.virality_score > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="border-lime-200 bg-lime-50 text-lime-700"
                                  >
                                    <Zap className="mr-1 h-3 w-3" />
                                    {candidate.virality_score}
                                  </Badge>
                                )}
                              {typeof candidate.relevance_score ===
                                "number" && (
                                <Badge
                                  variant="outline"
                                  className={scoreColor(
                                    candidate.relevance_score,
                                  )}
                                >
                                  <Star className="mr-1 h-3 w-3" />
                                  {(candidate.relevance_score * 100).toFixed(0)}
                                  %
                                </Badge>
                              )}
                            </div>
                            {candidate.text && (
                              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                                {candidate.text}
                              </p>
                            )}
                            {candidate.reasoning && (
                              <p className="mt-2 text-xs font-medium text-slate-400">
                                {candidate.reasoning}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            className="bg-white"
                            onClick={() =>
                              setPreviewStartSeconds(
                                parseTimestampToSeconds(candidate.start_time),
                              )
                            }
                          >
                            <Play className="h-4 w-4" />
                            Preview
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <aside className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-[var(--font-syne)] text-xl font-bold text-slate-950">
                  Source preview
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Starts at {formatDuration(previewStartSeconds)}.
                </p>
                <div className="mt-4 overflow-hidden rounded-lg bg-slate-950">
                  <video
                    key={previewStartSeconds}
                    controls
                    preload="metadata"
                    className="aspect-video w-full object-contain"
                  >
                    <source src={getSourcePreviewUrl()} type="video/mp4" />
                  </video>
                </div>
              </div>
            </aside>
          </section>
        )}

        {(task.status === "error" || task.status === "cancelled") && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-4">
                <span
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-lg",
                    task.status === "error"
                      ? "bg-red-50 text-red-600"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  <AlertCircle className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="font-[var(--font-syne)] text-xl font-bold text-slate-950">
                    {task.status === "error"
                      ? "Generation failed"
                      : "Generation cancelled"}
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                    {failureMessage}
                  </p>
                  {task.resume_from_stage && (
                    <Badge
                      variant="outline"
                      className="mt-3 border-slate-200 bg-slate-50"
                    >
                      Resume: {task.resume_from_stage}
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                className="bg-white"
                onClick={handleResumeTask}
                disabled={isResuming}
              >
                <RefreshCw
                  className={cn("h-4 w-4", isResuming && "animate-spin")}
                />
                {isResuming ? "Resuming" : task.resume_action_label || "Retry"}
              </Button>
            </div>
          </section>
        )}

        {task.status === "completed" && clips.length === 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-12 text-center shadow-sm">
            <Sparkles className="mx-auto h-10 w-10 text-amber-600" />
            <h2 className="mt-4 font-[var(--font-syne)] text-2xl font-bold text-slate-950">
              No clips generated
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              Task finished, but backend found no usable moments.
            </p>
            <Link href="/" className="mt-6 inline-block">
              <Button className="bg-slate-950 hover:bg-slate-800">
                Try another video
              </Button>
            </Link>
          </section>
        )}

        {clips.length > 0 && (
          <section>
            <div className="space-y-4">
              <div className="space-y-4">
                {clips.map((clip) => (
                  <div
                    key={clip.id}
                    className="grid gap-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm xl:grid-cols-[320px_minmax(0,1fr)]"
                  >
                    <div className="rounded-lg bg-slate-950 p-3">
                      <div className="flex justify-center rounded-lg bg-black">
                        <DynamicVideoPlayer
                          src={getClipUrl(clip.video_url)}
                          poster="/placeholder-video.jpg"
                          height="min(64vh, 520px)"
                        />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-slate-950">
                            Clip {clip.clip_order}
                          </h3>
                          <Badge variant="outline" className="bg-white">
                            {clip.start_time} - {clip.end_time}
                          </Badge>
                          <Badge variant="outline" className="bg-white">
                            {formatDuration(clip.duration)}
                          </Badge>
                          {clip.virality_score > 0 && (
                            <Badge
                              variant="outline"
                              className="border-lime-200 bg-lime-50 text-lime-700"
                            >
                              <Zap className="mr-1 h-3 w-3" />
                              <span
                                className={viralityColor(clip.virality_score)}
                              >
                                {clip.virality_score}
                              </span>
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={scoreColor(clip.relevance_score)}
                          >
                            <Star className="mr-1 h-3 w-3" />
                            {(clip.relevance_score * 100).toFixed(0)}%
                          </Badge>
                        </div>

                        <div className="flex shrink-0 items-start gap-2 sm:justify-end">
                          <Button
                            className="bg-slate-950 hover:bg-slate-800"
                            onClick={() => handleDownloadClip(clip)}
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </Button>
                          <Button
                            variant="outline"
                            className="border-red-200 bg-white text-red-700 hover:bg-red-50"
                            onClick={() => setDeletingClipId(clip.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {clip.text && (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-bold uppercase text-slate-400">
                            Transcript
                          </p>
                          <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-700">
                            {clip.text}
                          </p>
                        </div>
                      )}

                      {clip.reasoning && (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          {clip.reasoning}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      <AlertDialog
        open={showDeleteTaskDialog}
        onOpenChange={setShowDeleteTaskDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes generation and clips.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTask}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "Deleting" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deletingClipId)}
        onOpenChange={(open) => !open && setDeletingClipId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deletingClipId && void handleDeleteClip(deletingClipId)
              }
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StudioShell>
  );
}
