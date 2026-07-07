import * as esbuild from "esbuild";

const shared: esbuild.BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  external: [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "readline/promises",
    // Native-addon packages resolve from node_modules at runtime.
    "better-sqlite3",
    "sqlite-vec",
    // Transitive dep of @huggingface/transformers; loads platform-specific
    // .node binaries via a dynamic require esbuild can't bundle.
    "onnxruntime-node",
  ],
  // esbuild's ESM output emits a `require` shim for bundled CJS deps that
  // falls back to throwing when no global `require` exists (real ESM has
  // none). Polyfill it via createRequire so those deps' `require("fs")`
  // etc. resolve normally at runtime.
  banner: {
    js: "import { createRequire as __repoExpertCreateRequire } from \"node:module\";\nconst require = __repoExpertCreateRequire(import.meta.url);",
  },
};

const seaShared: esbuild.BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  // Disable the import.meta.url guard so it never fires in CJS/SEA context.
  // The SEA entry wrappers call main() directly instead.
  // better-sqlite3's JS wrapper is intentionally bundled here: the SEA
  // runtime dlopens the addon extracted from blob assets and passes it via
  // `nativeBinding` (see src/shell/sqlite-native.ts).
  define: { "import.meta.url": '"file:///sea-bundle"' },
};

async function buildEsm(): Promise<void> {
  // Output under dist/bin/ (two levels below the package root), not dist/
  // directly (one level). src/shell/tree-sitter-paths.ts's
  // resolvePackageRoot() walks up two directories from import.meta.url to
  // find the package root (matching its own original src/shell/ depth); once
  // bundled, import.meta.url is the *output* file's URL, so the output must
  // sit at the same depth or that walk lands one directory short and the
  // installed package can't find vendor/wasm and node_modules.
  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: ["src/cli.ts"],
      outfile: "dist/bin/cli.mjs",
    }),
    esbuild.build({
      ...shared,
      entryPoints: ["src/mcp-server.ts"],
      outfile: "dist/bin/mcp-server.mjs",
    }),
  ]);

  console.log("Build complete: dist/bin/cli.mjs, dist/bin/mcp-server.mjs");
}

async function buildSea(): Promise<void> {
  await Promise.all([
    esbuild.build({
      ...seaShared,
      entryPoints: ["scripts/sea-cli-entry.ts"],
      outfile: "dist/sea-cli.cjs",
    }),
    esbuild.build({
      ...seaShared,
      entryPoints: ["scripts/sea-mcp-entry.ts"],
      outfile: "dist/sea-mcp-server.cjs",
    }),
  ]);

  console.log("SEA build complete: dist/sea-cli.cjs, dist/sea-mcp-server.cjs");
}

const fn = process.argv.includes("--sea") ? buildSea : buildEsm;

fn().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
