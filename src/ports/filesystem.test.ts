import { describe, it, expect } from "vitest";
import type { FileSystemPort } from "./filesystem.js";

describe("FileSystemPort", () => {
  it("interface is structurally satisfied by an object with all methods", () => {
    const mock: FileSystemPort = {
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      stat: () => Promise.resolve({ size: 0, isDirectory: () => false }),
      access: () => Promise.resolve(),
      rename: () => Promise.resolve(),
      copyFile: () => Promise.resolve(),
      glob: () => Promise.resolve([]),
    };

    expect(mock.readFile).toBeDefined();
    expect(mock.writeFile).toBeDefined();
    expect(mock.stat).toBeDefined();
    expect(mock.access).toBeDefined();
    expect(mock.rename).toBeDefined();
    expect(mock.copyFile).toBeDefined();
    expect(mock.glob).toBeDefined();
  });
});
