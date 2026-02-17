import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { checkApiKey, checkConfigFile, runAllChecks, runDoctorFixes } from "./doctor.js";

const tempDirs: string[] = [];
const originalApiKey = process.env.LETTA_API_KEY;
const originalCwd = process.cwd();

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.chdir(originalCwd);
  process.env.LETTA_API_KEY = originalApiKey;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("doctor shell checks", () => {
  it("checkApiKey fails when LETTA_API_KEY is missing", async () => {
    delete process.env.LETTA_API_KEY;
    const result = await checkApiKey();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("LETTA_API_KEY");
  });

  it("checkApiKey passes when LETTA_API_KEY is set", async () => {
    process.env.LETTA_API_KEY = "test-key";
    const result = await checkApiKey();
    expect(result.status).toBe("pass");
  });

  it("checkConfigFile reports missing config", async () => {
    const missingPath = path.join(await makeTempDir("doctor-"), "missing.yaml");
    const result = await checkConfigFile(missingPath);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("not found");
  });

  it("runAllChecks includes config and git checks when config exists", async () => {
    const tempDir = await makeTempDir("doctor-");
    const repoDir = path.join(tempDir, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    const configPath = path.join(tempDir, "config.yaml");
    const config = [
      "letta:",
      "  model: openai/gpt-4.1",
      "  embedding: openai/text-embedding-3-small",
      "repos:",
      "  my-app:",
      `    path: ${repoDir}`,
      "    description: test repo",
      "    extensions: [.ts]",
      "    ignore_dirs: [node_modules, .git]",
    ].join("\n");
    await fs.writeFile(configPath, config, "utf-8");

    delete process.env.LETTA_API_KEY;
    const results = await runAllChecks(null, configPath);
    const names = results.map((r) => r.name);
    expect(names).toContain("API key");
    expect(names).toContain("Config file");
    expect(names).toContain("Git");
    expect(names).toContain('Repo "my-app"');
  });

  it("runDoctorFixes creates missing config, env, and state", async () => {
    const tempDir = await makeTempDir("doctor-fix-");
    process.chdir(tempDir);
    const configPath = path.join(tempDir, "config.yaml");
    await fs.writeFile(path.join(tempDir, "config.example.yaml"), "repos: {}\nletta:\n  model: x\n  embedding: y\n", "utf-8");

    const result = await runDoctorFixes(configPath);

    expect(result.applied.some((line) => line.includes(".env"))).toBe(true);
    expect(result.applied.some((line) => line.includes("config.example.yaml"))).toBe(true);
    expect(result.applied.some((line) => line.includes(".repo-expert-state.json"))).toBe(true);

    await expect(fs.access(path.join(tempDir, ".env"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, "config.yaml"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, ".repo-expert-state.json"))).resolves.toBeUndefined();
  });
});
