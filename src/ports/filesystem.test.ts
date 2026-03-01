import { describe, it, expect } from "vitest";
import type { FileSystemPort } from "./filesystem.js";

describe("FileSystemPort", () => {
  it("interface is structurally satisfied by an object with all methods", () => {
    const mock: FileSystemPort = {
      readFile: async () => "",
      writeFile: async () => {},
      stat: async () => ({ size: 0, isDirectory: () => false }),
      access: async () => {},
      rename: async () => {},
      copyFile: async () => {},
      glob: async () => [],
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
