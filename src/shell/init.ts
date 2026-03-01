import * as os from "node:os";
import * as path from "node:path";
import type * as readline from "node:readline/promises";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import {
  detectExtensions,
  suggestIgnoreDirs,
  detectRepoName,
  generateConfigYaml,
} from "../core/init.js";

interface InitResult {
  configPath: string;
  envPath: string | null;
  repoName: string;
}

export interface RunInitOptions {
  apiKey?: string;
  repoPath?: string;
  assumeYes?: boolean;
  allowPrompts?: boolean;
  cwd?: string;
  fs?: FileSystemPort;
}

/**
 * Scan a directory for file paths (no content). Used for extension/ignore detection.
 */
async function scanFilePaths(repoPath: string, fs: FileSystemPort): Promise<string[]> {
  return fs.glob(["**/*"], {
    cwd: repoPath,
    absolute: false,
    dot: true,
    deep: 3,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
}

function tildeify(absPath: string): string {
  const home = os.homedir();
  if (absPath.startsWith(home + "/")) {
    return "~/" + absPath.slice(home.length + 1);
  }
  return absPath;
}

/**
 * Interactive init flow. Prompts for API key, repo path, confirms settings, writes files.
 */
export async function runInit(rl: readline.Interface, options: RunInitOptions = {}): Promise<InitResult> {
  const {
    apiKey: apiKeyFromFlag,
    repoPath: repoPathFromFlag,
    assumeYes = false,
    allowPrompts = true,
    cwd = process.cwd(),
    fs = nodeFileSystem,
  } = options;
  console.log("repo-expert init — set up your first agent\n");

  // 1. API key
  const envPath = path.resolve(cwd, ".env");
  let envWritten: string | null = null;
  const existingKey = process.env.LETTA_API_KEY;

  if (existingKey) {
    console.log("API key: found in environment");
  } else {
    let hasEnvFile = false;
    try {
      const envContent = await fs.readFile(envPath, "utf8");
      hasEnvFile = envContent.includes("LETTA_API_KEY=") &&
        !envContent.includes("LETTA_API_KEY=your-key-here");
    } catch {
      // no .env
    }

    if (hasEnvFile) {
      console.log("API key: found in .env");
    } else if (apiKeyFromFlag && apiKeyFromFlag.trim()) {
      await fs.writeFile(envPath, `LETTA_API_KEY=${apiKeyFromFlag.trim()}\n`, "utf-8");
      envWritten = envPath;
      console.log(`API key: wrote ${envPath} from --api-key`);
    } else {
      if (!allowPrompts) {
        console.error("API key is required in non-interactive mode. Pass --api-key or set LETTA_API_KEY.");
        process.exitCode = 1;
        throw new Error("Missing API key");
      }
      const apiKey = await rl.question("Letta API key (from https://app.letta.com/): ");
      if (!apiKey.trim()) {
        console.error("API key is required. Get one at https://app.letta.com/");
        process.exitCode = 1;
        throw new Error("Missing API key");
      }
      await fs.writeFile(envPath, `LETTA_API_KEY=${apiKey.trim()}\n`, "utf-8");
      envWritten = envPath;
      console.log(`  Wrote ${envPath}`);
    }
  }

  // 2. Repo path
  const rawPath = repoPathFromFlag ?? (allowPrompts ? await rl.question("\nPath to your git repo: ") : "");
  if (!rawPath.trim()) {
    console.error("Repository path is required. Pass --repo-path in non-interactive mode.");
    process.exitCode = 1;
    throw new Error("Missing repo path");
  }
  const resolvedPath = rawPath.trim().startsWith("~/")
    ? path.resolve(os.homedir(), rawPath.trim().slice(2))
    : path.resolve(rawPath.trim());

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      console.error(`Not a directory: ${resolvedPath}`);
      process.exitCode = 1;
      throw new Error("Not a directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Directory not found: ${resolvedPath}`);
      process.exitCode = 1;
      throw new Error("Directory not found");
    }
    throw error;
  }

  try {
    await fs.access(path.join(resolvedPath, ".git"));
  } catch {
    console.error(`Not a git repository: ${resolvedPath}`);
    process.exitCode = 1;
    throw new Error("Not a git repository");
  }

  // 3. Scan and detect
  console.log("\nScanning files...");
  const files = await scanFilePaths(resolvedPath, fs);
  const extensions = detectExtensions(files);
  const ignoreDirs = suggestIgnoreDirs(files);
  const repoName = detectRepoName(resolvedPath);

  if (extensions.length === 0) {
    console.error("No code files detected for indexing (no supported extensions found).");
    process.exitCode = 1;
    throw new Error("No code files detected");
  }

  console.log(`  Found ${files.length} files`);
  console.log(`  Detected extensions: ${extensions.join(", ") || "(none)"}`);
  console.log(`  Detected ignore dirs: ${ignoreDirs.join(", ") || "(none)"}`);

  // 4. Description
  let defaultDescription = "";
  try {
    const pkgRaw = await fs.readFile(path.join(resolvedPath, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    if (typeof pkg.description === "string" && pkg.description) {
      defaultDescription = pkg.description;
    }
  } catch {
    // no package.json
  }

  const descPrompt = defaultDescription
    ? `Description [${defaultDescription}]: `
    : "Description (e.g. \"React Native mobile app\"): ";
  const descInput = assumeYes ? "" : (allowPrompts ? await rl.question(`\n${descPrompt}`) : "");
  const description = descInput.trim() || defaultDescription || `${repoName} repository`;

  // 5. Confirm
  const displayPath = tildeify(resolvedPath);
  console.log(`\n  Repo: ${repoName}`);
  console.log(`  Path: ${displayPath}`);
  console.log(`  Description: ${description}`);
  console.log(`  Extensions: ${extensions.join(", ")}`);
  console.log(`  Ignore dirs: ${ignoreDirs.join(", ")}`);

  const confirm = assumeYes ? "y" : (allowPrompts ? await rl.question("\nWrite config.yaml? [Y/n] ") : "y");
  if (confirm.trim().toLowerCase() === "n") {
    console.log("Aborted.");
    process.exitCode = 1;
    throw new Error("Aborted by user");
  }

  // 6. Write config.yaml
  const configPath = path.resolve(cwd, "config.yaml");
  const yamlContent = generateConfigYaml({
    repoName,
    repoPath: displayPath,
    description,
    extensions,
    ignoreDirs,
  });

  await fs.writeFile(configPath, yamlContent, "utf-8");
  console.log(`\nWrote ${configPath}`);
  console.log(`\nNext: repo-expert setup`);

  return { configPath, envPath: envWritten, repoName };
}
