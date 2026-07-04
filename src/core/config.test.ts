import { describe, it, expect } from "vitest";
import {
  parseConfig,
  ConfigError,
  formatConfigError,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE_DIRS,
} from "./config.js";

const MODEL = "qwen3-coder:30b";

const validRaw = {
  provider: {
    model: MODEL,
  },
  repos: {
    "my-app": {
      path: "/home/user/repos/my-app",
      description: "My application",
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
  it("parses a minimal config (model + path + description) with defaults applied", () => {
    const config = parseConfig(validRaw);
    expect(config.provider.model).toBe(MODEL);
    expect(config.provider.baseUrl).toBe("http://localhost:11434/v1");
    expect(config.provider.fallbackModels).toEqual([]);
    expect(config.provider.embeddingModel).toBe("nomic-embed-text");
    expect(config.provider.fastModel).toBeUndefined();
    expect(config.consolidateOnSync).toBe(false);
    expect(config.repos["my-app"].path).toBe("/home/user/repos/my-app");
    expect(config.repos["my-app"].description).toBe("My application");
  });

  it("fills extensions and ignore_dirs with the built-in defaults when omitted", () => {
    const config = parseConfig(validRaw);
    expect(config.repos["my-app"].extensions).toEqual(DEFAULT_EXTENSIONS);
    expect(config.repos["my-app"].ignoreDirs).toEqual(DEFAULT_IGNORE_DIRS);
    expect(DEFAULT_EXTENSIONS).toContain(".ts");
    expect(DEFAULT_IGNORE_DIRS).toContain("node_modules");
  });

  it("uses explicit extensions and ignore_dirs when provided", () => {
    const raw = {
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          extensions: [".ts", ".tsx"],
          ignore_dirs: ["node_modules", ".git"],
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].extensions).toEqual([".ts", ".tsx"]);
    expect(config.repos["my-app"].ignoreDirs).toEqual(["node_modules", ".git"]);
  });

  it("parses provider base_url and fallback_models", () => {
    const raw = {
      provider: {
        model: MODEL,
        base_url: "https://openrouter.ai/api/v1",
        fallback_models: ["moonshotai/kimi-k2.5", "deepseek/deepseek-v3.2"],
      },
      repos: validRaw.repos,
    };
    const config = parseConfig(raw);
    expect(config.provider.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.provider.fallbackModels).toEqual(["moonshotai/kimi-k2.5", "deepseek/deepseek-v3.2"]);
  });

  it("parses provider.fast_model when provided", () => {
    const raw = {
      provider: {
        model: MODEL,
        fast_model: "llama3.2:3b",
      },
      repos: validRaw.repos,
    };
    const config = parseConfig(raw);
    expect(config.provider.fastModel).toBe("llama3.2:3b");
  });

  it("parses provider.embedding_model when provided", () => {
    const raw = {
      provider: {
        model: MODEL,
        embedding_model: "mxbai-embed-large",
      },
      repos: validRaw.repos,
    };
    const config = parseConfig(raw);
    expect(config.provider.embeddingModel).toBe("mxbai-embed-large");
  });

  it("parses top-level consolidate_on_sync", () => {
    const config = parseConfig({ ...validRaw, consolidate_on_sync: true });
    expect(config.consolidateOnSync).toBe(true);
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

  it("parses include_submodules", () => {
    const raw = {
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          include_submodules: true,
        },
      },
    };
    const config = parseConfig(raw);
    expect(config.repos["my-app"].includeSubmodules).toBe(true);
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

  it("throws ConfigError when provider is missing", () => {
    const configErr = parseConfigError({ repos: validRaw.repos });
    expect(configErr.issues.some((i) => i.includes("provider"))).toBe(true);
  });

  it("rejects unknown provider keys (typo protection)", () => {
    const configErr = parseConfigError({
      provider: { model: MODEL, modle: "oops" },
      repos: validRaw.repos,
    });
    expect(configErr.issues.some((i) => i.includes("modle"))).toBe(true);
  });

  it("rejects unknown repo keys (typo protection)", () => {
    const configErr = parseConfigError({
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          ignore_dir: ["node_modules"],
        },
      },
    });
    expect(configErr.issues.some((i) => i.includes("ignore_dir"))).toBe(true);
  });

  it("rejects unknown top-level keys (typo protection)", () => {
    const configErr = parseConfigError({ ...validRaw, defaults: { chunking: "raw" } });
    expect(configErr.issues.some((i) => i.includes("defaults"))).toBe(true);
  });

  it("throws ConfigError when repos is empty", () => {
    const configErr = parseConfigError({ provider: { model: MODEL }, repos: {} });
    expect(configErr.issues.some((i) => i.includes("at least one repo"))).toBe(true);
  });

  it("rejects extensions without a leading dot", () => {
    const configErr = parseConfigError({
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          extensions: ["ts"],
        },
      },
    });
    expect(configErr.issues.some((i) => i.includes('"ts" should start with "."'))).toBe(true);
  });

  it("rejects ignore_dirs entries that look like paths", () => {
    const configErr = parseConfigError({
      ...validRaw,
      repos: {
        "my-app": {
          ...validRaw.repos["my-app"],
          ignore_dirs: ["src/dist"],
        },
      },
    });
    expect(configErr.issues.some((i) => i.includes("src/dist"))).toBe(true);
  });
});

describe("ConfigError formatting", () => {
  it("formats issues as a bulleted list", () => {
    const err = new ConfigError(["first issue", "second issue"]);
    expect(err.message).toContain("Config validation failed:");
    expect(err.message).toContain("  - first issue");
    expect(err.message).toContain("  - second issue");
    expect(formatConfigError(err)).toBe(err.message);
  });
});
