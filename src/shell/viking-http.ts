export interface SearchResult {
  uri: string;
  text: string;
  score: number;
}

export class VikingHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
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

  async mkdir(uri: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/resources/mkdir`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ uri }),
    });
    await this.checkOk(res, url);
  }

  async writeFile(uri: string, content: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/files`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ uri, content }),
    });
    await this.checkOk(res, url);
  }

  async readFile(uri: string): Promise<string> {
    const url = `${this.baseUrl}/api/v1/files?uri=${encodeURIComponent(uri)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });
    await this.checkOk(res, `${this.baseUrl}/api/v1/files`);
    return res.text();
  }

  async deleteFile(uri: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/files?uri=${encodeURIComponent(uri)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (res.status === 404) return;
    await this.checkOk(res, `${this.baseUrl}/api/v1/files`);
  }

  async listDirectory(uri: string): Promise<string[]> {
    const url = `${this.baseUrl}/api/v1/directories?uri=${encodeURIComponent(uri)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });
    await this.checkOk(res, `${this.baseUrl}/api/v1/directories`);
    const data = await res.json() as { children: string[] } | string[];
    return Array.isArray(data) ? data : data.children;
  }

  async deleteResource(uri: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/resources?uri=${encodeURIComponent(uri)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (res.status === 404) return;
    await this.checkOk(res, `${this.baseUrl}/api/v1/resources`);
  }

  async semanticSearch(
    query: string,
    targetUri: string,
    topK?: number
  ): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/api/v1/search/find`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, target_uri: targetUri, top_k: topK ?? 10 }),
    });
    await this.checkOk(res, url);
    return res.json() as Promise<SearchResult[]>;
  }
}
