import path from "node:path";

export interface McpServerEntry {
  command: string;
  args?: string[];
  timeout?: number;
  env: Record<string, string | undefined>;
}

export interface McpProviderConfig {
  /** Chat model id as the LLM endpoint knows it. */
  model?: string;
  /** OpenAI-compatible base URL. */
  baseUrl?: string;
  /** Embedding model id served by the same endpoint. */
  embeddingModel?: string;
  /** Embedding engine ("http" or "transformersjs"). */
  embeddingEngine?: string;
  /** Optional Bearer key for the LLM endpoint. */
  llmApiKey?: string;
}

/**
 * How the MCP server should be launched by the MCP client:
 * - "sea-binary": self-contained single executable (dist/repo-expert-mcp)
 * - "bundled": esbuild output shipped in the npm package (node dist/bin/mcp-server.mjs)
 * - "dev": source checkout, run via npx tsx (tsx is a devDependency)
 */
export type McpLaunchSpec =
  | { kind: "sea-binary"; binaryPath: string }
  | { kind: "bundled"; serverScriptPath: string }
  | { kind: "dev"; serverPath: string };

const DEFAULT_LLM_MODEL = "qwen3-coder:30b";
const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

/** MCP server entry name in the Claude Code / Cursor config. */
export const MCP_SERVER_ENTRY_NAME = "repo-expert";

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decide how the MCP server should be launched, given the path of the
 * running CLI entry script. A compiled entry (dist/bin/cli.mjs from the
 * npm package) has a bundled mcp-server.mjs sibling; a .ts entry means a
 * source checkout where the tsx devDependency is available.
 */
export function resolveMcpLaunchSpec(cliScriptPath: string, seaBinaryPath?: string): McpLaunchSpec {
  if (seaBinaryPath !== undefined) {
    return { kind: "sea-binary", binaryPath: seaBinaryPath };
  }
  const dir = path.dirname(cliScriptPath);
  if (/\.(?:mjs|cjs|js)$/.test(cliScriptPath)) {
    return { kind: "bundled", serverScriptPath: path.join(dir, "mcp-server.mjs") };
  }
  return { kind: "dev", serverPath: path.join(dir, "mcp-server.ts") };
}

export function generateMcpEntry(launch: McpLaunchSpec, provider: McpProviderConfig): McpServerEntry {
  const env: Record<string, string> = {
    LLM_MODEL: provider.model ?? DEFAULT_LLM_MODEL,
    LLM_BASE_URL: provider.baseUrl ?? DEFAULT_LLM_BASE_URL,
    LLM_EMBEDDING_MODEL: provider.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
    LLM_EMBEDDING_ENGINE: provider.embeddingEngine ?? "http",
  };
  if (isNonEmpty(provider.llmApiKey)) env["LLM_API_KEY"] = provider.llmApiKey;

  switch (launch.kind) {
    case "sea-binary": {
      return { command: launch.binaryPath, args: [], timeout: 300, env };
    }
    case "bundled": {
      return { command: "node", args: [launch.serverScriptPath], timeout: 300, env };
    }
    case "dev": {
      return { command: "npx", args: ["tsx", launch.serverPath], timeout: 300, env };
    }
  }
}

export interface McpCheckResult {
  ok: boolean;
  issues: string[];
}

/** Which of the two config locations `mcp-check`/`mcp-install` resolved to. */
export type McpConfigLocation = "local" | "global";

export interface McpConfigSelection {
  location: McpConfigLocation;
  configPath: string;
}

/**
 * Decide which Claude Code config file `mcp-check` should read, mirroring
 * `mcp-install`'s `--local`/`--global` flags (finding 8). `mcp-install
 * --local` writes `./.claude.json`, but `mcp-check` used to only ever read
 * `~/.claude.json`, so a local install could never validate. When neither
 * flag is passed, prefer the local file if one exists (it's the more
 * specific, more likely intended target), falling back to the traditional
 * global location — reporting back which one was actually used.
 */
export function selectMcpConfigFile(
  opts: { local?: boolean; global?: boolean },
  paths: { localPath: string; globalPath: string },
  existence: { localExists: boolean; globalExists: boolean },
): McpConfigSelection | null {
  if (opts.local) {
    return existence.localExists ? { location: "local", configPath: paths.localPath } : null;
  }
  if (opts.global) {
    return existence.globalExists ? { location: "global", configPath: paths.globalPath } : null;
  }
  if (existence.localExists) return { location: "local", configPath: paths.localPath };
  if (existence.globalExists) return { location: "global", configPath: paths.globalPath };
  return null;
}

function checkCommandAndArgs(entry: McpServerEntry, launch: McpLaunchSpec, issues: string[]): void {
  const args = entry.args ?? [];

  switch (launch.kind) {
    case "sea-binary": {
      if (entry.command !== launch.binaryPath) {
        issues.push(`Command should be "${launch.binaryPath}", got "${entry.command}".`);
      }
      return;
    }
    case "bundled": {
      if (entry.command !== "node") {
        issues.push(`Command should be "node", got "${entry.command}".`);
      }
      const configuredPath = args[0] ?? "";
      if (configuredPath !== launch.serverScriptPath) {
        issues.push(`Server path mismatch: config has "${configuredPath}", expected "${launch.serverScriptPath}".`);
      }
      return;
    }
    case "dev": {
      if (entry.command !== "npx") {
        issues.push(`Command should be "npx", got "${entry.command}".`);
      }
      if (args[0] !== "tsx") {
        const got = args[0] ?? "(missing)";
        issues.push(`First arg should be "tsx", got "${got}". Use "npx tsx" to avoid PATH issues.`);
      }
      const configuredPath = args[1] ?? "";
      if (configuredPath !== launch.serverPath) {
        issues.push(`Server path mismatch: config has "${configuredPath}", expected "${launch.serverPath}".`);
      }
      return;
    }
  }
}

function checkEnv(
  env: Record<string, string | undefined>,
  provider: McpProviderConfig,
  issues: string[],
): void {
  const model = env["LLM_MODEL"] ?? "";
  if (!isNonEmpty(model)) {
    issues.push("LLM_MODEL is missing from env.");
  } else if (isNonEmpty(provider.model) && model !== provider.model) {
    issues.push(`LLM_MODEL mismatch: config has "${model}", expected "${provider.model}".`);
  }

  const baseUrl = env["LLM_BASE_URL"] ?? "";
  if (!isNonEmpty(baseUrl)) {
    issues.push("LLM_BASE_URL is missing from env.");
  } else if (isNonEmpty(provider.baseUrl) && baseUrl !== provider.baseUrl) {
    issues.push(`LLM_BASE_URL mismatch: config has "${baseUrl}", expected "${provider.baseUrl}".`);
  }

  const embeddingModel = env["LLM_EMBEDDING_MODEL"] ?? "";
  if (isNonEmpty(provider.embeddingModel) && embeddingModel !== provider.embeddingModel) {
    issues.push(
      `LLM_EMBEDDING_MODEL mismatch: config has "${embeddingModel}", expected "${provider.embeddingModel}".`,
    );
  }

  const embeddingEngine = env["LLM_EMBEDDING_ENGINE"] ?? "";
  if (isNonEmpty(provider.embeddingEngine) && embeddingEngine !== provider.embeddingEngine) {
    issues.push(
      `LLM_EMBEDDING_ENGINE mismatch: config has "${embeddingEngine}", expected "${provider.embeddingEngine}".`,
    );
  }
}

export function checkMcpEntry(
  entry: McpServerEntry | undefined,
  launch: McpLaunchSpec,
  provider: McpProviderConfig,
): McpCheckResult {
  const issues: string[] = [];

  if (!entry) {
    issues.push(`No "${MCP_SERVER_ENTRY_NAME}" entry found in mcpServers.`);
    return { ok: false, issues };
  }

  checkCommandAndArgs(entry, launch, issues);
  checkEnv(entry.env, provider, issues);

  const timeout = entry.timeout ?? 0;
  if (timeout < 60) {
    issues.push(`Timeout is ${String(timeout)}s — agent calls can take 30s+. Recommend at least 300.`);
  }

  return { ok: issues.length === 0, issues };
}
