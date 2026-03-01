import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/shell/**/*.test.ts",
      "src/mcp-server.test.ts",
    ],
    exclude: [
      // doctor.test.ts and init.test.ts use process.chdir() which fails in Stryker sandbox workers
      "src/shell/doctor.test.ts",
      "src/shell/init.test.ts",
    ],
    pool: "forks",
  },
});
