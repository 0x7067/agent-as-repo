import * as os from "node:os";
import path from "node:path";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { checkLlmEndpoint } from "./doctor.js";
import {
  detectExtensions,
  suggestIgnoreDirs,
  detectRepoName,
  generateConfigYaml,
} from "../core/init.js";
import type { EmbeddingEngine } from "../core/types.js";

interface InitResult {
  configPath: string;
  envPath: string | null;
  repoName: string;
}

interface PromptReader {
  question(prompt: string): Promise<string>;
}

export interface RunInitOptions {
  /** Optional Bearer key for the LLM endpoint (written to .env as LLM_API_KEY). */
  apiKey?: string;
  repoPath?: string;
  /** Chat model id as the LLM endpoint knows it. */
  model?: string;
  /** OpenAI-compatible base URL. */
  baseUrl?: string;
  /** Embedding engine (default "http" when neither this nor a prompt answer is given). */
  embeddingEngine?: EmbeddingEngine;
  assumeYes?: boolean;
  allowPrompts?: boolean;
  cwd?: string;
  fs?: FileSystemPort;
  /** Injectable fetch for the best-effort LLM endpoint reachability probe. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "qwen3-coder:30b";
const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
const LLM_API_KEY_ENV = "LLM_API_KEY";

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
 * Interactive init flow. Prompts for model + base URL, scans a repo, writes files.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function runInit(rl: PromptReader, options: RunInitOptions = {}): Promise<InitResult> {
  const {
    apiKey: apiKeyFromFlag,
    repoPath: repoPathFromFlag,
    model: modelFromFlag,
    baseUrl: baseUrlFromFlag,
    embeddingEngine: embeddingEngineFromFlag,
    assumeYes = false,
    allowPrompts = true,
    cwd = process.cwd(),
    fs = nodeFileSystem,
    fetchImpl,
  } = options;
  console.log("repo-expert init — set up your first agent\n");

  // 1. Model + base URL
  const askWithDefault = async (prompt: string, fallback: string): Promise<string> => {
    if (!allowPrompts || assumeYes) return fallback;
    const response = await rl.question(prompt);
    const answer = response.trim();
    return answer || fallback;
  };
  const model = modelFromFlag ?? (await askWithDefault(`Chat model [${DEFAULT_MODEL}]: `, DEFAULT_MODEL));
  const baseUrl = baseUrlFromFlag ?? (await askWithDefault(`LLM base URL [${DEFAULT_LLM_BASE_URL}]: `, DEFAULT_LLM_BASE_URL));

  // 1a. Best-effort reachability probe. Non-fatal: the user learns right away
  // instead of only discovering an unreachable endpoint much later during "setup".
  const endpointCheck = await checkLlmEndpoint(baseUrl, fetchImpl);
  if (endpointCheck.status !== "pass") {
    console.warn(`\nWarning: ${endpointCheck.message}`);
    console.warn(`  "repo-expert setup" will fail until the LLM endpoint is reachable.`);
  }

  // 1b. Embedding engine: the OpenAI-compatible endpoint (needs a second model
  // pull) or an in-process transformers.js pipeline (no extra pull, downloads
  // weights from Hugging Face on first use).
  const askEmbeddingEngine = async (): Promise<EmbeddingEngine> => {
    if (!allowPrompts || assumeYes) return "http";
    const response = await rl.question(
      "Embedding engine — http (default, needs `ollama pull nomic-embed-text`) or transformersjs (in-process, downloads weights from HF on first use) [http]: ",
    );
    return response.trim().toLowerCase() === "transformersjs" ? "transformersjs" : "http";
  };
  const embeddingEngine: EmbeddingEngine = embeddingEngineFromFlag ?? (await askEmbeddingEngine());

  // 2. Optional API key (only remote endpoints need one; local Ollama does not).
  const envPath = path.resolve(cwd, ".env");
  let envWritten: string | null = null;
  if (apiKeyFromFlag && apiKeyFromFlag.trim()) {
    await fs.writeFile(envPath, `${LLM_API_KEY_ENV}=${apiKeyFromFlag.trim()}\n`);
    envWritten = envPath;
    console.log(`${LLM_API_KEY_ENV}: wrote ${envPath} from --api-key`);
  } else if (process.env[LLM_API_KEY_ENV]) {
    console.log(`${LLM_API_KEY_ENV}: found in environment`);
  }

  // 3. Repo path
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
      throw new Error("Directory not found", { cause: error });
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

  // 4. Scan and detect
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

  console.log(`  Found ${String(files.length)} files`);
  console.log(`  Detected extensions: ${extensions.join(", ") || "(none)"}`);
  console.log(`  Detected ignore dirs: ${ignoreDirs.join(", ") || "(none)"}`);

  // 5. Description
  let defaultDescription = "";
  try {
    const pkgRaw = await fs.readFile(path.join(resolvedPath, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    if (typeof pkg["description"] === "string" && pkg["description"]) {
      defaultDescription = pkg["description"];
    }
  } catch {
    // no package.json
  }

  const descPrompt = defaultDescription
    ? `Description [${defaultDescription}]: `
    : "Description (e.g. \"React Native mobile app\"): ";
  let descInput = "";
  if (!assumeYes && allowPrompts) {
    descInput = await rl.question(`\n${descPrompt}`);
  }
  const description = descInput.trim() || defaultDescription || `${repoName} repository`;

  // 6. Confirm
  const displayPath = tildeify(resolvedPath);
  console.log(`\n  Repo: ${repoName}`);
  console.log(`  Path: ${displayPath}`);
  console.log(`  Description: ${description}`);
  console.log(`  Model: ${model}`);
  console.log(`  LLM base URL: ${baseUrl}`);
  console.log(`  Embedding engine: ${embeddingEngine}`);
  console.log(`  Extensions: ${extensions.join(", ")}`);
  console.log(`  Ignore dirs: ${ignoreDirs.join(", ")}`);

  let confirm = "y";
  if (!assumeYes && allowPrompts) {
    confirm = await rl.question("\nWrite config.yaml? [Y/n] ");
  }
  if (confirm.trim().toLowerCase() === "n") {
    console.log("Aborted.");
    process.exitCode = 1;
    throw new Error("Aborted by user");
  }

  // 7. Write config.yaml (back up any existing one first)
  const configPath = path.resolve(cwd, "config.yaml");
  const backupPath = `${configPath}.bak`;
  let hasExistingConfig = true;
  try {
    await fs.access(configPath);
  } catch {
    hasExistingConfig = false;
  }
  if (hasExistingConfig) {
    await fs.copyFile(configPath, backupPath);
    console.log(`\nExisting ${configPath} found — backed up to ${backupPath}`);
  }

  const yamlContent = generateConfigYaml({
    repoName,
    repoPath: displayPath,
    description,
    extensions,
    ignoreDirs,
    model,
    baseUrl,
    embeddingEngine,
  });

  await fs.writeFile(configPath, yamlContent);
  console.log(`\nWrote ${configPath}`);
  console.log(`\nNext: repo-expert setup`);

  return { configPath, envPath: envWritten, repoName };
}
