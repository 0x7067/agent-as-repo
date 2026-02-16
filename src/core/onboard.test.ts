import { describe, it, expect } from "vitest";
import { buildOnboardPrompt } from "./onboard.js";

describe("buildOnboardPrompt", () => {
  it("includes repo name in the prompt", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt).toContain("my-app");
  });

  it("asks for architecture overview", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt.toLowerCase()).toContain("architecture");
  });

  it("asks for getting started steps", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt.toLowerCase()).toContain("getting started");
  });
});
