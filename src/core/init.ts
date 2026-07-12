import path from "node:path";
import yaml from "js-yaml";

/** Extensions to exclude from detection (binary/asset files). */
const EXCLUDED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".lock", ".map",
  ".pbxproj", ".xcworkspacedata", ".resolved", ".sample",
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

  const ranked = [...counts.entries()];
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked.slice(0, maxCount).map(([ext]) => ext);
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
  return path.basename(repoPath);
}

export interface NonInteractiveGuardInput {
  /** True when interactive prompting is currently possible (a TTY session, no --no-input). */
  allowPrompts: boolean;
  /** True when a repo path was already supplied via --repo-path. */
  repoPathProvided: boolean;
  /** True when the user explicitly passed --no-input (vs. stdin simply not being a TTY). */
  noInputFlagSet: boolean;
}

/**
 * Decide whether `init` can proceed without prompting. Returns an error
 * message when interactive prompts would be required but aren't available
 * (e.g. piped/non-TTY stdin with no --repo-path flag), or null when init
 * can proceed — either prompts are allowed, or all required input was
 * already supplied via flags.
 *
 * Fixes finding 7: piped (non-TTY) stdin with no flags used to silently
 * consume buffered lines, then exit 0 having written nothing once stdin
 * hit EOF mid-prompt.
 */
export function nonInteractiveInitError(input: NonInteractiveGuardInput): string | null {
  if (input.allowPrompts || input.repoPathProvided) return null;
  return input.noInputFlagSet
    ? "Repository path is required. Pass --repo-path in non-interactive mode."
    : "stdin is not a TTY — use --yes --repo-path <path> (and --model/--base-url as needed) for non-interactive init.";
}

export interface InitConfig {
  repoName: string;
  repoPath: string;
  description: string;
  extensions: string[];
  ignoreDirs: string[];
  /** Chat model id as the LLM endpoint knows it. */
  model?: string;
  /** OpenAI-compatible base URL (default: local Ollama). */
  baseUrl?: string;
  /** Embedding engine (default "http"); only written to the config when non-default. */
  embeddingEngine?: "http" | "transformersjs";
}

const DEFAULT_MODEL = "qwen3-coder:30b";
const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";

/**
 * Generate config.yaml content from init parameters.
 */
export function generateConfigYaml(config: InitConfig): string {
  const doc = {
    provider: {
      model: config.model ?? DEFAULT_MODEL,
      base_url: config.baseUrl ?? DEFAULT_LLM_BASE_URL,
      ...(config.embeddingEngine === "transformersjs" ? { embedding_engine: "transformersjs" } : {}),
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
