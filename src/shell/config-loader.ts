import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import { parseConfig } from "../core/config.js";
import type { Config } from "../core/types.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";

function resolvePath(p: string): string {
  if (p.startsWith("~/")) return path.resolve(os.homedir(), p.slice(2));
  return path.resolve(p);
}

export async function loadConfig(
  filePath: string,
  fs: FileSystemPort = nodeFileSystem,
): Promise<Config> {
  const content = await fs.readFile(filePath, "utf8");
  const raw = yaml.load(content);
  const config = parseConfig(raw);

  for (const repo of Object.values(config.repos)) {
    repo.path = resolvePath(repo.path);
  }

  return config;
}
