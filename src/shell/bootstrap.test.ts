import { describe, it, expect, vi } from "vitest";
import { bootstrapAgent } from "./bootstrap.js";
import { makeMockProvider } from "./__test__/mock-provider.js";

describe("bootstrapAgent", () => {
  it("sends architecture and conventions bootstrap prompts", async () => {
    const provider = makeMockProvider();
    await bootstrapAgent(provider, "agent-123");
    expect(provider.sendMessage as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);

    expect((provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("agent-123");
    expect((provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1]).toContain("architecture");

    expect((provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[1][1]).toContain("conventions");
  });

  it("grounds the architecture and conventions blocks against the indexed passages after bootstrap", async () => {
    const blocks: Record<string, string> = {
      architecture: [
        "This project has a `/tests` and `/middleware` directory.",
        "Routing lives in `src/router.ts`.",
        "Also see `lib/router/index.js` for internals.",
      ].join("\n"),
      conventions: "Config is loaded from `config/settings.ts`.",
    };
    const provider = makeMockProvider({
      listPassages: vi.fn().mockResolvedValue([
        { id: "1", text: "FILE: src/router.ts\n\nexport const router = {};" },
        { id: "2", text: "FILE: config/settings.ts\n\nexport const settings = {};" },
      ]),
      getBlock: vi.fn().mockImplementation((_agentId: string, label: string) =>
        Promise.resolve({ value: blocks[label] ?? "", limit: 5000 }),
      ),
      updateBlock: vi.fn().mockImplementation(
        (_agentId: string, label: string, value: string) => {
          blocks[label] = value;
          return Promise.resolve({ value, limit: 5000 });
        },
      ),
    });

    await bootstrapAgent(provider, "agent-123");

    const updateBlockMock = provider.updateBlock as ReturnType<typeof vi.fn>;
    const architectureCall = updateBlockMock.mock.calls.find((call) => call[1] === "architecture");
    expect(architectureCall).toBeDefined();
    const groundedArchitecture = architectureCall?.[2] as string;
    expect(groundedArchitecture).toContain("`src/router.ts`");
    expect(groundedArchitecture).not.toContain("lib/router/index.js");
    // Directory-only claims are left alone — this fix only grounds concrete files.
    expect(groundedArchitecture).toContain("/tests");

    // Conventions block already fully resolves — no rewrite needed.
    const conventionsCall = updateBlockMock.mock.calls.find((call) => call[1] === "conventions");
    expect(conventionsCall).toBeUndefined();
  });
});
