import * as path from "node:path";
import yaml from "js-yaml";

/** Extensions to exclude from detection (binary/asset files). */
const EXCLUDED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".lock", ".map",
]);

/** Directories commonly ignored in code indexing. */
const KNOWN_IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "coverage", ".cache", "__pycache__", ".venv", "venv",
  "target", "vendor", ".expo", "android", "ios",
  ".turbo", ".parcel-cache", "out",
]);

/**
 * Detect the most common file extensions from a list of paths.
 * Excludes binary/asset extensions. Returns up to `maxCount` results.
 */
export function detectExtensions(files: string[], maxCount = 10): string[] {
  const counts = new Map<string, number>();

  for (const file of files) {
    const ext = path.extname(file);
    if (!ext || EXCLUDED_EXTENSIONS.has(ext.toLowerCase())) continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(([ext]) => ext);
}

/**
 * Detect known ignore directories present in a list of file paths.
 */
export function suggestIgnoreDirs(files: string[]): string[] {
  const found = new Set<string>();

  for (const file of files) {
    for (const segment of file.split("/")) {
      if (KNOWN_IGNORE_DIRS.has(segment)) {
        found.add(segment);
      }
    }
  }

  return [...found];
}

/**
 * Extract a repo name from a filesystem path.
 */
export function detectRepoName(repoPath: string): string {
  const cleaned = repoPath.replace(/\/+$/, "");
  return path.basename(cleaned);
}

export interface InitConfig {
  repoName: string;
  repoPath: string;
  description: string;
  extensions: string[];
  ignoreDirs: string[];
}

/**
 * Generate config.yaml content from init parameters.
 */
export function generateConfigYaml(config: InitConfig): string {
  const doc = {
    letta: {
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
    },
    repos: {
      [config.repoName]: {
        path: config.repoPath,
        description: config.description,
        extensions: config.extensions,
        ignore_dirs: config.ignoreDirs,
      },
    },
  };

  return yaml.dump(doc, { lineWidth: 120, quotingType: '"', forceQuotes: false });
}
