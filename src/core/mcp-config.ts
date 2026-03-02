export interface McpServerEntry {
  command: string;
  args: string[];
  timeout: number;
  env: Record<string, string>;
}

export type McpProviderConfig =
  | {
      type: "letta";
      apiKey: string;
      baseUrl?: string;
    }
  | {
      type: "viking";
      openrouterApiKey: string;
      openrouterModel: string;
      vikingUrl?: string;
      vikingApiKey?: string;
    };

export function generateMcpEntry(
  mcpServerPath: string,
  provider: McpProviderConfig,
  binaryPath?: string,
): McpServerEntry {
  const env = provider.type === "letta"
    ? {
        LETTA_BASE_URL: provider.baseUrl ?? "https://api.letta.com",
        LETTA_API_KEY: provider.apiKey,
      }
    : {
        PROVIDER_TYPE: "viking",
        OPENROUTER_API_KEY: provider.openrouterApiKey,
        OPENROUTER_MODEL: provider.openrouterModel,
        ...(provider.vikingUrl ? { VIKING_URL: provider.vikingUrl } : {}),
        ...(provider.vikingApiKey ? { VIKING_API_KEY: provider.vikingApiKey } : {}),
      };

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

  if (provider.type === "letta") {
    const baseUrl = entry.env?.LETTA_BASE_URL ?? "";
    if (baseUrl.endsWith("/v1")) {
      issues.push(`LETTA_BASE_URL ends with "/v1" — the SDK adds this automatically. Use "https://api.letta.com".`);
    }
    if (!baseUrl) {
      issues.push("LETTA_BASE_URL is missing.");
    }

    const apiKey = entry.env?.LETTA_API_KEY ?? entry.env?.LETTA_PASSWORD ?? "";
    if (!apiKey) {
      issues.push("LETTA_API_KEY (or LETTA_PASSWORD) is missing from env.");
    }
  } else {
    if (entry.env?.PROVIDER_TYPE !== "viking") {
      issues.push(`PROVIDER_TYPE should be "viking", got "${entry.env?.PROVIDER_TYPE ?? "(missing)"}".`);
    }

    const openrouterApiKey = entry.env?.OPENROUTER_API_KEY ?? "";
    if (!openrouterApiKey) {
      issues.push("OPENROUTER_API_KEY is missing from env.");
    }

    const openrouterModel = entry.env?.OPENROUTER_MODEL ?? "";
    if (!openrouterModel) {
      issues.push("OPENROUTER_MODEL is missing from env.");
    } else if (openrouterModel !== provider.openrouterModel) {
      issues.push(`OPENROUTER_MODEL mismatch: config has "${openrouterModel}", expected "${provider.openrouterModel}".`);
    }

    if (provider.vikingUrl && (entry.env?.VIKING_URL ?? "") !== provider.vikingUrl) {
      issues.push(`VIKING_URL mismatch: config has "${entry.env?.VIKING_URL ?? ""}", expected "${provider.vikingUrl}".`);
    }
  }

  if ((entry.timeout ?? 0) < 60) {
    issues.push(`Timeout is ${entry.timeout ?? 0}s — Letta calls can take 30s+. Recommend at least 300.`);
  }

  return { ok: issues.length === 0, issues };
}
