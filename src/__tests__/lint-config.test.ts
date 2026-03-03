import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ESLINT_CONFIG_PATH = path.join(ROOT, "eslint.config.mjs");

function getVitestBlock(): string {
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
  const configText = fs.readFileSync(ESLINT_CONFIG_PATH, "utf8");
  return configText.includes(`"${ruleName}": "off"`);
}

describe("Lint config guardrails", () => {
  it("does not disable sonarjs/publicly-writable-directories for tests", () => {
    expect(isRuleDisabled("sonarjs/publicly-writable-directories")).toBe(false);
  });

  it("does not disable require-await in the global Vitest rules block", () => {
    expect(getVitestBlock().includes('"@typescript-eslint/require-await": "off"')).toBe(false);
  });
});
