import { getModelStatus } from "./data";
import type { GpuModelStatus, ModelSource } from "./types";

export type ModelChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelGeneration = {
  text: string;
  source: ModelSource;
  modelStatus: GpuModelStatus;
};

type GenerateConfiguredChatOptions = {
  messages: ModelChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const globalForModelClient = globalThis as unknown as {
  rocmPilotAmdCooldownUntil?: number;
};

async function callOpenAiCompatibleEndpoint({
  endpoint,
  headers,
  model,
  messages,
  temperature,
  maxTokens,
  timeoutMs,
}: {
  endpoint: string;
  headers: Record<string, string>;
  model: string;
  messages: ModelChatMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Model endpoint returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const text = payload.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("Model endpoint returned an empty response");
  }

  return text;
}

async function generateWithAmd({
  messages,
  temperature,
  maxTokens,
  timeoutMs,
}: Required<GenerateConfiguredChatOptions>) {
  const baseUrl = process.env.AMD_QWEN_BASE_URL?.replace(/\/$/, "");

  if (!baseUrl) {
    return null;
  }

  if ((globalForModelClient.rocmPilotAmdCooldownUntil ?? 0) > Date.now()) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (process.env.AMD_QWEN_API_KEY) {
    headers.Authorization = `Bearer ${process.env.AMD_QWEN_API_KEY}`;
  }

  return callOpenAiCompatibleEndpoint({
    endpoint: `${baseUrl}/v1/chat/completions`,
    headers,
    model: process.env.AMD_QWEN_MODEL ?? "Qwen/Qwen3-Coder-Next",
    messages,
    temperature,
    maxTokens,
    timeoutMs,
  });
}

async function generateWithHuggingFace({
  messages,
  temperature,
  maxTokens,
  timeoutMs,
}: Required<GenerateConfiguredChatOptions>) {
  if (!process.env.HF_TOKEN) {
    return null;
  }

  return callOpenAiCompatibleEndpoint({
    endpoint: "https://router.huggingface.co/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/json",
    },
    model: process.env.HF_REPORT_MODEL ?? "Qwen/Qwen2.5-Coder-7B-Instruct",
    messages,
    temperature,
    maxTokens,
    timeoutMs,
  });
}

export async function generateConfiguredChat({
  messages,
  temperature = 0.25,
  maxTokens = 700,
  timeoutMs = 12_000,
}: GenerateConfiguredChatOptions): Promise<ModelGeneration | null> {
  const options = { messages, temperature, maxTokens, timeoutMs };

  try {
    const text = await generateWithAmd(options);

    if (text) {
      globalForModelClient.rocmPilotAmdCooldownUntil = undefined;
      return {
        text,
        source: "amd-vllm",
        modelStatus: getModelStatus("amd-vllm"),
      };
    }
  } catch (error) {
    globalForModelClient.rocmPilotAmdCooldownUntil = Date.now() + 60_000;
    console.warn("Falling back from AMD model generation:", error);
  }

  try {
    const text = await generateWithHuggingFace(options);

    if (text) {
      return {
        text,
        source: "hf-router",
        modelStatus: getModelStatus("hf-router"),
      };
    }
  } catch (error) {
    console.warn("Falling back from Hugging Face model generation:", error);
  }

  return null;
}
