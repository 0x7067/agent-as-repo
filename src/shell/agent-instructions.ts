import path from "node:path";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { removeInstructionsBlock, renderInstructionsBlock, spliceInstructionsBlock } from "../core/agent-instructions.js";

const CLAUDE_MD = "CLAUDE.md";
const AGENTS_MD = "AGENTS.md";

export interface InstallInstructionsOptions {
  repoPath: string;
  repoNames: string[];
  remove?: boolean;
  dryRun?: boolean;
  filePath?: string;
}

export interface FileOutcome {
  path: string;
  action: "created" | "updated" | "removed" | "unchanged";
  warning?: string;
}

async function fileExists(fs: FileSystemPort, filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(fs: FileSystemPort, filePath: string): Promise<string | null> {
  if (!(await fileExists(fs, filePath))) return null;
  return fs.readFile(filePath, "utf8");
}

async function resolveDefaultTargets(fs: FileSystemPort, repoPath: string): Promise<string[]> {
  const claudePath = path.join(repoPath, CLAUDE_MD);
  const agentsPath = path.join(repoPath, AGENTS_MD);
  const claudeExists = await fileExists(fs, claudePath);
  const agentsExists = await fileExists(fs, agentsPath);

  if (!claudeExists && !agentsExists) {
    return [agentsPath];
  }

  const targets: string[] = [];
  if (claudeExists) targets.push(claudePath);
  if (agentsExists) targets.push(agentsPath);
  return targets;
}

function resolveAction(remove: boolean, isNewFile: boolean): FileOutcome["action"] {
  if (remove) return "removed";
  return isNewFile ? "created" : "updated";
}

async function installInstructionsForFile(
  fs: FileSystemPort,
  targetPath: string,
  block: string,
  opts: Pick<InstallInstructionsOptions, "remove" | "dryRun">,
): Promise<FileOutcome> {
  const existing = await readIfExists(fs, targetPath);
  const isNewFile = existing === null;
  const remove = Boolean(opts.remove);

  const result = remove ? removeInstructionsBlock(existing) : spliceInstructionsBlock(existing, block);
  const warning = result.warning === undefined ? {} : { warning: result.warning };

  if (!result.changed) {
    return { path: targetPath, action: "unchanged", ...warning };
  }

  if (!opts.dryRun) {
    await fs.writeFile(targetPath, result.content);
  }

  return { path: targetPath, action: resolveAction(remove, isNewFile), ...warning };
}

export async function installInstructions(
  opts: InstallInstructionsOptions,
  fs: FileSystemPort = nodeFileSystem,
): Promise<FileOutcome[]> {
  const targets = opts.filePath === undefined
    ? await resolveDefaultTargets(fs, opts.repoPath)
    : [path.resolve(opts.filePath)];

  const block = renderInstructionsBlock({ repoNames: opts.repoNames });
  const outcomes: FileOutcome[] = [];

  for (const targetPath of targets) {
    outcomes.push(await installInstructionsForFile(fs, targetPath, block, opts));
  }

  return outcomes;
}
