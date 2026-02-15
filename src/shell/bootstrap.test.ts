import { describe, it, expect, vi } from "vitest";
import { bootstrapAgent } from "./bootstrap.js";

function makeMockClient() {
  return {
    agents: {
      messages: {
        create: vi.fn().mockResolvedValue({
          messages: [{ message_type: "assistant_message", content: "Updated." }],
        }),
      },
    },
  };
}

describe("bootstrapAgent", () => {
  it("sends architecture and conventions bootstrap prompts", async () => {
    const client = makeMockClient();
    await bootstrapAgent(client as any, "agent-123");
    expect(client.agents.messages.create).toHaveBeenCalledTimes(2);

    const call1 = client.agents.messages.create.mock.calls[0];
    expect(call1[0]).toBe("agent-123");
    expect(call1[1].messages[0].content).toContain("architecture");

    const call2 = client.agents.messages.create.mock.calls[1];
    expect(call2[1].messages[0].content).toContain("conventions");
  });
});
