export interface McpServerEntry {
  command: string;
  args: string[];
  timeout: number;
  env: Record<string, string>;
}

export function generateMcpEntry(
  mcpServerPath: string,
  apiKey: string,
  baseUrl = "https://api.letta.com",
  binaryPath?: string,
): McpServerEntry {
  if (binaryPath) {
    return {
      command: binaryPath,
      args: [],
      timeout: 300,
      env: { LETTA_BASE_URL: baseUrl, LETTA_API_KEY: apiKey },
    };
  }
  return {
    command: "npx",
    args: ["tsx", mcpServerPath],
    timeout: 300,
    env: { LETTA_BASE_URL: baseUrl, LETTA_API_KEY: apiKey },
  };
}

export interface McpCheckResult {
  ok: boolean;
  issues: string[];
}

export function checkMcpEntry(
  entry: McpServerEntry | undefined,
  mcpServerPath: string,
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

  if ((entry.timeout ?? 0) < 60) {
    issues.push(`Timeout is ${entry.timeout ?? 0}s — Letta calls can take 30s+. Recommend at least 300.`);
  }

  return { ok: issues.length === 0, issues };
}
