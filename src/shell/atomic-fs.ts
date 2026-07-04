import { randomBytes } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";

/**
 * Writes `data` to `targetPath` atomically: writes to a uniquely-named temp
 * file in the same directory, then renames it over the target. `rename` is
 * atomic within the same filesystem/volume, so a process that dies mid-write
 * never leaves a truncated/partial file at `targetPath` — either the old
 * content is still there, or the new content is there in full.
 *
 * Used for SEA blob-asset extraction (src/shell/tree-sitter-paths.ts,
 * src/shell/sqlite-native.ts), where a crash between `open` and `close`
 * would otherwise corrupt the on-disk cache for every future run.
 */
export function atomicWriteFileSync(targetPath: string, data: Buffer | string): void {
  const tempPath = `${targetPath}.tmp-${String(process.pid)}-${randomBytes(6).toString("hex")}`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- tempPath/targetPath are derived from caller-owned cache directories, not external input
  writeFileSync(tempPath, data);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- tempPath/targetPath are derived from caller-owned cache directories, not external input
  renameSync(tempPath, targetPath);
}
