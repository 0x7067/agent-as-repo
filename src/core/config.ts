import { z } from "zod/v4";
import type { Config, RepoConfig, ProviderConfig } from "./types.js";

const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
/** Default HF model id when embeddings run in-process via transformers.js. */
export const DEFAULT_TRANSFORMERSJS_EMBEDDING_MODEL = "nomic-ai/nomic-embed-text-v1.5";

/** Indexed when a repo doesn't list its own `extensions`. */
export const DEFAULT_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".swift",
  ".c", ".h", ".cpp", ".hpp", ".cs",
  ".md", ".json", ".yaml", ".yml", ".toml",
];

/** Skipped when a repo doesn't list its own `ignore_dirs`. */
export const DEFAULT_IGNORE_DIRS = [
  "node_modules", ".git", "dist", "build", "out", "target", "vendor",
  ".venv", "venv", "__pycache__", ".next", ".turbo", "coverage",
];

const providerSchema = z.strictObject({
  model: z.string(),
  base_url: z.string().optional(),
  embedding_engine: z.enum(["http", "transformersjs"]).optional(),
  embedding_model: z.string().optional(),
  fast_model: z.string().optional(),
  fallback_models: z.array(z.string()).optional(),
});

const repoRawSchema = z.strictObject({
  path: z.string(),
  description: z.string(),
  extensions: z.array(z.string()).optional(),
  ignore_dirs: z.array(z.string()).optional(),
  persona: z.string().optional(),
  base_path: z.string().optional(),
  include_submodules: z.boolean().optional(),
});

const rawConfigSchema = z.strictObject({
  provider: providerSchema.optional(),
  consolidate_on_sync: z.boolean().optional(),
  repos: z.record(z.string(), repoRawSchema),
});

const PROVIDER_SHAPE_HINT =
  "Use provider: { model, base_url?, embedding_engine?, embedding_model?, fast_model?, fallback_models? }. See config.example.yaml.";

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
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

function validateSemantics(parsed: z.infer<typeof rawConfigSchema>): string[] {
  const issues: string[] = [];

  if (Object.keys(parsed.repos).length === 0) {
    issues.push("repos: Must define at least one repo");
  }

  for (const [name, repo] of Object.entries(parsed.repos)) {
    for (const ext of repo.extensions ?? []) {
      if (!ext.startsWith(".")) {
        issues.push(`repos.${name}.extensions: "${ext}" should start with "." (e.g. ".${ext}")`);
      }
    }

    for (const dir of repo.ignore_dirs ?? []) {
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

  const embeddingEngine = parsed.provider.embedding_engine ?? "http";
  const providerConfig: ProviderConfig = {
    model: parsed.provider.model,
    baseUrl: parsed.provider.base_url ?? DEFAULT_LLM_BASE_URL,
    fallbackModels: parsed.provider.fallback_models ?? [],
    embeddingEngine,
    embeddingModel:
      parsed.provider.embedding_model ??
      (embeddingEngine === "transformersjs" ? DEFAULT_TRANSFORMERSJS_EMBEDDING_MODEL : DEFAULT_EMBEDDING_MODEL),
    ...(parsed.provider.fast_model === undefined ? {} : { fastModel: parsed.provider.fast_model }),
  };

  const repos: Record<string, RepoConfig> = {};
  for (const [name, repo] of Object.entries(parsed.repos)) {
    repos[name] = {
      path: repo.path,
      description: repo.description,
      extensions: repo.extensions ?? DEFAULT_EXTENSIONS,
      ignoreDirs: repo.ignore_dirs ?? DEFAULT_IGNORE_DIRS,
      ...(repo.base_path === undefined ? {} : { basePath: repo.base_path }),
      ...(repo.persona === undefined ? {} : { persona: repo.persona }),
      ...(repo.include_submodules === undefined ? {} : { includeSubmodules: repo.include_submodules }),
    };
  }

  return {
    provider: providerConfig,
    consolidateOnSync: parsed.consolidate_on_sync ?? false,
    repos,
  };
}
