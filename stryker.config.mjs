export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.stryker.config.ts" },
  mutate: ["src/core/**/*.ts", "!src/core/**/*.test.ts"],
  coverageAnalysis: "perTest",
  thresholds: { high: 97, low: 90, break: 97 },
  reporters: ["html", "json", "clear-text", "progress"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
};
