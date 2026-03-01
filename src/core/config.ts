import { z } from "zod/v4";
import type { Config, RepoConfig, ProviderConfig } from "./types.js";

const BUILT_IN_DEFAULTS = {
  maxFileSizeKb: 50,
  memoryBlockLimit: 5000,
  bootstrapOnCreate: true,
  chunking: "raw" as const,
  askTimeoutMs: 60_000,
};

const defaultsSchema = z.object({
  max_file_size_kb: z.number().optional(),
  memory_block_limit: z.number().optional(),
  bootstrap_on_create: z.boolean().optional(),
  chunking: z.enum(["raw", "tree-sitter"]).optional(),
  ask_timeout_ms: z.number().optional(),
  tools: z.array(z.string()).optional(),
});

const repoRawSchema = z.object({
  path: z.string(),
  base_path: z.string().optional(),
  description: z.string(),
  extensions: z.array(z.string()),
  ignore_dirs: z.array(z.string()),
  tags: z.array(z.string()).optional(),
  persona: z.string().optional(),
  tools: z.array(z.string()).optional(),
  max_file_size_kb: z.number().optional(),
  memory_block_limit: z.number().optional(),
  bootstrap_on_create: z.boolean().optional(),
  include_submodules: z.boolean().optional(),
});

const rawConfigSchema = z.object({
  // New form
  provider: z.discriminatedUnion("type", [
    z.object({ type: z.literal("letta"), model: z.string(), embedding: z.string(), fast_model: z.string().optional() }),
    z.object({ type: z.literal("viking"), openrouter_model: z.string(), viking_url: z.string().optional() }),
  ]).optional(),
  // Old form (backwards compat)
  letta: z.object({ model: z.string(), embedding: z.string(), fast_model: z.string().optional() }).optional(),
  defaults: defaultsSchema.optional(),
  repos: z.record(z.string(), repoRawSchema),
});

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Config validation failed:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export function formatConfigError(err: ConfigError): string {
  return `Config validation failed:\n${err.issues.map((i) => `  - ${i}`).join("\n")}`;
}

function zodIssuesToStrings(err: z.core.$ZodError): string[] {
  return err.issues.map((issue) => {
    const path = issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
}

function validateSemantics(parsed: z.infer<typeof rawConfigSchema>): string[] {
  const issues: string[] = [];

  if (Object.keys(parsed.repos).length === 0) {
    issues.push("repos: Must define at least one repo");
  }

  for (const [name, repo] of Object.entries(parsed.repos)) {
    for (const ext of repo.extensions) {
      if (!ext.startsWith(".")) {
        issues.push(`repos.${name}.extensions: "${ext}" should start with "." (e.g. ".${ext}")`);
      }
    }

    for (const dir of repo.ignore_dirs) {
      if (dir.includes("/") || dir.includes("\\")) {
        issues.push(`repos.${name}.ignore_dirs: "${dir}" should be a directory name, not a path`);
      }
    }
  }

  return issues;
}

export function parseConfig(raw: unknown): Config {
  let parsed: z.infer<typeof rawConfigSchema>;
  try {
    parsed = rawConfigSchema.parse(raw);
  } catch (error) {
    // Stryker disable next-line ConditionalExpression: equivalent — rawConfigSchema.parse() always throws ZodError for invalid input; other error types are unreachable in practice
    if (error instanceof z.ZodError) {
      throw new ConfigError(zodIssuesToStrings(error));
    }
    throw error;
  }

  if (!parsed.provider && !parsed.letta) {
    throw new ConfigError(["Must specify either 'provider' or 'letta' configuration"]);
  }

  const semanticIssues = validateSemantics(parsed);
  if (semanticIssues.length > 0) {
    throw new ConfigError(semanticIssues);
  }

  let providerConfig: ProviderConfig;
  if (parsed.provider) {
    if (parsed.provider.type === "letta") {
      providerConfig = { type: "letta", model: parsed.provider.model, embedding: parsed.provider.embedding, fastModel: parsed.provider.fast_model };
    } else {
      providerConfig = { type: "viking", openrouterModel: parsed.provider.openrouter_model, vikingUrl: parsed.provider.viking_url };
    }
  } else {
    // migrate old letta: format
    providerConfig = { type: "letta", model: parsed.letta!.model, embedding: parsed.letta!.embedding, fastModel: parsed.letta!.fast_model };
  }

  const userDefaults = parsed.defaults ?? {};
  const defaults = {
    maxFileSizeKb: userDefaults.max_file_size_kb ?? BUILT_IN_DEFAULTS.maxFileSizeKb,
    memoryBlockLimit: userDefaults.memory_block_limit ?? BUILT_IN_DEFAULTS.memoryBlockLimit,
    bootstrapOnCreate: userDefaults.bootstrap_on_create ?? BUILT_IN_DEFAULTS.bootstrapOnCreate,
    chunking: userDefaults.chunking ?? BUILT_IN_DEFAULTS.chunking,
    askTimeoutMs: userDefaults.ask_timeout_ms ?? BUILT_IN_DEFAULTS.askTimeoutMs,
  };

  const repos: Record<string, RepoConfig> = {};
  for (const [name, repo] of Object.entries(parsed.repos)) {
    repos[name] = {
      path: repo.path,
      basePath: repo.base_path,
      description: repo.description,
      extensions: repo.extensions,
      ignoreDirs: repo.ignore_dirs,
      tags: repo.tags ?? [],
      persona: repo.persona,
      tools: repo.tools ?? userDefaults.tools,
      maxFileSizeKb: repo.max_file_size_kb ?? defaults.maxFileSizeKb,
      memoryBlockLimit: repo.memory_block_limit ?? defaults.memoryBlockLimit,
      bootstrapOnCreate: repo.bootstrap_on_create ?? defaults.bootstrapOnCreate,
      includeSubmodules: repo.include_submodules ?? false,
    };
  }

  return {
    provider: providerConfig,
    defaults,
    repos,
  };
}
