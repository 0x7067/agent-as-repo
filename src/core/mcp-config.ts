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
  /** Optional Bearer key for the LLM endpoint. */
  llmApiKey?: string;
}

const DEFAULT_LLM_MODEL = "qwen3-coder:30b";
const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

/** MCP server entry name in the Claude Code / Cursor config. */
export const MCP_SERVER_ENTRY_NAME = "repo-expert";

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function generateMcpEntry(
  mcpServerPath: string,
  provider: McpProviderConfig,
  binaryPath?: string,
): McpServerEntry {
  const env: Record<string, string> = {
    LLM_MODEL: provider.model ?? DEFAULT_LLM_MODEL,
    LLM_BASE_URL: provider.baseUrl ?? DEFAULT_LLM_BASE_URL,
    LLM_EMBEDDING_MODEL: provider.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
  };
  if (isNonEmpty(provider.llmApiKey)) env["LLM_API_KEY"] = provider.llmApiKey;

  if (binaryPath) {
    return {
      command: binaryPath,
      args: [],
      timeout: 300,
      env,
    };
  }
  return {
    command: "npx",
    args: ["tsx", mcpServerPath],
    timeout: 300,
    env,
  };
}

export interface McpCheckResult {
  ok: boolean;
  issues: string[];
}

function checkCommandAndArgs(
  entry: McpServerEntry,
  mcpServerPath: string,
  binaryPath: string | undefined,
  issues: string[],
): void {
  if (binaryPath !== undefined) {
    if (entry.command !== binaryPath) {
      issues.push(`Command should be "${binaryPath}", got "${entry.command}".`);
    }
    return;
  }

  if (entry.command !== "npx") {
    issues.push(`Command should be "npx", got "${entry.command}".`);
  }

  const args = entry.args ?? [];
  if (args[0] !== "tsx") {
    const got = args[0] ?? "(missing)";
    issues.push(`First arg should be "tsx", got "${got}". Use "npx tsx" to avoid PATH issues.`);
  }

  const configuredPath = args[1] ?? "";
  if (configuredPath !== mcpServerPath) {
    issues.push(`Server path mismatch: config has "${configuredPath}", expected "${mcpServerPath}".`);
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
}

export function checkMcpEntry(
  entry: McpServerEntry | undefined,
  mcpServerPath: string,
  provider: McpProviderConfig,
  binaryPath?: string,
): McpCheckResult {
  const issues: string[] = [];

  if (!entry) {
    issues.push(`No "${MCP_SERVER_ENTRY_NAME}" entry found in mcpServers.`);
    return { ok: false, issues };
  }

  checkCommandAndArgs(entry, mcpServerPath, binaryPath, issues);
  checkEnv(entry.env, provider, issues);

  const timeout = entry.timeout ?? 0;
  if (timeout < 60) {
    issues.push(`Timeout is ${String(timeout)}s — agent calls can take 30s+. Recommend at least 300.`);
  }

  return { ok: issues.length === 0, issues };
}
