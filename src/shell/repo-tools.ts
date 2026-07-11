import { execFileSync } from "node:child_process";
import path from "node:path";
import { buildRipgrepArgs } from "../core/ripgrep-args.js";
import { resolveSafeRepoPath } from "../core/repo-path.js";
import { windowText } from "../core/text-window.js";
import { repoFilterOptions, shouldIncludeFile } from "../core/filter.js";
import { MAX_INDEXABLE_FILE_SIZE_KB, type RepoConfig } from "../core/types.js";
import type { GrepRunnerResult, RepoAccessPort } from "../ports/repo-access.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";

const GREP_OUTPUT_CAP_CHARS = 32_000;
const GLOB_RESULT_CAP = 200;
const READ_OUTPUT_CAP_CHARS = 16_000;
const DEFAULT_READ_LINES = 400;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function toolError(message: string): string {
  return JSON.stringify({ error: message });
}

function resolveRepoOrError(
  access: RepoAccessPort,
  agentId: string,
): { ok: true; repo: RepoConfig } | { ok: false; error: string } {
  const repo = access.resolve(agentId);
  if (repo === undefined) {
    return {
      ok: false,
      error: toolError(
        `No repo path configured for agent '${agentId}'. Agentic tools need config.yaml repos.${agentId}.path.`,
      ),
    };
  }
  return { ok: true, repo };
}

function stdoutFromExecError(error: {
  stdout?: string | Buffer;
}): string {
  if (typeof error.stdout === "string") return error.stdout;
  if (Buffer.isBuffer(error.stdout)) return error.stdout.toString("utf8");
  return "";
}

/** Default ripgrep runner using execFileSync (arg arrays only). */
export function defaultGrepRunner(args: string[], cwd: string): GrepRunnerResult {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- rg is an intentional host dependency resolved from PATH
    const stdout = execFileSync("rg", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: GREP_OUTPUT_CAP_CHARS * 2,
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    if (error && typeof error === "object") {
      const err = error as {
        status?: number | null;
        stdout?: string | Buffer;
        code?: string;
      };
      if (err.code === "ENOENT") {
        return {
          stdout: "",
          exitCode: 127,
          error: "ripgrep (rg) is not installed or not on PATH. Install rg to enable grep_repo.",
        };
      }
      // rg exits 1 when there are no matches — treat as success with empty hits.
      return { stdout: stdoutFromExecError(err), exitCode: err.status ?? 1 };
    }
    return { stdout: "", exitCode: 1, error: String(error) };
  }
}

export function createRepoAccess(
  repos: Record<string, RepoConfig>,
  options: {
    fs?: FileSystemPort;
    grep?: (args: string[], cwd: string) => GrepRunnerResult;
  } = {},
): RepoAccessPort {
  const fs = options.fs ?? nodeFileSystem;
  const grep = options.grep ?? defaultGrepRunner;
  return {
    resolve: (agentId) => (Object.hasOwn(repos, agentId) ? repos[agentId] : undefined),
    fs,
    grep,
  };
}

function truncateOutput(text: string): string {
  if (text.length <= GREP_OUTPUT_CAP_CHARS) return text;
  return `${text.slice(0, GREP_OUTPUT_CAP_CHARS)}\n…[truncated]`;
}

export function handleGrepRepo(
  access: RepoAccessPort,
  agentId: string,
  args: Record<string, unknown>,
): string {
  const resolved = resolveRepoOrError(access, agentId);
  if (!resolved.ok) return resolved.error;
  const { repo } = resolved;

  const pattern = asString(args["pattern"]);
  if (pattern === undefined || pattern === "") {
    return toolError("grep_repo requires a non-empty 'pattern' string");
  }

  const searchPath = asString(args["path"]);
  const glob = asString(args["glob"]);
  const caseInsensitive = args["case_insensitive"] === true;
  const maxResults = asOptionalPositiveInt(args["max_results"]) ?? 50;

  let rgArgs: string[];
  try {
    rgArgs = buildRipgrepArgs({
      pattern,
      ...(searchPath === undefined ? {} : { path: searchPath }),
      ...(glob === undefined ? {} : { glob }),
      caseInsensitive,
      maxResults,
      ignoreDirs: repo.ignoreDirs,
    });
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }

  if (searchPath !== undefined) {
    try {
      resolveSafeRepoPath(repo.path, searchPath);
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  }

  const result = access.grep(rgArgs, repo.path);
  if (result.error !== undefined) {
    return toolError(result.error);
  }

  return JSON.stringify({
    matches: truncateOutput(result.stdout.trimEnd()),
    exitCode: result.exitCode,
  });
}

export async function handleGlobFiles(
  access: RepoAccessPort,
  agentId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const resolved = resolveRepoOrError(access, agentId);
  if (!resolved.ok) return resolved.error;
  const { repo } = resolved;

  const pattern = asString(args["pattern"]) ?? "**/*";
  const cwd = repo.basePath ? path.join(repo.path, repo.basePath) : repo.path;
  const ignore = repo.ignoreDirs.map((dir) => `**/${dir}/**`);

  try {
    const entries = await access.fs.glob([pattern], {
      cwd,
      ignore,
      absolute: false,
      onlyFiles: true,
    });
    const filter = repoFilterOptions(repo);
    const filtered: string[] = [];
    for (const relPath of entries) {
      if (filtered.length >= GLOB_RESULT_CAP) break;
      const absPath = path.join(cwd, relPath);
      let sizeKb = 0;
      try {
        const stat = await access.fs.stat(absPath);
        sizeKb = stat.size / 1024;
      } catch {
        continue;
      }
      if (shouldIncludeFile(relPath, sizeKb, filter)) {
        filtered.push(relPath);
      }
    }
    return JSON.stringify({ files: filtered, truncated: entries.length > filtered.length });
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

export async function handleReadFile(
  access: RepoAccessPort,
  agentId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const resolved = resolveRepoOrError(access, agentId);
  if (!resolved.ok) return resolved.error;
  const { repo } = resolved;

  const relativePath = asString(args["path"]);
  if (relativePath === undefined || relativePath === "") {
    return toolError("read_file requires a non-empty 'path' string");
  }

  let absPath: string;
  try {
    absPath = resolveSafeRepoPath(repo.path, relativePath);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }

  try {
    const stat = await access.fs.stat(absPath);
    const sizeKb = stat.size / 1024;
    if (sizeKb > MAX_INDEXABLE_FILE_SIZE_KB) {
      return toolError(
        `file is too large to read directly (${sizeKb.toFixed(1)} KB, hard cap ${String(MAX_INDEXABLE_FILE_SIZE_KB)} KB). ` +
        `Use grep_repo or archival_memory_search to locate the relevant section, then re-read with a narrower start_line/end_line range.`,
      );
    }
    const content = await access.fs.readFile(absPath, "utf8");
    const startLine = asOptionalPositiveInt(args["start_line"]) ?? 1;
    const endLine = asOptionalPositiveInt(args["end_line"]) ?? startLine + DEFAULT_READ_LINES - 1;
    const window = windowText(content, {
      startLine,
      endLine,
      maxChars: READ_OUTPUT_CAP_CHARS,
    });
    return JSON.stringify({ path: relativePath, ...window });
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}
