import { describe, expect, it } from "vitest";
import { isTestPath } from "./test-path.js";

describe("isTestPath", () => {
  it("recognizes colocated JS/TS test and spec files", () => {
    expect(isTestPath("src/core/chunker.test.ts")).toBe(true);
    expect(isTestPath("src/core/chunker.spec.ts")).toBe(true);
    expect(isTestPath("src/App.test.tsx")).toBe(true);
    expect(isTestPath("lib/util.test.js")).toBe(true);
  });

  it("recognizes per-language colocated conventions", () => {
    expect(isTestPath("pkg/server_test.go")).toBe(true);
    expect(isTestPath("app/models/user_test.rb")).toBe(true);
    expect(isTestPath("mymod/test_parser.py")).toBe(true);
    expect(isTestPath("mymod/parser_test.py")).toBe(true);
    expect(isTestPath("mymod/conftest.py")).toBe(true);
  });

  it("recognizes JVM/.NET PascalCase test-class conventions (case-sensitive)", () => {
    expect(isTestPath("src/main/java/com/x/UserServiceTest.java")).toBe(true);
    expect(isTestPath("src/main/java/com/x/UserServiceTests.java")).toBe(true);
    expect(isTestPath("Api/UserControllerTests.cs")).toBe(true);
    expect(isTestPath("app/PaymentSpec.kt")).toBe(true);
    // Lowercase "latest.java" must NOT match the PascalCase Test suffix.
    expect(isTestPath("src/Latest.java")).toBe(false);
    expect(isTestPath("src/manifest.cs")).toBe(false);
  });

  it("recognizes e2e naming", () => {
    expect(isTestPath("e2e/checkout.e2e.ts")).toBe(true);
  });

  it("recognizes test/spec directory conventions", () => {
    expect(isTestPath("src/__tests__/foo.ts")).toBe(true);
    expect(isTestPath("src/shell/__test__/mock-provider.ts")).toBe(true);
    expect(isTestPath("test/helpers.ts")).toBe(true);
    expect(isTestPath("tests/helpers.ts")).toBe(true);
    expect(isTestPath("spec/models/user.rb")).toBe(true);
  });

  it("treats real implementation files as non-test", () => {
    expect(isTestPath("src/core/chunker.ts")).toBe(false);
    expect(isTestPath("src/shell/sqlite-store.ts")).toBe(false);
    expect(isTestPath("pkg/server.go")).toBe(false);
  });

  it("does not false-positive on lookalike names", () => {
    // "contest", "latest", "attestation" contain "test" but are not tests.
    expect(isTestPath("src/contest.ts")).toBe(false);
    expect(isTestPath("src/latest/config.ts")).toBe(false);
    expect(isTestPath("src/attestation.ts")).toBe(false);
    expect(isTestPath("src/greatest.spec_helpers.ts")).toBe(false);
  });

  it("handles windows-style separators", () => {
    expect(isTestPath(String.raw`src\core\chunker.test.ts`)).toBe(true);
    expect(isTestPath(String.raw`src\__tests__\foo.ts`)).toBe(true);
  });
});
