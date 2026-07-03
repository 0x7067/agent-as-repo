import path from "node:path";
import { fileURLToPath } from "node:url";

export interface TreeSitterWasmPaths {
  webTreeSitterWasm: string;
  typescriptWasm: string;
  tsxWasm: string;
  javascriptWasm: string;
}

export function resolvePackageRoot(fromModuleUrl = import.meta.url): string {
  return path.resolve(fileURLToPath(new URL("../..", fromModuleUrl)));
}

export function resolveTreeSitterWasmPaths(packageRoot = resolvePackageRoot()): TreeSitterWasmPaths {
  return {
    webTreeSitterWasm: path.join(packageRoot, "node_modules/web-tree-sitter/web-tree-sitter.wasm"),
    typescriptWasm: path.join(packageRoot, "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm"),
    tsxWasm: path.join(packageRoot, "node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm"),
    javascriptWasm: path.join(packageRoot, "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm"),
  };
}
