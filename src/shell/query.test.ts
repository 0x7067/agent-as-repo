import { describe, it, expect, vi } from "vitest";
import { queryAgent } from "./query.js";

function makeMockClient(assistantContent: string) {
  return {
    agents: {
      messages: {
        create: vi.fn().mockResolvedValue({
          messages: [
            { message_type: "tool_call_message", tool_call: { name: "archival_memory_search" } },
            { message_type: "tool_return_message", tool_return: "some results" },
            { message_type: "assistant_message", content: assistantContent },
          ],
        }),
      },
    },
  };
}

describe("queryAgent", () => {
  it("sends a question and extracts assistant response", async () => {
    const client = makeMockClient("The auth uses JWT tokens.");
    const answer = await queryAgent(client as any, "agent-123", "How does auth work?");
    expect(answer).toBe("The auth uses JWT tokens.");

    const call = client.agents.messages.create.mock.calls[0];
    expect(call[0]).toBe("agent-123");
    expect(call[1].messages[0].content).toBe("How does auth work?");
  });

  it("returns empty string when no assistant message", async () => {
    const client = {
      agents: {
        messages: {
          create: vi.fn().mockResolvedValue({
            messages: [{ message_type: "tool_call_message" }],
          }),
        },
      },
    };
    const answer = await queryAgent(client as any, "agent-123", "test");
    expect(answer).toBe("");
  });
});
