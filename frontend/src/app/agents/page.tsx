"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Copy, Database, FileText, Save } from "lucide-react";
import { StudioShell } from "@/components/studio-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth-client";
import { formatSupportMessage, parseApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

interface AgentTemplate {
  key: string;
  name: string;
  description: string;
  agent_type: string;
}

interface AgentRun {
  id: string;
  agent_task_id: string;
  task_id?: string | null;
  agent_key: string;
  status: string;
  prompt_text: string;
  output_text?: string | null;
  error_message?: string | null;
  agent_task_title?: string | null;
  created_at: string;
}

interface TaskListItem {
  id: string;
  source_title: string;
  status: string;
  created_at: string;
}

async function buildSupportError(response: Response, fallbackMessage: string) {
  const parsed = await parseApiError(response, fallbackMessage);
  return formatSupportMessage(parsed);
}

export default function AgentsPage() {
  const { data: session, isPending } = useSession();
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [taskId, setTaskId] = useState("");
  const [goal, setGoal] = useState("Improve personal self-hosted clipping workflow for Shorts/Reels/TikTok.");
  const [prompt, setPrompt] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [outputText, setOutputText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || null,
    [runs, selectedRunId],
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.key === templateKey) || null,
    [templates, templateKey],
  );

  const loadData = useCallback(async () => {
    if (!session?.user?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [templatesResponse, runsResponse, tasksResponse] = await Promise.all([
        fetch("/api/agents/templates", { cache: "no-store" }),
        fetch("/api/agents/runs", { cache: "no-store" }),
        fetch("/api/tasks", { cache: "no-store" }),
      ]);
      if (!templatesResponse.ok) {
        throw new Error(await buildSupportError(templatesResponse, "Failed to load agent templates"));
      }
      if (!runsResponse.ok) {
        throw new Error(await buildSupportError(runsResponse, "Failed to load agent runs"));
      }
      if (!tasksResponse.ok) {
        throw new Error(await buildSupportError(tasksResponse, "Failed to load tasks"));
      }
      const templatesData = await templatesResponse.json();
      const runsData = await runsResponse.json();
      const tasksData = await tasksResponse.json();
      const nextTemplates = (templatesData.templates || []) as AgentTemplate[];
      const nextRuns = (runsData.runs || []) as AgentRun[];
      const nextTasks = (tasksData.tasks || []) as TaskListItem[];
      setTemplates(nextTemplates);
      setRuns(nextRuns);
      setTasks(nextTasks);
      setTemplateKey((current) => current || nextTemplates[0]?.key || "");
      setTaskId((current) => current || nextTasks[0]?.id || "");
      setSelectedRunId((current) => current || nextRuns[0]?.id || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load agent workspace");
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedRun) return;
    setPrompt(selectedRun.prompt_text || "");
    setOutputText(selectedRun.output_text || "");
  }, [selectedRun]);

  const createRun = async () => {
    if (!templateKey) {
      setError("Choose an agent template first.");
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_key: templateKey,
          task_id: taskId || undefined,
          goal,
        }),
      });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to create agent prompt"));
      }
      const data = await response.json();
      const run = data.run as AgentRun;
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setPrompt(run.prompt_text || "");
      setOutputText(run.output_text || "");
      setNotice("Prompt saved. Copy into Codex or Claude, then paste output back here.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create agent prompt");
    } finally {
      setIsSaving(false);
    }
  };

  const saveOutput = async () => {
    if (!selectedRunId) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/agents/runs/${selectedRunId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          output_text: outputText,
        }),
      });
      if (!response.ok) {
        throw new Error(await buildSupportError(response, "Failed to save agent output"));
      }
      const data = await response.json();
      const run = data.run as AgentRun;
      setRuns((current) => current.map((item) => (item.id === run.id ? run : item)));
      setNotice("Agent output saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save agent output");
    } finally {
      setIsSaving(false);
    }
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setNotice("Prompt copied.");
  };

  if (isPending || isLoading) {
    return (
      <StudioShell title="Agents" subtitle="Load workspace">
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </StudioShell>
    );
  }

  if (!session?.user) {
    return (
      <StudioShell title="Agents" subtitle="Sign in to use agent workspace">
        <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="mb-4 text-sm text-slate-600">Sign in to use agent workspace.</p>
          <Link href="/sign-in">
            <Button className="bg-slate-950 hover:bg-slate-800">Sign in</Button>
          </Link>
        </div>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Agents"
      subtitle="Codex/Claude handoff prompts with saved task context."
      actions={<Badge variant="outline" className="gap-1 bg-white"><Database className="h-3.5 w-3.5" />local</Badge>}
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

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <section className="space-y-4">
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  <h2 className="font-semibold">New Prompt</h2>
                </div>
                <div className="space-y-2">
                  <Label>Template</Label>
                  <Select value={templateKey} onValueChange={setTemplateKey}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.key} value={template.key}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && (
                    <p className="text-xs text-stone-500">{selectedTemplate.description}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Task Context</Label>
                  <Select value={taskId} onValueChange={setTaskId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose task" />
                    </SelectTrigger>
                    <SelectContent>
                      {tasks.map((task) => (
                        <SelectItem key={task.id} value={task.id}>
                          {task.source_title || task.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Goal</Label>
                  <Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={4} />
                </div>
                <Button onClick={createRun} disabled={isSaving || !templateKey} className="w-full">
                  <FileText className="mr-2 h-4 w-4" />
                  Create Prompt
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-4">
                <h2 className="font-semibold">Saved Runs</h2>
                {runs.length === 0 ? (
                  <p className="text-sm text-stone-500">No agent runs yet.</p>
                ) : (
                  <div className="space-y-2">
                    {runs.map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setSelectedRunId(run.id)}
                        className={cn(
                          "w-full rounded-md border p-3 text-left text-sm transition",
                          selectedRunId === run.id
                            ? "border-stone-900 bg-white"
                            : "border-stone-200 bg-stone-50 hover:border-stone-400",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{run.agent_task_title || run.agent_key}</span>
                          <Badge variant="outline">{run.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-stone-500">{new Date(run.created_at).toLocaleString()}</p>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">Prompt</h2>
                  <Button variant="outline" size="sm" onClick={copyPrompt} disabled={!prompt}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={18}
                  className="font-mono text-xs"
                  placeholder="Create a prompt to generate agent handoff context."
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold">Agent Output</h2>
                  <div className="flex items-center gap-2">
                    <Input value={selectedRun?.status || "draft"} readOnly className="h-9 w-32" />
                    <Button variant="outline" size="sm" onClick={saveOutput} disabled={!selectedRunId || isSaving}>
                      <Save className="mr-2 h-4 w-4" />
                      Save
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={outputText}
                  onChange={(event) => setOutputText(event.target.value)}
                  rows={12}
                  placeholder="Paste Claude/Codex result here."
                />
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </StudioShell>
  );
}
