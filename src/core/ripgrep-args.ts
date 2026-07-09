export interface RipgrepArgsOptions {
  pattern: string;
  path?: string;
  glob?: string;
  caseInsensitive?: boolean;
  maxResults?: number;
  ignoreDirs?: string[];
}

const DEFAULT_MAX_RESULTS = 50;

/**
 * Pure argv builder for `rg`. Callers pass the returned array to
 * `execFileSync("rg", args, { cwd })` — never interpolate into a shell string.
 */
export function buildRipgrepArgs(options: RipgrepArgsOptions): string[] {
  if (options.pattern === "") {
    throw new Error("ripgrep pattern must be non-empty");
  }

  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const args: string[] = [];

  if (options.caseInsensitive) {
    args.push("-i");
  }

  args.push("--line-number", "--no-heading", "--color", "never");
  args.push("--max-count", String(maxResults));

  if (options.glob !== undefined) {
    args.push("--glob", options.glob);
  }

  for (const dir of options.ignoreDirs ?? []) {
    args.push("--glob", `!${dir}/**`);
  }

  args.push("--", options.pattern, options.path ?? ".");
  return args;
}
