import { describe, expect, it } from "vitest";
import { completionFileName, generateCompletionScript } from "./completion.js";

describe("completion", () => {
  it("generates bash completion with command registration", () => {
    const script = generateCompletionScript("bash", "repo-expert");
    expect(script).toContain("complete -F _repo_expert_completion repo-expert");
    expect(script).toContain("setup");
  });

  it("generates zsh and fish completion scripts", () => {
    const zsh = generateCompletionScript("zsh", "repo-expert");
    const fish = generateCompletionScript("fish", "repo-expert");
    expect(zsh).toContain("#compdef repo-expert");
    expect(fish).toContain("complete -c repo-expert");
  });

  it("returns expected completion file names", () => {
    expect(completionFileName("bash", "repo-expert")).toBe("repo-expert.bash");
    expect(completionFileName("zsh", "repo-expert")).toBe("_repo-expert");
    expect(completionFileName("fish", "repo-expert")).toBe("repo-expert.fish");
  });
});
