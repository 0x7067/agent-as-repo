import { describe, expect, it, vi } from "vitest";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import { installInstructions } from "./agent-instructions.js";
import { INSTRUCTIONS_START_MARKER } from "../core/agent-instructions.js";

const fakeWatcherHandle = (): WatcherHandle => ({ close: () => {}, on: () => ({}) }) as WatcherHandle;

function makeFakeFs(files: Record<string, string> = {}): FileSystemPort & { store: Map<string, string> } {
  const store = new Map(Object.entries(files));
  return {
    store,
    readFile: (p) => {
      const v = store.get(p);
      if (v === undefined) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      return Promise.resolve(v);
    },
    writeFile: (p, d) => {
      store.set(p, d);
      return Promise.resolve();
    },
    stat: (p) => {
      const value = store.get(p);
      if (value !== undefined) return Promise.resolve({ size: value.length, isDirectory: () => false });
      return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    },
    access: (p) => {
      if (!store.has(p)) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      return Promise.resolve();
    },
    rename: (from, to) => {
      const v = store.get(from);
      if (v === undefined) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      store.delete(from);
      store.set(to, v);
      return Promise.resolve();
    },
    copyFile: (src, dest) => {
      const v = store.get(src);
      if (v === undefined) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      store.set(dest, v);
      return Promise.resolve();
    },
    glob: () => Promise.resolve([]),
    watch: fakeWatcherHandle,
  };
}

const REPO_PATH = "/repo";

describe("installInstructions", () => {
  it("creates AGENTS.md when neither CLAUDE.md nor AGENTS.md exists", async () => {
    const fs = makeFakeFs();

    const outcomes = await installInstructions({ repoPath: REPO_PATH, repoNames: ["my-app"] }, fs);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.path).toBe("/repo/AGENTS.md");
    expect(outcomes[0]?.action).toBe("created");
    expect(fs.store.get("/repo/AGENTS.md")).toContain(INSTRUCTIONS_START_MARKER);
    expect(fs.store.has("/repo/CLAUDE.md")).toBe(false);
  });

  it("updates both CLAUDE.md and AGENTS.md when both exist", async () => {
    const fs = makeFakeFs({
      "/repo/CLAUDE.md": "# Claude notes\n",
      "/repo/AGENTS.md": "# Agent notes\n",
    });

    const outcomes = await installInstructions({ repoPath: REPO_PATH, repoNames: ["my-app"] }, fs);

    expect(new Set(outcomes.map((o) => o.path))).toEqual(new Set(["/repo/AGENTS.md", "/repo/CLAUDE.md"]));
    expect(outcomes.every((o) => o.action === "updated")).toBe(true);
    expect(fs.store.get("/repo/CLAUDE.md")).toContain(INSTRUCTIONS_START_MARKER);
    expect(fs.store.get("/repo/CLAUDE.md")).toContain("# Claude notes");
    expect(fs.store.get("/repo/AGENTS.md")).toContain(INSTRUCTIONS_START_MARKER);
    expect(fs.store.get("/repo/AGENTS.md")).toContain("# Agent notes");
  });

  it("performs zero writes on a second run once the block is already installed", async () => {
    const fs = makeFakeFs({
      "/repo/CLAUDE.md": "# Claude notes\n",
    });
    const writeSpy = vi.spyOn(fs, "writeFile");

    await installInstructions({ repoPath: REPO_PATH, repoNames: ["my-app"] }, fs);
    writeSpy.mockClear();

    const outcomes = await installInstructions({ repoPath: REPO_PATH, repoNames: ["my-app"] }, fs);

    expect(writeSpy).not.toHaveBeenCalled();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.action).toBe("unchanged");
  });

  it("does not write when --dry-run is set, but still reports the pending action", async () => {
    const fs = makeFakeFs();
    const writeSpy = vi.spyOn(fs, "writeFile");

    const outcomes = await installInstructions({ repoPath: REPO_PATH, repoNames: ["my-app"], dryRun: true }, fs);

    expect(writeSpy).not.toHaveBeenCalled();
    expect(outcomes[0]?.action).toBe("created");
    expect(fs.store.has("/repo/AGENTS.md")).toBe(false);
  });

  it("removes the block with --remove and is a no-op when nothing is installed", async () => {
    const fs = makeFakeFs({
      "/repo/CLAUDE.md": "# Claude notes\n",
    });
    await installInstructions({ repoPath: REPO_PATH, repoNames: ["my-app"] }, fs);

    const outcomes = await installInstructions({ repoPath: REPO_PATH, repoNames: ["my-app"], remove: true }, fs);

    expect(outcomes[0]?.action).toBe("removed");
    expect(fs.store.get("/repo/CLAUDE.md")).not.toContain(INSTRUCTIONS_START_MARKER);
    expect(fs.store.get("/repo/CLAUDE.md")).toContain("# Claude notes");

    const noopOutcomes = await installInstructions({ repoPath: REPO_PATH, repoNames: ["my-app"], remove: true }, fs);
    expect(noopOutcomes[0]?.action).toBe("unchanged");
  });

  it("respects an explicit --file override, bypassing CLAUDE.md/AGENTS.md discovery", async () => {
    const fs = makeFakeFs({ "/repo/docs/CONTEXT.md": "# Context\n" });

    const outcomes = await installInstructions(
      { repoPath: REPO_PATH, repoNames: ["my-app"], filePath: "/repo/docs/CONTEXT.md" },
      fs,
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.path).toBe("/repo/docs/CONTEXT.md");
    expect(fs.store.get("/repo/docs/CONTEXT.md")).toContain(INSTRUCTIONS_START_MARKER);
    expect(fs.store.has("/repo/AGENTS.md")).toBe(false);
    expect(fs.store.has("/repo/CLAUDE.md")).toBe(false);
  });
});
