import { createRun } from "@/lib/rocmpilot/store";
import type { RunMode } from "@/lib/rocmpilot/types";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sampleId?: string;
    mode?: RunMode;
    repoUrl?: string;
  };

  const run = createRun(
    body.sampleId ?? "qwen-vllm-cuda",
    body.mode ?? "mock",
    body.repoUrl
  );

  return NextResponse.json(run);
}
