import { createRunRecord, parseRunRecord, snapshotRun } from "./data";
import { analyzeGitHubRepository } from "./github-scanner";
import type { RocmRun, RunMode } from "./types";

export function createRun(sampleId: string, mode: RunMode = "mock", repoUrl?: string): RocmRun {
  const record = createRunRecord(sampleId, mode, repoUrl);
  return snapshotRun(record);
}

export async function getRun(runId: string): Promise<RocmRun | null> {
  const record = parseRunRecord(runId);

  if (!record) {
    return null;
  }

  if (record.targetType === "github" && record.repoUrl) {
    const analysis = await analyzeGitHubRepository(record.repoUrl);
    return snapshotRun(record, analysis);
  }

  return snapshotRun(record);
}
