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
});
