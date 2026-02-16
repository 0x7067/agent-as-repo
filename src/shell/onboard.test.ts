import { describe, it, expect, vi } from "vitest";
import { onboardAgent } from "./onboard.js";
import { makeMockProvider } from "./__test__/mock-provider.js";

describe("onboardAgent", () => {
  it("sends onboarding prompt and returns response", async () => {
    const provider = makeMockProvider({
      sendMessage: vi.fn().mockResolvedValue("Welcome! Here is your onboarding guide..."),
    });

    const result = await onboardAgent(provider, "my-app", "agent-abc");

    expect(result).toBe("Welcome! Here is your onboarding guide...");
    expect(provider.sendMessage).toHaveBeenCalledWith("agent-abc", expect.stringContaining("my-app"));
    expect(provider.sendMessage).toHaveBeenCalledWith("agent-abc", expect.stringContaining("Architecture"));
  });
});
