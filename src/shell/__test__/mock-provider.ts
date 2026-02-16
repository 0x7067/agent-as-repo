import { vi } from "vitest";
import type { AgentProvider } from "../provider.js";

export function makeMockProvider(overrides?: Partial<AgentProvider>): AgentProvider {
  return {
    createAgent: vi.fn().mockResolvedValue({ agentId: "agent-abc" }),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    deletePassage: vi.fn().mockResolvedValue(undefined),
    listPassages: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn().mockResolvedValue({ value: "", limit: 5000 }),
    storePassage: vi.fn().mockResolvedValue("passage-1"),
    sendMessage: vi.fn().mockResolvedValue("Done."),
    ...overrides,
  };
}
