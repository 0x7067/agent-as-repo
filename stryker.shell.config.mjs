export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.stryker.shell.config.ts" },
  mutate: [
    "src/shell/**/*.ts",
    "!src/shell/**/*.test.ts",
  ],
  coverageAnalysis: "perTest",
  thresholds: { high: 97, low: 90, break: 70 },
  reporters: ["clear-text", "progress"],
};
