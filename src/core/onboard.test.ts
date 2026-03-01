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

  it("joins lines with newline separator", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt).toContain("\n");
  });

  it("includes all numbered sections", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt).toContain("1.");
    expect(prompt).toContain("2.");
    expect(prompt).toContain("3.");
    expect(prompt).toContain("4.");
    expect(prompt).toContain("5.");
    expect(prompt).toContain("6.");
    expect(prompt).toContain("7.");
    expect(prompt).toContain("8.");
  });

  it("asks for common workflows", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt.toLowerCase()).toContain("common workflows");
  });

  it("requests archival memory search", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt.toLowerCase()).toContain("archival memory");
    expect(prompt).toContain("Search your archival memory");
  });

  it("contains structured onboarding walkthrough line", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt).toContain("structured onboarding walkthrough");
  });

  it("contains file reference format instruction", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt).toContain("Use file references in this format");
    expect(prompt).toContain("path/to/file.ts");
  });

  it("contains evidence boundary instruction", () => {
    const prompt = buildOnboardPrompt("my-app");
    expect(prompt).toContain("instead of guessing");
  });

  it("has blank line separators (empty strings produce actual blank lines)", () => {
    const prompt = buildOnboardPrompt("my-app");
    // Must have \n\n (blank line) — not replaced with non-blank
    expect(prompt).toContain("\n\n");
    // Verify the blank lines are truly empty — split and check specific lines
    const lines = prompt.split("\n");
    // Find lines that are between numbered sections: after "...archival memory." and before "1."
    // And between "8." section and "Use file references"
    // Line 5 (after "...archival memory.") and line 14 (after "8.") are ""
    // With mutation: they become "Stryker was here!" which is non-empty
    const emptyLines = lines.filter((l) => l === "");
    // There should be at least 2 blank lines (the two "" entries in the array)
    expect(emptyLines.length).toBeGreaterThanOrEqual(2);
    // No line should contain "Stryker" (catches the mutation)
    for (const line of lines) {
      expect(line).not.toContain("Stryker");
    }
  });

  it("uses different repo name in output", () => {
    const prompt = buildOnboardPrompt("other-repo");
    expect(prompt).toContain("other-repo");
    expect(prompt).not.toContain("my-app");
  });
});
