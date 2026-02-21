import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

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
  return Number.parseInt(match[1], 10);
}

function runCommand(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function readPackageJson(cwd: string): Promise<PackageJsonShape | null> {
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

async function checkNodeVersion(minMajor: number): Promise<SelfCheckResult> {
  const major = parseNodeMajor(process.version);
  if (major === null) {
    return { name: "Node.js", status: "warn", message: `Could not parse Node version (${process.version})` };
  }
  if (major < minMajor) {
    return { name: "Node.js", status: "fail", message: `Found ${process.version}, requires Node ${minMajor}+` };
  }
  return { name: "Node.js", status: "pass", message: `Found ${process.version}` };
}

async function checkPnpm(cwd: string): Promise<SelfCheckResult> {
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

async function checkDependencies(cwd: string, pkg: PackageJsonShape | null): Promise<SelfCheckResult> {
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
    const suffix = missing.length > 5 ? ` (+${missing.length - 5} more)` : "";
    return { name: "dependencies", status: "fail", message: `Missing installed deps: ${sample}${suffix}` };
  }

  return { name: "dependencies", status: "pass", message: `${depNames.length} dependencies installed` };
}

export async function runSelfChecks(cwd = process.cwd(), minNodeMajor = 18): Promise<SelfCheckResult[]> {
  const packageJson = await readPackageJson(cwd);
  const results: SelfCheckResult[] = [];
  results.push(await checkNodeVersion(minNodeMajor));
  results.push(await checkPnpm(cwd));
  results.push(checkPackageManagerDeclaration(packageJson));
  results.push(await checkDependencies(cwd, packageJson));
  return results;
}

export function formatSelfChecks(results: SelfCheckResult[]): string {
  return results
    .map((result) => `${result.status.toUpperCase()}: ${result.name} - ${result.message}`)
    .join("\n");
}
