import { randomUUID } from "node:crypto";
import { buildPersona } from "../core/prompts.js";
import type {
  AgentProvider,
  CreateAgentParams,
  CreateAgentResult,
  Passage,
  MemoryBlock,
  SendMessageOptions,
} from "../ports/agent-provider.js";
import type { VikingHttpClient } from "./viking-http.js";
import { toolCallingLoop, type ToolDefinition } from "./openrouter-client.js";

export class VikingProvider implements AgentProvider {
  constructor(
    private viking: VikingHttpClient,
    private openrouterApiKey: string,
    private model: string,
  ) {}

  async createAgent(params: CreateAgentParams): Promise<CreateAgentResult> {
    const { repoName } = params;
    const persona = buildPersona(repoName, params.description, params.persona, params.tools);

    await this.viking.mkdir(`viking://resources/${repoName}/`);
    await this.viking.mkdir(`viking://resources/${repoName}/blocks/`);
    await this.viking.mkdir(`viking://resources/${repoName}/passages/`);

    await this.viking.writeFile(
      `viking://resources/${repoName}/manifest.json`,
      JSON.stringify({
        agentId: repoName,
        name: params.name,
        model: params.model,
        tags: params.tags,
        createdAt: new Date().toISOString(),
      }),
    );

    await this.viking.writeFile(`viking://resources/${repoName}/blocks/persona`, persona);
    await this.viking.writeFile(`viking://resources/${repoName}/blocks/architecture`, "Not yet analyzed.");
    await this.viking.writeFile(`viking://resources/${repoName}/blocks/conventions`, "Not yet analyzed.");

    return { agentId: repoName };
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.viking.deleteResource(`viking://resources/${agentId}/`);
  }

  enableSleeptime(_agentId: string): Promise<void> {
    return Promise.resolve();
  }

  async storePassage(agentId: string, text: string): Promise<string> {
    const uuid = randomUUID();
    await this.viking.writeFile(`viking://resources/${agentId}/passages/${uuid}.txt`, text);
    return uuid;
  }

  async deletePassage(agentId: string, passageId: string): Promise<void> {
    await this.viking.deleteFile(`viking://resources/${agentId}/passages/${passageId}.txt`);
  }

  async listPassages(agentId: string): Promise<Passage[]> {
    const uris = await this.viking.listDirectory(`viking://resources/${agentId}/passages/`);
    return Promise.all(
      uris.map(async (uri) => {
        const text = await this.viking.readFile(uri);
        const filename = uri.slice(uri.lastIndexOf("/") + 1);
        const id = filename.endsWith(".txt") ? filename.slice(0, -4) : filename;
        return { id, text };
      }),
    );
  }

  async getBlock(agentId: string, label: string): Promise<MemoryBlock> {
    const value = await this.viking.readFile(`viking://resources/${agentId}/blocks/${label}`);
    return { value, limit: 5000 };
  }

  async updateBlock(agentId: string, label: string, value: string): Promise<MemoryBlock> {
    await this.viking.writeFile(`viking://resources/${agentId}/blocks/${label}`, value);
    return { value, limit: 5000 };
  }

  async sendMessage(agentId: string, content: string, options?: SendMessageOptions): Promise<string> {
    const [personaBlock, archBlock, convBlock] = await Promise.all([
      this.getBlock(agentId, "persona"),
      this.getBlock(agentId, "architecture"),
      this.getBlock(agentId, "conventions"),
    ]);

    const systemPrompt = [
      personaBlock.value,
      `\n## Architecture\n${archBlock.value}`,
      `\n## Conventions\n${convBlock.value}`,
    ].join("\n");

    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "archival_memory_search",
          description: "Search for relevant code and documentation in archival memory",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Search query" } },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "memory_replace",
          description: "Update a memory block with new content",
          parameters: {
            type: "object",
            properties: {
              label: { type: "string", description: "Block label (persona, architecture, conventions)" },
              value: { type: "string", description: "New block content" },
            },
            required: ["label", "value"],
          },
        },
      },
    ];

    const toolHandlers = {
      archival_memory_search: async (args: Record<string, unknown>): Promise<string> => {
        const query = args.query as string;
        const results = await this.viking.semanticSearch(query, `viking://resources/${agentId}/passages/`, 10);
        return JSON.stringify(results);
      },
      memory_replace: async (args: Record<string, unknown>): Promise<string> => {
        const label = args.label as string;
        const value = args.value as string;
        await this.updateBlock(agentId, label, value);
        return `Updated block '${label}'`;
      },
    };

    const model = options?.overrideModel ?? this.model;
    return toolCallingLoop({
      systemPrompt,
      userMessage: content,
      tools,
      toolHandlers,
      model,
      apiKey: this.openrouterApiKey,
      maxSteps: options?.maxSteps,
    });
  }
}
