import { main } from "../src/mcp-server.js";

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`letta-tools MCP server error: ${message}\n`);
  process.exit(1);
});
