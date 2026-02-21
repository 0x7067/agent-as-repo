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
  const dotIdx = filePath.lastIndexOf(".");
  const ext = dotIdx === -1 ? "" : filePath.slice(dotIdx);
  if (!options.extensions.includes(ext)) return false;

  if (fileSizeKb > options.maxFileSizeKb) return false;

  const segments = filePath.split("/");
  for (const segment of segments) {
    if (options.ignoreDirs.includes(segment)) return false;
  }

  return true;
}
