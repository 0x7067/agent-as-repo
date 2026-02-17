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

async function main(): Promise<void> {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
