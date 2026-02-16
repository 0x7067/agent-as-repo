#!/usr/bin/env tsx
/**
 * Generates MCP server config JSON for Claude Code or Cursor
 * from the project's .env file.
 *
 * Usage: pnpm tsx scripts/generate-mcp-config.ts [--cursor]
 */
import "dotenv/config";

const apiKey = process.env.LETTA_API_KEY;
if (!apiKey) {
  console.error("Error: LETTA_API_KEY not found in .env");
  process.exit(1);
}

const baseUrl = process.env.LETTA_BASE_URL ?? "https://api.letta.com/v1";
const isCursor = process.argv.includes("--cursor");

const config = {
  mcpServers: {
    letta: {
      command: "letta-mcp",
      ...(isCursor ? {} : { args: [] as string[] }),
      env: {
        LETTA_BASE_URL: baseUrl,
        LETTA_PASSWORD: apiKey,
      },
    },
  },
};

const target = isCursor ? ".cursor/mcp.json" : "~/.claude/settings.json (mcpServers section)";
console.log(`# MCP config for ${target}`);
console.log(`# Paste this into your config file:\n`);
console.log(JSON.stringify(config, null, 2));
