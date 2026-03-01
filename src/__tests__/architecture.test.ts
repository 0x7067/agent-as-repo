import * as fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const CORE_DIR = path.join(ROOT, "src/core");
const PORTS_DIR = path.join(ROOT, "src/ports");

function coreFiles(): string[] {
  return fs
    .readdirSync(CORE_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(CORE_DIR, f));
}

function portFiles(): string[] {
  return fs
    .readdirSync(PORTS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(PORTS_DIR, f));
}

describe("Architecture: core layer boundaries", () => {
  it("no core file imports from shell", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
       
      const content = fs.readFileSync(file, "utf8");
      if (/from\s+['"]\.\.\/shell\//.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing from shell: ${violations.join(", ")}`).toEqual([]);
  });

  it("no core file imports from ports", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
       
      const content = fs.readFileSync(file, "utf8");
      if (/from\s+['"]\.\.\/ports\//.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing from ports: ${violations.join(", ")}`).toEqual([]);
  });

  it("no core file imports node:fs", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
       
      const content = fs.readFileSync(file, "utf8");
      if (/from\s+['"]node:fs/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing node:fs: ${violations.join(", ")}`).toEqual([]);
  });

  it("no core file imports node:child_process", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
       
      const content = fs.readFileSync(file, "utf8");
      if (/from\s+['"]node:child_process/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Core files importing node:child_process: ${violations.join(", ")}`).toEqual([]);
  });

  it("no core file imports fast-glob", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
       
      const content = fs.readFileSync(file, "utf8");
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
       
      const content = fs.readFileSync(file, "utf8");
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
       
      const content = fs.readFileSync(file, "utf8");
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
      expect(fs.existsSync(filePath), `Missing port file: ${filePath}`).toBe(true);
    }
  });
});
