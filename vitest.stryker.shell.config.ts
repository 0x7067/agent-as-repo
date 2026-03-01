import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/shell/**/*.test.ts",
      "src/mcp-server.test.ts",
    ],
    exclude: [
      // These files use process.chdir() which is not supported in Stryker sandbox workers.
      // Port-injected versions of these tests live in *.stryker.test.ts files.
      "src/shell/doctor.test.ts",
      "src/shell/init.test.ts",
    ],
    pool: "forks",
  },
});
