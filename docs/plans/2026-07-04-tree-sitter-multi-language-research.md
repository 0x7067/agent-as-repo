# Tree-sitter Multi-Language Support — Research Findings

**Date:** 2026-07-04
**Scope:** What it takes to extend tree-sitter symbol-boundary chunking beyond TS/JS to the other default-indexed extensions (`.py .go .rs .java .kt .rb .php .swift .c .h .cpp .hpp .cs`, plus `.md .json .yaml .yml .toml`).
**Status:** Research only — no implementation. Follow-up to the TS/JS-only scope guardrail in `2026-07-03-production-readiness-plan.md` ("Do not attempt to support all 40+ tree-sitter grammars in one slice").

## TL;DR

- **9 of the 11 target code languages ship prebuilt `.wasm` in their official npm packages** — the exact same pattern we already use for `tree-sitter-javascript` / `tree-sitter-typescript`. Adding them is mostly `pnpm add` + wiring.
- **Kotlin and Swift are the only gaps**: their npm packages (community grammars `fwcd/tree-sitter-kotlin`, `alex-pinkus/tree-sitter-swift`) ship native prebuilds only, no `.wasm`. Fill from an aggregate package or self-build.
- **ABI compatibility is a non-issue**: `web-tree-sitter` 0.26.x loads grammar ABI 13–15 (hard error outside that range, no silent degrade). Every package below is in range.
- **Found a live bug**: chunking is not gated to JS/TS. `grammarLabelForPath()` defaults *every* unknown extension to the TypeScript grammar, so `.py`/`.go`/`.java`/`.md` files are parsed as TypeScript today. Most fall through to raw chunking accidentally (no matching node types), but brace-style languages (Java, C#, Kotlin) can emit real-looking `class_declaration` nodes → subtly wrong chunk boundaries. `README.md` / `docs/architecture.md` claim a raw-text fallback that the code doesn't actually implement as a filter.
- **SEA gap (pre-existing)**: `scripts/build-sea.sh` stages only `better_sqlite3.node` + `vec0` as blob assets — no `.wasm` at all — and `scripts/build.ts` defines `import.meta.url` as `file:///sea-bundle`, so `resolvePackageRoot()` can't resolve `node_modules` paths inside the SEA binary. Tree-sitter is likely already broken in SEA builds; must be fixed before (or as part of) adding more grammars.

## Per-language availability (verified on npm, 2026-07)

| Language | npm package | Version | Ships `.wasm`? | ABI | wasm size | Declaration node types for symbol extraction |
|---|---|---|---|---|---|---|
| Python | `tree-sitter-python` | 0.25.0 | ✅ | 15 (confirmed) | 458 KB | `function_definition`, `class_definition`, `decorated_definition` (methods are also `function_definition` — no separate method node) |
| Go | `tree-sitter-go` | 0.25.0 | ✅ | 15 | 217 KB | `function_declaration`, `method_declaration` (has `receiver` field), `type_declaration` |
| Rust | `tree-sitter-rust` | 0.24.0 | ✅ | 14 | 1.1 MB | `function_item`, `struct_item`, `enum_item`, `impl_item`, `trait_item`, `mod_item` |
| Java | `tree-sitter-java` | 0.23.5 | ✅ | 14 | 415 KB | `class_declaration`, `interface_declaration`, `method_declaration`, `enum_declaration` |
| Kotlin | `tree-sitter-kotlin` (fwcd) | 0.3.8 | ❌ native only | 13 | ~4.1 MB (aggregate pkgs) | `function_declaration`, `class_declaration`, `object_declaration`, `property_declaration`, `type_alias` |
| Ruby | `tree-sitter-ruby` | 0.23.1 | ✅ | 14 | 2.1 MB | `method`, `singleton_method`, `class`, `module` |
| PHP | `tree-sitter-php` | 0.24.2 | ✅ (two variants) | 15 | 1.06 MB | `function_definition`, `method_declaration`, `class_declaration`, `interface_declaration`, `trait_declaration` |
| Swift | `tree-sitter-swift` (alex-pinkus) | 0.7.1 | ❌ native only | 13/14 | ~3.2–3.8 MB (aggregate pkgs) | `class_declaration` (also covers struct/enum via `declaration_kind` field), `function_declaration`, `protocol_declaration`, `init_declaration` |
| C | `tree-sitter-c` | 0.24.1 | ✅ | 15 | 626 KB | `function_definition`, `type_definition`, `struct_specifier`, `enum_specifier`, `declaration` |
| C++ | `tree-sitter-cpp` | 0.23.4 | ✅ | 14 | 3.4 MB | `function_definition`, `class_specifier`, `struct_specifier`, `namespace_definition`, `template_declaration` |
| C# | `tree-sitter-c-sharp` | 0.23.5 | ✅ ⚠️ file is `tree-sitter-c_sharp.wasm` (underscore) | 15 | 5.35 MB | `class_declaration`, `interface_declaration`, `struct_declaration`, `record_declaration`, `method_declaration`, `namespace_declaration` |

All MIT-licensed. All tree-sitter-org grammars except Kotlin (fwcd, ~61% structural fidelity vs kotlinc PSI) and Swift (alex-pinkus, de facto standard). C# grammar is maintained but quiet (no release in ~12 months).

### PHP variant note

`tree-sitter-php` ships two grammars: `tree-sitter-php.wasm` (full `.php` files including `<?php ?>` tags and interleaved HTML — **use this one**) and `tree-sitter-php_only.wasm` (PHP content only, for embedding).

## Filling the Kotlin/Swift gap (and structured-text formats)

Options, best-first:

1. **Self-build via `tree-sitter build --wasm`** — since tree-sitter CLI 0.26.1 (Dec 2025) this uses the WASI SDK (auto-downloaded), **no Docker/Emscripten needed**. `npx tree-sitter build --wasm node_modules/tree-sitter-kotlin` works in bare CI. Add the grammar source packages as devDependencies, build in CI, vendor the `.wasm` with pinned versions/checksums. Most maintainable long-term; removes third-party trust risk.
2. **`@lumis-sh/wasm-*`** (one package per grammar, ABI 15, built with CLI 0.26.x, current as of 2026-06) — freshest prebuilt source; only prebuilt source for Markdown. Caveats: single-maintainer scope (vendor the `.wasm`, don't take a runtime dep), and each package double-ships the wasm as base64 inside `index.js` (extract only the `.wasm`).
3. **`tree-sitter-wasms`** (0.1.13, Unlicense) — widest single-package coverage (36 grammars incl. kotlin, swift, json, yaml, toml) but built with CLI 0.20 (ABI 14) from 2023–24-era grammar versions, and ~9 months stale. Loadable, but lags language syntax. Stopgap only.
4. **`@vscode/tree-sitter-wasm`** (0.3.1, Microsoft) — best-maintained aggregate, but only covers languages the official packages already ship wasm for (no Kotlin/Swift/Rust/C/Markdown/YAML/TOML), so it adds little over option "just use the official packages".

### Markdown / JSON / YAML / TOML

- **Markdown**: grammar is split into two parsers (block + inline) requiring a two-pass parse with `set_included_ranges`. Real integration work; historical WASM-build issues. **Recommendation: skip tree-sitter — heading-based splitting (`#`/`##` boundaries) gets ~90% of the value at ~10% of the cost** and fits the existing pure-core chunker.
- **JSON**: `JSON.parse` is free and native; tree-sitter adds nothing here. Skip.
- **YAML** (183 KB) / **TOML** (25 KB): tiny wasms exist (`tree-sitter-grammars` org); tree-sitter genuinely helps with nested block/flow structure. Worth it only if config-file chunking quality becomes a real complaint — low priority.

## Codebase change surface

1. **`src/core/tree-sitter-chunker.ts`**
   - `grammarLabelForPath()` (lines 29–35): replace default-to-`"typescript"` with an explicit extension→grammar map; unknown extensions must return "no grammar" → raw fallback. **This fixes the mis-parse bug even before adding any language.**
   - `extractSymbolSpans`/`extractFromDeclaration` (lines 104–170): hardcode JS/TS node types. Needs a per-language dispatch table: `{ label → { nodeType → SymbolKind } }` driven by the node-type column above. `SymbolKind` union needs additions (e.g. `STRUCT`, `ENUM`, `TRAIT`/`PROTOCOL`, `MODULE`, `IMPL`).
   - `TreeSitterInitOptions` + the `["typescript","tsx","javascript"]` literal in `initTreeSitterChunker` (lines 7–12, 203): replace one-field-per-grammar with a data-driven `{ label, wasmPath }[]`.
2. **`src/shell/tree-sitter-paths.ts`**: same data-driven rewrite (currently 4 hardcoded fields). Watch the C# filename (`tree-sitter-c_sharp.wasm`).
3. **`scripts/build.ts` / `scripts/build-sea.sh`**: no `.wasm` is copied into `dist/` or staged as SEA blob assets today. Fix the SEA wasm story first (follow the `sqlite-native.ts` blob-asset pattern); then budget for the size impact — the 9 official grammars add ~14 MB of wasm; Kotlin+Swift add ~7–8 MB more, embedded in *each* of the two SEA binaries.
4. **Tests**: `src/core/tree-sitter-chunker.test.ts` + `src/shell/sync.test.ts` duplicate the wasm-path wiring — collapse into a shared helper. Add per-language inline-fixture tests (one `it` per declaration kind + a fallback case), and a regression test that an unknown extension goes to raw chunking, which no current test covers.
5. **Docs**: `README.md:121` and `docs/architecture.md:153` claim a raw-text fallback for non-JS/TS that doesn't exist as described — correct regardless of this work.

## Recommended rollout

1. **Slice 0 (bug fix, no new deps):** explicit extension→grammar map with raw fallback for unmapped extensions + regression test + doc correction.
2. **Slice 1 (cheap wins):** Python, Go, Java, Ruby — official npm packages, small wasms (0.2–2 MB), clean declaration node sets. Data-driven refactor of init/paths lands here.
3. **Slice 2:** Rust, PHP, C, C++, C# — official packages, but larger wasms (C++/C# are 3.4/5.4 MB) and messier node sets (`impl_item`, PHP variants, C `declaration` ambiguity). Fix SEA wasm staging before or during this slice.
4. **Slice 3 (optional):** Kotlin + Swift via CI self-build (`tree-sitter build --wasm`, WASI SDK, no Docker) with vendored, checksummed wasms. Weigh 7–8 MB of wasm against actual demand.
   **Status: implemented.** Self-build was attempted first but blocked in this environment — `tree-sitter-cli`'s own postinstall couldn't download its platform binary from `github.com/tree-sitter/tree-sitter/releases/...` (403, org egress policy), so the WASI SDK it would additionally need was never reached. Fell back to vendoring prebuilt wasm from `@lumis-sh/wasm-kotlin`/`@lumis-sh/wasm-swift` (ABI 15, built with tree-sitter-cli 0.26.x) after `tree-sitter-wasms` — this doc's other listed fallback — turned out to ship pre-2021-Emscripten `dylink` sections that `web-tree-sitter` 0.26.x can't load at all (needs `dylink.0`). Vendored sizes: kotlin ~3.9 MB, swift ~3.6 MB (~7.6 MB combined, in line with the estimate above). See `vendor/wasm/checksums.json` and `scripts/build-grammar-wasm.ts`.
5. **Skip:** tree-sitter for Markdown/JSON; revisit YAML/TOML only on demand.

## Sources

- npm registry + unpkg file listings for every package above (wasm presence and sizes verified from tarball contents, not READMEs)
- ABI confirmed from `parser.c` (`LANGUAGE_VERSION`) for tree-sitter-python 0.25.0 (15) and tree-sitter-typescript 0.23.2 (14); others inferred from each package's `tree-sitter-cli` devDependency (CLI <0.25 → ABI 14, ≥0.25 → ABI 15)
- `web-tree-sitter` compatibility range (ABI 13–15, hard load-time error outside it) confirmed from `tree_sitter/api.h` and the compiled `web-tree-sitter.cjs` in 0.26.10; ABI-15 wasm loading landed in 0.26.9
- https://github.com/tree-sitter/tree-sitter-{python,go,rust,java,ruby,php,c,cpp,c-sharp}, https://github.com/fwcd/tree-sitter-kotlin, https://github.com/alex-pinkus/tree-sitter-swift, https://github.com/sourcegraph/tree-sitter-wasms, https://github.com/microsoft/vscode-tree-sitter-wasm, https://github.com/tree-sitter-grammars
- tree-sitter CLI 0.26.1 release notes + docs (Emscripten → WASI SDK switch for `build --wasm`)
