/**
 * Spike #9 — tree-sitter chunking feasibility for TypeScript/JavaScript
 *
 * Parses real repo files with web-tree-sitter + WASM grammars, extracts symbol-boundary
 * chunks, and reports timing/quality metrics.
 *
 * Run: pnpm tsx spikes/09-tree-sitter-chunking.ts
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node, type Tree } from "web-tree-sitter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const WASM_ROOT = path.join(PROJECT_ROOT, "node_modules/web-tree-sitter");
const TS_GRAMMAR = path.join(PROJECT_ROOT, "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm");
const TSX_GRAMMAR = path.join(PROJECT_ROOT, "node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm");
const JS_GRAMMAR = path.join(PROJECT_ROOT, "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm");

const SAMPLE_FILES = [
  "src/core/chunker.ts",
  "src/shell/sync.ts",
  "src/cli.ts",
] as const;

const BENCHMARK_DIRS = ["src/core", "src/shell"] as const;

type SymbolKind = "FUNCTION" | "CLASS" | "INTERFACE" | "TYPE" | "CONST" | "METHOD";

interface ExtractedSymbol {
  kind: SymbolKind;
  name: string;
  className?: string;
  startIndex: number;
  endIndex: number;
  prefix: string;
}

interface FileReport {
  path: string;
  lineCount: number;
  parseOk: boolean;
  parseError?: string;
  symbolCount: number;
  symbols: ExtractedSymbol[];
  avgChunkChars: number;
  fallbackRecommended: boolean;
}

function grammarForPath(filePath: string): { wasmPath: string; label: string } {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx") return { wasmPath: TSX_GRAMMAR, label: "tsx" };
  if (ext === ".jsx") return { wasmPath: JS_GRAMMAR, label: "javascript" };
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return { wasmPath: JS_GRAMMAR, label: "javascript" };
  return { wasmPath: TS_GRAMMAR, label: "typescript" };
}

function buildPrefix(filePath: string, symbol: Omit<ExtractedSymbol, "prefix">): string {
  if (symbol.kind === "METHOD" && symbol.className) {
    return `FILE: ${filePath} | CLASS: ${symbol.className} | METHOD: ${symbol.name}`;
  }
  return `FILE: ${filePath} | ${symbol.kind}: ${symbol.name}`;
}

function nodeName(node: Node): string | undefined {
  const nameNode =
    node.childForFieldName("name")
    ?? node.namedChildren.find((child) => child.type === "identifier" || child.type === "type_identifier");
  if (!nameNode) return undefined;
  const text: string = nameNode.text;
  return text.length > 0 ? text : undefined;
}

function symbolFromNode(
  node: Node,
  kind: SymbolKind,
  className?: string,
): ExtractedSymbol | undefined {
  const name = nodeName(node);
  if (!name) return undefined;
  return {
    kind,
    name,
    className,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    prefix: "",
  };
}

function collectConstArrows(node: Node): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  for (const declarator of node.namedChildren) {
    if (declarator.type !== "variable_declarator") continue;
    const value = declarator.childForFieldName("value");
    if (!value?.text.includes("=>")) continue;
    const symbol = symbolFromNode(declarator, "CONST");
    if (symbol) symbols.push(symbol);
  }
  return symbols;
}

function collectClassMethods(classNode: Node, className: string): ExtractedSymbol[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];

  const methods: ExtractedSymbol[] = [];
  for (const member of body.namedChildren) {
    if (member.type !== "method_definition") continue;
    const symbol = symbolFromNode(member, "METHOD", className);
    if (symbol) methods.push(symbol);
  }
  return methods;
}

function extractFromDeclaration(node: Node): ExtractedSymbol[] {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const fn = symbolFromNode(node, "FUNCTION");
      return fn ? [fn] : [];
    }
    case "class_declaration": {
      const cls = symbolFromNode(node, "CLASS");
      if (!cls) return [];
      return [cls, ...collectClassMethods(node, cls.name)];
    }
    case "interface_declaration": {
      const iface = symbolFromNode(node, "INTERFACE");
      return iface ? [iface] : [];
    }
    case "type_alias_declaration": {
      const alias = symbolFromNode(node, "TYPE");
      return alias ? [alias] : [];
    }
    case "lexical_declaration":
    case "variable_declaration": {
      return collectConstArrows(node);
    }
    default: {
      return [];
    }
  }
}

function extractSymbols(_filePath: string, tree: Tree): Omit<ExtractedSymbol, "prefix">[] {
  const symbols: Omit<ExtractedSymbol, "prefix">[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "export_statement") {
      const declaration = child.namedChildren.find((node) =>
        node.type === "function_declaration"
        || node.type === "class_declaration"
        || node.type === "interface_declaration"
        || node.type === "type_alias_declaration"
        || node.type === "lexical_declaration"
        || node.type === "variable_declaration",
      );
      if (declaration) {
        symbols.push(...extractFromDeclaration(declaration));
        continue;
      }
      if (child.text.includes("=>")) {
        const match = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(child.text);
        if (match?.[1]) {
          symbols.push({
            kind: "CONST",
            name: match[1],
            startIndex: child.startIndex,
            endIndex: child.endIndex,
          });
        }
      }
      continue;
    }

    symbols.push(...extractFromDeclaration(child));
  }

  return symbols;
}

function withPrefixes(filePath: string, symbols: Omit<ExtractedSymbol, "prefix">[]): ExtractedSymbol[] {
  return symbols.map((symbol) => ({
    ...symbol,
    prefix: buildPrefix(filePath, symbol),
  }));
}

async function listSourceFiles(limit: number): Promise<string[]> {
  const files: string[] = [];
  for (const dir of BENCHMARK_DIRS) {
    const abs = path.join(PROJECT_ROOT, dir);
    const entries = await fs.readdir(abs, { recursive: true });
    for (const entry of entries) {
      const rel = path.join(dir, typeof entry === "string" ? entry : entry.toString());
      if (!/\.(?:ts|tsx|js|jsx)$/.test(rel)) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".spec.ts") || rel.endsWith(".d.ts")) continue;
      files.push(rel);
      if (files.length >= limit) return files;
    }
  }
  return files;
}

async function main(): Promise<void> {
  console.log("=== Spike #9: tree-sitter chunking feasibility ===\n");

  await Parser.init({
    locateFile: () => path.join(WASM_ROOT, "web-tree-sitter.wasm"),
  });

  const languageCache = new Map<string, Language>();

  async function languageFor(filePath: string): Promise<Language> {
    const { wasmPath, label } = grammarForPath(filePath);
    const cached = languageCache.get(wasmPath);
    if (cached) return cached;
    const language = await Language.load(wasmPath);
    languageCache.set(wasmPath, language);
    console.log(`Loaded grammar: ${label} (${path.basename(wasmPath)})`);
    return language;
  }

  const reports: FileReport[] = [];

  for (const relPath of SAMPLE_FILES) {
    const source = await fs.readFile(path.join(PROJECT_ROOT, relPath), "utf8");
    const lineCount = source.split("\n").length;
    const language = await languageFor(relPath);
    const parser = new Parser();
    parser.setLanguage(language);

    let parseOk = true;
    let parseError: string | undefined;
    let symbols: ExtractedSymbol[] = [];

    try {
      const tree = parser.parse(source);
      if (tree.rootNode.hasError) {
        parseOk = false;
        parseError = "root node hasError=true (partial parse)";
      }
      symbols = withPrefixes(relPath, extractSymbols(relPath, tree));
    } catch (error) {
      parseOk = false;
      parseError = error instanceof Error ? error.message : String(error);
    }

    const chunkSizes = symbols.map((symbol) => symbol.endIndex - symbol.startIndex);
    const avgChunkChars = chunkSizes.length > 0
      ? Math.round(chunkSizes.reduce((sum, size) => sum + size, 0) / chunkSizes.length)
      : 0;

    reports.push({
      path: relPath,
      lineCount,
      parseOk,
      parseError,
      symbolCount: symbols.length,
      symbols,
      avgChunkChars,
      fallbackRecommended: symbols.length === 0,
    });
  }

  console.log("\n--- Sample file reports ---");
  for (const report of reports) {
    console.log(`\n${report.path} (${String(report.lineCount)} lines)`);
    console.log(`  parse: ${report.parseOk ? "ok" : `FAILED (${report.parseError ?? "unknown"})`}`);
    console.log(`  symbols: ${String(report.symbolCount)} (avg ${String(report.avgChunkChars)} chars)`);
    console.log(`  fallback to rawTextStrategy: ${report.fallbackRecommended ? "yes" : "no"}`);
    for (const symbol of report.symbols.slice(0, 10)) {
      console.log(`    - ${symbol.prefix}`);
    }
    if (report.symbols.length > 10) {
      console.log(`    ... +${String(report.symbols.length - 10)} more`);
    }
  }

  const benchmarkFiles = await listSourceFiles(40);
  const start = performance.now();
  let parsed = 0;
  let failures = 0;
  let zeroSymbolFiles = 0;

  for (const relPath of benchmarkFiles) {
    const source = await fs.readFile(path.join(PROJECT_ROOT, relPath), "utf8");
    const language = await languageFor(relPath);
    const parser = new Parser();
    parser.setLanguage(language);
    try {
      const tree = parser.parse(source);
      parsed++;
      const symbols = withPrefixes(relPath, extractSymbols(relPath, tree));
      if (symbols.length === 0) zeroSymbolFiles++;
      if (tree.rootNode.hasError) failures++;
    } catch {
      failures++;
    }
  }

  const elapsedMs = performance.now() - start;
  const perFileMs = parsed > 0 ? elapsedMs / parsed : 0;

  console.log("\n--- Benchmark (40 non-test src files) ---");
  console.log(`  files parsed: ${String(parsed)}`);
  console.log(`  total time: ${elapsedMs.toFixed(1)}ms`);
  console.log(`  per file: ${perFileMs.toFixed(2)}ms`);
  console.log(`  extrapolated 1,000 files: ${((perFileMs * 1000) / 1000).toFixed(1)}s`);
  console.log(`  extrapolated 5,000 files: ${((perFileMs * 5000) / 1000).toFixed(1)}s`);
  console.log(`  parse errors/hasError: ${String(failures)}`);
  console.log(`  zero-symbol files (would fallback): ${String(zeroSymbolFiles)}`);

  console.log("\n--- Recommended prefix format (pinned for Task 14) ---");
  console.log("  FILE: <path> | FUNCTION: <name>");
  console.log("  FILE: <path> | CLASS: <name>");
  console.log("  FILE: <path> | CLASS: <Class> | METHOD: <method>");
  console.log("  FILE: <path> | INTERFACE: <name>");
  console.log("  FILE: <path> | TYPE: <name>");
  console.log("  FILE: <path> | CONST: <name>");

  console.log("\n--- SPIKE COMPLETE ---");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
