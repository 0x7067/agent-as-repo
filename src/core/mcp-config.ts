export interface McpServerEntry {
  command: string;
  args: string[];
  timeout: number;
  env: Record<string, string>;
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
  if (provider.preferredProvider) env.PROVIDER_TYPE = provider.preferredProvider;
  if (isNonEmpty(provider.letta?.apiKey)) env.LETTA_API_KEY = provider.letta.apiKey;
  if (isNonEmpty(provider.viking?.openrouterApiKey)) env.OPENROUTER_API_KEY = provider.viking.openrouterApiKey;
  if (isNonEmpty(provider.viking?.vikingApiKey)) env.VIKING_API_KEY = provider.viking.vikingApiKey;

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

  if (binaryPath) {
    if (entry.command !== binaryPath) {
      issues.push(`Command should be "${binaryPath}", got "${entry.command}".`);
    }
  } else {
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

  const providerType = entry.env?.PROVIDER_TYPE;
  if (providerType && providerType !== "letta" && providerType !== "viking") {
    issues.push(`PROVIDER_TYPE should be "letta" or "viking", got "${providerType}".`);
  }

  const hasLettaKey = isNonEmpty(entry.env?.LETTA_API_KEY) || isNonEmpty(entry.env?.LETTA_PASSWORD);
  const expectedLettaKey = isNonEmpty(provider.letta?.apiKey);
  if (expectedLettaKey && !hasLettaKey) {
    issues.push("LETTA_API_KEY (or LETTA_PASSWORD) is missing from env.");
  }
  if (hasLettaKey || expectedLettaKey) {
    const baseUrl = entry.env?.LETTA_BASE_URL ?? "";
    if (!baseUrl) {
      issues.push("LETTA_BASE_URL is missing.");
    } else if (baseUrl.endsWith("/v1")) {
      issues.push(`LETTA_BASE_URL ends with "/v1" — the SDK adds this automatically. Use "${DEFAULT_LETTA_BASE_URL}".`);
    }
  }

  const hasVikingKey = isNonEmpty(entry.env?.OPENROUTER_API_KEY);
  const expectedVikingKey = isNonEmpty(provider.viking?.openrouterApiKey);
  if (expectedVikingKey && !hasVikingKey) {
    issues.push("OPENROUTER_API_KEY is missing from env.");
  }
  if (hasVikingKey || expectedVikingKey) {
    const openrouterModel = entry.env?.OPENROUTER_MODEL ?? "";
    if (!openrouterModel) {
      issues.push("OPENROUTER_MODEL is missing from env.");
    } else {
      const expectedModel = provider.viking?.openrouterModel;
      if (isNonEmpty(expectedModel) && openrouterModel !== expectedModel) {
        issues.push(`OPENROUTER_MODEL mismatch: config has "${openrouterModel}", expected "${expectedModel}".`);
      }
    }

    const expectedVikingUrl = provider.viking?.vikingUrl;
    if (isNonEmpty(expectedVikingUrl) && (entry.env?.VIKING_URL ?? "") !== expectedVikingUrl) {
      issues.push(`VIKING_URL mismatch: config has "${entry.env?.VIKING_URL ?? ""}", expected "${expectedVikingUrl}".`);
    }
  }

  if (!hasLettaKey && !hasVikingKey) {
    issues.push("At least one provider key is required: LETTA_API_KEY (or LETTA_PASSWORD) and/or OPENROUTER_API_KEY.");
  }

  if ((entry.timeout ?? 0) < 60) {
    issues.push(`Timeout is ${entry.timeout ?? 0}s — Letta calls can take 30s+. Recommend at least 300.`);
  }

  return { ok: issues.length === 0, issues };
}
