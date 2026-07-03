import { Language, Parser, type Node, type Tree } from "web-tree-sitter";
import { chunkFile, chunkWithHeader, rawTextStrategy } from "./chunker.js";
import type { Chunk, ChunkingStrategy, FileInfo } from "./types.js";

const MAX_CHUNK_CHARS = 2000;

export interface TreeSitterInitOptions {
  webTreeSitterWasm: string;
  typescriptWasm: string;
  tsxWasm: string;
  javascriptWasm: string;
}

type SymbolKind = "FUNCTION" | "CLASS" | "INTERFACE" | "TYPE" | "CONST" | "METHOD";

interface SymbolSpan {
  kind: SymbolKind;
  name: string;
  className?: string;
  startIndex: number;
  endIndex: number;
}

let initialized = false;
let initPromise: Promise<void> | null = null;
let parser: Parser | null = null;
const languageByLabel = new Map<string, Language>();

function grammarLabelForPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (ext === ".tsx") return "tsx";
  if (ext === ".jsx") return "javascript";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  return "typescript";
}

function wasmPathForLabel(options: TreeSitterInitOptions, label: string): string {
  switch (label) {
    case "tsx":
      return options.tsxWasm;
    case "javascript":
      return options.javascriptWasm;
    default:
      return options.typescriptWasm;
  }
}

function buildPrefix(filePath: string, span: SymbolSpan): string {
  if (span.kind === "METHOD" && span.className) {
    return `FILE: ${filePath} | CLASS: ${span.className} | METHOD: ${span.name}`;
  }
  return `FILE: ${filePath} | ${span.kind}: ${span.name}`;
}

function nodeName(node: Node): string | undefined {
  const nameNode =
    node.childForFieldName("name")
    ?? node.namedChildren.find((child) => child.type === "identifier" || child.type === "type_identifier");
  if (!nameNode) return undefined;
  const text = nameNode.text;
  return text.length > 0 ? text : undefined;
}

function spanFromNode(node: Node, kind: SymbolKind, className?: string): SymbolSpan | undefined {
  const name = nodeName(node);
  if (!name) return undefined;
  return {
    kind,
    name,
    className,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

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

function extractSymbolSpans(tree: Tree): SymbolSpan[] {
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

function parseFile(file: FileInfo): Tree | null {
  if (!initialized || !parser) return null;
  const label = grammarLabelForPath(file.path);
  const language = languageByLabel.get(label);
  if (!language) return null;
  parser.setLanguage(language);
  return parser.parse(file.content);
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

    for (const label of ["typescript", "tsx", "javascript"] as const) {
      const wasmPath = wasmPathForLabel(options, label);
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
    const tree = parseFile(file);
    if (!tree) return chunkFile(file.path, file.content, MAX_CHUNK_CHARS);

    const spans = extractSymbolSpans(tree);
    if (spans.length === 0) {
      return chunkFile(file.path, file.content, MAX_CHUNK_CHARS);
    }

    return spansToChunks(file.path, file.content, spans);
  } catch {
    return chunkFile(file.path, file.content, MAX_CHUNK_CHARS);
  }
};
