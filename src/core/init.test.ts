import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import {
  detectExtensions,
  suggestIgnoreDirs,
  detectRepoName,
  generateConfigYaml,
} from "./init.js";

describe("detectExtensions", () => {
  it("returns top extensions sorted by frequency descending", () => {
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
    // Verify sorting: .ts (4) should come before others (1 each)
    expect(result.indexOf(".ts")).toBe(0);
  });

  it("counts correctly and sorts by frequency descending", () => {
    // Insertion order (.py, .ts, .js) differs from frequency order (.js, .ts, .py)
    const files = ["a.py", "b.ts", "c.ts", "d.js", "e.js", "f.js"];
    const result = detectExtensions(files);
    expect(result).toEqual([".js", ".ts", ".py"]);
  });

  it("accumulates count for repeated extensions (not replaced)", () => {
    // 5 occurrences of .ts, 1 of .js — .ts must come first
    // Catches ?? → && mutation: with &&, counts.get(ext) is truthy (1,2,3,...) so && returns 0, then +1 = 1
    // This means every ext gets count 1 instead of accumulating
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.js"];
    const result = detectExtensions(files);
    expect(result).toEqual([".ts", ".js"]);
  });

  it("accumulation uses ?? (not &&) — count goes above 1", () => {
    // .js seen first but .ts has more occurrences — frequency must win over insertion order
    const files = ["a.js", "b.ts", "c.ts", "d.ts", "e.js"];
    const result = detectExtensions(files);
    expect(result[0]).toBe(".ts");
    expect(result[1]).toBe(".js");
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

  it("excludes all known non-code extensions", () => {
    const excluded = [
      "icon.png", "photo.jpg", "img.jpeg", "anim.gif", "logo.svg",
      "fav.ico", "img.webp", "old.bmp",
      "font.woff", "font.woff2", "font.ttf", "font.eot", "font.otf",
      "archive.zip", "archive.tar", "archive.gz", "archive.bz2",
      "archive.7z", "archive.rar",
      "audio.mp3", "video.mp4", "audio.wav", "video.avi", "video.mov",
      "video.mkv",
      "doc.pdf", "doc.doc", "doc.docx", "sheet.xls", "sheet.xlsx",
      "pkg.lock", "build.map",
    ];
    const files = [...excluded, "src/app.ts"];
    const result = detectExtensions(files);
    expect(result).toEqual([".ts"]);
  });

  it("is case-insensitive for excluded extensions", () => {
    const files = ["IMAGE.PNG", "PHOTO.JPG", "src/app.ts"];
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

  it("detects all known ignore dirs", () => {
    const knownDirs = [
      "node_modules", ".git", "dist", "build", ".next", ".nuxt",
      "coverage", ".cache", "__pycache__", ".venv", "venv",
      "target", "vendor", ".expo", "android", "ios",
      ".turbo", ".parcel-cache", "out",
    ];
    const files = knownDirs.map((d) => `${d}/file.txt`);
    const result = suggestIgnoreDirs(files);
    for (const dir of knownDirs) {
      expect(result).toContain(dir);
    }
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

  it("handles multiple trailing slashes", () => {
    expect(detectRepoName("/Users/dev/my-app///")).toBe("my-app");
  });

  it("only strips trailing slashes, not internal ones", () => {
    expect(detectRepoName("/a/b")).toBe("b");
    expect(detectRepoName("/foo/bar")).toBe("bar");
  });

  it("handles home-relative path", () => {
    expect(detectRepoName("~/repos/backend")).toBe("backend");
  });
});

describe("generateConfigYaml", () => {
  it("produces valid YAML with repo config", () => {
    const output = generateConfigYaml({
      repoName: "my-app",
      repoPath: "~/repos/my-app",
      description: "React Native mobile app",
      extensions: [".ts", ".tsx", ".js"],
      ignoreDirs: ["node_modules", ".git", "dist"],
    });

    expect(output).toContain("model: openai/gpt-4.1");
    expect(output).toContain("embedding: openai/text-embedding-3-small");
    expect(output).toContain("my-app:");
    expect(output).toContain("path: ~/repos/my-app");
    expect(output).toContain("description: React Native mobile app");
    expect(output).toContain(".ts");
    expect(output).toContain("node_modules");
  });

  it("produces parseable YAML", () => {
    const output = generateConfigYaml({
      repoName: "app",
      repoPath: "~/projects/app",
      description: "test",
      extensions: [".ts"],
      ignoreDirs: [],
    });
    const parsed = yaml.load(output) as Record<string, unknown>;
    expect(parsed).toBeDefined();
    expect(parsed.letta).toBeDefined();
    expect(parsed.repos).toBeDefined();
  });

  it("respects lineWidth option — long lines not wrapped at default 80", () => {
    // yaml.dump default lineWidth is 80. Our code sets 120.
    // Catches: ObjectLiteral mutation (options → {}) — would use default 80-char wrapping
    const longDescription = "A".repeat(100); // 100 chars, > 80 default
    const output = generateConfigYaml({
      repoName: "app",
      repoPath: "~/projects/app",
      description: longDescription,
      extensions: [".ts"],
      ignoreDirs: [],
    });
    // With lineWidth 120: description fits on one line
    // With default lineWidth 80 (or {} options): wraps using >- block scalar
    expect(output).toContain(`description: ${longDescription}`);
    // Should NOT contain block scalar indicator (would appear with wrapping)
    expect(output).not.toContain(">-");
  });

  it("uses double-quote quoting type (not empty string)", () => {
    // Catches: quotingType '"' → '' mutation
    // With quotingType: '"', strings that need quoting use double quotes
    // With quotingType: '', js-yaml defaults to single quotes
    // To force quoting, we need a value that requires quotes in YAML
    // A string with special chars like `:` or `#` will be quoted
    const output = generateConfigYaml({
      repoName: "app",
      repoPath: "~/projects/app",
      description: "App: a test # with special chars",
      extensions: [".ts"],
      ignoreDirs: [],
    });
    // With quotingType: '"', the description should use double quotes
    // With quotingType: '' (or default), it uses single quotes
    // js-yaml only quotes when forceQuotes is true OR when the string requires it
    // Our code has forceQuotes: false, so only strings with special chars get quoted
    // A string with ":" triggers quoting
    expect(output).toContain('"App: a test # with special chars"');
  });

  it("uses tilde path when under home directory", () => {
    const output = generateConfigYaml({
      repoName: "app",
      repoPath: "~/projects/app",
      description: "test",
      extensions: [".ts"],
      ignoreDirs: [],
    });
    expect(output).toContain("path: ~/projects/app");
  });
});
