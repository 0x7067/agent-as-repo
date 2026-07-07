import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveRepoExpertDataDir, resolveStoreDbPath } from "./repo-expert-paths.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveRepoExpertDataDir", () => {
  it("uses REPO_EXPERT_DATA_DIR when writable", () => {
    const cwd = makeTempDir("repo-expert-paths-");
    const dataDir = path.join(cwd, "custom-data");

    const result = resolveRepoExpertDataDir({
      cwd,
      homeDir: "/dev/null",
      env: { REPO_EXPERT_DATA_DIR: dataDir },
    });

    expect(result).toBe(dataDir);
  });

  it("prefers ~/.repo-expert when no env override is set", () => {
    const home = makeTempDir("repo-expert-home-");
    const cwd = makeTempDir("repo-expert-cwd-");

    const result = resolveRepoExpertDataDir({ cwd, homeDir: home, env: {} });

    expect(result).toBe(path.join(home, ".repo-expert"));
  });

  it("falls back to a project-local directory when env and home candidates are not writable", () => {
    const cwd = makeTempDir("repo-expert-paths-");
    const expected = path.join(cwd, ".repo-expert");

    const result = resolveRepoExpertDataDir({
      cwd,
      homeDir: "/dev/null",
      env: { REPO_EXPERT_DATA_DIR: "/dev/null/not-writable" },
    });

    expect(result).toBe(expected);
  });

  it("creates the resolved data directory with mode 0o700 (private to owner)", () => {
    const home = makeTempDir("repo-expert-home-perm-");
    const dataDir = path.join(home, ".repo-expert");

    resolveRepoExpertDataDir({ cwd: home, homeDir: home, env: {} });

    // dataDir is derived from a mkdtemp-created temp directory for this test run.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const mode = statSync(dataDir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("throws when all candidates are not writable", () => {
    expect(() =>
      resolveRepoExpertDataDir({
        cwd: "/dev/null",
        homeDir: "/dev/null",
        env: { REPO_EXPERT_DATA_DIR: "/dev/null/not-writable" },
      }),
    ).toThrow("Unable to find a writable repo-expert data directory");
  });
});

describe("resolveStoreDbPath", () => {
  it("returns store.db inside the resolved data directory", () => {
    const home = makeTempDir("repo-expert-home-");

    const result = resolveStoreDbPath({ cwd: home, homeDir: home, env: {} });

    expect(result).toBe(path.join(home, ".repo-expert", "store.db"));
  });
});
