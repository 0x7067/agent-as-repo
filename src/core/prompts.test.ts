import { describe, it, expect } from "vitest";
import {
  buildPersona,
  architectureBootstrapPrompt,
  conventionsBootstrapPrompt,
} from "./prompts.js";

describe("buildPersona", () => {
  it("generates persona from repo name and description", () => {
    const persona = buildPersona("my-app", "A React Native mobile app");
    expect(persona).toContain("my-app");
    expect(persona).toContain("archival memory");
    expect(persona).toContain("do NOT pass tags");
  });

  it("uses custom persona when provided", () => {
    const custom = "I am the ultimate expert.";
    const persona = buildPersona("my-app", "desc", custom);
    expect(persona).toContain(custom);
    expect(persona).toContain("do NOT pass tags");
  });
});

describe("bootstrap prompts", () => {
  it("architecture prompt mentions archival memory search", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt).toContain("archival memory");
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("memory_replace");
  });

  it("conventions prompt mentions archival memory search", () => {
    const prompt = conventionsBootstrapPrompt();
    expect(prompt).toContain("archival memory");
    expect(prompt).toContain("conventions");
    expect(prompt).toContain("memory_replace");
  });
});
