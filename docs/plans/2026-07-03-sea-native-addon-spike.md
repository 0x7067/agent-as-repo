# Spike Report — SEA + Native Addons (sqlite-vec go/no-go)

Date: 2026-07-03
Status: complete
Answers: phase 1 gate of item 3 in `2026-07-03-follow-ups-plan.md`

## Verdict: GO

A Node SEA binary can load both `better-sqlite3`'s native `.node` addon and the
`sqlite-vec` `vec0.so` loadable extension. Verified empirically end-to-end
(create `vec0` virtual table, insert float32 embeddings, `MATCH` top-k query)
inside a real postject-injected SEA binary, run from a clean directory with no
`node_modules`. Item 3 phases 2–5 are unblocked.

## What was verified

- Plain node: better-sqlite3 12.11.1 + sqlite-vec 0.1.9, vec0 table + top-k query.
- esbuild bundle (`--platform=node --format=cjs`, mirroring `scripts/build.ts`)
  runs the same flow — 35.6 kb bundle, no dynamic-require breakage once addon
  loading is routed through the shim below.
- SEA build per the repo's existing recipe (`node --experimental-sea-config` +
  `postject --sentinel-fuse`, matching `scripts/build-sea.sh`) on Node 22.22.2.
- Both native-loading strategies work inside the SEA binary:
  - **Asset mode (recommended):** ship `better_sqlite3.node` and `vec0.so` as SEA
    `assets`; at runtime `sea.getRawAsset(...)` → write to a temp file → load.
    Single self-contained binary. Production fix needed: cache the extraction in
    a versioned dir instead of re-extracting per invocation. `dlopen`/
    `loadExtension` require a real filesystem path — extraction is mandatory.
  - **Sidecar mode:** ship both native files next to the binary, resolve via
    `path.dirname(process.execPath)`. Three files instead of one.

## The load-bearing shim

Native code cannot live in the JS blob; bypass both packages' resolvers:

```js
const m = { exports: {} };
process.dlopen(m, path.resolve(addonPath));           // better_sqlite3.node
const db = new Database(":memory:", { nativeBinding: m.exports });
db.loadExtension(path.resolve(vecPath));              // vec0.so
```

- better-sqlite3 12.x accepts `nativeBinding` as an already-loaded addon object,
  which sidesteps the `bindings` package (broken inside SEA).
- Do not call `sqliteVec.load(db)` (it uses `require.resolve` on the platform
  package); call `db.loadExtension(absolutePath)` directly.

## Constraints for implementation

- **ABI lock:** `better_sqlite3.node` must be compiled against the exact Node
  major used to build the SEA (the SEA copies that node binary). No prebuild
  existed for Node 22.22.2 — compiled from source via node-gyp (needs
  make/gcc/g++/python3). Moving the SEA build to another Node major means
  rebuilding the addon.
- `vec0.so` is a plain SQLite loadable extension — platform/arch-specific but
  not Node-ABI-tied.
- **Per-platform artifacts:** sqlite-vec ships `sqlite-vec-{linux,darwin,windows}-{x64,arm64}`
  packages (`.so`/`.dylib`/`.dll`) as optionalDependencies; pnpm does not install
  them by default — the build matrix must add the right one per target.
- **pnpm:** better-sqlite3's install script is in pnpm's ignored-build-scripts
  list (needs `pnpm approve-builds` or explicit rebuild).
- **Build-step changes:** (1) native-artifact staging step per target; (2) add
  `assets` to the sea-config JSONs; (3) small runtime shim (above) in the shell
  layer. macOS keeps the existing codesign strip/re-sign dance.

## Surprises

- vec0 rejects float primary keys: bind rowids as BigInt (`1n`) — better-sqlite3
  binds plain JS numbers as floats. Any implementation will hit this.
- SEA blob with both native assets is only ~2.4 MB; the final binary size is
  dominated by the copied node runtime itself.
