import { describe, it, expect } from "vitest";
import {
  buildPersona,
  architectureBootstrapPrompt,
  conventionsBootstrapPrompt,
  agenticSearchGuidance,
} from "./prompts.js";

const REPO_NAME = "my-app";
const ARCHIVAL_MEMORY = "archival_memory_search";

describe("buildPersona", () => {
  it("generates persona from repo name and description", () => {
    const persona = buildPersona(REPO_NAME, "A React Native mobile app");
    expect(persona).toContain(REPO_NAME);
    expect(persona).toContain("A React Native mobile app");
    expect(persona).toContain(ARCHIVAL_MEMORY);
    expect(persona).toContain("architecture and conventions memory blocks");
    expect(persona).toContain("Be specific");
    expect(persona).toContain("do NOT pass tags");
    expect(persona).toContain("path_prefix");
    // Persisted persona stays harness-friendly (no nested grep/glob/read).
    expect(persona).not.toContain("grep_repo");
  });

  it("uses custom persona instead of default when provided", () => {
    const custom = "I am the ultimate expert.";
    const persona = buildPersona(REPO_NAME, "desc", custom);
    expect(persona).toContain(custom);
    expect(persona).not.toContain(`codebase expert for the "${REPO_NAME}"`);
    expect(persona).toContain("do NOT pass tags");
  });

  it("joins lines with newline separator", () => {
    const persona = buildPersona(REPO_NAME, "desc");
    expect(persona).toContain("\n");
    const lines = persona.split("\n");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("includes naming tools and frameworks instruction", () => {
    const persona = buildPersona(REPO_NAME, "desc");
    expect(persona).toContain("exact tools, frameworks, and versions");
  });

  it("contains all required instruction lines", () => {
    const persona = buildPersona(REPO_NAME, "desc");
    expect(persona).toContain("first consult my architecture and conventions memory blocks");
    expect(persona).toContain("archival_memory_search");
    expect(persona).toContain("path_prefix");
  });

  it("instructs disclosure of tool failures instead of answering from prior knowledge", () => {
    const withDefault = buildPersona(REPO_NAME, "desc");
    const withCustom = buildPersona(REPO_NAME, "desc", "I am the ultimate expert.");
    for (const persona of [withDefault, withCustom]) {
      expect(persona).toContain("tool call fails");
      expect(persona.toLowerCase()).toContain("disclose");
      expect(persona).toContain("never answer from general knowledge");
    }
  });

  it("discloses a restricted index scope when basePath narrows it", () => {
    const withDefault = buildPersona(REPO_NAME, "desc", undefined, { indexedScope: "lib" });
    const withCustom = buildPersona(REPO_NAME, "desc", "I am the ultimate expert.", { indexedScope: "lib" });
    for (const persona of [withDefault, withCustom]) {
      expect(persona).toContain("`lib`");
      expect(persona).toContain("only the");
      expect(persona.toLowerCase()).toContain("not indexed");
    }
  });

  it("omits the scope disclosure when the whole repo is indexed", () => {
    const persona = buildPersona(REPO_NAME, "desc");
    expect(persona).not.toContain("only the");
    expect(persona.toLowerCase()).not.toContain("subtree");
  });

  it("includes the negative-space grounding rule even with a custom persona", () => {
    const withDefault = buildPersona(REPO_NAME, "desc");
    const withCustom = buildPersona(REPO_NAME, "desc", "I am the ultimate expert.");
    for (const persona of [withDefault, withCustom]) {
      expect(persona).toContain("does not appear to exist in this repository");
      expect(persona.toLowerCase()).toContain("no supporting evidence");
      expect(persona).toContain("Never describe");
    }
  });
});

describe("agenticSearchGuidance", () => {
  it("mentions live repo tools for standalone CLI", () => {
    const guidance = agenticSearchGuidance();
    expect(guidance).toContain("grep_repo");
    expect(guidance).toContain("glob_files");
    expect(guidance).toContain("read_file");
    expect(guidance).toContain("find_symbol");
    expect(guidance).toContain(ARCHIVAL_MEMORY);
  });

  it("carries the negative-space grounding rule (guards --fast/agentic asks too)", () => {
    const guidance = agenticSearchGuidance();
    expect(guidance).toContain("does not appear to exist in this repository");
    expect(guidance).toContain("Never describe");
  });

  it("carries the tool-failure disclosure rule (guards --fast/agentic asks too)", () => {
    const guidance = agenticSearchGuidance();
    expect(guidance).toContain("tool call fails");
    expect(guidance).toContain("never answer from general knowledge");
  });
});

describe("bootstrap prompts", () => {
  it("architecture prompt mentions archival memory search", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt).toContain(ARCHIVAL_MEMORY);
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

  it("architecture prompt warns against inventing unverified directories/files", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt.toLowerCase()).toContain("do not invent");
  });

  it("conventions prompt mentions archival memory search", () => {
    const prompt = conventionsBootstrapPrompt();
    expect(prompt).toContain(ARCHIVAL_MEMORY);
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
