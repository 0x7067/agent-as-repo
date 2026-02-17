import { describe, it, expect } from "vitest";
import {
  detectExtensions,
  suggestIgnoreDirs,
  detectRepoName,
  generateConfigYaml,
} from "./init.js";

describe("detectExtensions", () => {
  it("returns top extensions sorted by frequency", () => {
    const files = [
      "src/index.ts",
      "src/app.ts",
      "src/utils.ts",
      "src/app.test.ts",
      "src/style.css",
      "package.json",
      "README.md",
    ];
    const result = detectExtensions(files);
    expect(result[0]).toBe(".ts");
    expect(result).toContain(".css");
    expect(result).toContain(".json");
    expect(result).toContain(".md");
  });

  it("caps at maxCount", () => {
    const files = [
      "a.ts",
      "b.js",
      "c.py",
      "d.rb",
      "e.go",
      "f.rs",
      "g.java",
    ];
    const result = detectExtensions(files, 3);
    expect(result).toHaveLength(3);
  });

  it("returns empty for empty input", () => {
    expect(detectExtensions([])).toEqual([]);
  });

  it("ignores files without extensions", () => {
    const files = ["Makefile", "Dockerfile", "src/main.ts"];
    const result = detectExtensions(files);
    expect(result).toEqual([".ts"]);
  });

  it("excludes known non-code extensions", () => {
    const files = [
      "icon.png",
      "photo.jpg",
      "font.woff2",
      "archive.zip",
      "src/app.ts",
    ];
    const result = detectExtensions(files);
    expect(result).toEqual([".ts"]);
  });
});

describe("suggestIgnoreDirs", () => {
  it("returns common dirs found in file paths", () => {
    const files = [
      "node_modules/foo/index.js",
      "src/index.ts",
      ".git/HEAD",
      "dist/bundle.js",
    ];
    const result = suggestIgnoreDirs(files);
    expect(result).toContain("node_modules");
    expect(result).toContain(".git");
    expect(result).toContain("dist");
    expect(result).not.toContain("src");
  });

  it("returns empty when no known dirs found", () => {
    const files = ["src/index.ts", "lib/utils.ts"];
    expect(suggestIgnoreDirs(files)).toEqual([]);
  });
});

describe("detectRepoName", () => {
  it("extracts basename from absolute path", () => {
    expect(detectRepoName("/Users/dev/projects/my-app")).toBe("my-app");
  });

  it("handles trailing slash", () => {
    expect(detectRepoName("/Users/dev/my-app/")).toBe("my-app");
  });

  it("handles home-relative path", () => {
    expect(detectRepoName("~/repos/backend")).toBe("backend");
  });
});

describe("generateConfigYaml", () => {
  it("produces valid YAML with repo config", () => {
    const yaml = generateConfigYaml({
      repoName: "my-app",
      repoPath: "~/repos/my-app",
      description: "React Native mobile app",
      extensions: [".ts", ".tsx", ".js"],
      ignoreDirs: ["node_modules", ".git", "dist"],
    });

    expect(yaml).toContain("model: openai/gpt-4.1");
    expect(yaml).toContain("embedding: openai/text-embedding-3-small");
    expect(yaml).toContain("my-app:");
    expect(yaml).toContain("path: ~/repos/my-app");
    expect(yaml).toContain("description: React Native mobile app");
    expect(yaml).toContain(".ts");
    expect(yaml).toContain("node_modules");
  });

  it("uses tilde path when under home directory", () => {
    const yaml = generateConfigYaml({
      repoName: "app",
      repoPath: "~/projects/app",
      description: "test",
      extensions: [".ts"],
      ignoreDirs: [],
    });
    expect(yaml).toContain("path: ~/projects/app");
  });
});
