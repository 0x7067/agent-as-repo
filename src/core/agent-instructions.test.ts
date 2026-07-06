import { describe, expect, it } from "vitest";
import {
  renderInstructionsBlock,
  removeInstructionsBlock,
  spliceInstructionsBlock,
  INSTRUCTIONS_START_MARKER,
  INSTRUCTIONS_END_MARKER,
} from "./agent-instructions.js";

describe("renderInstructionsBlock", () => {
  it("wraps the block in start/end markers", () => {
    const block = renderInstructionsBlock({ repoNames: ["my-app"] });
    expect(block.startsWith(INSTRUCTIONS_START_MARKER)).toBe(true);
    expect(block.endsWith(INSTRUCTIONS_END_MARKER)).toBe(true);
  });

  it("lists the given repo names", () => {
    const block = renderInstructionsBlock({ repoNames: ["my-app", "other-repo"] });
    expect(block).toContain("Indexed repos: my-app, other-repo");
  });

  it("mentions the repo-expert MCP server and its tool names", () => {
    const block = renderInstructionsBlock({ repoNames: ["my-app"] });
    expect(block).toContain("repo-expert");
    expect(block).toContain("agent_call");
    expect(block).toContain("agent_search_archival");
  });
});

describe("spliceInstructionsBlock", () => {
  const block = renderInstructionsBlock({ repoNames: ["my-app"] });

  it("appends the block to null (no file) content", () => {
    const result = spliceInstructionsBlock(null, block);
    expect(result.changed).toBe(true);
    expect(result.content).toBe(`${block}\n`);
    expect(result.warning).toBeUndefined();
  });

  it("appends the block to empty content", () => {
    const result = spliceInstructionsBlock("", block);
    expect(result.changed).toBe(true);
    expect(result.content).toBe(`${block}\n`);
  });

  it("appends the block with a separating blank line when content exists and has no markers", () => {
    const result = spliceInstructionsBlock("# My Repo\n\nSome docs.\n", block);
    expect(result.changed).toBe(true);
    expect(result.content).toBe(`# My Repo\n\nSome docs.\n\n${block}\n`);
  });

  it("replaces an existing block between markers, leaving surrounding content intact", () => {
    const oldBlock = renderInstructionsBlock({ repoNames: ["old-repo"] });
    const existing = `# My Repo\n\n${oldBlock}\n\nMore docs.\n`;
    const result = spliceInstructionsBlock(existing, block);
    expect(result.changed).toBe(true);
    expect(result.content).toBe(`# My Repo\n\n${block}\n\nMore docs.\n`);
    expect(result.content).not.toContain("old-repo");
  });

  it("reports changed: false when the result is identical to the input", () => {
    const existing = `# My Repo\n\n${block}\n\nMore docs.\n`;
    const result = spliceInstructionsBlock(existing, block);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(existing);
  });

  it("replaces through EOF and warns when the start marker has no matching end marker", () => {
    const malformed = `# My Repo\n\n${INSTRUCTIONS_START_MARKER}\nstray content with no end marker\n`;
    const result = spliceInstructionsBlock(malformed, block);
    expect(result.changed).toBe(true);
    expect(result.content).toBe(`# My Repo\n\n${block}\n`);
    expect(result.warning).toBeDefined();
  });

  it("never duplicates the block across repeated splices", () => {
    const first = spliceInstructionsBlock(null, block);
    const second = spliceInstructionsBlock(first.content, block);
    expect(second.changed).toBe(false);
    const occurrences = second.content.split(INSTRUCTIONS_START_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("round-trips to a no-op: splice(splice(x).content) === splice(x).content", () => {
    const existing = "# My Repo\n\nSome docs.\n";
    const once = spliceInstructionsBlock(existing, block);
    const twice = spliceInstructionsBlock(once.content, block);
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once.content);
  });
});

describe("removeInstructionsBlock", () => {
  const block = renderInstructionsBlock({ repoNames: ["my-app"] });

  it("is a no-op when there is no existing block", () => {
    const result = removeInstructionsBlock("# My Repo\n\nSome docs.\n");
    expect(result.changed).toBe(false);
    expect(result.content).toBe("# My Repo\n\nSome docs.\n");
  });

  it("is a no-op on null content", () => {
    const result = removeInstructionsBlock(null);
    expect(result.changed).toBe(false);
    expect(result.content).toBe("");
  });

  it("removes an existing block, leaving surrounding content intact", () => {
    const existing = `# My Repo\n\n${block}\n\nMore docs.\n`;
    const result = removeInstructionsBlock(existing);
    expect(result.changed).toBe(true);
    expect(result.content).toBe("# My Repo\n\nMore docs.\n");
    expect(result.content).not.toContain(INSTRUCTIONS_START_MARKER);
  });

  it("removes a block that is the only content", () => {
    const existing = `${block}\n`;
    const result = removeInstructionsBlock(existing);
    expect(result.changed).toBe(true);
    expect(result.content).toBe("");
  });

  it("round-trips to a no-op: remove(remove(x).content) === remove(x).content", () => {
    const existing = `# My Repo\n\n${block}\n\nMore docs.\n`;
    const once = removeInstructionsBlock(existing);
    const twice = removeInstructionsBlock(once.content);
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once.content);
  });
});
