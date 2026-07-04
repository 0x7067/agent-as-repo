# Spike Report — transformers.js as the embedded local LLM

Date: 2026-07-04
Status: complete (Phase 1 shipped; Phase 2 deferred)
Prompted by: https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels — "could this replace Ollama so it's one less setup step?"

## Verdict: PARTIAL GO

The WebGPU kernels from the space itself are a no-go for this project, but the
underlying idea — embedding the model runtime in-process via
`@huggingface/transformers` — is a clear GO for embeddings and a
deferred-with-caveats for chat. Phase 1 (in-process embeddings) shipped on this
branch; chat stays on the OpenAI-compatible endpoint.

## What the space actually is

`gemma-4-webgpu-kernels` runs Gemma 4 E2B in the browser on purpose-built raw
WGSL/WebGPU kernels (related repo: https://github.com/tylerstraub/gemma4-webgpu).
It ships as a single ~552 kB browser bundle tied to `navigator.gpu` — not an npm
library, no Node support. repo-expert is a Node CLI + MCP server, so those
kernels cannot be reused here. What *is* transferable: the same model family has
ready-made ONNX weights (`onnx-community/gemma-4-E2B-it-ONNX`, ~1–2 GB at q4)
loadable by transformers.js in Node via onnxruntime-node (CPU; the v4 native
WebGPU runtime exists but should be treated as experimental in Node).

## Embeddings: GO (shipped as Phase 1)

Everything already funneled through `EmbedTexts` in `src/shell/sqlite-store.ts`,
so the integration seam was one function.

Shipped:

- `provider.embedding_engine: http | transformersjs` (default `http`; existing
  setups unaffected). `transformersjs` computes embeddings in-process — no
  `ollama pull nomic-embed-text`, no embeddings endpoint at all.
- Default HF model `nomic-ai/nomic-embed-text-v1.5` (q8 ONNX, ~140 MB),
  downloaded from the HF Hub on first use and cached; same 768-dim family as the
  Ollama default.
- `src/shell/transformersjs-embedder.ts` — lazy singleton pipeline (mean pooling
  + normalize), retry after a failed first download, count-mismatch guard.
  `@huggingface/transformers` is imported dynamically, so the dependency costs
  nothing at runtime unless the engine is enabled.
- `src/shell/embedder-factory.ts` — engine selection; wired into `cli.ts` and
  `mcp-server.ts` (new `LLM_EMBEDDING_ENGINE` env var, written by `mcp-install`,
  validated by `mcp-check`).

Verified empirically: full suite green (699 tests), and a real end-to-end run —
`createTransformersJsEmbedder("Xenova/all-MiniLM-L6-v2")` downloaded actual ONNX
weights and returned correct 2×384 normalized vectors on linux/x64 with no
onnxruntime-node postinstall step (prebuilt binaries ship in the npm tarball, so
pnpm's `onlyBuiltDependencies` gate is not a problem).

Caveats (documented in README):

- Switching engine or model changes the vector space → `setup --reindex`
  required. The store's dimension check catches mismatched sizes loudly, but
  same-dimension swaps also need a reindex to stay coherent.
- "One less setup step" is really "a different first-run cost": the ~140 MB
  weight download replaces the Ollama pull. After that it's fully offline.

## Chat: DEFERRED (Phase 2 if ever)

Feasible — Gemma 4 E2B ONNX loads in Node — but three real costs, none of which
Phase 1 pays:

1. **Tool calling is load-bearing.** The agent loop (`toolCallingLoop`,
   `archival_memory_search`, `memory_replace`) depends on OpenAI-style
   structured `tool_calls`. transformers.js returns raw text; we would have to
   render the chat template with tool definitions and parse function-call JSON
   ourselves, and a 2B-effective model driving a multi-step search-then-answer
   loop is a large quality drop from `qwen3-coder:30b`.
2. **Cold starts.** Ollama is a resident server; the CLI is a fresh process per
   invocation. In-process chat means loading ~2 GB of weights on every
   `repo-expert ask` (and separately in the MCP server) — tens of seconds on
   CPU before the first token, unless we grow a daemon.
3. **Packaging.** onnxruntime-node is another large native addon on top of the
   existing SEA + better-sqlite3 constraints
   (`2026-07-03-sea-native-addon-spike.md`).

If Phase 2 happens, the recommended shape is: in-process chat as the
fallback/`--fast` path only, template-based tool-call parsing behind the
existing `AgentProvider` port, endpoint chat remaining the quality path.
