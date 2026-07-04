import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GrammarLabel } from "./tree-sitter-chunker.js";

/**
 * Test-only wasm path wiring shared by every test that needs a real parser
 * (tree-sitter-chunker.test.ts, the per-language colocated tests, and
 * src/shell/sync.test.ts). Not imported by any production code.
 */

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function wasmPath(pkg: string, file: string): string {
  return path.join(ROOT, "node_modules", pkg, file);
}

export const WEB_TREE_SITTER_WASM = wasmPath("web-tree-sitter", "web-tree-sitter.wasm");

export const GRAMMAR_WASM_BY_LABEL: Record<GrammarLabel, string> = {
  typescript: wasmPath("tree-sitter-typescript", "tree-sitter-typescript.wasm"),
  tsx: wasmPath("tree-sitter-typescript", "tree-sitter-tsx.wasm"),
  javascript: wasmPath("tree-sitter-javascript", "tree-sitter-javascript.wasm"),
  python: wasmPath("tree-sitter-python", "tree-sitter-python.wasm"),
  go: wasmPath("tree-sitter-go", "tree-sitter-go.wasm"),
  java: wasmPath("tree-sitter-java", "tree-sitter-java.wasm"),
  ruby: wasmPath("tree-sitter-ruby", "tree-sitter-ruby.wasm"),
};
