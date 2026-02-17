import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as readline from "readline/promises";
import { runInit } from "./init.js";

interface MockRl extends Pick<readline.Interface, "question"> {}

function makeRl(answers: string[]): MockRl {
  return {
    question: vi.fn(async () => answers.shift() ?? ""),
  };
}

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalApiKey = process.env.LETTA_API_KEY;

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.chdir(originalCwd);
  process.env.LETTA_API_KEY = originalApiKey;
  process.exitCode = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe.sequential("runInit", () => {
  it("fails when repo path is not a git repository", async () => {
    const workspace = await makeTempDir("init-workspace-");
    const repoDir = path.join(workspace, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "src.ts"), "export const x = 1;\n", "utf-8");

    process.chdir(workspace);
    process.env.LETTA_API_KEY = "test-key";
    const rl = makeRl([repoDir]) as unknown as readline.Interface;

    await expect(runInit(rl)).rejects.toThrow("Not a git repository");
    expect(process.exitCode).toBe(1);
  });

  it("fails when no code extensions are detected", async () => {
    const workspace = await makeTempDir("init-workspace-");
    const repoDir = path.join(workspace, "repo");
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "image.png"), "not-really-a-png", "utf-8");

    process.chdir(workspace);
    process.env.LETTA_API_KEY = "test-key";
    const rl = makeRl([repoDir]) as unknown as readline.Interface;

    await expect(runInit(rl)).rejects.toThrow("No code files detected");
    expect(process.exitCode).toBe(1);
  });

  it("writes config.yaml for a valid git repository", async () => {
    const workspace = await makeTempDir("init-workspace-");
    const repoDir = path.join(workspace, "repo");
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "index.ts"), "export const ready = true;\n", "utf-8");

    process.chdir(workspace);
    process.env.LETTA_API_KEY = "test-key";
    const rl = makeRl([repoDir, "", "y"]) as unknown as readline.Interface;

    const result = await runInit(rl);
    expect(result.repoName).toBe("repo");
    const configPath = path.join(workspace, "config.yaml");
    const config = await fs.readFile(configPath, "utf-8");
    expect(config).toContain("repo:");
    expect(config).toContain(".ts");
  });
});
