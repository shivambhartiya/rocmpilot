"use client";

import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import { MessageResponse } from "@/components/ai-elements/message";
import { Terminal } from "@/components/ai-elements/terminal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SAMPLE_REPOS } from "@/lib/rocmpilot/data";
import type {
  AgentMemory,
  AgentMessage,
  AgentMessageKind,
  FindingSeverity,
  LongContextMemoryStatus,
  ReportResponse,
  RocmRun,
  RunStage,
} from "@/lib/rocmpilot/types";
import {
  Activity,
  BadgeCheck,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  FileCode2,
  Gauge,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const severityTone: Record<FindingSeverity, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-200",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  medium: "border-zinc-300/35 bg-zinc-200/10 text-zinc-100",
  low: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
};

const statusTone = {
  pending: "border-zinc-800 bg-zinc-950 text-zinc-500",
  running: "border-red-500/45 bg-red-500/10 text-red-100",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
};

const memoryStatusTone: Record<LongContextMemoryStatus["status"], string> = {
  connected: "border-red-500/40 bg-red-500/10 text-red-100",
  configured: "border-red-500/40 bg-red-500/10 text-red-100",
  fallback: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  "not-configured": "border-zinc-700 bg-zinc-900 text-zinc-300",
};

const messageKindTone: Record<AgentMessageKind, string> = {
  question: "border-red-500/40 bg-red-500/10 text-red-100",
  answer: "border-sky-500/40 bg-sky-500/10 text-sky-100",
  challenge: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  proposal: "border-orange-500/40 bg-orange-500/10 text-orange-100",
  decision: "border-lime-500/40 bg-lime-500/10 text-lime-100",
  memory: "border-rose-500/40 bg-rose-500/10 text-rose-100",
  consensus: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
};

const agentDotTone: Record<string, string> = {
  Orchestrator: "bg-red-400",
  "Repo Doctor": "bg-cyan-300",
  "Migration Planner": "bg-red-300",
  "Build Runner": "bg-amber-300",
  "Benchmark Agent": "bg-zinc-200",
  "Report Agent": "bg-rose-300",
};

function StageIcon({ stage }: { stage: RunStage }) {
  if (stage.status === "completed") {
    return <CheckCircle2 className="size-4 text-emerald-300" />;
  }

  if (stage.status === "running") {
    return <Loader2 className="size-4 animate-spin text-red-200" />;
  }

  return <Activity className="size-4 text-zinc-500" />;
}

function formatTime(value: string | undefined) {
  if (!value) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function WarRoomMessage({
  message,
  memoryById,
}: {
  message: AgentMessage;
  memoryById: Map<string, AgentMemory>;
}) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="relative mt-1 flex size-7 items-center justify-center rounded-full border border-border bg-card">
        <span
          className={`size-2.5 rounded-full ${agentDotTone[message.agent] ?? "bg-zinc-400"}`}
        />
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold">{message.agent}</p>
          <span className="text-xs text-muted-foreground">to</span>
          <p className="truncate text-sm font-medium text-red-100">{message.toAgent}</p>
          <Badge variant="outline" className={messageKindTone[message.kind]}>
            {message.kind}
          </Badge>
          {message.leadAgent === message.agent && (
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-100">
              lead
            </Badge>
          )}
          <span className="font-mono text-[11px] text-muted-foreground">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
          <span>{message.role}</span>
          <span>/</span>
          <span>{message.task}</span>
          {message.replyToId && (
            <>
              <span>/</span>
              <span>replying to earlier message</span>
            </>
          )}
        </div>
        <p className="break-words text-sm leading-6 text-foreground">{message.message}</p>
        {message.memoryRefs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.memoryRefs.map((memoryId) => (
              <Badge
                key={memoryId}
                variant="outline"
                className="border-red-500/20 bg-zinc-950/80 text-zinc-200"
              >
                memory: {memoryById.get(memoryId)?.title ?? memoryId}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentWarRoom({ run }: { run: RocmRun | null }) {
  const messages = useMemo(() => run?.agentMessages ?? [], [run?.agentMessages]);
  const memory = useMemo(() => run?.agentMemory ?? [], [run?.agentMemory]);
  const latestMessage = messages[messages.length - 1];
  const activeLead = latestMessage?.leadAgent ?? "No lead assigned";
  const memoryById = useMemo(
    () => new Map(memory.map((entry) => [entry.id, entry])),
    [memory]
  );

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Activity className="size-5 text-red-200" />
              Agent War Room
            </CardTitle>
            <CardDescription>
              Lead-led discussion with replies, objections, and shared memory the agents reuse later.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={
                run?.status === "running"
                  ? "border-red-500/40 bg-red-500/10 text-red-100"
                  : run?.status === "completed"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                    : "border-zinc-700 bg-zinc-950 text-zinc-300"
              }
            >
              {run?.status === "running" ? "live room" : run?.status === "completed" ? "consensus" : "standby"}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 bg-zinc-950 text-zinc-200">
              lead: {activeLead}
            </Badge>
            {run?.longContextMemory && (
              <Badge
                variant="outline"
                className={memoryStatusTone[run.longContextMemory.status]}
              >
                {run.longContextMemory.provider === "synap" ? "Synap memory" : "local memory"}
              </Badge>
            )}
          </div>
        </div>
        {latestMessage && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm leading-6 text-red-50">
            <span className="font-medium">
              {latestMessage.agent} to {latestMessage.toAgent}:
            </span>{" "}
            <span className="text-red-100/90">{latestMessage.message}</span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {messages.length ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.75fr)]">
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {messages.map((message) => (
                <WarRoomMessage key={message.id} message={message} memoryById={memoryById} />
              ))}
            </div>
            <div className="rounded-lg border border-border bg-background/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Shared memory</p>
                <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-100">
                  {memory.length} stored
                </Badge>
              </div>
              <div className="mt-3 max-h-[470px] space-y-3 overflow-y-auto pr-1">
                {memory.length ? (
                  memory.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-border/70 bg-card p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{entry.title}</p>
                        <Badge variant="outline">{entry.scope}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        learned from {entry.learnedFromAgent} at {formatTime(entry.createdAt)}
                      </p>
                      <p className="mt-3 text-sm leading-6">{entry.summary}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{entry.solution}</p>
                      {entry.usedBy.length > 0 && (
                        <p className="mt-3 text-xs text-emerald-100">
                          reused by {Array.from(new Set(entry.usedBy)).join(", ")}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Memory appears when agents store a blocker, solution, or evidence rule.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "Repo Doctor",
              "Migration Planner",
              "Build Runner",
              "Benchmark Agent",
              "Report Agent",
              "Orchestrator",
            ].map((agent) => (
              <div key={agent} className="flex min-w-0 items-center gap-3 rounded-lg bg-card p-3">
                <span className={`size-2.5 shrink-0 rounded-full ${agentDotTone[agent] ?? "bg-zinc-400"}`} />
                <span className="truncate text-sm text-muted-foreground">{agent} waiting</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RocmPilotDashboard() {
  const [sampleId, setSampleId] = useState(SAMPLE_REPOS[0].id);
  const [githubUrl, setGithubUrl] = useState("");
  const [run, setRun] = useState<RocmRun | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [activePanel, setActivePanel] = useState<"patches" | "logs" | "report">("patches");
  const [isStarting, setIsStarting] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportRequestedFor = useRef<string | null>(null);

  const selectedSample = useMemo(
    () => SAMPLE_REPOS.find((sample) => sample.id === sampleId) ?? SAMPLE_REPOS[0],
    [sampleId]
  );

  const logOutput = useMemo(() => run?.logs.join("\n") ?? "", [run]);
  const activeRepoUrl = run?.target.repoUrl ?? (githubUrl.trim() || selectedSample.repoUrl);

  const startRun = useCallback(async () => {
    setIsStarting(true);
    setError(null);
    setReport(null);
    reportRequestedFor.current = null;

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleId,
          mode: "mock",
          repoUrl: githubUrl.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not start migration audit");
      }

      const nextRun = (await response.json()) as RocmRun;
      setRun(nextRun);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown start error");
    } finally {
      setIsStarting(false);
    }
  }, [githubUrl, sampleId]);

  const pollRun = useCallback(async (runId: string) => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Could not refresh run state");
    }

    const nextRun = (await response.json()) as RocmRun;
    setRun(nextRun);
  }, []);

  const generateReport = useCallback(async (completedRun: RocmRun) => {
    setIsGeneratingReport(true);

    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(completedRun),
      });

      if (!response.ok) {
        throw new Error("Could not generate final report");
      }

      const reportResponse = (await response.json()) as ReportResponse;
      setReport(reportResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown report error");
    } finally {
      setIsGeneratingReport(false);
    }
  }, []);

  useEffect(() => {
    if (!run || run.status === "completed") {
      return;
    }

    const timer = window.setInterval(() => {
      void pollRun(run.id).catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Unknown polling error")
      );
    }, 900);

    return () => window.clearInterval(timer);
  }, [pollRun, run]);

  useEffect(() => {
    if (!run || run.status !== "completed" || reportRequestedFor.current === run.id) {
      return;
    }

    reportRequestedFor.current = run.id;
    void generateReport(run);
  }, [generateReport, run]);

  const modelStatus = report?.modelStatus ?? run?.modelStatus;
  const memoryStatus = report?.memoryStatus ?? run?.longContextMemory;
  const completedStages = run?.stages.filter((stage) => stage.status === "completed").length ?? 0;

  return (
    <main className="rocmpilot-shell min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-none min-w-0 flex-col gap-5 px-4 py-5 sm:px-5 lg:px-6">
        <section className="grid min-w-0 gap-5 border-b border-border pb-5 xl:grid-cols-[minmax(280px,0.55fr)_minmax(0,1fr)] xl:items-end">
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
              <Badge variant="outline" className="w-full justify-start border-red-500/45 bg-red-500/10 text-red-100 sm:w-fit sm:justify-center">
                Track 1
              </Badge>
              <Badge variant="outline" className="w-full justify-start border-red-500/45 bg-red-500/10 text-red-100 sm:w-fit sm:justify-center">
                ROCm + vLLM
              </Badge>
              <Badge variant="outline" className="w-full justify-start border-amber-500/40 bg-amber-500/10 text-amber-100 sm:w-fit sm:justify-center">
                Qwen3-Coder-Next
              </Badge>
              <Badge variant="outline" className="w-full justify-start border-cyan-300/50 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgb(34_211_238_/_0.12)] sm:w-fit sm:justify-center">
                CUDA to ROCm
              </Badge>
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                ROCmPilot
              </h1>
              <p className="mt-2 max-w-full text-sm leading-6 text-muted-foreground sm:max-w-3xl">
                Multi-agent ROCm migration cockpit for PyTorch and vLLM workloads.
              </p>
            </div>
          </div>

          <div className="grid w-full min-w-0 gap-3 md:grid-cols-[minmax(220px,0.85fr)_minmax(260px,1.35fr)] xl:grid-cols-[minmax(220px,0.8fr)_minmax(340px,1.45fr)_max-content]">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="sample">Sample workload</Label>
              <Select
                value={sampleId}
                onValueChange={(value) => {
                  setSampleId(value);
                  setGithubUrl("");
                }}
              >
                <SelectTrigger
                  id="sample"
                  className="h-10 w-full min-w-0 bg-card [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"
                >
                  <SelectValue placeholder="Select sample" />
                </SelectTrigger>
                <SelectContent>
                  {SAMPLE_REPOS.map((sample) => (
                    <SelectItem key={sample.id} value={sample.id}>
                      {sample.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="github-url">Public GitHub URL</Label>
              <Input
                id="github-url"
                className="h-10 bg-card font-mono text-xs sm:text-sm"
                onChange={(event) => setGithubUrl(event.target.value)}
                placeholder="https://github.com/org/repo"
                value={githubUrl}
              />
            </div>
            <Button
              className="h-10 w-full self-end md:col-span-2 xl:col-span-1 xl:w-auto"
              disabled={isStarting || (run?.status === "running")}
              onClick={startRun}
            >
              {isStarting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : run ? (
                <RefreshCw className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {run ? "Run Again" : githubUrl.trim() ? "Scan Repo" : "Start Sample"}
            </Button>
          </div>
        </section>

        {error && (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertTitle>Demo flow needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="grid gap-5 lg:grid-cols-[1.6fr_0.9fr]">
          <div className="grid gap-5">
            <Card>
              <CardHeader className="gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <Bot className="size-5 text-red-200" />
                      Agent run
                    </CardTitle>
                    <CardDescription>
                      {run
                        ? `${completedStages}/${run.stages.length} stages complete`
                        : "Ready to audit the selected workload"}
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      run?.status === "completed"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                      : run?.status === "running"
                          ? "border-red-500/40 bg-red-500/10 text-red-100"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300"
                    }
                  >
                    {run?.status ?? "idle"}
                  </Badge>
                </div>
                <Progress value={run?.progress ?? 0} />
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-5">
                  {(run?.stages ?? []).length > 0 ? (
                    run?.stages.map((stage) => (
                      <div
                        key={stage.id}
                        className={`rounded-lg border p-3 ${statusTone[stage.status]}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <StageIcon stage={stage} />
                          <span className="font-mono text-[11px]">{stage.progress}%</span>
                        </div>
                        <p className="mt-3 text-sm font-medium leading-5">{stage.agent}</p>
                        <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">
                          {stage.title}
                        </p>
                        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                          {formatTime(stage.completedAt ?? stage.startedAt)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                      Select a workload and start the audit.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <AgentWarRoom run={run} />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShieldCheck className="size-5 text-red-200" />
                  Migration findings
                </CardTitle>
                <CardDescription>CUDA assumptions, ROCm blockers, and recommended fixes.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Severity</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Fix</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {run?.findings.length ? (
                        run.findings.map((finding) => (
                          <TableRow key={finding.id}>
                            <TableCell>
                              <Badge variant="outline" className={severityTone[finding.severity]}>
                                {finding.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{finding.category}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {finding.file}:{finding.line}
                            </TableCell>
                            <TableCell className="max-w-md text-sm text-muted-foreground">
                              {finding.recommendedFix}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                            Findings appear after the Repo Doctor stage starts.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <FileCode2 className="size-5 text-amber-200" />
                  Evidence panels
                </CardTitle>
                <CardDescription>Patch previews, terminal logs, and final report output.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="w-full">
                  <div
                    aria-label="Evidence panels"
                    className="grid w-full grid-cols-3 rounded-lg bg-muted p-1"
                    role="tablist"
                  >
                    {(["patches", "logs", "report"] as const).map((panel) => (
                      <Button
                        aria-selected={activePanel === panel}
                        className="h-8 capitalize"
                        key={panel}
                        onClick={() => setActivePanel(panel)}
                        role="tab"
                        type="button"
                        variant={activePanel === panel ? "secondary" : "ghost"}
                      >
                        {panel}
                      </Button>
                    ))}
                  </div>
                  {activePanel === "patches" && (
                    <div className="mt-4 space-y-4" role="tabpanel">
                    {run?.patches.length ? (
                      run.patches.map((patch) => (
                        <div key={patch.id} className="space-y-2 rounded-lg border border-border p-3">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm font-medium">{patch.file}</p>
                            <p className="max-w-xl text-xs text-muted-foreground">{patch.rationale}</p>
                          </div>
                          <CodeBlock code={patch.diff} language="diff" showLineNumbers>
                            <CodeBlockHeader>
                              <CodeBlockTitle>
                                <CodeBlockFilename>{patch.file}</CodeBlockFilename>
                              </CodeBlockTitle>
                              <CodeBlockCopyButton />
                            </CodeBlockHeader>
                          </CodeBlock>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                        Patch previews unlock after the Migration Planner stage.
                      </div>
                    )}
                    </div>
                  )}
                  {activePanel === "logs" && (
                    <div className="mt-4" role="tabpanel">
                    <Terminal
                      output={logOutput || "waiting for run output..."}
                      isStreaming={run?.status === "running"}
                    />
                    </div>
                  )}
                  {activePanel === "report" && (
                    <div className="mt-4" role="tabpanel">
                    <div className="min-h-80 rounded-lg border bg-card p-4">
                      {isGeneratingReport ? (
                        <div className="flex h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Report Agent is calling AMD-hosted Qwen or fallback output.
                        </div>
                      ) : report?.report ? (
                        <MessageResponse>{report.report}</MessageResponse>
                      ) : (
                        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                          The final report appears after all agent stages complete.
                        </div>
                      )}
                    </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="grid content-start gap-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <GitBranch className="size-5 text-zinc-300" />
                  Workload
                </CardTitle>
                <CardDescription>
                  {run?.target.type === "github" ? run.target.note : selectedSample.stack}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="repo-url">Repository URL</Label>
                  <Input id="repo-url" value={activeRepoUrl} readOnly className="font-mono text-xs" />
                </div>
                <Separator />
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Scan mode</p>
                    <p className="font-medium">
                      {run?.target.type === "github" ? "Live public GitHub scan" : "Curated sample fixture"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Target</p>
                    <p className="font-medium">{run?.target.label ?? selectedSample.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Files scanned</p>
                    <p className="font-mono text-lg">{run?.target.scannedFiles ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Risk</p>
                    <p className="leading-6">{run?.target.note ?? selectedSample.risk}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Cpu className="size-5 text-red-200" />
                  GPU model status
                </CardTitle>
                <CardDescription>Qwen endpoint used by the Report Agent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Badge
                  variant="outline"
                  className={
                    modelStatus?.status === "connected"
                      ? "border-red-500/40 bg-red-500/10 text-red-100"
                      : modelStatus?.status === "not-configured"
                        ? "border-red-500/40 bg-red-500/10 text-red-100"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-100"
                  }
                >
                  {modelStatus?.label ?? "AMD GPU Model: Demo fallback"}
                </Badge>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 size-4 text-amber-200" />
                    <span>{modelStatus?.model ?? "Qwen/Qwen3-Coder-Next"}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap className="mt-0.5 size-4 text-red-200" />
                    <span className="break-all text-muted-foreground">
                      {modelStatus?.endpoint ?? "Set AMD_QWEN_BASE_URL"}
                    </span>
                  </div>
                  <p className="leading-6 text-muted-foreground">
                    {modelStatus?.detail ??
                      "The MVP stays demo-safe until an AMD ROCm/vLLM endpoint is available."}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BrainCircuit className="size-5 text-rose-200" />
                  Long-context memory
                </CardTitle>
                <CardDescription>Synap context used by the Report Agent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Badge
                  variant="outline"
                  className={memoryStatusTone[memoryStatus?.status ?? "fallback"]}
                >
                  {memoryStatus?.label ?? "Synap Memory: Local fallback"}
                </Badge>
                <div className="grid gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Provider</p>
                    <p className="font-medium">{memoryStatus?.provider ?? "local"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Conversation</p>
                    <p className="break-all font-mono text-xs">
                      {memoryStatus?.conversationId ?? "created after run starts"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="font-mono text-lg">{memoryStatus?.storedItems ?? 0}</p>
                      <p className="text-xs text-muted-foreground">stored</p>
                    </div>
                    <div>
                      <p className="font-mono text-lg">{memoryStatus?.recalledItems ?? 0}</p>
                      <p className="text-xs text-muted-foreground">recalled</p>
                    </div>
                  </div>
                  <p className="leading-6 text-muted-foreground">
                    {memoryStatus?.detail ??
                      "Set SYNAP_API_KEY to persist agent memory across sessions."}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Gauge className="size-5 text-red-200" />
                  Benchmark profile
                </CardTitle>
                <CardDescription>Demo metrics for the submission walkthrough.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(run?.benchmarks ?? []).map((benchmark) => (
                  <div key={benchmark.label} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{benchmark.label}</p>
                      <Badge variant="outline">{benchmark.backend}</Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="font-mono text-lg">{benchmark.tokensPerSecond}</p>
                        <p className="text-xs text-muted-foreground">tok/s</p>
                      </div>
                      <div>
                        <p className="font-mono text-lg">{benchmark.p95LatencyMs}</p>
                        <p className="text-xs text-muted-foreground">p95 ms</p>
                      </div>
                      <div>
                        <p className="font-mono text-lg">{benchmark.memoryGb}</p>
                        <p className="text-xs text-muted-foreground">GB</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">{benchmark.costNote}</p>
                  </div>
                ))}
                {!run && (
                  <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                    Benchmark cards appear during the run.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Boxes className="size-5 text-amber-200" />
                  Submission proof
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <BadgeCheck className="mt-0.5 size-4 text-emerald-200" />
                  <span>Track 1 agentic workflow with five specialized agents.</span>
                </div>
                <div className="flex items-start gap-2">
                  <BadgeCheck className="mt-0.5 size-4 text-emerald-200" />
                  <span>AMD GPU story through ROCm/vLLM Qwen model serving.</span>
                </div>
                <div className="flex items-start gap-2">
                  <TerminalSquare className="mt-0.5 size-4 text-red-200" />
                  <span>Demo remains reliable without credentials, then upgrades with live endpoint logs.</span>
                </div>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}
