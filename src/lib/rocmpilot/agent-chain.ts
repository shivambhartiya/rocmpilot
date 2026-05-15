import { getModelStatus } from "./data";
import { generateConfiguredChat, type ModelChatMessage } from "./model-client";
import type {
  AgentChainResponse,
  AgentMemory,
  AgentMessage,
  GpuModelStatus,
  ModelSource,
  RocmRun,
} from "./types";

type AgentStep = {
  agent: string;
  toAgent: string;
  role: string;
  task: string;
  leadAgent: string;
  kind: AgentMessage["kind"];
  memoryRefs: string[];
  instruction: string;
  fallback: (context: StepContext) => string;
};

type StepContext = {
  run: RocmRun;
  evidence: string;
  previous: AgentMessage[];
};

type StepOutput = {
  message: AgentMessage;
  source: ModelSource;
  fallback: boolean;
  modelStatus: GpuModelStatus;
};

const AGENT_STEPS: AgentStep[] = [
  {
    agent: "Repo Doctor",
    toAgent: "Migration Planner",
    role: "Scanner evidence reviewer",
    task: "Review repository evidence",
    leadAgent: "Repo Doctor",
    kind: "decision",
    memoryRefs: ["mem-runtime-api-nuance"],
    instruction:
      "Review the scanner evidence. Separate true ROCm blockers from inspection signals. Be explicit that PyTorch ROCm often uses the torch.cuda API surface, so .cuda() and torch.device('cuda') are not automatically incompatible. Identify what still needs proof.",
    fallback: ({ run }) =>
      `Reviewed ${run.findings.length} scanner findings for ${run.target.label}. The strongest blockers are container/runtime assumptions and CUDA-pinned dependencies. Direct \`.cuda()\` or \`torch.device("cuda")\` calls are inspection signals, not automatic ROCm failures, because ROCm PyTorch exposes HIP through much of \`torch.cuda\`. The repo still needs backend provenance logging with \`torch.version.hip\` and a live AMD smoke test.`,
  },
  {
    agent: "Migration Planner",
    toAgent: "Build Runner",
    role: "Patch strategist",
    task: "Create ROCm migration plan",
    leadAgent: "Migration Planner",
    kind: "proposal",
    memoryRefs: ["mem-runtime-api-nuance", "mem-migration-plan"],
    instruction:
      "Use Repo Doctor's output as input. Propose the smallest credible ROCm migration plan and name which patch previews should be applied first. Ask Build Runner what can invalidate the plan.",
    fallback: ({ run }) =>
      `Using Repo Doctor's review, apply ${run.patches.length || "the"} patch preview${run.patches.length === 1 ? "" : "s"} in this order: backend provenance resolver, separate ROCm container/launch path, then benchmark logging. Keep existing CUDA support intact. Build Runner should challenge container bootability, ROCm wheel resolution, vLLM startup, and whether the report clearly labels estimates versus live AMD proof.`,
  },
  {
    agent: "Build Runner",
    toAgent: "Benchmark Agent",
    role: "Validation critic",
    task: "Critique migration plan",
    leadAgent: "Build Runner",
    kind: "challenge",
    memoryRefs: ["mem-migration-plan", "mem-validation-boundary"],
    instruction:
      "Critique Migration Planner's plan. Name concrete build/smoke-test commands and failure modes. Do not claim tests were actually run unless the provided logs prove it.",
    fallback: () =>
      "The plan is credible only if it passes concrete smoke checks: install ROCm-compatible PyTorch/vLLM, print `torch.__version__`, `torch.version.hip`, `torch.cuda.is_available()`, boot the ROCm container, start the OpenAI-compatible vLLM server, and send one chat completion request. Current demo logs are planning evidence, not proof of a live external repository build.",
  },
  {
    agent: "Benchmark Agent",
    toAgent: "Report Agent",
    role: "Evidence analyst",
    task: "Define AMD proof requirements",
    leadAgent: "Benchmark Agent",
    kind: "decision",
    memoryRefs: ["mem-validation-boundary", "mem-amd-proof"],
    instruction:
      "Use Build Runner's critique to define the benchmark and proof requirements for AMD MI300X/ROCm/vLLM. Make clear what can be shown now and what must be replaced by live AMD logs.",
    fallback: ({ run }) =>
      `Show current benchmark cards as ROCmPilot planning estimates for ${run.target.label}. For AMD proof, require MI300X visibility (` +
      "`rocm-smi` or `amd-smi`), ROCm version, vLLM version, model name, tokens/sec, p95 latency, memory usage, endpoint request/response, and logs proving whether the endpoint was AMD-hosted or Hugging Face fallback.",
  },
  {
    agent: "Report Agent",
    toAgent: "All agents",
    role: "Submission synthesizer",
    task: "Synthesize agent consensus",
    leadAgent: "Report Agent",
    kind: "consensus",
    memoryRefs: [
      "mem-runtime-api-nuance",
      "mem-migration-plan",
      "mem-validation-boundary",
      "mem-amd-proof",
    ],
    instruction:
      "Synthesize Repo Doctor, Migration Planner, Build Runner, and Benchmark Agent into a final consensus for the report. Be judge-safe: no exaggerated incompatibility claims, no fake benchmarks, and no claim that an LLM debate happened if this chain fell back.",
    fallback: () =>
      "Consensus: ROCmPilot should present a real migration workflow, not a blanket CUDA search-and-replace. The credible story is scanner evidence -> technically nuanced migration plan -> build/test critique -> AMD proof checklist -> final report. The final report must say `.cuda()` can run on ROCm when HIP-backed PyTorch is installed, while container images, dependency pins, and missing provenance remain the main migration risks.",
  },
];

function compactList(items: string[], empty: string) {
  return items.length ? items.join("\n") : empty;
}

function buildEvidenceDigest(run: RocmRun) {
  const findings = compactList(
    run.findings.map(
      (finding) =>
        `- ${finding.severity.toUpperCase()} ${finding.category} at ${finding.file}:${finding.line}. Evidence: ${finding.explanation} Fix: ${finding.recommendedFix}`
    ),
    "- No findings are visible yet."
  );
  const patches = compactList(
    run.patches.map((patch) => `- ${patch.file}: ${patch.rationale}`),
    "- No patch previews are visible yet."
  );
  const logs = compactList(
    run.logs.map((line) => `- ${line}`),
    "- No terminal logs are visible yet."
  );
  const benchmarks = compactList(
    run.benchmarks.map(
      (benchmark) =>
        `- ${benchmark.label}: ${benchmark.backend}, ${benchmark.tokensPerSecond} tok/s, p95 ${benchmark.p95LatencyMs}ms, ${benchmark.memoryGb}GB. ${benchmark.costNote}`
    ),
    "- No benchmark profile is visible yet."
  );

  return [
    `Target: ${run.target.label}`,
    `Repository: ${run.target.repoUrl}`,
    `Scan status: ${run.target.scanStatus}; scanned files: ${run.target.scannedFiles}`,
    `Scan note: ${run.target.note}`,
    "",
    "Scanner findings:",
    findings,
    "",
    "Patch previews:",
    patches,
    "",
    "Terminal/demo logs:",
    logs,
    "",
    "Benchmark cards:",
    benchmarks,
  ].join("\n");
}

function previousTranscript(messages: AgentMessage[]) {
  return compactList(
    messages.map((message) => `[${message.agent} -> ${message.toAgent}] ${message.message}`),
    "- No previous agent output yet."
  );
}

function buildStepPrompt(step: AgentStep, context: StepContext): ModelChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a specialized ROCmPilot agent in a chained multi-agent workflow. Keep output concise, technical, and evidence-bound. Do not invent repository files, live benchmark results, or AMD access. Important ROCm nuance: PyTorch on ROCm deliberately exposes HIP through much of the torch.cuda API, so .cuda() and torch.device('cuda') are not automatically incompatible; they are signals to verify backend provenance.",
    },
    {
      role: "user",
      content: [
        `Current agent: ${step.agent}`,
        `Role: ${step.role}`,
        `Task: ${step.task}`,
        `You are speaking to: ${step.toAgent}`,
        "",
        "Instruction:",
        step.instruction,
        "",
        "Repository evidence:",
        context.evidence,
        "",
        "Prior agent transcript:",
        previousTranscript(context.previous),
        "",
        "Return 3-5 tight bullets or one compact paragraph. Include one question or handoff for the agent you are speaking to.",
      ].join("\n"),
    },
  ];
}

function snippet(text: string, maxLength = 380) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

function makeMessage({
  run,
  step,
  index,
  text,
  previous,
}: {
  run: RocmRun;
  step: AgentStep;
  index: number;
  text: string;
  previous: AgentMessage[];
}): AgentMessage {
  const baseTime = new Date(run.completedAt ?? run.startedAt).getTime();

  return {
    id: `${run.id}.llm-agent-${index + 1}.${step.agent.toLowerCase().replace(/\W+/g, "-")}`,
    agent: step.agent,
    toAgent: step.toAgent,
    role: step.role,
    task: step.task,
    leadAgent: step.leadAgent,
    kind: step.kind,
    message: text.slice(0, 2_400),
    replyToId: previous.at(-1)?.id,
    memoryRefs: step.memoryRefs,
    createdAt: new Date(baseTime + index * 1_200).toISOString(),
  };
}

async function runStep(
  run: RocmRun,
  step: AgentStep,
  index: number,
  context: StepContext
): Promise<StepOutput> {
  const generation = await generateConfiguredChat({
    messages: buildStepPrompt(step, context),
    temperature: 0.2,
    maxTokens: 420,
    timeoutMs: 8_000,
  });
  const text = generation?.text ?? step.fallback(context);
  const source = generation?.source ?? "fallback";

  return {
    message: makeMessage({
      run,
      step,
      index,
      text,
      previous: context.previous,
    }),
    source,
    fallback: !generation,
    modelStatus: generation?.modelStatus ?? getModelStatus("fallback"),
  };
}

function chooseChainSource(outputs: StepOutput[]): ModelSource {
  if (outputs.some((output) => output.source === "amd-vllm")) {
    return "amd-vllm";
  }

  if (outputs.some((output) => output.source === "hf-router")) {
    return "hf-router";
  }

  return "fallback";
}

function buildChainMemory(run: RocmRun, messages: AgentMessage[]): AgentMemory[] {
  const baseTime = new Date(run.completedAt ?? run.startedAt).getTime();
  const [repoDoctor, migrationPlanner, buildRunner, benchmarkAgent] = messages;

  return [
    {
      id: "mem-runtime-api-nuance",
      title: "PyTorch ROCm API nuance",
      scope: "Runtime compatibility",
      learnedFromAgent: "Repo Doctor",
      summary:
        "The scanner should treat torch.cuda and .cuda() as evidence to inspect, not automatic proof that AMD ROCm is impossible.",
      solution:
        "Verify HIP-backed PyTorch with `torch.version.hip`, keep device strings compatible where appropriate, and log backend provenance as CUDA, ROCm, or CPU.",
      createdAt: new Date(baseTime + 600).toISOString(),
      usedBy: ["Migration Planner", "Build Runner", "Report Agent"],
    },
    {
      id: "mem-migration-plan",
      title: "Migration patch order",
      scope: "Implementation planning",
      learnedFromAgent: "Migration Planner",
      summary: snippet(migrationPlanner?.message ?? "Apply resolver, ROCm runtime path, and evidence logging before optimizing."),
      solution:
        "Apply the backend resolver first, keep a separate ROCm container/serve path, then add metrics and documentation so the repo remains dual-backend friendly.",
      createdAt: new Date(baseTime + 1_800).toISOString(),
      usedBy: ["Build Runner", "Benchmark Agent", "Report Agent"],
    },
    {
      id: "mem-validation-boundary",
      title: "Validation proof boundary",
      scope: "Build validation",
      learnedFromAgent: "Build Runner",
      summary: snippet(buildRunner?.message ?? "A patch is only credible after ROCm install, backend detection, container boot, vLLM startup, and endpoint smoke tests."),
      solution:
        "Do not present estimated cards as live AMD results; require logs for PyTorch HIP detection, container boot, vLLM health, and one OpenAI-compatible completion.",
      createdAt: new Date(baseTime + 3_000).toISOString(),
      usedBy: ["Benchmark Agent", "Report Agent"],
    },
    {
      id: "mem-amd-proof",
      title: "AMD proof checklist",
      scope: "Submission evidence",
      learnedFromAgent: "Benchmark Agent",
      summary: snippet(benchmarkAgent?.message ?? "Final proof needs MI300X visibility, ROCm/vLLM versions, model name, throughput, latency, memory, and endpoint provenance."),
      solution:
        "Attach `rocm-smi`/`amd-smi`, ROCm and vLLM versions, Qwen model name, token throughput, p95 latency, memory usage, and endpoint request/response logs.",
      createdAt: new Date(baseTime + 4_200).toISOString(),
      usedBy: ["Report Agent"],
    },
    {
      id: "mem-report-consensus",
      title: "Report consensus",
      scope: "Submission narrative",
      learnedFromAgent: "Report Agent",
      summary: snippet(repoDoctor?.message ?? "The final story must stay technically precise and evidence-bound."),
      solution:
        "Tell the story as an evidence-driven ROCm readiness workflow: scan, nuanced plan, validation critique, proof checklist, and final migration report.",
      createdAt: new Date(baseTime + 5_400).toISOString(),
      usedBy: ["Report Agent"],
    },
  ];
}

export async function runAgentChain(run: RocmRun): Promise<Omit<AgentChainResponse, "memoryStatus">> {
  const evidence = buildEvidenceDigest(run);
  const outputs: StepOutput[] = [];
  const messages: AgentMessage[] = [];

  for (const [index, step] of AGENT_STEPS.entries()) {
    const output = await runStep(run, step, index, {
      run,
      evidence,
      previous: messages,
    });
    outputs.push(output);
    messages.push(output.message);
  }

  const source = chooseChainSource(outputs);

  return {
    agentMessages: messages,
    agentMemory: buildChainMemory(run, messages),
    source,
    modelStatus: getModelStatus(source),
    fallback: outputs.some((output) => output.fallback),
  };
}
