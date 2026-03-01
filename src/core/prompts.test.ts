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
    expect(persona).toContain("A React Native mobile app");
    expect(persona).toContain("archival memory");
    expect(persona).toContain("architecture and conventions memory blocks");
    expect(persona).toContain("Be specific");
    expect(persona).toContain("do NOT pass tags");
  });

  it("uses custom persona instead of default when provided", () => {
    const custom = "I am the ultimate expert.";
    const persona = buildPersona("my-app", "desc", custom);
    expect(persona).toContain(custom);
    // Should NOT contain the default template
    expect(persona).not.toContain('codebase expert for the "my-app"');
    expect(persona).toContain("do NOT pass tags");
  });

  it("joins lines with newline separator", () => {
    const persona = buildPersona("my-app", "desc");
    expect(persona).toContain("\n");
    const lines = persona.split("\n");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("includes cross-repo instruction when cross-agent tools are configured", () => {
    const persona = buildPersona("my-app", "A mobile app", undefined, [
      "send_message_to_agents_matching_tags",
    ]);
    expect(persona).toContain("query other repo-expert agents");
    expect(persona).toContain("send_message_to_agents_matching_tags");
  });

  it("includes cross-repo instruction for wait_for_reply tool", () => {
    const persona = buildPersona("my-app", "A mobile app", undefined, [
      "send_message_to_agent_and_wait_for_reply",
    ]);
    expect(persona).toContain("query other repo-expert agents");
  });

  it("omits cross-repo instruction when no cross-agent tools configured", () => {
    const persona = buildPersona("my-app", "A mobile app");
    expect(persona).not.toContain("query other repo-expert agents");
  });

  it("omits cross-repo instruction when tools is empty", () => {
    const persona = buildPersona("my-app", "A mobile app", undefined, []);
    expect(persona).not.toContain("query other repo-expert agents");
  });

  it("omits cross-repo instruction when tools has no messaging tools", () => {
    const persona = buildPersona("my-app", "A mobile app", undefined, ["some_other_tool"]);
    expect(persona).not.toContain("query other repo-expert agents");
  });

  it("includes naming tools and frameworks instruction", () => {
    const persona = buildPersona("my-app", "desc");
    expect(persona).toContain("exact tools, frameworks, and versions");
  });

  it("contains all required instruction lines", () => {
    const persona = buildPersona("my-app", "desc");
    expect(persona).toContain("All project source files are stored in my archival memory");
    expect(persona).toContain("first consult my architecture and conventions memory blocks");
    expect(persona).toContain("then search archival memory");
  });
});

describe("bootstrap prompts", () => {
  it("architecture prompt mentions archival memory search", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt).toContain("archival memory");
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("memory_replace");
  });

  it("architecture prompt includes required content areas", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt).toContain("Project name and purpose");
    expect(prompt).toContain("Directory structure");
    expect(prompt).toContain("Key architectural patterns");
    expect(prompt).toContain("Technology stack");
    expect(prompt).toContain("How components interact");
    expect(prompt).toContain("under 4000 chars");
  });

  it("architecture prompt warns about tags", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt).toContain("Do NOT pass tags");
  });

  it("architecture prompt joins with newlines", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt).toContain("\n");
  });

  it("conventions prompt mentions archival memory search", () => {
    const prompt = conventionsBootstrapPrompt();
    expect(prompt).toContain("archival memory");
    expect(prompt).toContain("conventions");
    expect(prompt).toContain("memory_replace");
  });

  it("conventions prompt includes required content areas", () => {
    const prompt = conventionsBootstrapPrompt();
    expect(prompt).toContain("Key dependencies");
    expect(prompt).toContain("Coding conventions");
    expect(prompt).toContain("Configuration approach");
    expect(prompt).toContain("CLI design");
    expect(prompt).toContain("Update your 'conventions' memory block");
  });

  it("conventions prompt warns about tags", () => {
    const prompt = conventionsBootstrapPrompt();
    expect(prompt).toContain("Do NOT pass tags");
  });

  it("conventions prompt joins with newlines", () => {
    const prompt = conventionsBootstrapPrompt();
    expect(prompt).toContain("\n");
  });
});
