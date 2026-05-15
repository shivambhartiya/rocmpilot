import { buildFallbackReport, buildReportPrompt, getModelStatus } from "@/lib/rocmpilot/data";
import { generateConfiguredChat } from "@/lib/rocmpilot/model-client";
import { syncRunMemoryWithSynap } from "@/lib/rocmpilot/synap-memory";
import type { ReportResponse, RocmRun } from "@/lib/rocmpilot/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const run = (await request.json()) as RocmRun;
  const memorySync = await syncRunMemoryWithSynap(run);
  const generation = await generateConfiguredChat({
    temperature: 0.25,
    maxTokens: 900,
    timeoutMs: 15_000,
    messages: [
      {
        role: "system",
        content:
          "You are the Report Agent for ROCmPilot. Write concise, credible hackathon submission reports from the real chained agent transcript. Do not invent live benchmark claims beyond the provided data. Be technically precise: PyTorch ROCm exposes HIP through much of the torch.cuda API, so .cuda() is not automatically incompatible.",
      },
      {
        role: "user",
        content: buildReportPrompt(run, memorySync.promptContext),
      },
    ],
  });

  if (generation) {
    const response: ReportResponse = {
      report: generation.text,
      source: generation.source,
      modelStatus: generation.modelStatus,
      memoryStatus: memorySync.status,
      agentMessages: run.agentMessages,
      agentMemory: run.agentMemory,
    };
    return NextResponse.json(response);
  }

  const response: ReportResponse = {
    report: buildFallbackReport(run, memorySync.promptContext),
    source: "fallback",
    modelStatus: getModelStatus("fallback"),
    memoryStatus: memorySync.status,
    agentMessages: run.agentMessages,
    agentMemory: run.agentMemory,
  };

  return NextResponse.json(response);
}
