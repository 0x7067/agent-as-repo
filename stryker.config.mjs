export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.stryker.config.ts" },
  mutate: ["src/core/**/*.ts", "!src/core/**/*.test.ts"],
  coverageAnalysis: "perTest",
  thresholds: { high: 97, low: 90, break: 97 },
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
};
