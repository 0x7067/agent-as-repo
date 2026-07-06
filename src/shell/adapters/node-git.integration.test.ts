import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { nodeGit } from "./node-git.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-git-integration-"));
  tempDirs.push(dir);
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["init", "-q"], { cwd: dir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

async function commitFile(dir: string, name: string, contents: string, message: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp dir under test
  await fs.writeFile(path.join(dir, name), contents);
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["add", name], { cwd: dir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
}

describe("nodeGit adapter against a real temp git repo", () => {
  it("commitExists returns true for a real commit and false for a bogus sha", async () => {
    const dir = await makeTempRepo();
    const sha = await commitFile(dir, "a.txt", "hello", "initial commit");
    expect(nodeGit.commitExists(dir, sha)).toBe(true);
    expect(nodeGit.commitExists(dir, "0000000000000000000000000000000000000000")).toBe(false);
  });

  it("commitExists returns false for a nonexistent cwd", () => {
    expect(nodeGit.commitExists("/nonexistent-path-xyz-does-not-exist", "abc123")).toBe(false);
  });

  it("commitExists returns false for a malformed sha", async () => {
    const dir = await makeTempRepo();
    await commitFile(dir, "a.txt", "hello", "initial commit");
    expect(nodeGit.commitExists(dir, "not-a-sha")).toBe(false);
  });

  it("logNameStatus returns real name-status log content for a range source", async () => {
    const dir = await makeTempRepo();
    const firstSha = await commitFile(dir, "a.txt", "hello", "add a.txt");
    await commitFile(dir, "b.txt", "world", "add b.txt");

    const log = nodeGit.logNameStatus(dir, { kind: "range", from: firstSha });

    expect(log).toContain("add b.txt");
    expect(log).toContain("A\tb.txt");
    expect(log).not.toContain("add a.txt");
  });

  it("logNameStatus returns all commits for a since source covering full history", async () => {
    const dir = await makeTempRepo();
    await commitFile(dir, "a.txt", "hello", "add a.txt");
    await commitFile(dir, "b.txt", "world", "add b.txt");

    const log = nodeGit.logNameStatus(dir, { kind: "since", date: "2000-01-01" });

    expect(log).toContain("add a.txt");
    expect(log).toContain("add b.txt");
  });

  it("logNameStatus respects the max-count for a recent source", async () => {
    const dir = await makeTempRepo();
    await commitFile(dir, "a.txt", "hello", "add a.txt");
    await commitFile(dir, "b.txt", "world", "add b.txt");
    await commitFile(dir, "c.txt", "!", "add c.txt");

    const log = nodeGit.logNameStatus(dir, { kind: "recent", count: 2 });

    expect(log).toContain("add c.txt");
    expect(log).toContain("add b.txt");
    expect(log).not.toContain("add a.txt");
  });

  it("logNameStatus returns empty string for a nonexistent cwd", () => {
    expect(nodeGit.logNameStatus("/nonexistent-path-xyz-does-not-exist", { kind: "recent", count: 20 })).toBe("");
  });

  it("logNameStatus returns empty string for a range with a bogus from-ref", async () => {
    const dir = await makeTempRepo();
    await commitFile(dir, "a.txt", "hello", "add a.txt");
    expect(nodeGit.logNameStatus(dir, { kind: "range", from: "0000000000000000000000000000000000000000" })).toBe("");
  });

  it("logFileNamesSince returns real name-only paths covering full history", async () => {
    const dir = await makeTempRepo();
    await commitFile(dir, "a.txt", "hello", "add a.txt");
    await commitFile(dir, "b.txt", "world", "add b.txt");

    const log = nodeGit.logFileNamesSince(dir, "2000-01-01");

    expect(log).toContain("a.txt");
    expect(log).toContain("b.txt");
    expect(log).not.toContain("add a.txt"); // --pretty=format: omits commit subjects
  });

  it("logFileNamesSince returns empty string for a nonexistent cwd", () => {
    expect(nodeGit.logFileNamesSince("/nonexistent-path-xyz-does-not-exist", "2000-01-01")).toBe("");
  });
});
