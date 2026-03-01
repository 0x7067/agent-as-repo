import * as fs from "node:fs/promises";
import fg from "fast-glob";
import type { FileSystemPort, GlobOptions, StatResult } from "../../ports/filesystem.js";

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
};
