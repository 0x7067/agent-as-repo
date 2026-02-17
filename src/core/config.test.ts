import { describe, it, expect } from "vitest";
import { parseConfig, ConfigError, formatConfigError } from "./config.js";

const validRaw = {
  letta: {
    model: "openai/gpt-4.1",
    embedding: "openai/text-embedding-3-small",
  },
  repos: {
    "my-app": {
      path: "/home/user/repos/my-app",
      description: "My application",
      extensions: [".ts", ".tsx"],
      ignore_dirs: ["node_modules", ".git"],
      tags: ["frontend"],
    },
  },
};

describe("parseConfig", () => {
  it("parses a valid config with defaults applied", () => {
    const config = parseConfig(validRaw);
    expect(config.letta.model).toBe("openai/gpt-4.1");
    expect(config.repos["my-app"].maxFileSizeKb).toBe(50);
    expect(config.repos["my-app"].memoryBlockLimit).toBe(5000);
    expect(config.repos["my-app"].bootstrapOnCreate).toBe(true);
  });

  it("defaults chunking to 'raw' when omitted", () => {
    const config = parseConfig(validRaw);
    expect(config.defaults.chunking).toBe("raw");
  });

  it("accepts 'tree-sitter' chunking override", () => {
    const raw = { ...validRaw, defaults: { chunking: "tree-sitter" } };
    const config = parseConfig(raw);
    expect(config.defaults.chunking).toBe("tree-sitter");
  });

  it("applies explicit defaults over built-in defaults", () => {
    const raw = {
      ...validRaw,
      defaults: { max_file_size_kb: 100, memory_block_limit: 3000, bootstrap_on_create: false },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].maxFileSizeKb).toBe(100);
    expect(config.repos["my-app"].memoryBlockLimit).toBe(3000);
    expect(config.repos["my-app"].bootstrapOnCreate).toBe(false);
  });

  it("allows per-repo overrides of defaults", () => {
    const raw = {
      ...validRaw,
      defaults: { max_file_size_kb: 100 },
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          max_file_size_kb: 200,
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].maxFileSizeKb).toBe(200);
  });

  it("throws on missing required fields", () => {
    expect(() => parseConfig({})).toThrow();
    expect(() => parseConfig({ letta: {} })).toThrow();
    expect(() =>
      parseConfig({
        letta: { model: "x", embedding: "y" },
        repos: { app: { path: "/x" } },
      }),
    ).toThrow();
  });

  it("defaults tags to empty array when omitted", () => {
    const raw = {
      ...validRaw,
      repos: {
        "my-app": {
          path: "/x",
          description: "app",
          extensions: [".ts"],
          ignore_dirs: [".git"],
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].tags).toEqual([]);
  });

  it("includes optional persona when provided", () => {
    const raw = {
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          persona: "I am an expert on my-app.",
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].persona).toBe("I am an expert on my-app.");
  });

  it("includes optional tools when provided", () => {
    const raw = {
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          tools: ["send_message_to_agents_matching_tags"],
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].tools).toEqual(["send_message_to_agents_matching_tags"]);
  });

  it("leaves tools undefined when omitted", () => {
    const config = parseConfig(validRaw);
    expect(config.repos["my-app"].tools).toBeUndefined();
  });

  it("includes optional base_path for monorepo support", () => {
    const raw = {
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          base_path: "packages/frontend",
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].basePath).toBe("packages/frontend");
  });

  it("leaves basePath undefined when omitted", () => {
    const config = parseConfig(validRaw);
    expect(config.repos["my-app"].basePath).toBeUndefined();
  });

  it("applies defaults.tools to repos without per-repo tools", () => {
    const raw = {
      ...validRaw,
      defaults: { tools: ["send_message_to_agents_matching_tags"] },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].tools).toEqual(["send_message_to_agents_matching_tags"]);
  });

  it("per-repo tools override defaults.tools", () => {
    const raw = {
      ...validRaw,
      defaults: { tools: ["send_message_to_agents_matching_tags"] },
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          tools: ["send_message_to_agent_and_wait_for_reply"],
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].tools).toEqual(["send_message_to_agent_and_wait_for_reply"]);
  });

  it("throws ConfigError with formatted messages on schema violations", () => {
    try {
      parseConfig({
        letta: {},
        repos: { app: { path: 123, extensions: "not-array" } },
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const configErr = err as ConfigError;
      expect(configErr.issues.length).toBeGreaterThan(0);
      // Should have readable path-based messages
      expect(configErr.issues.some((i) => i.includes("letta.model"))).toBe(true);
      expect(configErr.issues.some((i) => i.includes("repos.app.path"))).toBe(true);
    }
  });

  it("throws ConfigError when extensions don't start with dot", () => {
    try {
      parseConfig({
        ...validRaw,
        repos: {
          "my-app": {
            ...validRaw.repos["my-app"],
            extensions: [".ts", "js", ".tsx"],
          },
        },
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const configErr = err as ConfigError;
      expect(configErr.issues.some((i) => i.includes('"js"'))).toBe(true);
      expect(configErr.issues.some((i) => i.includes("start with"))).toBe(true);
    }
  });

  it("throws ConfigError when no repos defined", () => {
    try {
      parseConfig({
        letta: { model: "x", embedding: "y" },
        repos: {},
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const configErr = err as ConfigError;
      expect(configErr.issues.some((i) => i.includes("at least one repo"))).toBe(true);
    }
  });

  it("throws ConfigError when ignore_dirs contain path separators", () => {
    try {
      parseConfig({
        ...validRaw,
        repos: {
          "my-app": {
            ...validRaw.repos["my-app"],
            ignore_dirs: ["node_modules", "src/dist"],
          },
        },
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const configErr = err as ConfigError;
      expect(configErr.issues.some((i) => i.includes("src/dist"))).toBe(true);
    }
  });
});

describe("formatConfigError", () => {
  it("formats a ConfigError into readable lines", () => {
    const err = new ConfigError(["letta.model: Required", "repos.app.path: Expected string"]);
    const output = formatConfigError(err);
    expect(output).toContain("Config validation failed");
    expect(output).toContain("letta.model: Required");
    expect(output).toContain("repos.app.path: Expected string");
  });
});
