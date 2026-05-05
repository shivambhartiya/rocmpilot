import type {
  AgentMessage,
  AgentMessageKind,
  AgentMemory,
  BenchmarkResult,
  Finding,
  GpuModelStatus,
  LongContextMemoryStatus,
  PatchPreview,
  RocmRun,
  RunMode,
  RunStatus,
  RunStage,
  StageStatus,
  SampleRepo,
  RunTarget,
} from "./types";
import { isRealGitHubRepoUrl, parseGitHubRepoUrl } from "./github-url";
import type { RepoAnalysis } from "./github-scanner";
import {
  buildMemoryConversationId,
  DEFAULT_MEMORY_CUSTOMER_ID,
  DEFAULT_MEMORY_USER_ID,
} from "./memory-ids";

const TOTAL_DURATION_MS = 30_000;

const STAGES: Array<Omit<RunStage, "status" | "progress" | "startedAt" | "completedAt"> & {
  durationMs: number;
}> = [
  {
    id: "repo-doctor",
    agent: "Repo Doctor Agent",
    title: "Repo compatibility scan",
    description: "Dependency graph, Docker image, device paths, and runtime flags",
    durationMs: 5_000,
  },
  {
    id: "migration-planner",
    agent: "Migration Planner Agent",
    title: "ROCm migration plan",
    description: "PyTorch ROCm wheels, vLLM runtime, and device abstraction changes",
    durationMs: 6_000,
  },
  {
    id: "build-runner",
    agent: "Build Runner Agent",
    title: "Build and smoke tests",
    description: "Container validation, import checks, and inference dry run",
    durationMs: 5_500,
  },
  {
    id: "benchmark-agent",
    agent: "Benchmark Agent",
    title: "MI300X readiness benchmark",
    description: "Throughput, latency, memory, and fallback path comparison",
    durationMs: 5_000,
  },
  {
    id: "report-agent",
    agent: "Report Agent",
    title: "Judge-ready report",
    description: "Technical summary, business value, and AMD proof points",
    durationMs: 6_000,
  },
];

export const SAMPLE_REPOS: SampleRepo[] = [
  {
    id: "qwen-vllm-cuda",
    name: "Qwen vLLM CUDA Starter",
    repoUrl: "https://github.com/example/qwen-vllm-cuda-starter",
    stack: "FastAPI, PyTorch, vLLM, Docker",
    model: "Qwen/Qwen2.5-Coder-7B-Instruct",
    description: "A common NVIDIA-first inference service with CUDA-only install steps.",
    risk: "Hardcoded CUDA device checks block AMD Developer Cloud deployment.",
  },
  {
    id: "torch-agent-worker",
    name: "Torch Agent Worker",
    repoUrl: "https://github.com/example/torch-agent-worker",
    stack: "Python workers, PyTorch, Redis queue",
    model: "Qwen/Qwen3-Coder-Next",
    description: "Background coding-agent worker that assumes NVIDIA runtime images.",
    risk: "Docker and benchmark scripts hide GPU vendor assumptions.",
  },
];

export const FINDINGS: Finding[] = [
  {
    id: "cuda-device",
    severity: "critical",
    category: "Runtime device lock",
    file: "src/inference/server.py",
    line: 42,
    explanation:
      "`torch.device('cuda')` is used directly, so the app never checks ROCm-compatible PyTorch device availability or CPU fallback.",
    recommendedFix:
      "Introduce a device resolver that accepts HIP-backed PyTorch as CUDA-compatible and records the detected backend.",
  },
  {
    id: "docker-image",
    severity: "high",
    category: "Container image",
    file: "Dockerfile",
    line: 1,
    explanation:
      "The base image is `nvidia/cuda`, which prevents a clean ROCm/vLLM deployment on AMD Developer Cloud.",
    recommendedFix:
      "Use the ROCm vLLM image for AMD runs and keep CUDA images only as an optional backend.",
  },
  {
    id: "vllm-flags",
    severity: "high",
    category: "Serving configuration",
    file: "scripts/serve.sh",
    line: 9,
    explanation:
      "The vLLM launch script omits ROCm-oriented environment flags and does not expose tensor-parallel settings.",
    recommendedFix:
      "Add backend-aware vLLM launch arguments and document MI300X model-serving defaults.",
  },
  {
    id: "metrics",
    severity: "medium",
    category: "Benchmark visibility",
    file: "benchmarks/run_latency.py",
    line: 18,
    explanation:
      "The benchmark reports request latency only and misses GPU memory, tokens/sec, and backend provenance.",
    recommendedFix:
      "Add AMD SMI/vLLM metrics capture so submission evidence includes GPU model, memory, and throughput.",
  },
];

export const PATCHES: PatchPreview[] = [
  {
    id: "device-resolver",
    file: "src/inference/device.py",
    rationale:
      "Centralizes device selection so ROCm-backed PyTorch can run without scattering vendor checks across the service.",
    diff: `+import torch
+
+def resolve_device() -> tuple[str, str]:
+    if torch.cuda.is_available():
+        backend = "rocm" if getattr(torch.version, "hip", None) else "cuda"
+        return "cuda", backend
+    return "cpu", "cpu"
+
+DEVICE, GPU_BACKEND = resolve_device()
`,
  },
  {
    id: "rocm-docker",
    file: "Dockerfile.rocm",
    rationale:
      "Adds an AMD-specific runtime image while preserving the original CUDA path for teams that need dual-vendor support.",
    diff: `+FROM rocm/vllm:latest
+
+WORKDIR /workspace
+COPY requirements-rocm.txt .
+RUN pip install --no-cache-dir -r requirements-rocm.txt
+COPY . .
+
+ENV HIP_VISIBLE_DEVICES=0
+ENV VLLM_USE_ROCM=1
+CMD ["bash", "scripts/serve-rocm.sh"]
`,
  },
  {
    id: "serve-rocm",
    file: "scripts/serve-rocm.sh",
    rationale:
      "Launches an OpenAI-compatible vLLM endpoint for the migration/report agents on AMD Instinct GPUs.",
    diff: `+#!/usr/bin/env bash
+set -euo pipefail
+
+MODEL="\${MODEL:-Qwen/Qwen3-Coder-Next}"
+PORT="\${PORT:-8000}"
+
+python -m vllm.entrypoints.openai.api_server \\
+  --model "$MODEL" \\
+  --host 0.0.0.0 \\
+  --port "$PORT" \\
+  --tensor-parallel-size "\${TENSOR_PARALLEL_SIZE:-1}" \\
+  --max-model-len "\${MAX_MODEL_LEN:-32768}"
`,
  },
];

export const BENCHMARKS: BenchmarkResult[] = [
  {
    label: "Before migration",
    backend: "CUDA-only config",
    tokensPerSecond: 0,
    p95LatencyMs: 0,
    memoryGb: 0,
    costNote: "Does not boot on AMD ROCm image.",
  },
  {
    label: "ROCm-ready target",
    backend: "ROCm + vLLM on MI300X",
    tokensPerSecond: 182,
    p95LatencyMs: 730,
    memoryGb: 92,
    costNote: "Estimated from demo profile; replace with live AMD run evidence.",
  },
  {
    label: "Agent report model",
    backend: "Qwen3-Coder-Next via OpenAI-compatible endpoint",
    tokensPerSecond: 64,
    p95LatencyMs: 1180,
    memoryGb: 46,
    costNote: "Runs as the Report Agent when AMD_QWEN_BASE_URL is configured.",
  },
];

const LOGS = [
  "queued run qwen-vllm-cuda-starter in mock-safe mode",
  "repo-doctor: scanning pyproject.toml, Dockerfile, scripts, and src/inference",
  "repo-doctor: found nvidia/cuda base image in Dockerfile",
  "repo-doctor: found direct torch.device('cuda') usage in src/inference/server.py:42",
  "migration-planner: generated ROCm runtime image proposal",
  "migration-planner: created backend-aware device resolver",
  "build-runner: docker build -f Dockerfile.rocm .",
  "build-runner: import torch; torch.version.hip detected when ROCm wheel is present",
  "build-runner: vLLM OpenAI endpoint smoke test passed in demo mode",
  "benchmark-agent: captured target profile for MI300X/vLLM serving",
  "report-agent: preparing technical and business summary",
  "completed run with fallback-safe report path",
];

type MessageBlueprint = {
  offsetMs: number;
  agent: string;
  toAgent: string;
  role: string;
  task: string;
  leadAgent: string;
  kind: AgentMessageKind;
  replyToOffsetMs?: number;
  memoryRefs?: string[];
  message: (context: {
    target: RunTarget;
    sample: SampleRepo;
    findings: Finding[];
    patches: PatchPreview[];
  }) => string;
};

const WAR_ROOM_MESSAGES: MessageBlueprint[] = [
  {
    offsetMs: 1_200,
    agent: "Orchestrator",
    toAgent: "Repo Doctor",
    role: "Run coordinator",
    task: "Repo compatibility scan",
    leadAgent: "Repo Doctor",
    kind: "question",
    message: ({ target }) =>
      `You are lead for the first task on ${target.label}. Ask the other agents what evidence they need before you mark any blocker as real.`,
  },
  {
    offsetMs: 2_600,
    agent: "Repo Doctor",
    toAgent: "Build Runner",
    role: "Compatibility scout",
    task: "Repo compatibility scan",
    leadAgent: "Repo Doctor",
    kind: "question",
    replyToOffsetMs: 1_200,
    message: ({ target }) =>
      target.type === "github"
        ? `I am scanning ${target.scannedFiles || "the selected"} files. Which findings should I flag as build-breaking instead of just advisory?`
        : "I am scanning Docker, vLLM scripts, PyTorch device paths, and benchmarks. Which findings should I flag as build-breaking instead of advisory?",
  },
  {
    offsetMs: 3_700,
    agent: "Build Runner",
    toAgent: "Repo Doctor",
    role: "Skeptical validator",
    task: "Repo compatibility scan",
    leadAgent: "Repo Doctor",
    kind: "answer",
    replyToOffsetMs: 2_600,
    message:
      () =>
        "Treat container base images, hardcoded device selection, and missing smoke commands as build-breaking. Those decide whether the workload even starts on ROCm.",
  },
  {
    offsetMs: 5_200,
    agent: "Repo Doctor",
    toAgent: "Migration Planner",
    role: "Compatibility scout",
    task: "Repo compatibility scan",
    leadAgent: "Repo Doctor",
    kind: "question",
    replyToOffsetMs: 3_700,
    message: ({ findings }) =>
      findings[0]
        ? `I found ${findings[0].category} in ${findings[0].file}:${findings[0].line}. Can you design the safest migration step for this first?`
        : "I have no hard blocker yet. Can you prepare a safe migration pattern for hidden GPU vendor assumptions?",
  },
  {
    offsetMs: 6_700,
    agent: "Migration Planner",
    toAgent: "Repo Doctor",
    role: "Patch strategist",
    task: "Repo compatibility scan",
    leadAgent: "Repo Doctor",
    kind: "proposal",
    replyToOffsetMs: 5_200,
    message: ({ findings }) =>
      findings[0]
        ? `Yes. First migration step: ${findings[0].recommendedFix} I will store that as the device-resolution pattern for later stages.`
        : "Yes. I will store a pattern that keeps CUDA and ROCm paths explicit instead of hidden in environment assumptions.",
  },
  {
    offsetMs: 8_200,
    agent: "Repo Doctor",
    toAgent: "Shared Memory",
    role: "Compatibility scout",
    task: "Repo compatibility scan",
    leadAgent: "Repo Doctor",
    kind: "memory",
    replyToOffsetMs: 6_700,
    memoryRefs: ["mem-device-resolution"],
    message:
      () =>
        "Memory write: hardcoded device selection must be solved with one backend resolver, not scattered if/else checks.",
  },
  {
    offsetMs: 9_600,
    agent: "Orchestrator",
    toAgent: "Migration Planner",
    role: "Run coordinator",
    task: "ROCm migration plan",
    leadAgent: "Migration Planner",
    kind: "question",
    memoryRefs: ["mem-device-resolution"],
    message:
      () =>
        "You are lead now. Use the device-resolution memory and ask Build Runner what would make the patch testable.",
  },
  {
    offsetMs: 10_800,
    agent: "Migration Planner",
    toAgent: "Build Runner",
    role: "Patch strategist",
    task: "ROCm migration plan",
    leadAgent: "Migration Planner",
    kind: "question",
    replyToOffsetMs: 9_600,
    memoryRefs: ["mem-device-resolution"],
    message:
      () =>
        "I can patch the resolver, but what acceptance check should prove this is ROCm-ready and not just cleaner code?",
  },
  {
    offsetMs: 12_100,
    agent: "Build Runner",
    toAgent: "Migration Planner",
    role: "Skeptical validator",
    task: "ROCm migration plan",
    leadAgent: "Migration Planner",
    kind: "answer",
    replyToOffsetMs: 10_800,
    memoryRefs: ["mem-device-resolution"],
    message:
      () =>
        "Acceptance check: import torch, report torch.version.hip when present, start vLLM with an OpenAI-compatible health request, then log backend provenance.",
  },
  {
    offsetMs: 13_500,
    agent: "Migration Planner",
    toAgent: "Shared Memory",
    role: "Patch strategist",
    task: "ROCm migration plan",
    leadAgent: "Migration Planner",
    kind: "proposal",
    replyToOffsetMs: 12_100,
    memoryRefs: ["mem-device-resolution", "mem-rocm-acceptance"],
    message: ({ patches }) =>
      patches[0]
        ? `Patch candidate for ${patches[0].file} is ready, and I am storing Build Runner's acceptance check with it.`
        : "Patch candidate is ready, and I am storing Build Runner's acceptance check with it.",
  },
  {
    offsetMs: 15_200,
    agent: "Orchestrator",
    toAgent: "Build Runner",
    role: "Run coordinator",
    task: "Build and smoke tests",
    leadAgent: "Build Runner",
    kind: "question",
    memoryRefs: ["mem-device-resolution", "mem-rocm-acceptance"],
    message:
      () =>
        "You are lead for validation. Look back at memory before challenging the plan: what can still fail later?",
  },
  {
    offsetMs: 16_500,
    agent: "Build Runner",
    toAgent: "Migration Planner",
    role: "Skeptical validator",
    task: "Build and smoke tests",
    leadAgent: "Build Runner",
    kind: "challenge",
    replyToOffsetMs: 15_200,
    memoryRefs: ["mem-rocm-acceptance"],
    message:
      () =>
        "I checked the memory. Device resolution is covered, but the Docker path can still fail. A CUDA image with ROCm notes is still a deployment trap.",
  },
  {
    offsetMs: 17_800,
    agent: "Migration Planner",
    toAgent: "Build Runner",
    role: "Patch strategist",
    task: "Build and smoke tests",
    leadAgent: "Build Runner",
    kind: "answer",
    replyToOffsetMs: 16_500,
    message:
      () =>
        "Agreed. I will keep Dockerfile.rocm separate and avoid pretending the existing CUDA container is portable.",
  },
  {
    offsetMs: 19_000,
    agent: "Build Runner",
    toAgent: "Shared Memory",
    role: "Skeptical validator",
    task: "Build and smoke tests",
    leadAgent: "Build Runner",
    kind: "memory",
    replyToOffsetMs: 17_800,
    memoryRefs: ["mem-container-split"],
    message:
      () =>
        "Memory write: ROCm validation needs a separate container path plus a smoke command, not just migration notes in README.",
  },
  {
    offsetMs: 20_300,
    agent: "Orchestrator",
    toAgent: "Benchmark Agent",
    role: "Run coordinator",
    task: "MI300X readiness benchmark",
    leadAgent: "Benchmark Agent",
    kind: "question",
    memoryRefs: ["mem-rocm-acceptance", "mem-container-split"],
    message:
      () =>
        "You are lead for measurement. Use the earlier memories and ask what numbers are safe to show before AMD access is connected.",
  },
  {
    offsetMs: 21_500,
    agent: "Benchmark Agent",
    toAgent: "Report Agent",
    role: "Evidence analyst",
    task: "MI300X readiness benchmark",
    leadAgent: "Benchmark Agent",
    kind: "question",
    replyToOffsetMs: 20_300,
    memoryRefs: ["mem-rocm-acceptance", "mem-container-split"],
    message:
      () =>
        "I can show estimated tokens/sec, p95 latency, memory, and bootability. How should I label estimates so the story stays credible?",
  },
  {
    offsetMs: 22_700,
    agent: "Report Agent",
    toAgent: "Benchmark Agent",
    role: "Submission narrator",
    task: "MI300X readiness benchmark",
    leadAgent: "Benchmark Agent",
    kind: "answer",
    replyToOffsetMs: 21_500,
    message:
      () =>
        "Label estimates as a static ROCmPilot profile and reserve final proof for AMD Developer Cloud logs. Judges trust explicit provenance.",
  },
  {
    offsetMs: 24_000,
    agent: "Benchmark Agent",
    toAgent: "Shared Memory",
    role: "Evidence analyst",
    task: "MI300X readiness benchmark",
    leadAgent: "Benchmark Agent",
    kind: "memory",
    replyToOffsetMs: 22_700,
    memoryRefs: ["mem-metric-provenance"],
    message:
      () =>
        "Memory write: estimated metrics are acceptable only when labeled with provenance and paired with the exact AMD proof still needed.",
  },
  {
    offsetMs: 25_200,
    agent: "Orchestrator",
    toAgent: "Report Agent",
    role: "Run coordinator",
    task: "Judge-ready report",
    leadAgent: "Report Agent",
    kind: "question",
    memoryRefs: ["mem-device-resolution", "mem-container-split", "mem-metric-provenance"],
    message:
      () =>
        "You are lead for the final report. Read the shared memory first, then ask if anyone disagrees with the submission story.",
  },
  {
    offsetMs: 26_000,
    agent: "Report Agent",
    toAgent: "All agents",
    role: "Submission narrator",
    task: "Judge-ready report",
    leadAgent: "Report Agent",
    kind: "question",
    replyToOffsetMs: 25_200,
    memoryRefs: ["mem-device-resolution", "mem-container-split", "mem-metric-provenance"],
    message:
      () =>
        "I read the memories. Final story: find CUDA locks, create ROCm patch path, validate container/smoke tests, show metric provenance. Any objections?",
  },
  {
    offsetMs: 26_800,
    agent: "Build Runner",
    toAgent: "Report Agent",
    role: "Skeptical validator",
    task: "Judge-ready report",
    leadAgent: "Report Agent",
    kind: "answer",
    replyToOffsetMs: 26_000,
    memoryRefs: ["mem-container-split"],
    message:
      () =>
        "No objection if the report says validation is complete for the demo path and pending for live MI300X logs.",
  },
  {
    offsetMs: 27_400,
    agent: "Benchmark Agent",
    toAgent: "Report Agent",
    role: "Evidence analyst",
    task: "Judge-ready report",
    leadAgent: "Report Agent",
    kind: "answer",
    replyToOffsetMs: 26_000,
    memoryRefs: ["mem-metric-provenance"],
    message:
      () =>
        "No objection if every metric names its source. I want the next live run to overwrite estimates with AMD SMI and vLLM logs.",
  },
  {
    offsetMs: 28_200,
    agent: "Orchestrator",
    toAgent: "All agents",
    role: "Run coordinator",
    task: "Judge-ready report",
    leadAgent: "Report Agent",
    kind: "consensus",
    replyToOffsetMs: 27_400,
    memoryRefs: ["mem-device-resolution", "mem-container-split", "mem-metric-provenance"],
    message:
      () =>
        "Consensus stored: ship a ROCm readiness report, patch previews, shared discussion memory, and an AMD/vLLM validation checklist. Next run should replace estimates with MI300X logs.",
  },
];

type MemoryBlueprint = {
  offsetMs: number;
  id: string;
  title: string;
  scope: string;
  learnedFromAgent: string;
  summary: (context: { findings: Finding[]; patches: PatchPreview[] }) => string;
  solution: string;
};

const WAR_ROOM_MEMORY: MemoryBlueprint[] = [
  {
    offsetMs: 8_200,
    id: "mem-device-resolution",
    title: "Device resolution pattern",
    scope: "Runtime compatibility",
    learnedFromAgent: "Repo Doctor",
    summary: ({ findings }) =>
      findings[0]
        ? `${findings[0].category} should be handled once in a resolver instead of repeated across inference code.`
        : "GPU backend detection should be handled once in a resolver instead of repeated across inference code.",
    solution: "Create a backend-aware resolver that accepts HIP-backed PyTorch as CUDA-compatible and records backend provenance.",
  },
  {
    offsetMs: 13_500,
    id: "mem-rocm-acceptance",
    title: "ROCm acceptance checks",
    scope: "Build validation",
    learnedFromAgent: "Build Runner",
    summary: () =>
      "A patch is not enough unless the run proves import, backend detection, vLLM health, and provenance logging.",
    solution: "Use a smoke command that imports torch, reports torch.version.hip, starts vLLM, and hits the OpenAI-compatible health path.",
  },
  {
    offsetMs: 19_000,
    id: "mem-container-split",
    title: "Separate ROCm container path",
    scope: "Deployment safety",
    learnedFromAgent: "Build Runner",
    summary: () =>
      "A CUDA image with ROCm comments still leaves teams with a deployment trap.",
    solution: "Keep Dockerfile.rocm and ROCm launch scripts separate, with CUDA preserved only as an optional backend.",
  },
  {
    offsetMs: 24_000,
    id: "mem-metric-provenance",
    title: "Metric provenance rule",
    scope: "Benchmark evidence",
    learnedFromAgent: "Benchmark Agent",
    summary: () =>
      "Estimated benchmark cards are useful for the MVP only when their source is explicit.",
    solution: "Label estimates as static ROCmPilot profiles and replace them with AMD SMI plus vLLM logs when MI300X access is available.",
  },
];

export type RunRecord = {
  id: string;
  sampleId: string;
  mode: RunMode;
  startedAt: number;
  targetType: "sample" | "github";
  repoUrl?: string;
};

export function getSample(sampleId: string | undefined) {
  return SAMPLE_REPOS.find((sample) => sample.id === sampleId) ?? SAMPLE_REPOS[0];
}

function toBase64Url(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function buildGitHubSample(repoUrl: string): SampleRepo {
  const parsed = parseGitHubRepoUrl(repoUrl);

  return {
    id: "github-repo",
    name: parsed?.label ?? "Public GitHub Repository",
    repoUrl,
    stack: "Detected from public GitHub files",
    model: "Detected workload",
    description: "A public repository scanned live by ROCmPilot.",
    risk: "ROCm compatibility depends on detected CUDA/NVIDIA assumptions and live AMD validation.",
  };
}

export function createRunRecord(sampleId: string, mode: RunMode, repoUrl?: string): RunRecord {
  const startedAt = Date.now();
  const safeSampleId = getSample(sampleId).id;
  const nonce = Math.random().toString(36).slice(2, 8);
  const parsedRepo = isRealGitHubRepoUrl(repoUrl) ? parseGitHubRepoUrl(repoUrl) : null;
  const targetType = parsedRepo ? "github" : "sample";
  const payload = parsedRepo ? toBase64Url(parsedRepo.repoUrl) : safeSampleId;

  return {
    id: `run.${startedAt.toString(36)}.${mode}.${targetType}.${payload}.${nonce}`,
    sampleId: safeSampleId,
    mode,
    startedAt,
    targetType,
    repoUrl: parsedRepo?.repoUrl,
  };
}

export function parseRunRecord(runId: string): RunRecord | null {
  const parts = runId.split(".");

  if (parts.length !== 6 || parts[0] !== "run") {
    return null;
  }

  const [, startedAtBase36, mode, targetType, payload] = parts;
  const startedAt = Number.parseInt(startedAtBase36, 36);

  if (
    !Number.isFinite(startedAt) ||
    (mode !== "mock" && mode !== "amd") ||
    (targetType !== "sample" && targetType !== "github")
  ) {
    return null;
  }

  if (targetType === "github") {
    const repoUrl = fromBase64Url(payload);

    if (!isRealGitHubRepoUrl(repoUrl)) {
      return null;
    }

    return {
      id: runId,
      sampleId: "qwen-vllm-cuda",
      mode,
      startedAt,
      targetType,
      repoUrl,
    };
  }

  const sample = SAMPLE_REPOS.find((candidate) => candidate.id === payload);

  if (!sample) {
    return null;
  }

  return {
    id: runId,
    sampleId: sample.id,
    mode,
    startedAt,
    targetType,
  };
}

export function getModelStatus(source: GpuModelStatus["source"] = "fallback"): GpuModelStatus {
  const endpoint = process.env.AMD_QWEN_BASE_URL?.replace(/\/$/, "");
  const model = process.env.AMD_QWEN_MODEL ?? "Qwen/Qwen3-Coder-Next";
  const hfModel = process.env.HF_REPORT_MODEL ?? "Qwen/Qwen2.5-Coder-7B-Instruct";

  if (endpoint && source === "amd-vllm") {
    return {
      status: "connected",
      label: "AMD GPU Model: Connected",
      model,
      endpoint,
      detail: "Report generation used the configured ROCm/vLLM OpenAI-compatible endpoint.",
      source,
    };
  }

  if (source === "hf-router") {
    return {
      status: "connected",
      label: "HF Router: Connected",
      model: hfModel,
      endpoint: "https://router.huggingface.co/v1",
      detail: "Report generation used Hugging Face Inference Providers as the temporary model backend.",
      source,
    };
  }

  if (endpoint) {
    return {
      status: "not-configured",
      label: "AMD GPU Model: Endpoint configured",
      model,
      endpoint,
      detail: "Endpoint is configured; report generation will attempt AMD-hosted Qwen first.",
      source,
    };
  }

  if (process.env.HF_TOKEN) {
    return {
      status: "not-configured",
      label: "HF Router: Available",
      model: hfModel,
      endpoint: "https://router.huggingface.co/v1",
      detail: "Hugging Face token is configured; final report generation will use HF unless AMD is configured.",
      source: "hf-router",
    };
  }

  return {
    status: "fallback",
    label: "AMD GPU Model: Demo fallback",
    model,
    endpoint: "Set AMD_QWEN_BASE_URL to enable live ROCm/vLLM inference",
    detail: "The dashboard is using deterministic fallback output so the MVP demo remains reliable.",
    source: "fallback",
  };
}

export function getLongContextMemoryStatus(
  runId: string,
  storedItems = 0,
  recalledItems = 0,
  source: LongContextMemoryStatus["status"] = process.env.SYNAP_API_KEY ? "configured" : "fallback"
): LongContextMemoryStatus {
  const conversationId = buildMemoryConversationId(runId);
  const customerId = process.env.SYNAP_CUSTOMER_ID ?? DEFAULT_MEMORY_CUSTOMER_ID;
  const userId = process.env.SYNAP_USER_ID ?? DEFAULT_MEMORY_USER_ID;

  if (source === "connected") {
    return {
      status: "connected",
      label: "Synap Memory: Connected",
      provider: "synap",
      conversationId,
      scope: `${customerId}/${userId}`,
      detail: "Report Agent stored this run and retrieved scoped long-context memory from Synap.",
      storedItems,
      recalledItems,
    };
  }

  if (source === "configured") {
    return {
      status: "configured",
      label: "Synap Memory: Ready",
      provider: "synap",
      conversationId,
      scope: `${customerId}/${userId}`,
      detail: "Synap is configured; the Report Agent will ingest the war-room transcript during report generation.",
      storedItems,
      recalledItems,
    };
  }

  if (source === "not-configured") {
    return {
      status: "not-configured",
      label: "Synap Memory: Setup needed",
      provider: "synap",
      conversationId,
      scope: `${customerId}/${userId}`,
      detail: "Set SYNAP_API_KEY and run the Synap JS runtime setup to enable persistent memory.",
      storedItems,
      recalledItems,
    };
  }

  return {
    status: "fallback",
    label: "Synap Memory: Local fallback",
    provider: "local",
    conversationId,
    scope: "current stateless run",
    detail: "Using reconstructed run memory now; Synap can persist it across sessions once credentials are configured.",
    storedItems,
    recalledItems,
  };
}

function buildTarget(record: RunRecord, analysis?: RepoAnalysis): RunTarget {
  if (record.targetType === "github" && record.repoUrl) {
    const parsed = parseGitHubRepoUrl(record.repoUrl);

    return {
      type: "github",
      repoUrl: record.repoUrl,
      label: analysis?.label ?? parsed?.label ?? "GitHub repository",
      branch: analysis?.branch ?? parsed?.branch,
      scanStatus: analysis?.status ?? "pending",
      scannedFiles: analysis?.scannedFiles ?? 0,
      note:
        analysis?.note ??
        "ROCmPilot will fetch public GitHub files during the Repo Doctor stage.",
    };
  }

  const sample = getSample(record.sampleId);

  return {
    type: "sample",
    repoUrl: sample.repoUrl,
    label: sample.name,
    scanStatus: "fixture",
    scannedFiles: 4,
    note: "Using curated sample fixtures for a reliable demo run.",
  };
}

function buildMessageId(record: RunRecord, offsetMs: number, agent: string) {
  return `${record.id}.${offsetMs}.${agent.toLowerCase().replace(/\W+/g, "-")}`;
}

function buildAgentMessages(
  elapsed: number,
  record: RunRecord,
  target: RunTarget,
  sample: SampleRepo,
  findings: Finding[],
  patches: PatchPreview[]
): AgentMessage[] {
  return WAR_ROOM_MESSAGES.filter((blueprint) => elapsed >= blueprint.offsetMs).map((blueprint) => ({
    id: buildMessageId(record, blueprint.offsetMs, blueprint.agent),
    agent: blueprint.agent,
    toAgent: blueprint.toAgent,
    role: blueprint.role,
    task: blueprint.task,
    leadAgent: blueprint.leadAgent,
    kind: blueprint.kind,
    message: blueprint.message({ target, sample, findings, patches }),
    replyToId:
      blueprint.replyToOffsetMs === undefined
        ? undefined
        : WAR_ROOM_MESSAGES.find((message) => message.offsetMs === blueprint.replyToOffsetMs)
          ? buildMessageId(
              record,
              blueprint.replyToOffsetMs,
              WAR_ROOM_MESSAGES.find((message) => message.offsetMs === blueprint.replyToOffsetMs)?.agent ?? "unknown"
            )
          : undefined,
    memoryRefs: blueprint.memoryRefs ?? [],
    createdAt: new Date(record.startedAt + blueprint.offsetMs).toISOString(),
  }));
}

function buildAgentMemory(
  elapsed: number,
  record: RunRecord,
  messages: AgentMessage[],
  findings: Finding[],
  patches: PatchPreview[]
): AgentMemory[] {
  return WAR_ROOM_MEMORY.filter((memory) => elapsed >= memory.offsetMs).map((memory) => ({
    id: memory.id,
    title: memory.title,
    scope: memory.scope,
    learnedFromAgent: memory.learnedFromAgent,
    summary: memory.summary({ findings, patches }),
    solution: memory.solution,
    createdAt: new Date(record.startedAt + memory.offsetMs).toISOString(),
    usedBy: messages
      .filter((message) => message.memoryRefs.includes(memory.id) && new Date(message.createdAt).getTime() > record.startedAt + memory.offsetMs)
      .map((message) => message.agent),
  }));
}

export function snapshotRun(record: RunRecord, analysis?: RepoAnalysis): RocmRun {
  const elapsed = Math.max(0, Date.now() - record.startedAt);
  const sample =
    record.targetType === "github" && record.repoUrl
      ? buildGitHubSample(record.repoUrl)
      : getSample(record.sampleId);
  const status: RunStatus = elapsed >= TOTAL_DURATION_MS ? "completed" : "running";
  const target = buildTarget(record, analysis);
  let cursor = 0;

  const stages = STAGES.map((stage) => {
    const stageStart = cursor;
    const stageEnd = cursor + stage.durationMs;
    cursor = stageEnd;

    const stageElapsed = elapsed - stageStart;
    const progress = Math.max(0, Math.min(100, Math.round((stageElapsed / stage.durationMs) * 100)));
    const stageStatus: StageStatus =
      progress >= 100 ? "completed" : progress > 0 ? "running" : "pending";

    return {
      id: stage.id,
      agent: stage.agent,
      title: stage.title,
      description: stage.description,
      status: stageStatus,
      progress,
      startedAt: stageElapsed > 0 ? new Date(record.startedAt + stageStart).toISOString() : undefined,
      completedAt: stageStatus === "completed" ? new Date(record.startedAt + stageEnd).toISOString() : undefined,
    };
  });

  const allFindings = analysis?.findings.length ? analysis.findings : FINDINGS;
  const allPatches = analysis?.patches.length ? analysis.patches : PATCHES;
  const allBenchmarks = record.targetType === "github"
    ? BENCHMARKS.map((benchmark) => ({
        ...benchmark,
        costNote: benchmark.costNote.replace("demo profile", "static ROCmPilot profile until live AMD validation"),
      }))
    : BENCHMARKS;
  const allLogs =
    record.targetType === "github"
      ? [
          `queued public GitHub scan for ${target.label}`,
          ...(analysis?.logs ?? ["repo-doctor: waiting for GitHub scan results"]),
          "build-runner: generated ROCm validation plan without mutating repository files",
          "benchmark-agent: prepared estimated MI300X profile pending live AMD run",
          "report-agent: preparing technical and business summary",
        ]
      : LOGS;

  const visibleFindings =
    elapsed > 4_000
      ? allFindings.slice(0, Math.min(allFindings.length, Math.ceil((elapsed - 4_000) / 3_000)))
      : [];
  const visiblePatches =
    elapsed > 10_000
      ? allPatches.slice(0, Math.min(allPatches.length, Math.ceil((elapsed - 10_000) / 4_000)))
      : [];
  const visibleBenchmarks = elapsed > 18_000 ? allBenchmarks : allBenchmarks.slice(0, 1);
  const visibleLogs = allLogs.slice(0, Math.min(allLogs.length, Math.max(1, Math.ceil(elapsed / 2_300))));
  const agentMessages = buildAgentMessages(
    elapsed,
    record,
    target,
    sample,
    visibleFindings.length ? visibleFindings : allFindings,
    visiblePatches.length ? visiblePatches : allPatches
  );
  const agentMemory = buildAgentMemory(
    elapsed,
    record,
    agentMessages,
    visibleFindings.length ? visibleFindings : allFindings,
    visiblePatches.length ? visiblePatches : allPatches
  );

  return {
    id: record.id,
    sample,
    target,
    mode: record.mode,
    status,
    progress: Math.min(100, Math.round((elapsed / TOTAL_DURATION_MS) * 100)),
    startedAt: new Date(record.startedAt).toISOString(),
    completedAt: status === "completed" ? new Date(record.startedAt + TOTAL_DURATION_MS).toISOString() : undefined,
    stages,
    findings: visibleFindings,
    patches: visiblePatches,
    logs: visibleLogs,
    agentMessages,
    agentMemory,
    longContextMemory: getLongContextMemoryStatus(
      record.id,
      agentMemory.length,
      agentMessages.filter((message) => message.memoryRefs.length > 0).length
    ),
    benchmarks: visibleBenchmarks,
    modelStatus: getModelStatus(),
  };
}

export function buildFallbackReport(run: RocmRun, longContext?: string) {
  const findingList = run.findings
    .map((finding) => `- **${finding.category}** in \`${finding.file}:${finding.line}\`: ${finding.recommendedFix}`)
    .join("\n");
  const memoryList = run.agentMemory
    .map((memory) => `- **${memory.title}**: ${memory.solution}`)
    .join("\n");

  return `# ROCmPilot Migration Report

## Executive Summary

ROCmPilot completed a multi-agent audit for **${run.sample.name}** and produced an AMD ROCm migration path for a PyTorch/vLLM workload. The system found CUDA-only assumptions, generated ROCm patch previews, and prepared the project for validation on AMD Developer Cloud.

## Agent Findings

${findingList || "- Findings are still being prepared."}

## Shared Agent Memory

${memoryList || "- Shared memory is still being written by the agents."}

## Long-Context Memory

${longContext || "- Synap memory was not available for this report, so ROCmPilot used the current run's reconstructed local memory."}

## AMD GPU Usage

- Primary model target: **Qwen/Qwen3-Coder-Next**
- Serving path: **ROCm + vLLM OpenAI-compatible endpoint**
- GPU goal: run the Migration Planner or Report Agent on AMD Instinct MI300X
- MVP fallback: deterministic report generation when the endpoint is unavailable

## Business Value

ROCmPilot reduces the time needed to move inference services away from NVIDIA-only assumptions. Teams get a migration checklist, patch previews, benchmark evidence, and a report they can hand to infra leads before spending engineering time on a full port.

## Next Step

Connect \`AMD_QWEN_BASE_URL\` to a live ROCm/vLLM endpoint and rerun the report stage to replace demo metrics with captured MI300X evidence.`;
}

export function buildReportPrompt(run: RocmRun, longContext?: string) {
  return `Create a concise hackathon submission report for ROCmPilot.

Product: multi-agent ROCm migration dashboard.
Track: AI Agents & Agentic Workflows.
Sample repo: ${run.sample.name} (${run.sample.stack}).
Target: ${run.target.label} (${run.target.repoUrl}).
Scan status: ${run.target.scanStatus}, scanned files: ${run.target.scannedFiles}.
GPU story: Qwen3-Coder-Next served on AMD Instinct MI300X with ROCm/vLLM powers the report or migration agent when configured.

Findings:
${run.findings.map((finding) => `- ${finding.severity}: ${finding.category} in ${finding.file}:${finding.line}. Fix: ${finding.recommendedFix}`).join("\n")}

Patches:
${run.patches.map((patch) => `- ${patch.file}: ${patch.rationale}`).join("\n")}

Shared memory:
${run.agentMemory.map((memory) => `- ${memory.title}: ${memory.solution}`).join("\n")}

Long-context memory from Synap or fallback memory:
${longContext || "- No long-context memory was available beyond the current run."}

Benchmarks:
${run.benchmarks.map((benchmark) => `- ${benchmark.label}: ${benchmark.backend}, ${benchmark.tokensPerSecond} tok/s, p95 ${benchmark.p95LatencyMs}ms, ${benchmark.memoryGb}GB.`).join("\n")}

Write markdown with these sections only: Executive Summary, Agent Workflow, AMD GPU Proof, Business Value, Next 48 Hours.`;
}
