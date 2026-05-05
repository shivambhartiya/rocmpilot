import { buildFallbackReport, buildReportPrompt, getModelStatus } from "@/lib/rocmpilot/data";
import { syncRunMemoryWithSynap } from "@/lib/rocmpilot/synap-memory";
import type { ReportResponse, RocmRun } from "@/lib/rocmpilot/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

async function generateWithAmdQwen(run: RocmRun, longContext: string) {
  const baseUrl = process.env.AMD_QWEN_BASE_URL?.replace(/\/$/, "");

  if (!baseUrl) {
    return null;
  }

  const model = process.env.AMD_QWEN_MODEL ?? "Qwen/Qwen3-Coder-Next";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (process.env.AMD_QWEN_API_KEY) {
    headers.Authorization = `Bearer ${process.env.AMD_QWEN_API_KEY}`;
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model,
      temperature: 0.25,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content:
            "You are the Report Agent for ROCmPilot. Write concise, credible hackathon submission reports. Do not invent live benchmark claims beyond the provided data.",
        },
        {
          role: "user",
          content: buildReportPrompt(run, longContext),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`AMD Qwen endpoint returned ${response.status}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  return payload.choices?.[0]?.message?.content?.trim() || null;
}

async function generateWithHuggingFace(run: RocmRun, longContext: string) {
  if (!process.env.HF_TOKEN) {
    return null;
  }

  const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model: process.env.HF_REPORT_MODEL ?? "Qwen/Qwen2.5-Coder-7B-Instruct",
      temperature: 0.25,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content:
            "You are the Report Agent for ROCmPilot. Write concise, credible hackathon submission reports. Do not invent live benchmark claims beyond the provided data.",
        },
        {
          role: "user",
          content: buildReportPrompt(run, longContext),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Hugging Face router returned ${response.status}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  return payload.choices?.[0]?.message?.content?.trim() || null;
}

export async function POST(request: Request) {
  const run = (await request.json()) as RocmRun;
  const memorySync = await syncRunMemoryWithSynap(run);

  try {
    const report = await generateWithAmdQwen(run, memorySync.promptContext);

    if (report) {
      const response: ReportResponse = {
        report,
        source: "amd-vllm",
        modelStatus: getModelStatus("amd-vllm"),
        memoryStatus: memorySync.status,
      };
      return NextResponse.json(response);
    }
  } catch (error) {
    console.warn("Falling back from AMD Qwen report generation:", error);
  }

  try {
    const report = await generateWithHuggingFace(run, memorySync.promptContext);

    if (report) {
      const response: ReportResponse = {
        report,
        source: "hf-router",
        modelStatus: getModelStatus("hf-router"),
        memoryStatus: memorySync.status,
      };
      return NextResponse.json(response);
    }
  } catch (error) {
    console.warn("Falling back from Hugging Face report generation:", error);
  }

  const response: ReportResponse = {
    report: buildFallbackReport(run, memorySync.promptContext),
    source: "fallback",
    modelStatus: getModelStatus("fallback"),
    memoryStatus: memorySync.status,
  };

  return NextResponse.json(response);
}
