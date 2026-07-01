"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Loader2,
  PlayCircle,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";

import { StudioShell } from "@/components/studio-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSupportMessage, parseApiError } from "@/lib/api-error";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  user_id: string;
  source_id: string;
  source_title: string;
  source_type: string;
  status: string;
  clips_count: number;
  created_at: string;
  updated_at: string;
}

type BatchAction = "cancel" | "resume" | "delete" | null;

const activeStatuses = ["queued", "processing", "retrying"];
const resumableStatuses = ["cancelled", "error"];

const statusConfig: Record<string, { label: string; className: string; dot: string }> = {
  completed: {
    label: "Ready",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  processing: {
    label: "Generating",
    className: "border-cyan-200 bg-cyan-50 text-cyan-700",
    dot: "bg-cyan-500 animate-pulse",
  },
  queued: {
    label: "Queued",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
  retrying: {
    label: "Retrying",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500 animate-pulse",
  },
  error: {
    label: "Error",
    className: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
  cancelled: {
    label: "Cancelled",
    className: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
  },
};

async function fetchTasksList() {
  const response = await fetch("/api/tasks/", {
    cache: "no-store",
  });

  if (!response.ok) {
    const parsed = await parseApiError(response, `Failed to fetch tasks: ${response.status}`);
    throw new Error(formatSupportMessage(parsed));
  }

  const data = await response.json();
  return (data.tasks || []) as Task[];
}

async function buildSupportError(response: Response, fallbackMessage: string) {
  const parsed = await parseApiError(response, fallbackMessage);
  return formatSupportMessage(parsed);
}

function StatusPill({ status }: { status: string }) {
  const config = statusConfig[status] || {
    label: status,
    className: "border-slate-200 bg-white text-slate-600",
    dot: "bg-slate-400",
  };

  return (
    <span className={cn("inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-bold", config.className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

export default function ListPage() {
  const { data: session, isPending } = useSession();
  const [mounted, setMounted] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchNotice, setBatchNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [activeBatchAction, setActiveBatchAction] = useState<BatchAction>(null);

  const loadTasks = async () => {
    if (!session?.user?.id) {
      setTasks([]);
      setSelectedTaskIds([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const nextTasks = await fetchTasksList();
      setTasks(nextTasks);
      setSelectedTaskIds((current) => current.filter((id) => nextTasks.some((task) => task.id === id)));
    } catch (loadError) {
      console.error("Error fetching tasks:", loadError);
      setError(loadError instanceof Error ? loadError.message : "Failed to load tasks");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, session?.user?.id]);

  const selectedTasks = tasks.filter((task) => selectedTaskIds.includes(task.id));
  const selectedCount = selectedTasks.length;
  const allVisibleSelected = tasks.length > 0 && tasks.every((task) => selectedTaskIds.includes(task.id));
  const someSelected = selectedCount > 0 && !allVisibleSelected;

  const stats = useMemo(
    () => ({
      ready: tasks.filter((task) => task.status === "completed").length,
      generating: tasks.filter((task) => activeStatuses.includes(task.status)).length,
      attention: tasks.filter((task) => resumableStatuses.includes(task.status)).length,
    }),
    [tasks],
  );

  const toggleTask = (taskId: string) => {
    setBatchNotice(null);
    setSelectedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  };

  const toggleAll = () => {
    setBatchNotice(null);
    setSelectedTaskIds(allVisibleSelected ? [] : tasks.map((task) => task.id));
  };

  const runBatchAction = async (
    action: Exclude<BatchAction, null>,
    targetTaskIds: string[],
    requestFactory: (taskId: string) => Promise<Response>,
    emptyMessage: string,
    successLabel: string,
    fallbackMessage: string,
  ) => {
    if (targetTaskIds.length === 0) {
      setBatchNotice({ tone: "error", message: emptyMessage });
      return;
    }

    setActiveBatchAction(action);
    setBatchNotice(null);

    const results = await Promise.allSettled(
      targetTaskIds.map(async (taskId) => {
        const response = await requestFactory(taskId);
        if (!response.ok) throw new Error(await buildSupportError(response, fallbackMessage));
        return taskId;
      }),
    );

    const failed = results.filter((result) => result.status === "rejected");
    await loadTasks();
    setSelectedTaskIds([]);
    setActiveBatchAction(null);

    if (failed.length > 0) {
      const first = failed[0] as PromiseRejectedResult;
      setBatchNotice({
        tone: "error",
        message: first.reason instanceof Error ? first.reason.message : fallbackMessage,
      });
    } else {
      setBatchNotice({ tone: "success", message: `${targetTaskIds.length} ${successLabel}` });
    }
  };

  const cancelSelected = async () => {
    const ids = selectedTasks.filter((task) => activeStatuses.includes(task.status)).map((task) => task.id);
    await runBatchAction(
      "cancel",
      ids,
      (taskId) => fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" }),
      "No active projects selected.",
      "cancelled",
      "Failed to cancel project",
    );
  };

  const resumeSelected = async () => {
    const ids = selectedTasks.filter((task) => resumableStatuses.includes(task.status)).map((task) => task.id);
    await runBatchAction(
      "resume",
      ids,
      (taskId) => fetch(`/api/tasks/${taskId}/resume`, { method: "POST" }),
      "No failed or cancelled projects selected.",
      "resumed",
      "Failed to resume project",
    );
  };

  const deleteSelected = async () => {
    await runBatchAction(
      "delete",
      selectedTaskIds,
      (taskId) => fetch(`/api/tasks/${taskId}`, { method: "DELETE" }),
      "Select at least one project.",
      "deleted",
      "Failed to delete project",
    );
  };

  if (!mounted || isPending) {
    return (
      <StudioShell title="Projects" subtitle="Load studio">
        <Skeleton className="h-[520px] rounded-lg" />
      </StudioShell>
    );
  }

  if (!session?.user) {
    return (
      <StudioShell title="Projects" subtitle="Sign in to view backend projects">
        <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <FolderOpen className="mx-auto h-10 w-10 text-cyan-600" />
          <h2 className="mt-4 font-[var(--font-syne)] text-2xl font-bold text-slate-950">No session</h2>
          <p className="mt-2 text-sm text-slate-600">Sign in to load your real project list.</p>
          <Link href="/sign-in" className="mt-6 inline-block">
            <Button className="bg-slate-950 hover:bg-slate-800">Sign in</Button>
          </Link>
        </div>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Projects"
      subtitle="Real backend generations. No sample rows."
      actions={
        <Link href="/">
          <Button className="hidden bg-slate-950 hover:bg-slate-800 sm:inline-flex">
            New task
          </Button>
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-emerald-200 bg-white p-5 shadow-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <p className="mt-3 text-3xl font-bold text-slate-950">{stats.ready}</p>
            <p className="text-sm font-medium text-slate-500">Ready clips</p>
          </div>
          <div className="rounded-lg border border-cyan-200 bg-white p-5 shadow-sm">
            <Loader2 className={cn("h-5 w-5 text-cyan-600", stats.generating > 0 && "animate-spin")} />
            <p className="mt-3 text-3xl font-bold text-slate-950">{stats.generating}</p>
            <p className="text-sm font-medium text-slate-500">Generating</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-white p-5 shadow-sm">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <p className="mt-3 text-3xl font-bold text-slate-950">{stats.attention}</p>
            <p className="text-sm font-medium text-slate-500">Needs action</p>
          </div>
        </div>

        {batchNotice && (
          <Alert className={cn(batchNotice.tone === "success" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
            {batchNotice.tone === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600" />
            )}
            <AlertDescription>{batchNotice.message}</AlertDescription>
          </Alert>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={allVisibleSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                disabled={activeBatchAction !== null || tasks.length === 0}
                aria-label="Select all projects"
              />
              <span className="text-sm font-bold text-slate-950">
                {selectedCount > 0 ? `${selectedCount} selected` : `${tasks.length} projects`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="bg-white" onClick={() => void loadTasks()}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              {selectedCount > 0 && (
                <>
                  <Button size="sm" variant="outline" className="bg-white" onClick={cancelSelected} disabled={activeBatchAction !== null}>
                    <XCircle className="h-4 w-4" />
                    Cancel
                  </Button>
                  <Button size="sm" variant="outline" className="bg-white" onClick={resumeSelected} disabled={activeBatchAction !== null}>
                    <RefreshCw className="h-4 w-4" />
                    Resume
                  </Button>
                  <Button size="sm" variant="outline" className="border-red-200 bg-white text-red-700 hover:bg-red-50" onClick={deleteSelected} disabled={activeBatchAction !== null}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="divide-y divide-slate-100">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="flex items-center gap-4 p-4">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-64" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-5">
              <Alert className="border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-12 text-center">
              <PlayCircle className="mx-auto h-12 w-12 text-cyan-600" />
              <h2 className="mt-4 font-[var(--font-syne)] text-2xl font-bold text-slate-950">No projects yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Create a task from a link or upload. Finished clips appear here from backend data.
              </p>
              <Link href="/" className="mt-6 inline-block">
                <Button className="bg-slate-950 hover:bg-slate-800">Create first task</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {tasks.map((task) => {
                const selected = selectedTaskIds.includes(task.id);
                return (
                  <div
                    key={task.id}
                    className={cn(
                      "grid gap-4 p-4 transition hover:bg-cyan-50/30 md:grid-cols-[auto_1fr_auto]",
                      selected && "bg-cyan-50/50",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleTask(task.id)}
                        disabled={activeBatchAction !== null}
                        aria-label={`Select ${task.source_title}`}
                        className="mt-3"
                      />
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-950 text-white">
                        <PlayCircle className="h-5 w-5" />
                      </div>
                    </div>

                    <Link href={`/tasks/${task.id}`} className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-bold text-slate-950">{task.source_title}</h3>
                        <StatusPill status={task.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                        <span className="capitalize">{task.source_type}</span>
                        <span>{task.clips_count} clips</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatDate(task.created_at)}
                        </span>
                      </div>
                    </Link>

                    <div className="flex items-center gap-2 md:justify-end">
                      <Link href={`/tasks/${task.id}`}>
                        <Button variant="outline" className="bg-white">
                          Open
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </StudioShell>
  );
}
