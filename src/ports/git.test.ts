import { describe, it, expect } from "vitest";
import type { GitPort } from "./git.js";

describe("GitPort", () => {
  it("is structurally satisfied by an object with submoduleStatus", () => {
    const mock: GitPort = {
      submoduleStatus: (_repoPath: string) => "",
    };
    expect(mock.submoduleStatus("/repo")).toBe("");
  });
});
