import { describe, it, expect } from "vitest";
import { formatExport, type ExportData } from "./export.js";

describe("formatExport", () => {
  it("formats blocks and file list as markdown", () => {
    const data: ExportData = {
      repoName: "my-app",
      agentId: "agent-abc",
      blocks: [
        { label: "persona", value: "I am a repo expert." },
        { label: "architecture", value: "Uses React with Redux." },
        { label: "conventions", value: "ESLint + Prettier." },
      ],
      files: ["src/index.ts", "src/app.tsx", "src/utils/auth.ts"],
    };

    const md = formatExport(data);

    expect(md).toContain("# my-app");
    expect(md).toContain("Agent: `agent-abc`");
    expect(md).toContain("## persona");
    expect(md).toContain("I am a repo expert.");
    expect(md).toContain("## architecture");
    expect(md).toContain("Uses React with Redux.");
    expect(md).toContain("## conventions");
    expect(md).toContain("ESLint + Prettier.");
    expect(md).toContain("## Files (3)");
    expect(md).toContain("- `src/index.ts`");
    expect(md).toContain("- `src/app.tsx`");
  });

  it("shows 0 files when list is empty", () => {
    const data: ExportData = {
      repoName: "my-app",
      agentId: "agent-abc",
      blocks: [],
      files: [],
    };

    const md = formatExport(data);

    expect(md).toContain("## Files (0)");
  });

  it("uses newline as line separator", () => {
    const data: ExportData = {
      repoName: "my-app",
      agentId: "agent-abc",
      blocks: [],
      files: [],
    };
    const md = formatExport(data);
    expect(md).toContain("\n");
  });

  it("formats heading with hash and repo name", () => {
    const md = formatExport({
      repoName: "test-repo",
      agentId: "a-1",
      blocks: [],
      files: [],
    });
    expect(md).toMatch(/^# test-repo/);
  });

  it("wraps agent id in backticks", () => {
    const md = formatExport({
      repoName: "r",
      agentId: "agent-xyz",
      blocks: [],
      files: [],
    });
    expect(md).toContain("Agent: `agent-xyz`");
  });

  it("wraps file paths in backticks with list marker", () => {
    const md = formatExport({
      repoName: "r",
      agentId: "a",
      blocks: [],
      files: ["src/a.ts", "src/b.ts"],
    });
    expect(md).toContain("- `src/a.ts`");
    expect(md).toContain("- `src/b.ts`");
  });

  it("has blank lines between sections (not replaced with non-blank)", () => {
    const data: ExportData = {
      repoName: "my-app",
      agentId: "agent-abc",
      blocks: [
        { label: "persona", value: "I am a repo expert." },
      ],
      files: ["src/index.ts"],
    };
    const md = formatExport(data);
    // Verify blank lines exist as separators
    expect(md).toContain("\n\n");
    // Between heading and agent
    expect(md).toMatch(/# my-app\n\nAgent:/);
    // Between agent and block header
    expect(md).toMatch(/agent-abc`\n\n## persona/);
  });

  it("blank lines in block sections are truly empty (not 'Stryker was here!')", () => {
    // Catches: "" → "Stryker was here!" on lines.push(header, "", value, "")
    const data: ExportData = {
      repoName: "r",
      agentId: "a",
      blocks: [{ label: "arch", value: "Uses MVC." }],
      files: ["f.ts"],
    };
    const md = formatExport(data);
    const lines = md.split("\n");
    // Find line indices with "## arch" and the value
    const headerIdx = lines.findIndex((l) => l === "## arch");
    expect(headerIdx).toBeGreaterThan(-1);
    // Line after "## arch" should be empty (blank separator)
    expect(lines[headerIdx + 1]).toBe("");
    // Line after value should also be empty
    const valueIdx = lines.indexOf("Uses MVC.");
    expect(valueIdx).toBeGreaterThan(-1);
    expect(lines[valueIdx + 1]).toBe("");
  });

  it("blank line before files section is truly empty", () => {
    // Catches: "" → "Stryker was here!" on lines.push(filesHeader, "")
    const data: ExportData = {
      repoName: "r",
      agentId: "a",
      blocks: [],
      files: ["f.ts"],
    };
    const md = formatExport(data);
    const lines = md.split("\n");
    const filesIdx = lines.findIndex((l) => l.startsWith("## Files"));
    expect(filesIdx).toBeGreaterThan(-1);
    // Line after files header should be empty
    expect(lines[filesIdx + 1]).toBe("");
  });
});
