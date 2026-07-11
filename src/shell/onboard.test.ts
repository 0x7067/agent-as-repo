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
    expect(provider.sendMessage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("agent-abc", expect.stringContaining("my-app"));
    expect(provider.sendMessage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("agent-abc", expect.stringContaining("Architecture"));
  });

  it("forwards an abort signal to the provider so onboarding can be timed out", async () => {
    const provider = makeMockProvider({
      sendMessage: vi.fn().mockResolvedValue("Welcome!"),
    });
    const controller = new AbortController();

    await onboardAgent(provider, "my-app", "agent-abc", { signal: controller.signal });

    expect(provider.sendMessage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      "agent-abc",
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("does not pass an options object when no signal is given", async () => {
    const provider = makeMockProvider({
      sendMessage: vi.fn().mockResolvedValue("Welcome!"),
    });

    await onboardAgent(provider, "my-app", "agent-abc");

    expect(provider.sendMessage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("agent-abc", expect.any(String));
    const call = (provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(call).toHaveLength(2);
  });

  it("strips path/to/ template artifacts and drops recommendations for unindexed files", async () => {
    const walkthrough = [
      "## Top 10 files to read first",
      "- `path/to/src/core/onboard.ts` — builds the onboarding prompt",
      "- `lib/router/index.js` — internal router dispatch (doesn't exist)",
      "- `src/cli.ts` — CLI entry point",
    ].join("\n");
    const provider = makeMockProvider({
      sendMessage: vi.fn().mockResolvedValue(walkthrough),
      listPassages: vi.fn().mockResolvedValue([
        { id: "1", text: "FILE: src/core/onboard.ts\n\nexport function buildOnboardPrompt() {}" },
        { id: "2", text: "FILE: src/cli.ts\n\n#!/usr/bin/env node" },
      ]),
    });

    const result = await onboardAgent(provider, "my-app", "agent-abc");

    expect(result).toContain("`src/core/onboard.ts`");
    expect(result).not.toContain("path/to/");
    expect(result).toContain("`src/cli.ts`");
    expect(result).not.toContain("lib/router/index.js");
  });
});
