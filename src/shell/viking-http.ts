export interface SearchResult {
  uri: string;
  text: string;
  score: number;
}

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BREAKER_FAILURE_THRESHOLD = 4;
const DEFAULT_BREAKER_WINDOW_MS = 10_000;
const DEFAULT_BREAKER_COOLDOWN_MS = 2_500;

type CircuitDomain = "fs" | "content";

interface VikingHttpClientOptions {
  maxRetries?: number;
  breakerFailureThreshold?: number;
  breakerWindowMs?: number;
  breakerCooldownMs?: number;
}

class RequestCircuitBreaker {
  private readonly failureHistory = new Map<CircuitDomain, number[]>();
  private readonly openUntil = new Map<CircuitDomain, number>();

  constructor(
    private readonly failureThreshold: number,
    private readonly windowMs: number,
    private readonly cooldownMs: number,
  ) {}

  assertCanRequest(domain: CircuitDomain): void {
    const now = Date.now();
    const openUntil = this.openUntil.get(domain) ?? 0;
    if (now < openUntil) {
      const retryInMs = openUntil - now;
      throw new Error(`Circuit open for Viking ${domain} operations; retry in ${retryInMs.toString()}ms`);
    }
  }

  recordSuccess(domain: CircuitDomain): void {
    this.failureHistory.delete(domain);
    this.openUntil.delete(domain);
  }

  recordFailure(domain: CircuitDomain): void {
    const now = Date.now();
    const kept = (this.failureHistory.get(domain) ?? []).filter((timestamp) => now - timestamp <= this.windowMs);
    kept.push(now);

    if (kept.length >= this.failureThreshold) {
      this.failureHistory.set(domain, []);
      this.openUntil.set(domain, now + this.cooldownMs);
      return;
    }

    this.failureHistory.set(domain, kept);
  }
}

export class VikingHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly maxRetries: number;
  private readonly circuitBreaker: RequestCircuitBreaker;

  constructor(baseUrl: string, apiKey?: string, options?: VikingHttpClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.maxRetries = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);
    const failureThreshold = Math.max(1, options?.breakerFailureThreshold ?? DEFAULT_BREAKER_FAILURE_THRESHOLD);
    const windowMs = Math.max(1, options?.breakerWindowMs ?? DEFAULT_BREAKER_WINDOW_MS);
    const cooldownMs = Math.max(1, options?.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS);
    this.circuitBreaker = new RequestCircuitBreaker(failureThreshold, windowMs, cooldownMs);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async checkOk(res: Response, url: string): Promise<void> {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const lower = error.message.toLowerCase();
    return (
      lower.includes("fetch failed") ||
      lower.includes("network") ||
      lower.includes("econn") ||
      lower.includes("timed out") ||
      lower.includes("timeout")
    );
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    options?: { allow404?: boolean; circuitDomain?: CircuitDomain },
  ): Promise<Response> {
    const domain = options?.circuitDomain;
    if (domain) {
      this.circuitBreaker.assertCanRequest(domain);
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.ok || (options?.allow404 && res.status === 404)) {
          if (domain) {
            this.circuitBreaker.recordSuccess(domain);
          }
          return res;
        }

        const retryableHttp = RETRYABLE_HTTP_STATUS.has(res.status);
        if (attempt < this.maxRetries && retryableHttp) {
          continue;
        }

        if (domain && retryableHttp) {
          this.circuitBreaker.recordFailure(domain);
        }

        await this.checkOk(res, url);
        return res;
      } catch (error) {
        const retryableNetwork = this.isRetryableNetworkError(error);
        if (attempt < this.maxRetries && retryableNetwork) {
          continue;
        }

        if (domain && retryableNetwork) {
          this.circuitBreaker.recordFailure(domain);
        }

        throw error;
      }
    }

    throw new Error(`Request retry loop exhausted for ${url}`);
  }

  async mkdir(uri: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/fs/mkdir`;
    const res = await this.fetchWithRetry(url, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ uri }),
    }, { circuitDomain: "fs" });
    await this.checkOk(res, url);
  }

  async writeFile(uri: string, content: string): Promise<void> {
    // Step 1: upload content to a temp file
    const uploadUrl = `${this.baseUrl}/api/v1/resources/temp_upload`;
    const formData = new FormData();
    formData.append("file", new Blob([content], { type: "text/plain" }), "upload.txt");
    const uploadRes = await this.fetchWithRetry(uploadUrl, {
      method: "POST",
      headers: this.headers(),
      body: formData,
    });
    await this.checkOk(uploadRes, uploadUrl);
    const uploadData = await uploadRes.json() as { status: string; result: { temp_path: string } };
    const tempPath = uploadData.result.temp_path;

    // Step 2: ingest the temp file at the target Viking URI
    const addUrl = `${this.baseUrl}/api/v1/resources`;
    const res = await this.fetchWithRetry(addUrl, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ temp_path: tempPath, target: uri, wait: true, strict: false }),
    });
    await this.checkOk(res, addUrl);
  }

  async readFile(uri: string): Promise<string> {
    const url = `${this.baseUrl}/api/v1/content/read?uri=${encodeURIComponent(uri)}`;
    const res = await this.fetchWithRetry(url, {
      method: "GET",
      headers: this.headers(),
    }, { circuitDomain: "content" });
    await this.checkOk(res, url);
    const data = await res.json() as { status: string; result: string };
    return data.result;
  }

  async deleteFile(uri: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/fs?uri=${encodeURIComponent(uri)}`;
    const res = await this.fetchWithRetry(url, {
      method: "DELETE",
      headers: this.headers(),
    }, { allow404: true, circuitDomain: "fs" });
    if (res.status === 404) return;
    await this.checkOk(res, url);
  }

  async listDirectory(uri: string): Promise<string[]> {
    const url = `${this.baseUrl}/api/v1/fs/ls?uri=${encodeURIComponent(uri)}&simple=true`;
    const res = await this.fetchWithRetry(url, {
      method: "GET",
      headers: this.headers(),
    }, { circuitDomain: "fs" });
    await this.checkOk(res, url);
    const data = await res.json() as { status: string; result: string[] };
    return data.result;
  }

  async deleteResource(uri: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/fs?uri=${encodeURIComponent(uri)}&recursive=true`;
    const res = await this.fetchWithRetry(url, {
      method: "DELETE",
      headers: this.headers(),
    }, { allow404: true, circuitDomain: "fs" });
    if (res.status === 404) return;
    await this.checkOk(res, url);
  }

  async semanticSearch(
    query: string,
    targetUri: string,
    topK?: number
  ): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/api/v1/search/find`;
    const res = await this.fetchWithRetry(url, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, target_uri: targetUri, limit: topK ?? 10 }),
    });
    await this.checkOk(res, url);
    const data = await res.json() as {
      status: string;
      result: { resources: Array<{ uri: string; abstract: string; score: number }> };
    };
    const resources = data.result.resources ?? [];
    return Promise.all(
      resources.map(async (r) => ({
        uri: r.uri,
        text: await this.readFile(r.uri),
        score: r.score,
      }))
    );
  }
}
