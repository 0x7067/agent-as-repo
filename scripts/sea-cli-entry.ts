import { main } from "../src/cli.js";

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`repo-expert error: ${message}\n`);
  process.exitCode = 1;
});
