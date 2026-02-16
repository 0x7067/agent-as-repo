import { z } from "zod/v4";
import type { Config, RepoConfig } from "./types.js";

const BUILT_IN_DEFAULTS = {
  maxFileSizeKb: 50,
  memoryBlockLimit: 5000,
  bootstrapOnCreate: true,
};

const defaultsSchema = z.object({
  max_file_size_kb: z.number().optional(),
  memory_block_limit: z.number().optional(),
  bootstrap_on_create: z.boolean().optional(),
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
});

const rawConfigSchema = z.object({
  letta: z.object({
    model: z.string(),
    embedding: z.string(),
  }),
  defaults: defaultsSchema.optional(),
  repos: z.record(z.string(), repoRawSchema),
});

export function parseConfig(raw: unknown): Config {
  const parsed = rawConfigSchema.parse(raw);

  const userDefaults = parsed.defaults ?? {};
  const defaults = {
    maxFileSizeKb: userDefaults.max_file_size_kb ?? BUILT_IN_DEFAULTS.maxFileSizeKb,
    memoryBlockLimit: userDefaults.memory_block_limit ?? BUILT_IN_DEFAULTS.memoryBlockLimit,
    bootstrapOnCreate: userDefaults.bootstrap_on_create ?? BUILT_IN_DEFAULTS.bootstrapOnCreate,
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
    };
  }

  return {
    letta: parsed.letta,
    defaults,
    repos,
  };
}
