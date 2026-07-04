import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GrammarLabel } from "../core/tree-sitter-chunker.js";

export interface TreeSitterWasmPaths {
  webTreeSitterWasm: string;
  grammarWasmByLabel: Record<GrammarLabel, string>;
}

/** Package name and wasm filename for each supported grammar, relative to `node_modules/`. */
const GRAMMAR_PACKAGE_INFO: Record<GrammarLabel, { pkg: string; file: string }> = {
  typescript: { pkg: "tree-sitter-typescript", file: "tree-sitter-typescript.wasm" },
  tsx: { pkg: "tree-sitter-typescript", file: "tree-sitter-tsx.wasm" },
  javascript: { pkg: "tree-sitter-javascript", file: "tree-sitter-javascript.wasm" },
  python: { pkg: "tree-sitter-python", file: "tree-sitter-python.wasm" },
  go: { pkg: "tree-sitter-go", file: "tree-sitter-go.wasm" },
  java: { pkg: "tree-sitter-java", file: "tree-sitter-java.wasm" },
  ruby: { pkg: "tree-sitter-ruby", file: "tree-sitter-ruby.wasm" },
  rust: { pkg: "tree-sitter-rust", file: "tree-sitter-rust.wasm" },
  php: { pkg: "tree-sitter-php", file: "tree-sitter-php.wasm" },
  c: { pkg: "tree-sitter-c", file: "tree-sitter-c.wasm" },
  cpp: { pkg: "tree-sitter-cpp", file: "tree-sitter-cpp.wasm" },
  // Package name uses a hyphen, but the shipped wasm filename uses an underscore.
  csharp: { pkg: "tree-sitter-c-sharp", file: "tree-sitter-c_sharp.wasm" },
};

export function resolvePackageRoot(fromModuleUrl = import.meta.url): string {
  return path.resolve(fileURLToPath(new URL("../..", fromModuleUrl)));
}

export function resolveTreeSitterWasmPaths(packageRoot = resolvePackageRoot()): TreeSitterWasmPaths {
  const entries = Object.entries(GRAMMAR_PACKAGE_INFO) as [GrammarLabel, { pkg: string; file: string }][];
  const grammarWasmByLabel = Object.fromEntries(
    entries.map(([label, { pkg, file }]) => [label, path.join(packageRoot, "node_modules", pkg, file)]),
  ) as Record<GrammarLabel, string>;

  return {
    webTreeSitterWasm: path.join(packageRoot, "node_modules/web-tree-sitter/web-tree-sitter.wasm"),
    grammarWasmByLabel,
  };
}
