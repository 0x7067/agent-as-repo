import type {
  AgentManifest,
  PassageSearchResult,
  PassageStore,
  StoredPassage,
} from "../../ports/passage-store.js";
import type { VikingHttpClient } from "../viking-http.js";

const RESOURCES_ROOT = "viking://resources/";
const FLAKY_RETRY_DELAY_MS = 120;

function agentRootUri(agentId: string): string {
  return `${RESOURCES_ROOT}${agentId}/`;
}

function passagesDirUri(agentId: string): string {
  return `${agentRootUri(agentId)}passages/`;
}

function passageUri(agentId: string, passageId: string): string {
  return `${passagesDirUri(agentId)}${passageId}.txt`;
}

function passageIdFromUri(uri: string): string {
  const filename = uri.slice(uri.lastIndexOf("/") + 1);
  return filename.endsWith(".txt") ? filename.slice(0, -4) : filename;
}

/**
 * OpenViking's fs DELETE occasionally 500s while still applying the delete;
 * such failures are disambiguated by re-listing the directory.
 */
function isDeletePassageAmbiguousFsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("http 500") && message.includes("/api/v1/fs");
}

function unknownToMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  try {
    const encoded = JSON.stringify(value);
    return encoded;
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** PassageStore over an OpenViking server's fs/content/search HTTP API. */
export class VikingPassageStore implements PassageStore {
  constructor(private readonly viking: VikingHttpClient) {}

  async initAgent(agentId: string, manifest: AgentManifest): Promise<void> {
    await this.viking.mkdir(agentRootUri(agentId));
    await this.viking.mkdir(passagesDirUri(agentId));
    await this.viking.writeFile(`${agentRootUri(agentId)}manifest.json`, JSON.stringify(manifest));
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.viking.deleteResource(agentRootUri(agentId));
  }

  async listAgents(): Promise<string[]> {
    const uris = await this.viking.listDirectory(RESOURCES_ROOT);
    return uris.map((uri) => uri.replace(RESOURCES_ROOT, "").replace(/\/$/, ""));
  }

  async writePassage(agentId: string, passageId: string, text: string): Promise<void> {
    await this.viking.writeFile(passageUri(agentId, passageId), text);
  }

  async readPassage(agentId: string, passageId: string): Promise<string> {
    return this.viking.readFile(passageUri(agentId, passageId));
  }

  async deletePassage(agentId: string, passageId: string): Promise<void> {
    const targetUri = passageUri(agentId, passageId);
    try {
      await this.viking.deleteFile(targetUri);
      return;
    } catch (error) {
      if (!isDeletePassageAmbiguousFsError(error)) throw error;

      const listUri = passagesDirUri(agentId);
      const siblingUris = await this.viking.listDirectory(listUri);
      const hasTarget = siblingUris.some((uri) => uri.endsWith(`/${passageId}.txt`));
      if (!hasTarget) return;

      await sleep(FLAKY_RETRY_DELAY_MS);
      try {
        await this.viking.deleteFile(targetUri);
        return;
      } catch (retryError) {
        if (!isDeletePassageAmbiguousFsError(retryError)) throw retryError;
        const afterRetryUris = await this.viking.listDirectory(listUri);
        const stillExists = afterRetryUris.some((uri) => uri.endsWith(`/${passageId}.txt`));
        if (!stillExists) return;
        throw retryError;
      }
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async listPassages(agentId: string): Promise<StoredPassage[]> {
    const uris = await this.viking.listDirectory(passagesDirUri(agentId));
    const readPassage = async (uri: string): Promise<StoredPassage> => {
      const text = await this.viking.readFile(uri);
      return { id: passageIdFromUri(uri), text };
    };

    const settled = await Promise.allSettled(uris.map((uri) => readPassage(uri)));

    const passages: StoredPassage[] = [];
    const failedUris: string[] = [];
    let firstError: unknown;

    for (const [index, entry] of settled.entries()) {
      if (entry.status === "fulfilled") {
        passages.push(entry.value);
        continue;
      }
      const uri = uris[index];
      if (uri) {
        failedUris.push(uri);
      }
      if (firstError === undefined) {
        firstError = entry.reason;
      }
    }

    if (failedUris.length > 0) {
      await sleep(FLAKY_RETRY_DELAY_MS);
      const retrySettled = await Promise.allSettled(failedUris.map((uri) => readPassage(uri)));
      for (const retryEntry of retrySettled) {
        if (retryEntry.status === "fulfilled") {
          passages.push(retryEntry.value);
          continue;
        }
        if (firstError === undefined) {
          firstError = retryEntry.reason;
        }
      }
    }

    if (passages.length === 0 && firstError !== undefined) {
      throw firstError instanceof Error
        ? firstError
        : new Error(unknownToMessage(firstError) || "Failed to list passages");
    }

    return passages;
  }

  async semanticSearch(agentId: string, query: string, limit: number): Promise<PassageSearchResult[]> {
    const results = await this.viking.semanticSearch(query, passagesDirUri(agentId), limit);
    return results.map((r) => ({ id: passageIdFromUri(r.uri), text: r.text, score: r.score }));
  }
}
