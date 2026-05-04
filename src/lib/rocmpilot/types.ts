export type RunMode = "mock" | "amd";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export type StageStatus = "pending" | "running" | "completed";

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type ModelSource = "amd-vllm" | "hf-router" | "fallback";

export type RunTargetType = "sample" | "github";

export type GpuModelStatus = {
  status: "connected" | "fallback" | "not-configured";
  label: string;
  model: string;
  endpoint: string;
  detail: string;
  source: ModelSource;
};

export type SampleRepo = {
  id: string;
  name: string;
  repoUrl: string;
  stack: string;
  model: string;
  description: string;
  risk: string;
};

export type RunStage = {
  id: string;
  agent: string;
  title: string;
  description: string;
  status: StageStatus;
  progress: number;
  startedAt?: string;
  completedAt?: string;
};

export type Finding = {
  id: string;
  severity: FindingSeverity;
  category: string;
  file: string;
  line: number;
  explanation: string;
  recommendedFix: string;
};

export type PatchPreview = {
  id: string;
  file: string;
  rationale: string;
  diff: string;
};

export type BenchmarkResult = {
  label: string;
  backend: string;
  tokensPerSecond: number;
  p95LatencyMs: number;
  memoryGb: number;
  costNote: string;
};

export type RunTarget = {
  type: RunTargetType;
  repoUrl: string;
  label: string;
  branch?: string;
  scanStatus: "fixture" | "scanned" | "failed" | "pending";
  scannedFiles: number;
  note: string;
};

export type RocmRun = {
  id: string;
  sample: SampleRepo;
  target: RunTarget;
  mode: RunMode;
  status: RunStatus;
  progress: number;
  startedAt: string;
  completedAt?: string;
  stages: RunStage[];
  findings: Finding[];
  patches: PatchPreview[];
  logs: string[];
  benchmarks: BenchmarkResult[];
  modelStatus: GpuModelStatus;
};

export type ReportResponse = {
  report: string;
  source: ModelSource;
  modelStatus: GpuModelStatus;
};
