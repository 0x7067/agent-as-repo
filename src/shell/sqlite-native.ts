import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export type VectorDatabase = Database.Database;

interface SeaApi {
  isSea(): boolean;
  getRawAsset(key: string): ArrayBuffer;
}

/**
 * SEA binaries carry the natives as blob assets; everything else resolves
 * them from node_modules. Detection must not throw outside SEA builds.
 */
function tryGetSea(): SeaApi | undefined {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const sea = requireFromHere("node:sea") as SeaApi;
    return sea.isSea() ? sea : undefined;
  } catch {
    return undefined;
  }
}

function vecExtensionFilename(): string {
  if (process.platform === "win32") return "vec0.dll";
  if (process.platform === "darwin") return "vec0.dylib";
  return "vec0.so";
}

/**
 * dlopen/loadExtension need real filesystem paths, so SEA assets are
 * extracted once into a cache keyed by platform/arch/Node version.
 */
function extractSeaAsset(sea: SeaApi, assetKey: string, targetPath: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- target is inside the app-owned native cache dir
  if (existsSync(targetPath)) return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- target is inside the app-owned native cache dir
  writeFileSync(targetPath, Buffer.from(sea.getRawAsset(assetKey)));
}

function openSeaDatabase(sea: SeaApi, dbPath: string): VectorDatabase {
  const cacheDir = path.join(
    homedir(),
    ".repo-expert",
    "native",
    `${process.platform}-${process.arch}-node${process.versions.node}`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned native cache dir
  mkdirSync(cacheDir, { recursive: true });

  const addonPath = path.join(cacheDir, "better_sqlite3.node");
  const vecPath = path.join(cacheDir, vecExtensionFilename());
  extractSeaAsset(sea, "better_sqlite3.node", addonPath);
  extractSeaAsset(sea, "vec0", vecPath);

  // better-sqlite3's own resolver (the `bindings` package) breaks inside SEA;
  // dlopen the addon directly and hand it over via `nativeBinding`.
  const addonModule = { exports: {} };
  process.dlopen(addonModule as NodeJS.Module, addonPath);
  const db = new Database(dbPath, {
    nativeBinding: addonModule.exports as unknown as string,
  });
  db.loadExtension(vecPath);
  return db;
}

function openNodeModulesDatabase(dbPath: string): VectorDatabase {
  const requireFromHere = createRequire(import.meta.url);
  const sqliteVec = requireFromHere("sqlite-vec") as { getLoadablePath: () => string };
  const db = new Database(dbPath);
  db.loadExtension(sqliteVec.getLoadablePath());
  return db;
}

/** Open a SQLite database with the sqlite-vec (vec0) extension loaded. */
export function openVectorDatabase(dbPath: string): VectorDatabase {
  if (dbPath !== ":memory:") {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the app-owned store location
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const sea = tryGetSea();
  const db = sea === undefined ? openNodeModulesDatabase(dbPath) : openSeaDatabase(sea, dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}
