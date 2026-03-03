import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ESLINT_CONFIG_PATH = path.join(ROOT, "eslint.config.mjs");

function isRuleDisabled(ruleName: string): boolean {
  const configText = fs.readFileSync(ESLINT_CONFIG_PATH, "utf8");
  return configText.includes(`"${ruleName}": "off"`);
}

describe("Lint config guardrails", () => {
  it("does not disable sonarjs/publicly-writable-directories for tests", () => {
    expect(isRuleDisabled("sonarjs/publicly-writable-directories")).toBe(false);
  });
});
