import { describe, it, expect } from "vitest";
import { loadConfig } from "./config-loader.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { FileSystemPort } from "../ports/filesystem.js";

async function withTempConfig(yamlContent: string, fn: (filePath: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
  const filePath = path.join(dir, "config.yaml");
  await fs.writeFile(filePath, yamlContent, "utf-8");
  try {
    await fn(filePath);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

const validYaml = `
letta:
  model: openai/gpt-4.1
  embedding: openai/text-embedding-3-small

repos:
  my-app:
    path: /home/user/repos/my-app
    description: My application
    extensions: [.ts, .tsx]
    ignore_dirs: [node_modules, .git]
    tags: [frontend]
`;

describe("loadConfig", () => {
  it("loads and parses a valid YAML config file", async () => {
    await withTempConfig(validYaml, async (filePath) => {
      const config = await loadConfig(filePath);
      expect(config.letta.model).toBe("openai/gpt-4.1");
      expect(config.repos["my-app"].extensions).toEqual([".ts", ".tsx"]);
    });
  });

  it("throws on non-existent file", async () => {
    await expect(loadConfig("/tmp/nonexistent-config-xyz.yaml")).rejects.toThrow();
  });

  it("throws on invalid YAML content", async () => {
    await withTempConfig("{{invalid yaml", async (filePath) => {
      await expect(loadConfig(filePath)).rejects.toThrow();
    });
  });

  it("throws on valid YAML but invalid schema", async () => {
    await withTempConfig("foo: bar", async (filePath) => {
      await expect(loadConfig(filePath)).rejects.toThrow();
    });
  });

  it("resolves tilde paths to absolute paths", async () => {
    const yamlWithTilde = `
letta:
  model: openai/gpt-4.1
  embedding: openai/text-embedding-3-small

repos:
  my-app:
    path: ~/repos/my-app
    description: My application
    extensions: [.ts]
    ignore_dirs: [node_modules]
`;
    await withTempConfig(yamlWithTilde, async (filePath) => {
      const config = await loadConfig(filePath);
      const resolvedPath = config.repos["my-app"].path;
      expect(resolvedPath).not.toContain("~");
      expect(path.isAbsolute(resolvedPath)).toBe(true);
      expect(resolvedPath).toBe(path.join(os.homedir(), "repos/my-app"));
    });
  });

  it("accepts injected FileSystemPort", async () => {
    const mockFs: FileSystemPort = {
      readFile: async () => validYaml,
      writeFile: async () => {},
      stat: async () => ({ size: 0, isDirectory: () => false }),
      access: async () => {},
      rename: async () => {},
      copyFile: async () => {},
      glob: async () => [],
    };

    const config = await loadConfig("/fake/config.yaml", mockFs);
    expect(config.letta.model).toBe("openai/gpt-4.1");
    expect(config.repos["my-app"]).toBeDefined();
  });

  it("resolves relative paths to absolute paths", async () => {
    const yamlWithRelative = `
letta:
  model: openai/gpt-4.1
  embedding: openai/text-embedding-3-small

repos:
  my-app:
    path: ./repos/my-app
    description: My application
    extensions: [.ts]
    ignore_dirs: [node_modules]
`;
    await withTempConfig(yamlWithRelative, async (filePath) => {
      const config = await loadConfig(filePath);
      expect(path.isAbsolute(config.repos["my-app"].path)).toBe(true);
    });
  });
});
