import * as fs from "fs/promises";
import yaml from "js-yaml";
import { parseConfig } from "../core/config.js";
import type { Config } from "../core/types.js";

export async function loadConfig(filePath: string): Promise<Config> {
  const content = await fs.readFile(filePath, "utf-8");
  const raw = yaml.load(content);
  return parseConfig(raw);
}
