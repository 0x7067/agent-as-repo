import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when the given module is the process entry point. npm installs bin
 * scripts as symlinks (node_modules/.bin/repo-expert -> dist/bin/cli.mjs),
 * so a plain `process.argv[1] === fileURLToPath(import.meta.url)` check
 * fails for the installed package; resolve symlinks before comparing.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined = process.argv.at(1)): boolean {
  if (argv1 === undefined) return false;
  const modulePath = fileURLToPath(moduleUrl);
  if (argv1 === modulePath) return true;
  try {
    // argv1 comes from the process invocation, not user data.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return realpathSync(argv1) === realpathSync(modulePath);
  } catch {
    return false;
  }
}
