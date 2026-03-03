import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { STATE_SCHEMA_VERSION, createEmptyState } from "../core/state.js";
import type { AppState } from "../core/types.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";

const passageMapSchema = z.record(z.string(), z.array(z.string()));

const agentStateSchema = z.object({
  agentId: z.string(),
  repoName: z.string(),
  passages: passageMapSchema.optional().default({}),
  lastBootstrap: z.string().nullable().optional().default(null),
  lastSyncCommit: z.string().nullable().optional().default(null),
  lastSyncAt: z.string().nullable().optional().default(null),
  createdAt: z.string().optional().default(""),
});

const appStateSchema = z.object({
  stateVersion: z.number().int().default(STATE_SCHEMA_VERSION),
  agents: z.record(z.string(), agentStateSchema).optional().default({}),
});

export class StateFileError extends Error {
  readonly filePath: string;
  readonly backupPath: string | null;

  constructor(filePath: string, details: string, backupPath: string | null) {
    const backupHint = backupPath ? ` A backup was created at ${backupPath}.` : "";
    super(`Invalid state file at ${filePath}: ${details}. Please remove or fix it, then re-run your command.${backupHint}`);
    this.name = "StateFileError";
    this.filePath = filePath;
    this.backupPath = backupPath;
  }
}

function migrateLegacyState(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const record = raw as Record<string, unknown>;

  // v1 had no stateVersion field.
  if (!("stateVersion" in record)) {
    return { stateVersion: STATE_SCHEMA_VERSION, ...record };
  }

  const version = record.stateVersion;
  if (version === 1) {
    return { ...record, stateVersion: STATE_SCHEMA_VERSION };
  }

  return raw;
}

async function backupInvalidState(filePath: string, fs: FileSystemPort): Promise<string | null> {
  const backupPath = `${filePath}.bak.${String(Date.now())}`;
  try {
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

function isTransientRenameError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if (!("code" in err)) return false;
  const code = String(err.code);
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function formatStateSchemaError(error: z.ZodError): string {
  const issue = error.issues.at(0);
  if (issue === undefined) {
    return "schema error at \"root\": unknown schema validation error";
  }
  const location = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `schema error at "${location}": ${issue.message}`;
}

function getRecoverableStateErrorDetails(error: unknown): string | null {
  if (error instanceof SyntaxError) {
    return error.message;
  }
  if (error instanceof z.ZodError) {
    return formatStateSchemaError(error);
  }
  return null;
}

async function throwStateFileError(filePath: string, details: string, fs: FileSystemPort): Promise<never> {
  const backupPath = await backupInvalidState(filePath, fs);
  throw new StateFileError(filePath, details, backupPath);
}

async function renameWithRetry(tempPath: string, filePath: string, fs: FileSystemPort, retries = 3): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientRenameError(error) || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function loadState(filePath: string, fs: FileSystemPort = nodeFileSystem): Promise<AppState> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const raw: unknown = JSON.parse(content);
    const migrated = migrateLegacyState(raw);
    const parsed = appStateSchema.parse(migrated);
    if (parsed.stateVersion !== STATE_SCHEMA_VERSION) {
      await throwStateFileError(filePath, `unsupported state version "${String(parsed.stateVersion)}"`, fs);
    }
    return parsed;
  } catch (error: unknown) {
    if (isErrno(error, "ENOENT")) {
      return createEmptyState();
    }
    if (error instanceof StateFileError) {
      throw error;
    }

    const details = getRecoverableStateErrorDetails(error);
    if (details !== null) {
      await throwStateFileError(filePath, details, fs);
    }

    throw error;
  }
}

export async function saveState(filePath: string, state: AppState, fs: FileSystemPort = nodeFileSystem): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${base}.tmp.${String(process.pid)}.${String(Date.now())}.${randomUUID()}`,
  );
  const toPersist: AppState = {
    ...state,
    stateVersion: STATE_SCHEMA_VERSION,
  };

  await fs.writeFile(tempPath, JSON.stringify(toPersist, null, 2));
  await renameWithRetry(tempPath, filePath, fs);
}
