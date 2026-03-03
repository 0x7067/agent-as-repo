export interface StatResult {
  size: number;
  isDirectory(this: void): boolean;
}

export interface GlobOptions {
  cwd: string;
  ignore?: string[];
  absolute?: boolean;
  dot?: boolean;
  deep?: number;
  onlyFiles?: boolean;
  followSymbolicLinks?: boolean;
}

export interface WatcherHandle {
  close(this: void): void;
  on(this: void, event: "error", listener: (err: Error) => void): this;
}

export interface FileSystemPort {
  readFile(this: void, path: string, encoding: string): Promise<string>;
  writeFile(this: void, path: string, data: string): Promise<void>;
  stat(this: void, path: string): Promise<StatResult>;
  access(this: void, path: string): Promise<void>;
  rename(this: void, from: string, to: string): Promise<void>;
  copyFile(this: void, src: string, dest: string): Promise<void>;
  glob(this: void, patterns: string[], options: GlobOptions): Promise<string[]>;
  watch(
    this: void,
    path: string,
    options: { recursive?: boolean },
    listener: (event: string, filename: string | null) => void,
  ): WatcherHandle;
}
