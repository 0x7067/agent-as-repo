import { Language, Parser, type Node, type Tree } from "web-tree-sitter";
import { chunkFile, chunkWithHeader, rawTextStrategy } from "./chunker.js";
import { extractSymbolSpansGo } from "./tree-sitter-lang-go.js";
import { extractSymbolSpansJava } from "./tree-sitter-lang-java.js";
import { extractSymbolSpansPython } from "./tree-sitter-lang-python.js";
import { extractSymbolSpansRuby } from "./tree-sitter-lang-ruby.js";
import { spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";
import type { Chunk, ChunkingStrategy, FileInfo } from "./types.js";

const MAX_CHUNK_CHARS = 2000;

export type GrammarLabel =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "ruby";

export interface TreeSitterInitOptions {
  webTreeSitterWasm: string;
  grammarWasmByLabel: Record<GrammarLabel, string>;
}

let initialized = false;
let initPromise: Promise<void> | null = null;
let parser: Parser | null = null;
const languageByLabel = new Map<GrammarLabel, Language>();

const GRAMMAR_LABEL_BY_EXTENSION: Record<string, GrammarLabel> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
};

function grammarLabelForPath(filePath: string): GrammarLabel | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return GRAMMAR_LABEL_BY_EXTENSION[ext] ?? null;
}

function buildPrefix(filePath: string, span: SymbolSpan): string {
  if (span.kind === "METHOD" && span.className) {
    const containerKind = span.containerKind ?? "CLASS";
    return `FILE: ${filePath} | ${containerKind}: ${span.className} | METHOD: ${span.name}`;
  }
  return `FILE: ${filePath} | ${span.kind}: ${span.name}`;
}

// ---------------------------------------------------------------------------
// JS / TS (existing logic, unchanged)
// ---------------------------------------------------------------------------

function collectConstArrows(node: Node): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const declarator of node.namedChildren) {
    if (declarator.type !== "variable_declarator") continue;
    const value = declarator.childForFieldName("value");
    if (!value?.text.includes("=>")) continue;
    const span = spanFromNode(declarator, "CONST");
    if (span) spans.push(span);
  }
  return spans;
}

function collectClassMethods(classNode: Node, className: string): SymbolSpan[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];

  const methods: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    if (member.type !== "method_definition") continue;
    const span = spanFromNode(member, "METHOD", className);
    if (span) methods.push(span);
  }
  return methods;
}

function extractFromDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const fn = spanFromNode(node, "FUNCTION");
      return fn ? [fn] : [];
    }
    case "class_declaration": {
      const cls = spanFromNode(node, "CLASS");
      if (!cls) return [];
      return [cls, ...collectClassMethods(node, cls.name)];
    }
    case "interface_declaration": {
      const iface = spanFromNode(node, "INTERFACE");
      return iface ? [iface] : [];
    }
    case "type_alias_declaration": {
      const alias = spanFromNode(node, "TYPE");
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

function extractSymbolSpansJsTs(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];

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
        spans.push(...extractFromDeclaration(declaration));
        continue;
      }
      if (child.text.includes("=>")) {
        const match = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(child.text);
        const exportedName = match?.[1];
        if (exportedName) {
          spans.push({
            kind: "CONST",
            name: exportedName,
            startIndex: child.startIndex,
            endIndex: child.endIndex,
          });
        }
      }
      continue;
    }

    spans.push(...extractFromDeclaration(child));
  }

  return spans;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function extractSymbolSpans(tree: Tree, label: GrammarLabel): SymbolSpan[] {
  switch (label) {
    case "typescript":
    case "tsx":
    case "javascript": {
      return extractSymbolSpansJsTs(tree);
    }
    case "python": {
      return extractSymbolSpansPython(tree);
    }
    case "go": {
      return extractSymbolSpansGo(tree);
    }
    case "java": {
      return extractSymbolSpansJava(tree);
    }
    case "ruby": {
      return extractSymbolSpansRuby(tree);
    }
  }
}

function spansToChunks(filePath: string, content: string, spans: SymbolSpan[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const span of spans) {
    const header = buildPrefix(filePath, span);
    const body = content.slice(span.startIndex, span.endIndex);
    const spanChunks = chunkWithHeader(header, body, filePath, MAX_CHUNK_CHARS);
    chunks.push(...spanChunks);
  }
  return chunks;
}

function parseFile(file: FileInfo): { tree: Tree; label: GrammarLabel } | null {
  if (!initialized || !parser) return null;
  const label = grammarLabelForPath(file.path);
  if (label === null) return null;
  const language = languageByLabel.get(label);
  if (!language) return null;
  parser.setLanguage(language);
  const tree = parser.parse(file.content);
  return tree ? { tree, label } : null;
}

export async function initTreeSitterChunker(options: TreeSitterInitOptions): Promise<void> {
  if (initialized) return;
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    await Parser.init({ locateFile: () => options.webTreeSitterWasm });
    parser = new Parser();

    for (const [label, wasmPath] of Object.entries(options.grammarWasmByLabel) as [GrammarLabel, string][]) {
      languageByLabel.set(label, await Language.load(wasmPath));
    }

    initialized = true;
  })();

  await initPromise;
}

export function resetTreeSitterChunkerForTests(): void {
  initialized = false;
  initPromise = null;
  parser = null;
  languageByLabel.clear();
}

export const treeSitterStrategy: ChunkingStrategy = (file: FileInfo): Chunk[] => {
  if (!file.content.trim()) return [];

  if (!initialized || !parser) {
    return rawTextStrategy(file);
  }

  try {
    const parsed = parseFile(file);
    if (!parsed) return chunkFile(file.path, file.content, MAX_CHUNK_CHARS);

    const spans = extractSymbolSpans(parsed.tree, parsed.label);
    if (spans.length === 0) {
      return chunkFile(file.path, file.content, MAX_CHUNK_CHARS);
    }

    return spansToChunks(file.path, file.content, spans);
  } catch {
    return chunkFile(file.path, file.content, MAX_CHUNK_CHARS);
  }
};
