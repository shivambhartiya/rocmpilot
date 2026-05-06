import type { Finding, PatchPreview } from "./types";
import { parseGitHubRepoUrl } from "./github-url";

type GitHubTreeItem = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
};

type GitHubTreeResponse = {
  tree?: GitHubTreeItem[];
  truncated?: boolean;
};

type GitHubRepoResponse = {
  default_branch?: string;
};

type GitHubBlobResponse = {
  content?: string;
  encoding?: string;
};

type ScannedFile = {
  path: string;
  content: string;
};

export type RepoAnalysis = {
  status: "scanned" | "failed";
  label: string;
  repoUrl: string;
  branch?: string;
  scannedFiles: number;
  findings: Finding[];
  patches: PatchPreview[];
  logs: string[];
  stack: string;
  note: string;
};

const globalForGitHubScan = globalThis as unknown as {
  rocmPilotScanCache?: Map<string, { expiresAt: number; analysis: RepoAnalysis }>;
};

const scanCache = globalForGitHubScan.rocmPilotScanCache ?? new Map();
globalForGitHubScan.rocmPilotScanCache = scanCache;

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ROCmPilot",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: githubHeaders(),
    next: { revalidate: 180 },
  });

  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${url}`);
  }

  return response.json() as Promise<T>;
}

export async function checkGitHubRepositoryAccess(repoUrl: string) {
  const parsed = parseGitHubRepoUrl(repoUrl);

  if (!parsed || parsed.owner === "example") {
    return {
      ok: false as const,
      message: "Enter a valid public GitHub repository URL, for example https://github.com/owner/repo.",
    };
  }

  const response = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
    headers: githubHeaders(),
    cache: "no-store",
  });

  if (response.ok) {
    return {
      ok: true as const,
      repoUrl: parsed.repoUrl,
    };
  }

  if (response.status === 404) {
    return {
      ok: false as const,
      message: `Repository not found: ${parsed.label}. Check that the repo exists and is public.`,
    };
  }

  if (response.status === 403 || response.status === 429) {
    return {
      ok: false as const,
      message:
        "GitHub rate-limited this scan. Add GITHUB_TOKEN in Vercel or try again in a few minutes.",
    };
  }

  return {
    ok: false as const,
    message: `GitHub could not validate this repository right now (HTTP ${response.status}).`,
  };
}

function isRelevantPath(path: string) {
  const lower = path.toLowerCase();

  if (
    lower.includes("node_modules/") ||
    lower.includes(".git/") ||
    lower.includes("dist/") ||
    lower.includes("build/") ||
    lower.includes(".next/")
  ) {
    return false;
  }

  return (
    /^dockerfile/i.test(path) ||
    lower.endsWith("docker-compose.yml") ||
    lower.endsWith("docker-compose.yaml") ||
    lower.endsWith("requirements.txt") ||
    lower.endsWith("requirements-rocm.txt") ||
    lower.endsWith("pyproject.toml") ||
    lower.endsWith("environment.yml") ||
    lower.endsWith("environment.yaml") ||
    lower.endsWith(".py") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.includes("vllm") ||
    lower.includes("inference") ||
    lower.includes("serve") ||
    lower.includes("benchmark")
  );
}

function firstLineOf(content: string, pattern: RegExp) {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : 1;
}

function addFinding(
  findings: Finding[],
  finding: Omit<Finding, "id">,
  idSeed: string
) {
  if (findings.length >= 10) {
    return;
  }

  const id = `${idSeed}-${findings.length + 1}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

  if (!findings.some((existing) => existing.file === finding.file && existing.category === finding.category)) {
    findings.push({ id, ...finding });
  }
}

function detectFindings(files: ScannedFile[]) {
  const findings: Finding[] = [];

  for (const file of files) {
    const lowerPath = file.path.toLowerCase();
    const content = file.content;

    if (/nvidia\/cuda|nvidia-container|--gpus\s+all|nvidia-smi/i.test(content)) {
      addFinding(
        findings,
        {
          severity: "high",
          category: "NVIDIA container/runtime assumption",
          file: file.path,
          line: firstLineOf(content, /nvidia\/cuda|nvidia-container|--gpus\s+all|nvidia-smi/i),
          explanation:
            "The repository includes NVIDIA-specific container/runtime configuration, which will not run cleanly on AMD ROCm infrastructure.",
          recommendedFix:
            "Add an AMD ROCm runtime path using a ROCm/vLLM image and keep NVIDIA launch flags behind a backend-specific profile.",
        },
        file.path
      );
    }

    if (/torch\.device\(\s*["']cuda["']\s*\)|\.cuda\(|\.cuda\(\)|device_map\s*=\s*["']cuda["']/i.test(content)) {
      addFinding(
        findings,
        {
          severity: "critical",
          category: "Hardcoded CUDA device path",
          file: file.path,
          line: firstLineOf(content, /torch\.device\(\s*["']cuda["']\s*\)|\.cuda\(|\.cuda\(\)|device_map\s*=\s*["']cuda["']/i),
          explanation:
            "The code moves models/tensors directly to CUDA, so the workload needs a backend-aware device resolver before AMD validation.",
          recommendedFix:
            "Introduce a resolver that treats HIP-backed torch.cuda availability as ROCm and records backend provenance in logs/metrics.",
        },
        file.path
      );
    }

    if (/torch\.cuda|cuda_visible_devices|hip_visible_devices/i.test(content)) {
      addFinding(
        findings,
        {
          severity: "medium",
          category: "GPU backend detection needs abstraction",
          file: file.path,
          line: firstLineOf(content, /torch\.cuda|cuda_visible_devices|hip_visible_devices/i),
          explanation:
            "The repo checks GPU availability through vendor-specific environment or PyTorch CUDA APIs without documenting AMD behavior.",
          recommendedFix:
            "Centralize backend detection and expose CUDA, ROCm, and CPU as explicit runtime modes.",
        },
        file.path
      );
    }

    if (/cu12|cu118|cu121|nvidia-|cupy-cuda|bitsandbytes|flash-attn|xformers/i.test(content)) {
      addFinding(
        findings,
        {
          severity: "high",
          category: "CUDA-oriented dependency",
          file: file.path,
          line: firstLineOf(content, /cu12|cu118|cu121|nvidia-|cupy-cuda|bitsandbytes|flash-attn|xformers/i),
          explanation:
            "One or more dependencies are pinned to CUDA/NVIDIA builds, which can block ROCm package resolution.",
          recommendedFix:
            "Create a ROCm requirements profile and verify PyTorch/vLLM wheels against the target ROCm version.",
        },
        file.path
      );
    }

    if (/vllm/i.test(content) && /tensor-parallel-size|max-model-len|served-model-name/i.test(content) === false) {
      addFinding(
        findings,
        {
          severity: "low",
          category: "vLLM serving defaults need AMD profile",
          file: file.path,
          line: firstLineOf(content, /vllm/i),
          explanation:
            "vLLM is present, but the repo does not expose the serving knobs that matter when moving to MI300X validation.",
          recommendedFix:
            "Add a backend-aware vLLM launch script with model length, tensor parallelism, and metrics capture settings.",
        },
        file.path
      );
    }

    if (lowerPath.includes("benchmark") && /tokens|latency|memory|throughput/i.test(content) === false) {
      addFinding(
        findings,
        {
          severity: "medium",
          category: "Benchmark evidence incomplete",
          file: file.path,
          line: 1,
          explanation:
            "The benchmark file exists but does not obviously capture tokens/sec, latency, memory, and backend metadata.",
          recommendedFix:
            "Add a ROCm benchmark profile that emits AMD SMI/vLLM metrics for the final migration report.",
        },
        file.path
      );
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: "no-direct-cuda-blockers",
      severity: "low",
      category: "No direct CUDA blockers in scanned files",
      file: "repository",
      line: 1,
      explanation:
        "ROCmPilot did not find obvious CUDA-only strings in the scanned files, but the workload still needs a live AMD smoke test.",
      recommendedFix:
        "Run the generated ROCm validation script on AMD Developer Cloud and attach the benchmark evidence to the report.",
    });
  }

  return findings;
}

function buildPatchPreviews(findings: Finding[]): PatchPreview[] {
  const hasDocker = findings.some((finding) => finding.category.includes("container"));
  const hasDevice = findings.some((finding) => finding.category.includes("CUDA device") || finding.category.includes("backend"));
  const hasDeps = findings.some((finding) => finding.category.includes("dependency"));
  const patches: PatchPreview[] = [];

  if (hasDevice) {
    patches.push({
      id: "device-resolver",
      file: "src/rocmpilot_device.py",
      rationale:
        "Adds a reusable runtime resolver so the project can run on CUDA, ROCm-backed PyTorch, or CPU without hardcoded model code.",
      diff: `+import torch
+
+def resolve_accelerator() -> tuple[str, str]:
+    if torch.cuda.is_available():
+        backend = "rocm" if getattr(torch.version, "hip", None) else "cuda"
+        return "cuda", backend
+    return "cpu", "cpu"
+
+DEVICE, GPU_BACKEND = resolve_accelerator()
+print(f"ROCmPilot backend={GPU_BACKEND} device={DEVICE}")
`,
    });
  }

  if (hasDocker) {
    patches.push({
      id: "dockerfile-rocm",
      file: "Dockerfile.rocm",
      rationale:
        "Creates an AMD-specific runtime container while preserving the original repository for existing CUDA deployments.",
      diff: `+FROM rocm/vllm:latest
+
+WORKDIR /workspace
+COPY . .
+ENV HIP_VISIBLE_DEVICES=0
+ENV VLLM_USE_ROCM=1
+RUN pip install --no-cache-dir -r requirements-rocm.txt
+CMD ["bash", "scripts/serve-rocm.sh"]
`,
    });
  }

  if (hasDeps) {
    patches.push({
      id: "requirements-rocm",
      file: "requirements-rocm.txt",
      rationale:
        "Separates ROCm dependencies from CUDA pins so CI and AMD Developer Cloud validation can install a clean environment.",
      diff: `+torch
+transformers
+accelerate
+vllm
+sentencepiece
+# Verify exact ROCm-compatible wheel versions in AMD Developer Cloud before production use.
`,
    });
  }

  patches.push({
    id: "serve-rocm",
    file: "scripts/serve-rocm.sh",
    rationale:
      "Provides the OpenAI-compatible vLLM endpoint that ROCmPilot can call for the Report Agent on AMD hardware.",
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
  });

  return patches.slice(0, 4);
}

function inferStack(files: ScannedFile[]) {
  const joined = files.map((file) => `${file.path}\n${file.content.slice(0, 2_000)}`).join("\n").toLowerCase();
  const stack = new Set<string>();

  if (joined.includes("vllm")) stack.add("vLLM");
  if (joined.includes("torch")) stack.add("PyTorch");
  if (joined.includes("transformers")) stack.add("Transformers");
  if (joined.includes("fastapi")) stack.add("FastAPI");
  if (joined.includes("dockerfile")) stack.add("Docker");
  if (joined.includes("langchain")) stack.add("LangChain");
  if (joined.includes("crewai")) stack.add("CrewAI");

  return stack.size > 0 ? Array.from(stack).join(", ") : "Python/AI workload";
}

async function fetchRelevantFiles(owner: string, repo: string, ref: string) {
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const tree = await fetchGitHubJson<GitHubTreeResponse>(treeUrl);
  const blobs = (tree.tree ?? [])
    .filter((item) => item.type === "blob" && isRelevantPath(item.path) && (item.size ?? 0) <= 120_000)
    .slice(0, 32);

  const files: ScannedFile[] = [];

  for (const blob of blobs) {
    const data = await fetchGitHubJson<GitHubBlobResponse>(
      `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blob.sha}`
    );

    if (data.encoding === "base64" && data.content) {
      files.push({
        path: blob.path,
        content: Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8"),
      });
    }
  }

  return files;
}

export async function analyzeGitHubRepository(repoUrl: string): Promise<RepoAnalysis> {
  const parsed = parseGitHubRepoUrl(repoUrl);

  if (!parsed) {
    return failedAnalysis(repoUrl, "Invalid GitHub URL.");
  }

  const cacheKey = parsed.repoUrl;
  const cached = scanCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.analysis;
  }

  try {
    const repo = await fetchGitHubJson<GitHubRepoResponse>(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`
    );
    const ref = parsed.branch ?? repo.default_branch ?? "main";
    const files = await fetchRelevantFiles(parsed.owner, parsed.repo, ref);
    const findings = detectFindings(files);
    const patches = buildPatchPreviews(findings);
    const stack = inferStack(files);
    const analysis: RepoAnalysis = {
      status: "scanned",
      label: parsed.label,
      repoUrl: parsed.repoUrl,
      branch: ref,
      scannedFiles: files.length,
      findings,
      patches,
      stack,
      note: `Scanned ${files.length} public GitHub files from ${parsed.label}@${ref}.`,
      logs: [
        `github-scan: resolved ${parsed.label}@${ref}`,
        `github-scan: selected ${files.length} relevant files for ROCm analysis`,
        `repo-doctor: detected stack profile: ${stack}`,
        `migration-planner: produced ${findings.length} findings and ${patches.length} patch previews`,
      ],
    };

    scanCache.set(cacheKey, { analysis, expiresAt: Date.now() + 180_000 });
    return analysis;
  } catch (error) {
    return failedAnalysis(
      parsed.repoUrl,
      error instanceof Error ? error.message : "Unknown GitHub scan failure.",
      parsed.label,
      parsed.branch
    );
  }
}

function failedAnalysis(repoUrl: string, message: string, label = "GitHub repository", branch?: string): RepoAnalysis {
  return {
    status: "failed",
    label,
    repoUrl,
    branch,
    scannedFiles: 0,
    stack: "Public GitHub repository",
    note: message,
    findings: [
      {
        id: "github-scan-failed",
        severity: "medium",
        category: "GitHub scan unavailable",
        file: "repository",
        line: 1,
        explanation:
          "ROCmPilot could not fetch enough public repository data to complete a live scan. The app remains usable with sample fixtures.",
        recommendedFix:
          "Check that the repository is public, add GITHUB_TOKEN for higher API limits, or use the sample workload for the demo.",
      },
    ],
    patches: buildPatchPreviews([]),
    logs: [`github-scan: ${message}`, "fallback: using safe ROCm migration guidance"],
  };
}
