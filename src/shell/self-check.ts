import path from "node:path";
import { execFileSync } from "node:child_process";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { openVectorDatabase, type VectorDatabase } from "./sqlite-native.js";

export type SelfCheckStatus = "pass" | "warn" | "fail";

export interface SelfCheckResult {
  name: string;
  status: SelfCheckStatus;
  message: string;
}

interface PackageJsonShape {
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parseNodeMajor(version: string): number | null {
  const match = /^v(\d+)/.exec(version);
  if (!match) return null;
  const major = match.at(1);
  if (major === undefined) return null;
  return Number.parseInt(major, 10);
}

function defaultRunCommand(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function readPackageJson(cwd: string, fs: FileSystemPort): Promise<PackageJsonShape | null> {
  const packagePath = path.join(cwd, "package.json");
  try {
    const raw = await fs.readFile(packagePath, "utf8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function checkNodeVersion(minMajor: number): SelfCheckResult {
  const major = parseNodeMajor(process.version);
  if (major === null) {
    return { name: "Node.js", status: "warn", message: `Could not parse Node version (${process.version})` };
  }
  if (major < minMajor) {
    return { name: "Node.js", status: "fail", message: `Found ${process.version}, requires Node ${String(minMajor)}+` };
  }
  return { name: "Node.js", status: "pass", message: `Found ${process.version}` };
}

function checkPnpm(
  cwd: string,
  runCommand: (cmd: string, args: string[], cwd: string) => string,
): SelfCheckResult {
  try {
    const version = runCommand("pnpm", ["--version"], cwd);
    return { name: "pnpm", status: "pass", message: `Found ${version}` };
  } catch {
    return { name: "pnpm", status: "fail", message: "pnpm not found on PATH" };
  }
}

function checkPackageManagerDeclaration(pkg: PackageJsonShape | null): SelfCheckResult {
  if (!pkg) {
    return { name: "package.json", status: "warn", message: "No package.json in current directory" };
  }
  const declared = pkg.packageManager;
  if (!declared) {
    return { name: "packageManager", status: "warn", message: "packageManager field is missing" };
  }
  if (!declared.startsWith("pnpm@")) {
    return { name: "packageManager", status: "fail", message: `Expected pnpm@..., found "${declared}"` };
  }
  return { name: "packageManager", status: "pass", message: declared };
}

async function checkDependencies(cwd: string, pkg: PackageJsonShape | null, fs: FileSystemPort): Promise<SelfCheckResult> {
  if (!pkg) {
    return { name: "dependencies", status: "warn", message: "No package.json, skipping dependency checks" };
  }

  const depNames = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
  if (depNames.length === 0) {
    return { name: "dependencies", status: "warn", message: "No dependencies declared" };
  }

  const nodeModules = path.join(cwd, "node_modules");
  try {
    await fs.access(nodeModules);
  } catch {
    return { name: "dependencies", status: "fail", message: "node_modules not found. Run pnpm install." };
  }

  const missing: string[] = [];
  for (const dep of depNames) {
    const depPath = path.join(nodeModules, ...dep.split("/"));
    try {
      await fs.access(depPath);
    } catch {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    const sample = missing.slice(0, 5).join(", ");
    const suffix = missing.length > 5 ? ` (+${String(missing.length - 5)} more)` : "";
    return { name: "dependencies", status: "fail", message: `Missing installed deps: ${sample}${suffix}` };
  }

  return { name: "dependencies", status: "pass", message: `${String(depNames.length)} dependencies installed` };
}

/**
 * Node major every environment standardizes on (engines, CI, .nvmrc, SEA
 * packaging). better-sqlite3's addon is ABI-locked to this major.
 */
export const MIN_NODE_MAJOR = 22;

interface QueryRow {
  version?: string;
}

/**
 * The #1 first-run failure: better-sqlite3's native addon (and the
 * sqlite-vec extension it loads) is ABI-locked to a Node major version and
 * requires pnpm's build-script approval to compile/install. When either is
 * missing or mismatched, `require`/`dlopen` can throw well past the point a
 * naive "is the package on disk" check would catch — so this probes the real
 * behavior by opening an in-memory database and running a trivial query.
 */
function checkNativeModules(
  openDatabase: (dbPath: string) => VectorDatabase = openVectorDatabase,
): SelfCheckResult {
  let db: VectorDatabase | undefined;
  try {
    db = openDatabase(":memory:");
    const row = db.prepare("select vec_version() as version").get() as QueryRow | undefined;
    if (!row?.version) {
      return {
        name: "native modules",
        status: "fail",
        message: "better-sqlite3/sqlite-vec loaded but vec_version() returned no result.",
      };
    }
    return {
      name: "native modules",
      status: "pass",
      message: `better-sqlite3 + sqlite-vec loaded (sqlite-vec ${row.version})`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      name: "native modules",
      status: "fail",
      message:
        `better-sqlite3/sqlite-vec failed to load or query (${detail}). ` +
        `This is usually a Node ABI mismatch or a skipped native build step: ` +
        `confirm you're on Node ${String(MIN_NODE_MAJOR)}+ and run "pnpm approve-builds" then "pnpm install" again.`,
    };
  } finally {
    db?.close();
  }
}

export async function runSelfChecks(
  cwd = process.cwd(),
  minNodeMajor = MIN_NODE_MAJOR,
  fs: FileSystemPort = nodeFileSystem,
  runCommand: (cmd: string, args: string[], cwd: string) => string = defaultRunCommand,
  openDatabase: (dbPath: string) => VectorDatabase = openVectorDatabase,
): Promise<SelfCheckResult[]> {
  const packageJson = await readPackageJson(cwd, fs);
  return [
    checkNodeVersion(minNodeMajor),
    checkPnpm(cwd, runCommand),
    checkPackageManagerDeclaration(packageJson),
    await checkDependencies(cwd, packageJson, fs),
    checkNativeModules(openDatabase),
  ];
}

export function formatSelfChecks(results: SelfCheckResult[]): string {
  return results
    .map((result) => `${result.status.toUpperCase()}: ${result.name} - ${result.message}`)
    .join("\n");
}
