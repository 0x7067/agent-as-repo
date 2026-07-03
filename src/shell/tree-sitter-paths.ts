import * as path from "node:path";

export interface TreeSitterWasmPaths {
  webTreeSitterWasm: string;
  typescriptWasm: string;
  tsxWasm: string;
  javascriptWasm: string;
}

export function resolveTreeSitterWasmPaths(projectRoot: string): TreeSitterWasmPaths {
  return {
    webTreeSitterWasm: path.join(projectRoot, "node_modules/web-tree-sitter/web-tree-sitter.wasm"),
    typescriptWasm: path.join(projectRoot, "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm"),
    tsxWasm: path.join(projectRoot, "node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm"),
    javascriptWasm: path.join(projectRoot, "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm"),
  };
}
