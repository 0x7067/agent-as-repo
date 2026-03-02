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
    const url = `${this.baseUrl}/api/v1/fs/mkdir`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ uri }),
    });
    await this.checkOk(res, url);
  }

  async writeFile(uri: string, content: string): Promise<void> {
    // Step 1: upload content to a temp file
    const uploadUrl = `${this.baseUrl}/api/v1/resources/temp_upload`;
    const formData = new FormData();
    formData.append("file", new Blob([content], { type: "text/plain" }), "upload.txt");
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: this.headers(),
      body: formData,
    });
    await this.checkOk(uploadRes, uploadUrl);
    const uploadData = await uploadRes.json() as { status: string; result: { temp_path: string } };
    const tempPath = uploadData.result.temp_path;

    // Step 2: ingest the temp file at the target Viking URI
    const addUrl = `${this.baseUrl}/api/v1/resources`;
    const res = await fetch(addUrl, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ temp_path: tempPath, target: uri, wait: true, strict: false }),
    });
    await this.checkOk(res, addUrl);
  }

  async readFile(uri: string): Promise<string> {
    const url = `${this.baseUrl}/api/v1/content/read?uri=${encodeURIComponent(uri)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });
    await this.checkOk(res, url);
    const data = await res.json() as { status: string; result: string };
    return data.result;
  }

  async deleteFile(uri: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/fs?uri=${encodeURIComponent(uri)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (res.status === 404) return;
    await this.checkOk(res, url);
  }

  async listDirectory(uri: string): Promise<string[]> {
    const url = `${this.baseUrl}/api/v1/fs/ls?uri=${encodeURIComponent(uri)}&simple=true`;
    const res = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });
    await this.checkOk(res, url);
    const data = await res.json() as { status: string; result: string[] };
    return data.result;
  }

  async deleteResource(uri: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/fs?uri=${encodeURIComponent(uri)}&recursive=true`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (res.status === 404) return;
    await this.checkOk(res, url);
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
