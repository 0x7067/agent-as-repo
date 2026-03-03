import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ESLINT_CONFIG_PATH = path.join(ROOT, "eslint.config.mjs");

function getVitestBlock(): string {
  // Path is fixed to the repository eslint config file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const configText = fs.readFileSync(ESLINT_CONFIG_PATH, "utf8");
  const vitestSelector = 'files: ["**/*.test.ts", "**/*.spec.ts"]';
  const selectorIndex = configText.indexOf(vitestSelector);
  if (selectorIndex === -1) {
    throw new Error("Could not locate Vitest ESLint files selector");
  }

  const vitestAndAfter = configText.slice(selectorIndex + vitestSelector.length);
  const languageOptionsIndex = vitestAndAfter.indexOf("languageOptions:");
  if (languageOptionsIndex === -1) {
    throw new Error("Could not locate Vitest languageOptions marker");
  }

  return vitestAndAfter.slice(0, languageOptionsIndex);
}

function isRuleDisabled(ruleName: string): boolean {
  // Path is fixed to the repository eslint config file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const configText = fs.readFileSync(ESLINT_CONFIG_PATH, "utf8");
  return configText.includes(`"${ruleName}": "off"`);
}

describe("Lint config guardrails", () => {
  it("does not disable sonarjs/publicly-writable-directories for tests", () => {
    expect(isRuleDisabled("sonarjs/publicly-writable-directories")).toBe(false);
  });

  it("does not disable sonarjs/no-hardcoded-passwords in the global Vitest rules block", () => {
    expect(getVitestBlock().includes('"sonarjs/no-hardcoded-passwords": "off"')).toBe(false);
  });

  it("does not disable detect-non-literal-fs-filename in the global Vitest rules block", () => {
    expect(getVitestBlock().includes('"security/detect-non-literal-fs-filename": "off"')).toBe(false);
  });

  it("does not disable max-lines in the global Vitest rules block", () => {
    expect(getVitestBlock().includes('"max-lines": "off"')).toBe(false);
  });

  it("does not disable no-duplicate-string in the global Vitest rules block", () => {
    expect(getVitestBlock().includes('"sonarjs/no-duplicate-string": "off"')).toBe(false);
  });

  it("does not disable require-await in the global Vitest rules block", () => {
    expect(getVitestBlock().includes('"@typescript-eslint/require-await": "off"')).toBe(false);
  });

  it("does not disable unbound-method in the global Vitest rules block", () => {
    expect(getVitestBlock().includes('"@typescript-eslint/unbound-method": "off"')).toBe(false);
  });
});
