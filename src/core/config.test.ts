import { describe, it, expect } from "vitest";
import { parseConfig, ConfigError, formatConfigError } from "./config.js";

const MODEL = "qwen3-coder:30b";

const validRaw = {
  provider: {
    model: MODEL,
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

function parseConfigError(raw: unknown): ConfigError {
  try {
    parseConfig(raw);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected parseConfig to throw ConfigError");
}

describe("parseConfig", () => {
  it("parses a valid config with defaults applied", () => {
    const config = parseConfig(validRaw);
    expect(config.provider.model).toBe(MODEL);
    expect(config.provider.baseUrl).toBe("http://localhost:11434/v1");
    expect(config.provider.fallbackModels).toEqual([]);
    expect(config.provider.vikingUrl).toBe("http://localhost:1933");
    expect(config.repos["my-app"].maxFileSizeKb).toBe(50);
    expect(config.repos["my-app"].memoryBlockLimit).toBe(5000);
    expect(config.repos["my-app"].bootstrapOnCreate).toBe(true);
    expect(config.defaults.askTimeoutMs).toBe(60_000);
  });

  it("defaults chunking to 'tree-sitter' when omitted", () => {
    const config = parseConfig(validRaw);
    expect(config.defaults.chunking).toBe("tree-sitter");
  });

  it("accepts chunking: tree-sitter and threads it into defaults", () => {
    const raw = {
      provider: { model: MODEL },
      defaults: { chunking: "tree-sitter" },
      repos: {
        "my-app": {
          path: "~/repos/my-app",
          description: "test",
          extensions: [".ts"],
          ignore_dirs: ["node_modules"],
        },
      },
    };

    const config = parseConfig(raw);
    expect(config.defaults.chunking).toBe("tree-sitter");
  });

  it("accepts explicit 'raw' chunking in defaults", () => {
    const raw = { ...validRaw, defaults: { chunking: "raw" } };
    const config = parseConfig(raw);
    expect(config.defaults.chunking).toBe("raw");
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

  it("parses provider base_url, fallback_models, and viking_url", () => {
    const raw = {
      provider: {
        model: MODEL,
        base_url: "https://openrouter.ai/api/v1",
        fallback_models: ["moonshotai/kimi-k2.5", "deepseek/deepseek-v3.2"],
        viking_url: "http://localhost:2000",
      },
      repos: validRaw.repos,
    };
    const config = parseConfig(raw);
    expect(config.provider.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.provider.fallbackModels).toEqual(["moonshotai/kimi-k2.5", "deepseek/deepseek-v3.2"]);
    expect(config.provider.vikingUrl).toBe("http://localhost:2000");
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
    expect(() => parseConfig({ provider: {} })).toThrow();
    expect(() =>
      parseConfig({
        provider: { model: "x" },
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
          tools: ["archival_memory_search"],
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].tools).toEqual(["archival_memory_search"]);
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
      defaults: { tools: ["archival_memory_search"] },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].tools).toEqual(["archival_memory_search"]);
  });

  it("per-repo tools override defaults.tools", () => {
    const raw = {
      ...validRaw,
      defaults: { tools: ["archival_memory_search"] },
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          tools: ["memory_replace"],
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].tools).toEqual(["memory_replace"]);
  });

  it("throws ConfigError with formatted messages on schema violations", () => {
    const configErr = parseConfigError({
      provider: {},
      repos: { app: { path: 123, extensions: "not-array" } },
    });
    expect(configErr.issues.length).toBeGreaterThan(0);
    expect(configErr.issues.some((i) => i.includes("provider.model"))).toBe(true);
    expect(configErr.issues.some((i) => i.includes("repos.app.path"))).toBe(true);
  });

  it("throws ConfigError when extensions don't start with dot", () => {
    const configErr = parseConfigError({
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          extensions: [".ts", "js", ".tsx"],
        },
      },
    });
    expect(configErr.issues.some((i) => i.includes('"js"'))).toBe(true);
    expect(configErr.issues.some((i) => i.includes("start with"))).toBe(true);
  });

  it("throws ConfigError when no repos defined", () => {
    const configErr = parseConfigError({
      provider: { model: "x" },
      repos: {},
    });
    expect(configErr.issues.some((i) => i.includes("at least one repo"))).toBe(true);
  });

  it("re-throws non-ZodError errors as-is (not wrapped in ConfigError)", () => {
    expect(() => parseConfig(null)).toThrow(ConfigError);
  });

  it("throws ConfigError when ignore_dirs contain path separators", () => {
    const configErr = parseConfigError({
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          ignore_dirs: ["node_modules", "src/dist"],
        },
      },
    });
    expect(configErr.issues.some((i) => i.includes("src/dist"))).toBe(true);
  });

  it("throws ConfigError when provider is missing", () => {
    const configErr = parseConfigError({ repos: validRaw.repos });
    expect(configErr.issues.some((i) => i.includes("provider"))).toBe(true);
  });

  describe("legacy config rejection", () => {
    it("rejects a top-level letta: block with a helpful message", () => {
      const configErr = parseConfigError({
        letta: { model: "openai/gpt-4.1", embedding: "openai/text-embedding-3-small" },
        repos: validRaw.repos,
      });
      expect(configErr.issues.some((i) => i.includes("letta"))).toBe(true);
      expect(configErr.issues.some((i) => i.includes("provider"))).toBe(true);
    });

    it("rejects provider.type", () => {
      const configErr = parseConfigError({
        provider: { type: "viking", model: MODEL },
        repos: validRaw.repos,
      });
      expect(configErr.issues.some((i) => i.includes("provider.type"))).toBe(true);
    });

    it("rejects provider.openrouter_model", () => {
      const configErr = parseConfigError({
        provider: { openrouter_model: "openai/gpt-4o-mini" },
        repos: validRaw.repos,
      });
      expect(configErr.issues.some((i) => i.includes("openrouter_model"))).toBe(true);
    });

    it("rejects provider.embedding", () => {
      const configErr = parseConfigError({
        provider: { model: MODEL, embedding: "openai/text-embedding-3-small" },
        repos: validRaw.repos,
      });
      expect(configErr.issues.some((i) => i.includes("embedding"))).toBe(true);
    });
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
    const err = new ConfigError(["provider.model: Required", "repos.app.path: Expected string"]);
    const output = formatConfigError(err);
    expect(output).toContain("Config validation failed");
    expect(output).toContain("provider.model: Required");
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
    const err = new ConfigError(["issue-one", "issue-two"]);
    expect(err.message).toContain("  - issue-one\n  - issue-two");
  });
});
