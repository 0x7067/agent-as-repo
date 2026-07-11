import { beforeAll, describe, expect, it } from "vitest";
import { buildBulkIndexArtifacts } from "./cli.js";
import { selectChunkingStrategy } from "./core/chunker.js";
import {
  initTreeSitterChunker,
  resetTreeSitterChunkerForTests,
} from "./core/tree-sitter-chunker.js";
import { GRAMMAR_WASM_BY_LABEL, WEB_TREE_SITTER_WASM } from "./core/tree-sitter-test-paths.js";
import type { FileInfo } from "./core/types.js";

// Guards the wiring bug where the bulk index path (setup / full reindex) built
// chunks without enrichment, so a fresh index carried no file-local context.
describe("buildBulkIndexArtifacts", () => {
  beforeAll(async () => {
    resetTreeSitterChunkerForTests();
    await initTreeSitterChunker({
      webTreeSitterWasm: WEB_TREE_SITTER_WASM,
      grammarWasmByLabel: GRAMMAR_WASM_BY_LABEL,
    });
  });

  it("enriches bulk-indexed chunks with file-local context and builds symbol files", () => {
    const files: FileInfo[] = [
      {
        path: "src/a.ts",
        content: [
          "import { getSession } from './auth/session';",
          "export function handler(): void {",
          "  getSession();",
          "}",
        ].join("\n"),
        sizeKb: 0.1,
      },
    ];

    const { chunks, symbolFiles } = buildBulkIndexArtifacts(
      files,
      selectChunkingStrategy("tree-sitter"),
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.text.startsWith("FILE: src/a.ts"))).toBe(true);
    expect(chunks.some((c) => c.text.includes("imports:") && c.text.includes("session"))).toBe(true);
    expect(chunks.some((c) => c.text.includes("exports:") && c.text.includes("handler"))).toBe(true);
    expect(symbolFiles["src/a.ts"]).toBeDefined();
  });
});
