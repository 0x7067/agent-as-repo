import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CORE_DIR = path.join(ROOT, "src/core");
const PORTS_DIR = path.join(ROOT, "src/ports");

function listTsFilesInDirectory(directoryPath: string): string[] {
  // Directory path is constrained to repository-owned constants in this test.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs
    .readdirSync(directoryPath)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(directoryPath, f));
}

function readTextFile(filePath: string): string {
  // File path comes from listTsFilesInDirectory and stays under src/core or src/ports.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(filePath, "utf8");
}

function fileExists(filePath: string): boolean {
  // File path is resolved under src/ports for required interface files.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.existsSync(filePath);
}

function coreFiles(): string[] {
  return listTsFilesInDirectory(CORE_DIR);
}

function portFiles(): string[] {
  return listTsFilesInDirectory(PORTS_DIR);
}

describe("Architecture: core layer boundaries", () => {
  it("no core file imports from shell", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
      const content = readTextFile(file);
      if (/from\s+['"]\.\.\/shell\//.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing from shell: ${violations.join(", ")}`).toEqual([]);
  });

  it("no core file imports from ports", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
      const content = readTextFile(file);
      if (/from\s+['"]\.\.\/ports\//.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing from ports: ${violations.join(", ")}`).toEqual([]);
  });

  it("no core file imports node:fs", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
      const content = readTextFile(file);
      if (/from\s+['"]node:fs/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing node:fs: ${violations.join(", ")}`).toEqual([]);
  });

  it("no core file imports node:child_process", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
      const content = readTextFile(file);
      if (/from\s+['"]node:child_process/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing node:child_process: ${violations.join(", ")}`).toEqual([]);
  });

  it("no core file imports fast-glob", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
      const content = readTextFile(file);
      if (/from\s+['"]fast-glob['"]/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing fast-glob: ${violations.join(", ")}`).toEqual([]);
  });
});

describe("Architecture: ports layer — interfaces only", () => {
  it("port files contain no class declarations", () => {
    const violations: string[] = [];
    for (const file of portFiles()) {
      const content = readTextFile(file);
      // eslint-disable-next-line sonarjs/slow-regex
      if (/^\s*class\s+\w+/m.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Port files with class declarations: ${violations.join(", ")}`).toEqual([]);
  });

  it("port files contain no function implementations", () => {
    const violations: string[] = [];
    for (const file of portFiles()) {
      const content = readTextFile(file);
      // Match standalone function declarations with a body (not method signatures in interfaces)
      // eslint-disable-next-line security/detect-unsafe-regex, sonarjs/slow-regex
      if (/^\s*(?:export\s+)?function\s+\w[^;]*\{/m.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Port files with function implementations: ${violations.join(", ")}`).toEqual([]);
  });

  it("required port files exist", () => {
    const required = ["filesystem.ts", "git.ts", "admin.ts"];
    for (const name of required) {
      const filePath = path.join(PORTS_DIR, name);
      expect(fileExists(filePath), `Missing port file: ${filePath}`).toBe(true);
    }
  });
});
