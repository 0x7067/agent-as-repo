import { z } from "zod/v4";
import type { Config, RepoConfig, ProviderConfig } from "./types.js";

const BUILT_IN_DEFAULTS = {
  maxFileSizeKb: 50,
  memoryBlockLimit: 5000,
  bootstrapOnCreate: true,
  chunking: "tree-sitter" as const,
  askTimeoutMs: 60_000,
  consolidateOnSync: false,
  consolidateMinFilesChanged: 5,
};

const defaultsSchema = z.object({
  max_file_size_kb: z.number().optional(),
  memory_block_limit: z.number().optional(),
  bootstrap_on_create: z.boolean().optional(),
  chunking: z.enum(["raw", "tree-sitter"]).optional(),
  ask_timeout_ms: z.number().optional(),
  consolidate_on_sync: z.boolean().optional(),
  consolidate_min_files_changed: z.number().optional(),
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

const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";

const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

const providerSchema = z.object({
  model: z.string(),
  base_url: z.string().optional(),
  fallback_models: z.array(z.string()).optional(),
  fast_model: z.string().optional(),
  embedding_model: z.string().optional(),
});

const rawConfigSchema = z.object({
  provider: providerSchema.optional(),
  defaults: defaultsSchema.optional(),
  repos: z.record(z.string(), repoRawSchema),
});

const PROVIDER_SHAPE_HINT =
  "Use provider: { model, base_url?, fallback_models?, fast_model?, embedding_model? } (embedded store + OpenAI-compatible LLM). See config.example.yaml.";

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    const formattedIssues = issues.map((issue) => "  - " + issue).join("\n");
    super("Config validation failed:\n" + formattedIssues);
    this.name = "ConfigError";
  }
}

export function formatConfigError(err: ConfigError): string {
  return "Config validation failed:\n" + err.issues.map((issue) => "  - " + issue).join("\n");
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

  if (!parsed.provider) {
    throw new ConfigError([`Must specify a 'provider' block with a 'model'. ${PROVIDER_SHAPE_HINT}`]);
  }

  const semanticIssues = validateSemantics(parsed);
  if (semanticIssues.length > 0) {
    throw new ConfigError(semanticIssues);
  }

  const providerConfig: ProviderConfig = {
    model: parsed.provider.model,
    baseUrl: parsed.provider.base_url ?? DEFAULT_LLM_BASE_URL,
    fallbackModels: parsed.provider.fallback_models ?? [],
    embeddingModel: parsed.provider.embedding_model ?? DEFAULT_EMBEDDING_MODEL,
    ...(parsed.provider.fast_model === undefined ? {} : { fastModel: parsed.provider.fast_model }),
  };

  const userDefaults = parsed.defaults ?? {};
  const defaults = {
    maxFileSizeKb: userDefaults.max_file_size_kb ?? BUILT_IN_DEFAULTS.maxFileSizeKb,
    memoryBlockLimit: userDefaults.memory_block_limit ?? BUILT_IN_DEFAULTS.memoryBlockLimit,
    bootstrapOnCreate: userDefaults.bootstrap_on_create ?? BUILT_IN_DEFAULTS.bootstrapOnCreate,
    chunking: userDefaults.chunking ?? BUILT_IN_DEFAULTS.chunking,
    askTimeoutMs: userDefaults.ask_timeout_ms ?? BUILT_IN_DEFAULTS.askTimeoutMs,
    consolidateOnSync: userDefaults.consolidate_on_sync ?? BUILT_IN_DEFAULTS.consolidateOnSync,
    consolidateMinFilesChanged:
      userDefaults.consolidate_min_files_changed ?? BUILT_IN_DEFAULTS.consolidateMinFilesChanged,
  };

  const repos: Record<string, RepoConfig> = {};
  for (const [name, repo] of Object.entries(parsed.repos)) {
    const tools = repo.tools ?? userDefaults.tools;
    repos[name] = {
      path: repo.path,
      description: repo.description,
      extensions: repo.extensions,
      ignoreDirs: repo.ignore_dirs,
      tags: repo.tags ?? [],
      maxFileSizeKb: repo.max_file_size_kb ?? defaults.maxFileSizeKb,
      memoryBlockLimit: repo.memory_block_limit ?? defaults.memoryBlockLimit,
      bootstrapOnCreate: repo.bootstrap_on_create ?? defaults.bootstrapOnCreate,
      includeSubmodules: repo.include_submodules ?? false,
      ...(repo.base_path === undefined ? {} : { basePath: repo.base_path }),
      ...(repo.persona === undefined ? {} : { persona: repo.persona }),
      ...(tools === undefined ? {} : { tools }),
    };
  }

  return {
    provider: providerConfig,
    defaults,
    repos,
  };
}
