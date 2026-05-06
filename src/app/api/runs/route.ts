import { createRun } from "@/lib/rocmpilot/store";
import { checkGitHubRepositoryAccess } from "@/lib/rocmpilot/github-scanner";
import type { RunMode } from "@/lib/rocmpilot/types";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sampleId?: string;
    mode?: RunMode;
    repoUrl?: string;
  };
  const repoUrl = body.repoUrl?.trim();

  if (repoUrl) {
    const repository = await checkGitHubRepositoryAccess(repoUrl);

    if (!repository.ok) {
      return NextResponse.json({ error: repository.message }, { status: 400 });
    }
  }

  const run = createRun(
    body.sampleId ?? "qwen-vllm-cuda",
    body.mode ?? "mock",
    repoUrl
  );

  return NextResponse.json(run);
}
