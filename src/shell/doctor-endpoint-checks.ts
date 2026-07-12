import type { CheckResult } from "../core/doctor.js";
import type { AgentProvider } from "../ports/agent-provider.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { embed } from "./llm-client.js";

/**
 * LLM endpoint/model reachability checks — split out of doctor.ts (which was
 * over the 300-line file cap) as a cohesive group: everything here probes the
 * configured provider's HTTP endpoint (chat models, embeddings) rather than
 * local config/state/git bookkeeping. Re-exported from doctor.ts so existing
 * imports keep working unchanged.
 */

const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
const LLM_ENDPOINT_TIMEOUT_MS = 3000;

function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(url);
}

const OLLAMA_DEFAULT_PORT = "11434";

/**
 * Ollama-specific remediation hints (`ollama pull ...`, `ollama serve`) only make sense
 * against a local Ollama endpoint. `isLocalUrl` covers localhost/127.0.0.1/etc.; this also
 * catches a LAN-reachable Ollama on its default port (e.g. `http://192.168.1.5:11434/v1`).
 * Exported so cli.ts's setup preflight can make its own endpoint-unreachable hint
 * endpoint-aware too, instead of always suggesting `ollama serve`.
 */
export function isLocalOllamaEndpoint(baseUrl: string): boolean {
  return isLocalUrl(baseUrl) || baseUrl.includes(`:${OLLAMA_DEFAULT_PORT}`);
}

/** Endpoint-aware "model not found" remediation: Ollama gets `ollama pull`, anything else gets a neutral hint. */
function modelNotFoundHint(baseUrl: string, model: string): string {
  if (isLocalOllamaEndpoint(baseUrl)) {
    return `Try: ollama pull ${model}`;
  }
  return `Check that "${model}" is the correct model id for ${baseUrl} and that your API key has access to it.`;
}

export interface ProviderModelInfo {
  baseUrl: string;
  model: string | null;
  embeddingEngine: string | null;
  embeddingModel: string | null;
}

export async function loadProviderModelInfo(configPath: string, fs: FileSystemPort = nodeFileSystem): Promise<ProviderModelInfo> {
  try {
    const { loadConfig } = await import("./config-loader.js");
    const config = await loadConfig(configPath, fs);
    return {
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
      embeddingEngine: config.provider.embeddingEngine,
      embeddingModel: config.provider.embeddingModel,
    };
  } catch {
    return { baseUrl: DEFAULT_LLM_BASE_URL, model: null, embeddingEngine: null, embeddingModel: null };
  }
}

/**
 * The LLM endpoint only needs an API key when it's remote (OpenRouter etc.).
 * Local Ollama needs none, so a missing key is only a warning for remote URLs.
 */
export function checkApiKey(baseUrl: string = DEFAULT_LLM_BASE_URL): CheckResult {
  if (isLocalUrl(baseUrl)) {
    return { name: "LLM API key", status: "pass", message: `Local LLM endpoint (${baseUrl}) needs no API key` };
  }
  if (!process.env["LLM_API_KEY"]) {
    const message = `LLM_API_KEY not set for non-local endpoint ${baseUrl}. Set it in .env if the endpoint requires auth.`;
    return { name: "LLM API key", status: "warn", message };
  }
  return { name: "LLM API key", status: "pass", message: "Set in environment" };
}

export async function checkApiConnection(provider: AgentProvider, agentId: string): Promise<CheckResult> {
  try {
    await provider.listPassages(agentId);
    return { name: "API connection", status: "pass", message: "Passage store is readable" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { name: "API connection", status: "fail", message: `Cannot read the passage store: ${msg}` };
  }
}

type ModelsFetchResult = { res: Response } | { error: string };

/** Shared `GET {baseUrl}/models` + timeout/abort plumbing for checkLlmEndpoint and checkModelAvailable. */
async function fetchModelsList(baseUrl: string, fetchImpl: typeof fetch): Promise<ModelsFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, LLM_ENDPOINT_TIMEOUT_MS);
  try {
    return { res: await fetchImpl(`${baseUrl}/models`, { method: "GET", signal: controller.signal }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkLlmEndpoint(
  baseUrl: string = DEFAULT_LLM_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
  const result = await fetchModelsList(baseUrl, fetchImpl);
  // Warn (not fail): the endpoint may simply not be running yet (e.g. Ollama not started).
  if ("error" in result) {
    return { name: "LLM endpoint", status: "warn", message: `Cannot reach LLM endpoint ${baseUrl}: ${result.error}` };
  }
  if (result.res.ok) {
    return { name: "LLM endpoint", status: "pass", message: `Reachable at ${baseUrl}` };
  }
  return { name: "LLM endpoint", status: "warn", message: `${baseUrl}/models returned HTTP ${String(result.res.status)}` };
}

interface ModelsListResponse {
  data?: Array<{ id?: string }>;
}

/**
 * Verify `model` actually exists on the endpoint, not just that it responds.
 * A models-listing failure (unreachable, non-OK, or unimplemented `/models`)
 * degrades to a warning; only a confirmed absence from the list fails.
 */
export async function checkModelAvailable(
  baseUrl: string,
  model: string,
  label: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
  const url = `${baseUrl}/models`;
  const result = await fetchModelsList(baseUrl, fetchImpl);
  if ("error" in result) {
    return { name: label, status: "warn", message: `Could not verify model "${model}" at ${url}: ${result.error}` };
  }
  if (!result.res.ok) {
    return { name: label, status: "warn", message: `${url} returned HTTP ${String(result.res.status)}; could not verify model "${model}" is available` };
  }

  let ids: string[];
  try {
    const payload = await result.res.json() as ModelsListResponse;
    ids = (payload.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === "string");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { name: label, status: "warn", message: `Could not parse models list from ${url}: ${msg}` };
  }
  if (ids.length === 0) {
    return { name: label, status: "warn", message: `${url} returned no models; could not verify model "${model}" is available` };
  }
  if (ids.includes(model)) {
    return { name: label, status: "pass", message: `Model "${model}" is available at ${baseUrl}` };
  }
  return { name: label, status: "fail", message: `Model "${model}" not found at ${baseUrl}. ${modelNotFoundHint(baseUrl, model)}` };
}

/**
 * Verify an embedding model actually works by making a real embedding call, rather than
 * checking `GET /models` — remote endpoints like OpenRouter never list embedding models
 * there (only chat models), so a models-list-based check false-fails against a perfectly
 * healthy embedding endpoint. Success is a well-formed embedding vector for a tiny probe
 * input; any failure (network, auth, unknown model, malformed response) fails the check
 * with an endpoint-aware remediation hint.
 *
 * Reuses `embed()` from llm-client.ts (shared fetch/auth/timeout conventions) rather than
 * an ad hoc HTTP call.
 */
export async function checkEmbeddingModelAvailable(
  baseUrl: string,
  model: string,
  apiKey: string | undefined,
  label = "Embedding model",
  embedImpl: typeof embed = embed,
): Promise<CheckResult> {
  try {
    const vectors = await embedImpl(["ping"], model, baseUrl, apiKey, { timeoutMs: LLM_ENDPOINT_TIMEOUT_MS });
    const vector = vectors.at(0);
    const isWellFormed = vectors.length === 1 && Array.isArray(vector) && vector.length > 0
      && vector.every((n) => typeof n === "number" && Number.isFinite(n));
    if (!isWellFormed) {
      return {
        name: label,
        status: "fail",
        message: `${baseUrl}/embeddings returned a malformed embedding for model "${model}".`,
      };
    }
    return {
      name: label,
      status: "pass",
      message: `Model "${model}" produced a ${String(vector.length)}-dimensional embedding at ${baseUrl}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // `postJson` (llm-client.ts) throws "HTTP <status> from <url>" for a non-OK response —
    // that's an authoritative negative result (bad model id, bad auth, etc.) worth failing
    // on. Anything else (connection refused, DNS failure, timeout) means the endpoint isn't
    // reachable at all, which — same as checkLlmEndpoint/checkModelAvailable — degrades to a
    // warning rather than blocking setup/doctor outright.
    if (!/^HTTP \d+ /.test(msg)) {
      return {
        name: label,
        status: "warn",
        message: `Could not verify embedding model "${model}" at ${baseUrl}/embeddings: ${msg}`,
      };
    }
    return {
      name: label,
      status: "fail",
      message: `Embeddings probe failed for model "${model}" at ${baseUrl}/embeddings: ${msg}. ${modelNotFoundHint(baseUrl, model)}`,
    };
  }
}
