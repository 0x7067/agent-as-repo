import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface OpenVikingPathOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

function ensureWritableDirectory(directory: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is constrained to app-controlled candidate directories
  mkdirSync(directory, { recursive: true });
  const probePath = path.join(directory, `.probe-${String(process.pid)}-${String(Date.now())}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- probe path is under the vetted directory above
  writeFileSync(probePath, "ok", "utf8");
  rmSync(probePath, { force: true });
}

export function resolveOpenVikingBlocksDir(options: OpenVikingPathOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  const envValue = env["OPENVIKING_BLOCKS_DIR"]?.trim();
  const candidates: string[] = [
    ...(envValue ? [path.isAbsolute(envValue) ? envValue : path.resolve(cwd, envValue)] : []),
    path.join(homeDir, ".openviking", "blocks"),
    path.join(cwd, ".openviking", "blocks"),
  ];

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
