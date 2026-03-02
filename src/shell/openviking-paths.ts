import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface OpenVikingPathOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

function ensureWritableDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true });
  const probePath = join(directory, `.probe-${process.pid}-${Date.now()}`);
  writeFileSync(probePath, "ok", "utf-8");
  rmSync(probePath, { force: true });
}

export function resolveOpenVikingBlocksDir(options: OpenVikingPathOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  const candidates: string[] = [];
  const envValue = env["OPENVIKING_BLOCKS_DIR"]?.trim();
  if (envValue) {
    candidates.push(isAbsolute(envValue) ? envValue : resolve(cwd, envValue));
  }
  candidates.push(join(homeDir, ".openviking", "blocks"));
  candidates.push(join(cwd, ".openviking", "blocks"));

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      ensureWritableDirectory(candidate);
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate}: ${message}`);
    }
  }

  throw new Error(
    [
      "Unable to find a writable OpenViking block storage directory.",
      "Set OPENVIKING_BLOCKS_DIR to a writable location.",
      ...errors.map((e) => `- ${e}`),
    ].join("\n"),
  );
}
