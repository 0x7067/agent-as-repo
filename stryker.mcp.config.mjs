export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.stryker.shell.config.ts" },
  mutate: ["src/mcp-server.ts"],
  coverageAnalysis: "perTest",
  thresholds: { high: 97, low: 90, break: 0 },
  reporters: ["clear-text", "progress"],
};
