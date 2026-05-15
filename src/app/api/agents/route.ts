import { runAgentChain } from "@/lib/rocmpilot/agent-chain";
import { syncRunMemoryWithSynap } from "@/lib/rocmpilot/synap-memory";
import type { AgentChainResponse, RocmRun } from "@/lib/rocmpilot/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const run = (await request.json()) as RocmRun;
  const chain = await runAgentChain(run);
  const runWithRealAgents: RocmRun = {
    ...run,
    agentMessages: chain.agentMessages,
    agentMemory: chain.agentMemory,
  };
  const memorySync = await syncRunMemoryWithSynap(runWithRealAgents);
  const response: AgentChainResponse = {
    ...chain,
    memoryStatus: memorySync.status,
  };

  return NextResponse.json(response);
}
