import * as path from "path";

export interface FilterOptions {
  extensions: string[];
  ignoreDirs: string[];
  maxFileSizeKb: number;
}

export function shouldIncludeFile(
  filePath: string,
  fileSizeKb: number,
  options: FilterOptions,
): boolean {
  const ext = path.extname(filePath);
  if (!options.extensions.includes(ext)) return false;

  if (fileSizeKb > options.maxFileSizeKb) return false;

  const segments = filePath.split(path.sep);
  for (const segment of segments) {
    if (options.ignoreDirs.includes(segment)) return false;
  }

  return true;
}
