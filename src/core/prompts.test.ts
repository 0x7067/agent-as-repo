import { describe, it, expect } from "vitest";
import {
  buildPersona,
  architectureBootstrapPrompt,
  conventionsBootstrapPrompt,
} from "./prompts.js";

describe("buildPersona", () => {
  it("generates persona from repo name and description", () => {
    const persona = buildPersona("my-app", "A React Native mobile app");
    expect(persona).toContain("my-app");
    expect(persona).toContain("archival memory");
    expect(persona).toContain("do NOT pass tags");
  });

  it("uses custom persona when provided", () => {
    const custom = "I am the ultimate expert.";
    const persona = buildPersona("my-app", "desc", custom);
    expect(persona).toContain(custom);
    expect(persona).toContain("do NOT pass tags");
  });

  it("includes cross-repo instruction when cross-agent tools are configured", () => {
    const persona = buildPersona("my-app", "A mobile app", undefined, [
      "send_message_to_agents_matching_all_tags",
    ]);
    expect(persona).toContain("query other repo-expert agents");
    expect(persona).toContain("send_message_to_agents_matching_all_tags");
  });

  it("omits cross-repo instruction when no cross-agent tools configured", () => {
    const persona = buildPersona("my-app", "A mobile app");
    expect(persona).not.toContain("query other repo-expert agents");
  });

  it("omits cross-repo instruction when tools has no messaging tools", () => {
    const persona = buildPersona("my-app", "A mobile app", undefined, ["some_other_tool"]);
    expect(persona).not.toContain("query other repo-expert agents");
  });
});

describe("bootstrap prompts", () => {
  it("architecture prompt mentions archival memory search", () => {
    const prompt = architectureBootstrapPrompt();
    expect(prompt).toContain("archival memory");
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("memory_replace");
  });

  it("conventions prompt mentions archival memory search", () => {
    const prompt = conventionsBootstrapPrompt();
    expect(prompt).toContain("archival memory");
    expect(prompt).toContain("conventions");
    expect(prompt).toContain("memory_replace");
  });
});
