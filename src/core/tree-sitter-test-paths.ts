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

/** Kotlin/Swift ship no wasm in their npm packages at all — their wasm is vendored in-repo (see
 * vendor/wasm/checksums.json + scripts/build-grammar-wasm.ts), not resolved from node_modules. */
function vendoredWasmPath(file: string): string {
  return path.join(ROOT, "vendor", "wasm", file);
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
  rust: wasmPath("tree-sitter-rust", "tree-sitter-rust.wasm"),
  php: wasmPath("tree-sitter-php", "tree-sitter-php.wasm"),
  c: wasmPath("tree-sitter-c", "tree-sitter-c.wasm"),
  cpp: wasmPath("tree-sitter-cpp", "tree-sitter-cpp.wasm"),
  csharp: wasmPath("tree-sitter-c-sharp", "tree-sitter-c_sharp.wasm"),
  kotlin: vendoredWasmPath("tree-sitter-kotlin.wasm"),
  swift: vendoredWasmPath("tree-sitter-swift.wasm"),
};
