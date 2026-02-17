import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as readline from "readline/promises";
import fg from "fast-glob";
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

/**
 * Scan a directory for file paths (no content). Used for extension/ignore detection.
 */
async function scanFilePaths(repoPath: string): Promise<string[]> {
  return fg("**/*", {
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
export async function runInit(rl: readline.Interface): Promise<InitResult> {
  console.log("repo-expert init — set up your first agent\n");

  // 1. API key
  const envPath = path.resolve(".env");
  let envWritten: string | null = null;
  const existingKey = process.env.LETTA_API_KEY;

  if (existingKey) {
    console.log("API key: found in environment");
  } else {
    let hasEnvFile = false;
    try {
      const envContent = await fs.readFile(envPath, "utf-8");
      hasEnvFile = envContent.includes("LETTA_API_KEY=") &&
        !envContent.includes("LETTA_API_KEY=your-key-here");
    } catch {
      // no .env
    }

    if (hasEnvFile) {
      console.log("API key: found in .env");
    } else {
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
  const rawPath = await rl.question("\nPath to your git repo: ");
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Directory not found: ${resolvedPath}`);
      process.exitCode = 1;
      throw new Error("Directory not found");
    }
    throw err;
  }

  // 3. Scan and detect
  console.log("\nScanning files...");
  const files = await scanFilePaths(resolvedPath);
  const extensions = detectExtensions(files);
  const ignoreDirs = suggestIgnoreDirs(files);
  const repoName = detectRepoName(resolvedPath);

  console.log(`  Found ${files.length} files`);
  console.log(`  Detected extensions: ${extensions.join(", ") || "(none)"}`);
  console.log(`  Detected ignore dirs: ${ignoreDirs.join(", ") || "(none)"}`);

  // 4. Description
  let defaultDescription = "";
  try {
    const pkgRaw = await fs.readFile(path.join(resolvedPath, "package.json"), "utf-8");
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
  const descInput = await rl.question(`\n${descPrompt}`);
  const description = descInput.trim() || defaultDescription || `${repoName} repository`;

  // 5. Confirm
  const displayPath = tildeify(resolvedPath);
  console.log(`\n  Repo: ${repoName}`);
  console.log(`  Path: ${displayPath}`);
  console.log(`  Description: ${description}`);
  console.log(`  Extensions: ${extensions.join(", ")}`);
  console.log(`  Ignore dirs: ${ignoreDirs.join(", ")}`);

  const confirm = await rl.question("\nWrite config.yaml? [Y/n] ");
  if (confirm.trim().toLowerCase() === "n") {
    console.log("Aborted.");
    process.exitCode = 1;
    throw new Error("Aborted by user");
  }

  // 6. Write config.yaml
  const configPath = path.resolve("config.yaml");
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
