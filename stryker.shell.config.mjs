export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.stryker.shell.config.ts" },
  mutate: [
    "src/shell/**/*.ts",
    "!src/shell/**/*.test.ts",
    // doctor.ts and init.ts are tested via process.chdir() tests that can't run in Stryker sandbox
    "!src/shell/doctor.ts",
    "!src/shell/init.ts",
  ],
  coverageAnalysis: "perTest",
  thresholds: { high: 97, low: 90, break: 0 },
  reporters: ["clear-text", "progress"],
};
