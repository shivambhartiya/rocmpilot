export const DEFAULT_MEMORY_CUSTOMER_ID = "rocmpilot-hackathon";
export const DEFAULT_MEMORY_USER_ID = "rocmpilot-agent-fleet";

export function buildMemoryConversationId(runId: string) {
  return `rocmpilot-${runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 140)}`;
}
