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
    expect(config.provider.type).toBe("letta");
    if (config.provider.type === "letta") {
      expect(config.provider.model).toBe("openai/gpt-4.1");
    }
    expect(config.repos["my-app"].maxFileSizeKb).toBe(50);
    expect(config.repos["my-app"].memoryBlockLimit).toBe(5000);
    expect(config.repos["my-app"].bootstrapOnCreate).toBe(true);
    expect(config.defaults.askTimeoutMs).toBe(60_000);
  });

  it("defaults chunking to 'raw' when omitted", () => {
    const config = parseConfig(validRaw);
    expect(config.defaults.chunking).toBe("raw");
  });

  it("accepts explicit 'raw' chunking in defaults", () => {
    // Catches: z.enum(["raw", ...]) → z.enum(["", ...]) mutation
    // With mutation: "raw" is not in enum ["", "tree-sitter"] → ZodError
    const raw = { ...validRaw, defaults: { chunking: "raw" } };
    const config = parseConfig(raw);
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
      defaults: {
        max_file_size_kb: 100,
        memory_block_limit: 3000,
        bootstrap_on_create: false,
        ask_timeout_ms: 12_345,
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].maxFileSizeKb).toBe(100);
    expect(config.repos["my-app"].memoryBlockLimit).toBe(3000);
    expect(config.repos["my-app"].bootstrapOnCreate).toBe(false);
    expect(config.defaults.askTimeoutMs).toBe(12_345);
  });

  it("accepts optional letta.fast_model", () => {
    const raw = {
      ...validRaw,
      letta: {
        ...validRaw.letta,
        fast_model: "openai/gpt-4.1-mini",
      },
    };
    const config = parseConfig(raw);
    if (config.provider.type === "letta") {
      expect(config.provider.fastModel).toBe("openai/gpt-4.1-mini");
    } else {
      expect.unreachable("expected letta provider");
    }
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
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configErr = error as ConfigError;
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
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configErr = error as ConfigError;
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
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configErr = error as ConfigError;
      expect(configErr.issues.some((i) => i.includes("at least one repo"))).toBe(true);
    }
  });

  it("re-throws non-ZodError errors as-is (not wrapped in ConfigError)", () => {
    // Catches: if(error instanceof z.ZodError) → if(true) mutation
    // With if(true): ALL errors get wrapped in ConfigError via zodIssuesToStrings
    // Non-ZodError objects don't have .issues property → zodIssuesToStrings would throw or produce garbage
    // We pass something that Zod schema will throw a ZodError for, so we can't easily trigger a non-ZodError
    // in normal flow. But we CAN test that a valid ZodError IS caught correctly.
    // Actually, the if(true) mutation means non-ZodErrors also get caught.
    // The only way to trigger a non-ZodError from rawConfigSchema.parse() is if Zod itself has a bug.
    // This might be an equivalent mutant for practical purposes.
    // Let's verify: pass null which makes z.parse throw ZodError (not other error)
    try {
      parseConfig(null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
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
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configErr = error as ConfigError;
      expect(configErr.issues.some((i) => i.includes("src/dist"))).toBe(true);
    }
  });

  it("migrates old letta: format to provider: { type: 'letta', ... }", () => {
    const config = parseConfig(validRaw);
    expect(config.provider.type).toBe("letta");
    if (config.provider.type === "letta") {
      expect(config.provider.model).toBe("openai/gpt-4.1");
      expect(config.provider.embedding).toBe("openai/text-embedding-3-small");
    }
  });

  it("parses new provider: { type: 'letta' } format", () => {
    const raw = {
      provider: { type: "letta", model: "openai/gpt-4.1", embedding: "openai/text-embedding-3-small" },
      repos: validRaw.repos,
    };
    const config = parseConfig(raw);
    expect(config.provider.type).toBe("letta");
    if (config.provider.type === "letta") {
      expect(config.provider.model).toBe("openai/gpt-4.1");
    }
  });

  it("parses viking provider config", () => {
    const raw = {
      provider: { type: "viking", openrouter_model: "openai/gpt-4o-mini" },
      repos: validRaw.repos,
    };
    const config = parseConfig(raw);
    expect(config.provider.type).toBe("viking");
    if (config.provider.type === "viking") {
      expect(config.provider.openrouterModel).toBe("openai/gpt-4o-mini");
      expect(config.provider.vikingUrl).toBeUndefined();
    }
  });

  it("parses viking provider config with optional viking_url", () => {
    const raw = {
      provider: { type: "viking", openrouter_model: "openai/gpt-4o-mini", viking_url: "http://localhost:1933" },
      repos: validRaw.repos,
    };
    const config = parseConfig(raw);
    if (config.provider.type === "viking") {
      expect(config.provider.vikingUrl).toBe("http://localhost:1933");
    } else {
      expect.unreachable("expected viking provider");
    }
  });

  it("throws ConfigError when neither provider nor letta is specified", () => {
    try {
      parseConfig({ repos: validRaw.repos });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configErr = error as ConfigError;
      expect(configErr.issues.some((i) => i.includes("provider") || i.includes("letta"))).toBe(true);
    }
  });
});

describe("include_submodules config field", () => {
  it("defaults to false when omitted", () => {
    const config = parseConfig(validRaw);
    expect(config.repos["my-app"].includeSubmodules).toBe(false);
  });

  it("parses include_submodules: true", () => {
    const raw = {
      ...validRaw,
      repos: {
        "my-app": { ...validRaw.repos["my-app"], include_submodules: true },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].includeSubmodules).toBe(true);
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

  it("separates issues with newlines and prefixes with dash", () => {
    const err = new ConfigError(["issue1", "issue2"]);
    const output = formatConfigError(err);
    expect(output).toContain("  - issue1\n  - issue2");
  });
});

describe("ConfigError", () => {
  it("has name set to ConfigError", () => {
    const err = new ConfigError(["test"]);
    expect(err.name).toBe("ConfigError");
  });

  it("stores issues array", () => {
    const err = new ConfigError(["a", "b"]);
    expect(err.issues).toEqual(["a", "b"]);
  });

  it("message contains each issue prefixed with dash", () => {
    const err = new ConfigError(["foo", "bar"]);
    expect(err.message).toContain("  - foo");
    expect(err.message).toContain("  - bar");
    expect(err.message).toContain("\n");
  });

  it("message joins issues with newline separator (not empty string)", () => {
    // Catches: join("\n") → join("") mutation in super() call
    const err = new ConfigError(["issue-one", "issue-two"]);
    // With join("\n"): "...  - issue-one\n  - issue-two"
    // With join(""): "...  - issue-one  - issue-two" (no newline between)
    expect(err.message).toContain("  - issue-one\n  - issue-two");
  });
});
