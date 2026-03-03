export interface McpServerEntry {
  command: string;
  args?: string[];
  timeout?: number;
  env: Record<string, string | undefined>;
}

export interface McpProviderConfig {
  preferredProvider?: "letta" | "viking";
  letta?: {
    apiKey?: string;
    baseUrl?: string;
  };
  viking?: {
    openrouterApiKey?: string;
    openrouterModel?: string;
    vikingUrl?: string;
    vikingApiKey?: string;
  };
}

const DEFAULT_LETTA_BASE_URL = "https://api.letta.com";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const DEFAULT_VIKING_URL = "http://localhost:1933";

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function generateMcpEntry(
  mcpServerPath: string,
  provider: McpProviderConfig,
  binaryPath?: string,
): McpServerEntry {
  const env: Record<string, string> = {
    LETTA_BASE_URL: provider.letta?.baseUrl ?? DEFAULT_LETTA_BASE_URL,
    OPENROUTER_MODEL: provider.viking?.openrouterModel ?? DEFAULT_OPENROUTER_MODEL,
    VIKING_URL: provider.viking?.vikingUrl ?? DEFAULT_VIKING_URL,
  };
  if (provider.preferredProvider) env["PROVIDER_TYPE"] = provider.preferredProvider;
  if (isNonEmpty(provider.letta?.apiKey)) env["LETTA_API_KEY"] = provider.letta.apiKey;
  if (isNonEmpty(provider.viking?.openrouterApiKey)) env["OPENROUTER_API_KEY"] = provider.viking.openrouterApiKey;
  if (isNonEmpty(provider.viking?.vikingApiKey)) env["VIKING_API_KEY"] = provider.viking.vikingApiKey;

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

function checkProviderType(providerType: string | undefined, issues: string[]): void {
  if (providerType && providerType !== "letta" && providerType !== "viking") {
    issues.push(`PROVIDER_TYPE should be "letta" or "viking", got "${providerType}".`);
  }
}

function checkLettaConfig(
  env: Record<string, string | undefined>,
  provider: McpProviderConfig,
  issues: string[],
): boolean {
  const hasLettaKey = isNonEmpty(env["LETTA_API_KEY"]) || isNonEmpty(env["LETTA_PASSWORD"]);
  const expectedLettaKey = isNonEmpty(provider.letta?.apiKey);

  if (expectedLettaKey && !hasLettaKey) {
    issues.push("LETTA_API_KEY (or LETTA_PASSWORD) is missing from env.");
  }

  if (hasLettaKey || expectedLettaKey) {
    const baseUrl = env["LETTA_BASE_URL"] ?? "";
    if (!baseUrl) {
      issues.push("LETTA_BASE_URL is missing.");
    } else if (baseUrl.endsWith("/v1")) {
      issues.push(`LETTA_BASE_URL ends with "/v1" — the SDK adds this automatically. Use "${DEFAULT_LETTA_BASE_URL}".`);
    }
  }

  return hasLettaKey;
}

function checkVikingConfig(
  env: Record<string, string | undefined>,
  provider: McpProviderConfig,
  issues: string[],
): boolean {
  const hasVikingKey = isNonEmpty(env["OPENROUTER_API_KEY"]);
  const expectedVikingKey = isNonEmpty(provider.viking?.openrouterApiKey);

  if (expectedVikingKey && !hasVikingKey) {
    issues.push("OPENROUTER_API_KEY is missing from env.");
  }

  if (hasVikingKey || expectedVikingKey) {
    const openrouterModel = env["OPENROUTER_MODEL"] ?? "";
    if (openrouterModel) {
      const expectedModel = provider.viking?.openrouterModel;
      if (isNonEmpty(expectedModel) && openrouterModel !== expectedModel) {
        issues.push(`OPENROUTER_MODEL mismatch: config has "${openrouterModel}", expected "${expectedModel}".`);
      }
    } else {
      issues.push("OPENROUTER_MODEL is missing from env.");
    }

    const configuredVikingUrl = env["VIKING_URL"] ?? "";
    const expectedVikingUrl = provider.viking?.vikingUrl;
    if (isNonEmpty(expectedVikingUrl) && configuredVikingUrl !== expectedVikingUrl) {
      issues.push(`VIKING_URL mismatch: config has "${configuredVikingUrl}", expected "${expectedVikingUrl}".`);
    }
  }

  return hasVikingKey;
}

export function checkMcpEntry(
  entry: McpServerEntry | undefined,
  mcpServerPath: string,
  provider: McpProviderConfig,
  binaryPath?: string,
): McpCheckResult {
  const issues: string[] = [];

  if (!entry) {
    issues.push('No "letta" entry found in mcpServers.');
    return { ok: false, issues };
  }

  checkCommandAndArgs(entry, mcpServerPath, binaryPath, issues);

  const env = entry.env;
  checkProviderType(env["PROVIDER_TYPE"], issues);
  const hasLettaKey = checkLettaConfig(env, provider, issues);
  const hasVikingKey = checkVikingConfig(env, provider, issues);

  if (hasLettaKey || hasVikingKey) {
    // At least one provider key is present.
  } else {
    issues.push("At least one provider key is required: LETTA_API_KEY (or LETTA_PASSWORD) and/or OPENROUTER_API_KEY.");
  }

  const timeout = entry.timeout ?? 0;
  if (timeout < 60) {
    issues.push(`Timeout is ${String(timeout)}s — Letta calls can take 30s+. Recommend at least 300.`);
  }

  return { ok: issues.length === 0, issues };
}
