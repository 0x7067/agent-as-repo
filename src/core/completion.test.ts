import { describe, expect, it } from "vitest";
import { completionFileName, generateCompletionScript } from "./completion.js";

const ALL_COMMANDS = [
  "init", "doctor", "self-check", "setup", "config", "ask", "sync",
  "list", "status", "export", "onboard", "destroy", "watch",
  "install-daemon", "uninstall-daemon", "mcp-install", "mcp-check",
  "completion", "help",
];

const ALL_FLAGS = ["--help", "--version", "--no-input", "--debug"];

describe("completion", () => {
  it("generates bash completion with command registration", () => {
    const script = generateCompletionScript("bash", "repo-expert");
    expect(script).toContain("complete -F _repo_expert_completion repo-expert");
    expect(script).toContain("setup");
  });

  it("bash script includes all commands as space-separated words", () => {
    const script = generateCompletionScript("bash", "repo-expert");
    for (const cmd of ALL_COMMANDS) {
      // Each command must appear as a full word, not just a substring
      expect(script).toContain(cmd);
    }
    // Verify no empty entries from mutated "" strings (would cause double spaces)
    expect(script).not.toMatch(/\b  \b/);
  });

  it("bash script includes all global flags", () => {
    const script = generateCompletionScript("bash", "repo-expert");
    for (const flag of ALL_FLAGS) {
      expect(script).toContain(flag);
    }
  });

  it("bash script has commands and flags as space-separated words without gaps", () => {
    const script = generateCompletionScript("bash", "repo-expert");
    // Commands are space-separated in the COMPREPLY line
    expect(script).toContain("init doctor");
    // Flags are space-separated
    expect(script).toContain("--help --version");
    // Verify setup, config, sync, install-daemon, completion all appear in the COMPREPLY line
    const compreplyMatch = script.match(/compgen -W "([^"]+)"/);
    expect(compreplyMatch).not.toBeNull();
    const compreplyLine = compreplyMatch![1];
    for (const cmd of ALL_COMMANDS) {
      expect(compreplyLine).toContain(cmd);
    }
    // Ensure no double-spaces from empty command mutations
    expect(compreplyLine).not.toContain("  ");
  });

  it("bash replaces hyphens with underscores in function name", () => {
    const script = generateCompletionScript("bash", "my-cli-tool");
    // Catches replaceAll('-', '') mutation: hyphens removed entirely → "myclitool" instead of "my_cli_tool"
    // With '' replacement: _myclitool_completion
    // With '_' replacement: _my_cli_tool_completion (correct)
    expect(script).toContain("_my_cli_tool_completion");
    // Verify underscores ARE present where hyphens were (not just removed)
    expect(script).not.toContain("_myclitool_completion");
    // Catches replaceAll('', '_') mutation: should not have double underscores from empty string match
    expect(script).not.toMatch(/_m_y_/);
  });

  it("generates zsh and fish completion scripts", () => {
    const zsh = generateCompletionScript("zsh", "repo-expert");
    const fish = generateCompletionScript("fish", "repo-expert");
    expect(zsh).toContain("#compdef repo-expert");
    expect(fish).toContain("complete -c repo-expert");
  });

  it("fish script includes all commands", () => {
    const fish = generateCompletionScript("fish", "repo-expert");
    for (const cmd of ALL_COMMANDS) {
      expect(fish).toContain(cmd);
    }
  });

  it("returns expected completion file names", () => {
    expect(completionFileName("bash", "repo-expert")).toBe("repo-expert.bash");
    expect(completionFileName("zsh", "repo-expert")).toBe("_repo-expert");
    expect(completionFileName("fish", "repo-expert")).toBe("repo-expert.fish");
  });

  it("uses default command name when not specified", () => {
    const bash = generateCompletionScript("bash");
    expect(bash).toContain("repo-expert");
    expect(completionFileName("bash")).toBe("repo-expert.bash");
  });
});
