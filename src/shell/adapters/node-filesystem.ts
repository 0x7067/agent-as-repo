/* eslint-disable security/detect-non-literal-fs-filename -- Filesystem adapter methods intentionally accept runtime paths from higher-level validated call sites. */
import * as fs from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import fg from "fast-glob";
import type { FileSystemPort, GlobOptions, StatResult, WatcherHandle } from "../../ports/filesystem.js";

export const nodeFileSystem: FileSystemPort = {
  readFile: (path, encoding) => fs.readFile(path, { encoding: encoding as BufferEncoding }),
  writeFile: (path, data) => fs.writeFile(path, data, "utf8"),
  stat: async (path): Promise<StatResult> => {
    const s = await fs.stat(path);
    return { size: s.size, isDirectory: () => s.isDirectory() };
  },
  access: (path) => fs.access(path),
  rename: (from, to) => fs.rename(from, to),
  copyFile: (src, dest) => fs.copyFile(src, dest),
  glob: (patterns, options: GlobOptions) => fg(patterns, options),
  watch: (path, options, listener): WatcherHandle => {
    return fsWatch(path, options, listener);
  },
};
/* eslint-enable security/detect-non-literal-fs-filename */
