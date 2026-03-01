import { describe, it, expect } from "vitest";
import { makeMockProvider } from "./mock-provider.js";

describe("makeMockProvider", () => {
  it("listPassages resolves to an empty array by default", async () => {
    const provider = makeMockProvider();
    const result = await provider.listPassages("agent-1");
    expect(result).toEqual([]);
  });

  it("storePassage resolves to 'passage-1' string by default", async () => {
    const provider = makeMockProvider();
    const id = await provider.storePassage("agent-1", "some text");
    expect(id).toBe("passage-1");
  });

  it("sendMessage resolves to 'Done.' string by default", async () => {
    const provider = makeMockProvider();
    const reply = await provider.sendMessage("agent-1", "hello");
    expect(reply).toBe("Done.");
  });

  it("getBlock resolves with value '' and limit 5000 by default", async () => {
    const provider = makeMockProvider();
    const block = await provider.getBlock("agent-1", "persona");
    expect(block.value).toBe("");
    expect(block.limit).toBe(5000);
  });

  it("overrides are applied over defaults", async () => {
    const provider = makeMockProvider({
      storePassage: async () => "custom-id",
    });
    const id = await provider.storePassage("agent-1", "text");
    expect(id).toBe("custom-id");
    // Other defaults remain
    const reply = await provider.sendMessage("agent-1", "hi");
    expect(reply).toBe("Done.");
  });
});
