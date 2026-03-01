import * as esbuild from "esbuild";

const shared: esbuild.BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  sourcemap: false,
  external: [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "readline/promises",
  ],
};

const seaShared: esbuild.BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: false,
  // Disable the import.meta.url guard so it never fires in CJS/SEA context.
  // The SEA entry wrappers call main() directly instead.
  define: { "import.meta.url": '"file:///sea-bundle"' },
};

async function buildEsm(): Promise<void> {
  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: ["src/cli.ts"],
      outfile: "dist/cli.mjs",
      banner: { js: "#!/usr/bin/env node" },
    }),
    esbuild.build({
      ...shared,
      entryPoints: ["src/mcp-server.ts"],
      outfile: "dist/mcp-server.mjs",
      banner: { js: "#!/usr/bin/env node" },
    }),
  ]);

  console.log("Build complete: dist/cli.mjs, dist/mcp-server.mjs");
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

fn().catch((err) => {
  console.error(err);
  process.exit(1);
});
