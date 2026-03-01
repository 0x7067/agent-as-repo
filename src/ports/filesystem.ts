export interface StatResult {
  size: number;
  isDirectory(): boolean;
}

export interface GlobOptions {
  cwd: string;
  ignore?: string[];
  absolute?: boolean;
  dot?: boolean;
}

export interface FileSystemPort {
  readFile(path: string, encoding: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  stat(path: string): Promise<StatResult>;
  access(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  glob(patterns: string[], options: GlobOptions): Promise<string[]>;
}
