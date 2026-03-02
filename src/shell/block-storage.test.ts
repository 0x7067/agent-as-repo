import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBlockStorage } from "./block-storage.js";

describe("FilesystemBlockStorage", () => {
  let tmpDir: string;
  let storage: FilesystemBlockStorage;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "block-storage-test-"));
    storage = new FilesystemBlockStorage(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("get", () => {
    it("returns empty string when block does not exist", () => {
      expect(storage.get("agent1", "persona")).toBe("");
    });

    it("returns stored value after set", () => {
      storage.set("agent1", "persona", "I am a persona");
      expect(storage.get("agent1", "persona")).toBe("I am a persona");
    });

    it("is scoped per agentId", () => {
      storage.set("agent1", "persona", "agent1 persona");
      storage.set("agent2", "persona", "agent2 persona");
      expect(storage.get("agent1", "persona")).toBe("agent1 persona");
      expect(storage.get("agent2", "persona")).toBe("agent2 persona");
    });
  });

  describe("set", () => {
    it("creates parent directories as needed", () => {
      storage.set("new-agent", "conventions", "some conventions");
      expect(storage.get("new-agent", "conventions")).toBe("some conventions");
    });

    it("overwrites existing value", () => {
      storage.set("agent1", "architecture", "old value");
      storage.set("agent1", "architecture", "new value");
      expect(storage.get("agent1", "architecture")).toBe("new value");
    });
  });

  describe("init", () => {
    it("writes all provided blocks", () => {
      storage.init("agent1", {
        persona: "I am the persona",
        architecture: "Not yet analyzed.",
        conventions: "Not yet analyzed.",
      });
      expect(storage.get("agent1", "persona")).toBe("I am the persona");
      expect(storage.get("agent1", "architecture")).toBe("Not yet analyzed.");
      expect(storage.get("agent1", "conventions")).toBe("Not yet analyzed.");
    });

    it("creates agent directory if it does not exist", () => {
      storage.init("brand-new-agent", { persona: "hello" });
      expect(storage.get("brand-new-agent", "persona")).toBe("hello");
    });
  });

  describe("delete", () => {
    it("removes all blocks for the agent", () => {
      storage.init("agent1", { persona: "data", architecture: "data" });
      storage.delete("agent1");
      expect(storage.get("agent1", "persona")).toBe("");
      expect(storage.get("agent1", "architecture")).toBe("");
    });

    it("does not throw when agent does not exist", () => {
      expect(() => storage.delete("nonexistent")).not.toThrow();
    });
  });
});
