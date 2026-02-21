import type { vi } from "vitest";
import { describe, it, expect } from "vitest";
import { bootstrapAgent } from "./bootstrap.js";
import { makeMockProvider } from "./__test__/mock-provider.js";

describe("bootstrapAgent", () => {
  it("sends architecture and conventions bootstrap prompts", async () => {
    const provider = makeMockProvider();
    await bootstrapAgent(provider, "agent-123");
    const sendMessage = provider.sendMessage as ReturnType<typeof vi.fn>;
    expect(sendMessage).toHaveBeenCalledTimes(2);

    expect(sendMessage.mock.calls[0][0]).toBe("agent-123");
    expect(sendMessage.mock.calls[0][1]).toContain("architecture");

    expect(sendMessage.mock.calls[1][1]).toContain("conventions");
  });
});
