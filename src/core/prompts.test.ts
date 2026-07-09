import { describe, it, expect } from "vitest";
import {
  buildPersona,
  architectureBootstrapPrompt,
  conventionsBootstrapPrompt,
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
    expect(persona).toContain("grep_repo");
    expect(persona).toContain("glob_files");
    expect(persona).toContain("read_file");
  });

  it("uses custom persona instead of default when provided", () => {
    const custom = "I am the ultimate expert.";
    const persona = buildPersona(REPO_NAME, "desc", custom);
    expect(persona).toContain(custom);
    // Should NOT contain the default template
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
    expect(persona).toContain("grep_repo / glob_files / read_file");
    expect(persona).toContain("first consult my architecture and conventions memory blocks");
    expect(persona).toContain("archival_memory_search");
    expect(persona).toContain("path_prefix");
  });
});

describe("bootstrap prompts", () => {
  it("architecture prompt mentions archival memory search and live tools", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt).toContain(ARCHIVAL_MEMORY);
    expect(prompt).toContain("grep_repo");
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

  it("conventions prompt mentions archival memory search and live tools", () => {
    const prompt = conventionsBootstrapPrompt();
    expect(prompt).toContain(ARCHIVAL_MEMORY);
    expect(prompt).toContain("grep_repo");
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
