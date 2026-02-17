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

  it("requires key files with concrete file references", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt.toLowerCase()).toContain("file references");
    expect(prompt.toLowerCase()).toContain("top 10");
  });

  it("requires day-1 checklist and explicit unknowns", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt.toLowerCase()).toContain("day-1 checklist");
    expect(prompt.toLowerCase()).toContain("unknowns");
    expect(prompt.toLowerCase()).toContain("assumptions");
  });

  it("requires confidence and evidence boundaries", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt.toLowerCase()).toContain("confidence");
    expect(prompt.toLowerCase()).toContain("if you cannot find");
  });
});
