import type {
  ChatMessage,
  ContextForPromptResult,
  ContextResponse,
  SynapClient,
  SynapClientOptions,
} from "@maximem/synap-js-sdk";
import {
  getLongContextMemoryStatus,
} from "./data";
import {
  buildMemoryConversationId,
  DEFAULT_MEMORY_CUSTOMER_ID,
  DEFAULT_MEMORY_USER_ID,
} from "./memory-ids";
import type { LongContextMemoryStatus, RocmRun } from "./types";

type SynapSyncResult = {
  status: LongContextMemoryStatus;
  promptContext: string;
};

function parseOptionalPort(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) ? port : undefined;
}

function parseOptionalBoolean(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return ["1", "true", "yes"].includes(value.toLowerCase());
}

function getSynapIdentity(run: RocmRun) {
  return {
    conversationId: buildMemoryConversationId(run.id),
    customerId: process.env.SYNAP_CUSTOMER_ID ?? DEFAULT_MEMORY_CUSTOMER_ID,
    userId: process.env.SYNAP_USER_ID ?? DEFAULT_MEMORY_USER_ID,
  };
}

function buildSynapMessages(run: RocmRun): ChatMessage[] {
  const targetSummary = [
    `ROCmPilot run ${run.id}`,
    `Target: ${run.target.label} (${run.target.repoUrl})`,
    `Scan status: ${run.target.scanStatus}; scanned files: ${run.target.scannedFiles}`,
    `Goal: migrate PyTorch/vLLM workload toward AMD ROCm readiness.`,
  ].join("\n");

  const agentDiscussion = run.agentMessages.map((message) => ({
    role: "assistant" as const,
    content: [
      `[${message.agent} -> ${message.toAgent}] ${message.kind.toUpperCase()}`,
      `Task: ${message.task}`,
      `Lead: ${message.leadAgent}`,
      `Message: ${message.message}`,
      message.memoryRefs.length ? `Memory refs: ${message.memoryRefs.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: {
      agent: message.agent,
      toAgent: message.toAgent,
      kind: message.kind,
      task: message.task,
      leadAgent: message.leadAgent,
      runId: run.id,
    },
  }));

  const sharedMemory = run.agentMemory.map((memory) => ({
    role: "assistant" as const,
    content: [
      `Shared memory: ${memory.title}`,
      `Scope: ${memory.scope}`,
      `Learned from: ${memory.learnedFromAgent}`,
      `Summary: ${memory.summary}`,
      `Reusable solution: ${memory.solution}`,
      memory.usedBy.length ? `Reused by: ${Array.from(new Set(memory.usedBy)).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: {
      memoryId: memory.id,
      scope: memory.scope,
      learnedFromAgent: memory.learnedFromAgent,
      runId: run.id,
    },
  }));

  return [
    {
      role: "user",
      content: targetSummary,
      metadata: {
        runId: run.id,
        target: run.target.label,
        repository: run.target.repoUrl,
      },
    },
    ...agentDiscussion,
    ...sharedMemory,
  ];
}

function buildLocalMemoryContext(run: RocmRun) {
  const memories = run.agentMemory
    .map((memory) => `- ${memory.title} (${memory.scope}): ${memory.solution}`)
    .join("\n");
  const recentDiscussion = run.agentMessages
    .slice(-8)
    .map((message) => `- ${message.agent} -> ${message.toAgent}: ${message.message}`)
    .join("\n");

  return [
    "Current run memory:",
    memories || "- No shared memory has been written yet.",
    "",
    "Recent agent discussion:",
    recentDiscussion || "- No agent discussion is available yet.",
  ].join("\n");
}

function countContextItems(context: ContextResponse | null) {
  if (!context) {
    return 0;
  }

  return (
    (context.facts?.length ?? 0) +
    (context.preferences?.length ?? 0) +
    (context.episodes?.length ?? 0) +
    (context.emotions?.length ?? 0) +
    (context.temporalEvents?.length ?? 0)
  );
}

function summarizeContext(
  context: ContextResponse | null,
  promptContext: ContextForPromptResult | null
) {
  const sections: string[] = [];

  if (promptContext?.formattedContext) {
    sections.push(`Synap compacted context:\n${promptContext.formattedContext}`);
  }

  if (context?.facts?.length) {
    sections.push(
      `Synap facts:\n${context.facts
        .slice(0, 5)
        .map((fact) => `- ${fact.content}`)
        .join("\n")}`
    );
  }

  if (context?.episodes?.length) {
    sections.push(
      `Synap episodes:\n${context.episodes
        .slice(0, 5)
        .map((episode) => `- ${episode.summary}`)
        .join("\n")}`
    );
  }

  if (context?.preferences?.length) {
    sections.push(
      `Synap preferences:\n${context.preferences
        .slice(0, 5)
        .map((preference) => `- ${preference.content}`)
        .join("\n")}`
    );
  }

  return sections.join("\n\n");
}

function synapOptions(): SynapClientOptions {
  return {
    apiKey: process.env.SYNAP_API_KEY,
    baseUrl: process.env.SYNAP_BASE_URL,
    grpcHost: process.env.SYNAP_GRPC_HOST,
    grpcPort: parseOptionalPort(process.env.SYNAP_GRPC_PORT),
    grpcUseTls: parseOptionalBoolean(process.env.SYNAP_GRPC_TLS),
    autoSetup: parseOptionalBoolean(process.env.SYNAP_AUTO_SETUP) ?? false,
    requestTimeoutMs: 10_000,
    initTimeoutMs: 10_000,
    ingestTimeoutMs: 10_000,
    onLog: (level, message) => {
      if (level === "error") {
        console.warn(`Synap ${level}: ${message}`);
      }
    },
  };
}

async function shutdownClient(client: SynapClient | null) {
  if (!client) {
    return;
  }

  try {
    await client.shutdown();
  } catch (error) {
    console.warn("Synap shutdown warning:", error);
  }
}

export async function syncRunMemoryWithSynap(run: RocmRun): Promise<SynapSyncResult> {
  const localContext = buildLocalMemoryContext(run);
  const identity = getSynapIdentity(run);

  if (!process.env.SYNAP_API_KEY) {
    return {
      status: getLongContextMemoryStatus(
        run.id,
        run.agentMemory.length,
        run.agentMessages.filter((message) => message.memoryRefs.length > 0).length,
        "fallback"
      ),
      promptContext: localContext,
    };
  }

  let client: SynapClient | null = null;

  try {
    const { createClient } = await import("@maximem/synap-js-sdk");
    client = createClient(synapOptions());
    await client.init();

    const messages = buildSynapMessages(run);

    await client.addMemory({
      userId: identity.userId,
      customerId: identity.customerId,
      conversationId: identity.conversationId,
      sessionId: run.id,
      documentId: run.id,
      documentType: "ai-chat-conversation",
      documentCreatedAt: run.startedAt,
      mode: "long-range",
      metadata: {
        product: "ROCmPilot",
        track: "AI Agents & Agentic Workflows",
        targetLabel: run.target.label,
        targetRepo: run.target.repoUrl,
        scanStatus: run.target.scanStatus,
        agentMessages: run.agentMessages.length,
        sharedMemories: run.agentMemory.length,
      },
      messages,
    });

    const [contextResult, promptContextResult] = await Promise.allSettled([
      client.fetchUserContext({
        userId: identity.userId,
        customerId: identity.customerId,
        conversationId: identity.conversationId,
        searchQuery: [
          "ROCm migration blockers",
          "CUDA assumptions and AMD validation",
          "agent decisions from prior ROCmPilot runs",
        ],
        maxResults: 8,
        mode: "accurate",
      }),
      client.getContextForPrompt({
        conversationId: identity.conversationId,
        style: "structured",
      }),
    ]);

    const context = contextResult.status === "fulfilled" ? contextResult.value : null;
    const promptContext =
      promptContextResult.status === "fulfilled" ? promptContextResult.value : null;
    const synapContext = summarizeContext(context, promptContext);
    const recalledItems =
      countContextItems(context) + (promptContext?.recentMessageCount ?? 0);

    return {
      status: getLongContextMemoryStatus(
        run.id,
        messages.length,
        recalledItems,
        "connected"
      ),
      promptContext: synapContext || localContext,
    };
  } catch (error) {
    console.warn("Synap memory fallback:", error);

    return {
      status: {
        ...getLongContextMemoryStatus(
          run.id,
          run.agentMemory.length,
          run.agentMessages.filter((message) => message.memoryRefs.length > 0).length,
          "fallback"
        ),
        detail:
          "Synap credentials are present, but the SDK runtime could not complete ingestion. Using local run memory for this report.",
      },
      promptContext: localContext,
    };
  } finally {
    await shutdownClient(client);
  }
}
