import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  callChatCompletions,
  embed,
  toolCallingLoop,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_MAX_TOOL_STEPS,
  type ToolDefinition,
  type ToolHandler,
} from "./llm-client.js";

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const MODEL = "qwen3-coder:30b";
const API_KEY = "test-api-key";
const DEFAULT_BASE_URL = DEFAULT_LLM_BASE_URL;
const HELPFUL_SYSTEM_PROMPT = "You are helpful.";
const WEATHER_SYSTEM_PROMPT = "You are a weather assistant.";
const PARIS_WEATHER_QUESTION = "What is the weather in Paris?";

function makeChoice(content: string | null, toolCalls?: Array<{ id: string; name: string; args: string }>) {
  return {
    choices: [
      {
        message: {
          role: "assistant" as const,
          content,
          ...(toolCalls
            ? {
                tool_calls: toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: tc.args },
                })),
              }
            : {}),
        },
        finish_reason: toolCalls ? "tool_calls" : "stop",
      },
    ],
  };
}

function formatCityArg(args: unknown): string {
  const city = (args as { city?: unknown }).city;
  return typeof city === "string" ? city : JSON.stringify(city);
}

function getJsonRequestBody(mockFetch: ReturnType<typeof vi.fn>, callIndex: number): unknown {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit | undefined] | undefined;
  if (call === undefined) {
    throw new TypeError(`Expected fetch call at index ${String(callIndex)}`);
  }
  const body = call[1]?.body;
  if (typeof body !== "string") {
    throw new TypeError(`Expected string request body at fetch call ${String(callIndex)}`);
  }
  return JSON.parse(body);
}

const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  },
];

describe("callChatCompletions", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("defaults to the local Ollama base URL", () => {
    expect(DEFAULT_LLM_BASE_URL).toBe("http://localhost:11434/v1");
  });

  it("uses a conservative default tool-step budget", () => {
    expect(DEFAULT_MAX_TOOL_STEPS).toBe(5);
  });

  it("posts to the correct URL with correct headers and body", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("Hello!")));

    await callChatCompletions(
      [{ role: "user", content: "Hi" }],
      TOOLS,
      MODEL,
      DEFAULT_BASE_URL,
      API_KEY,
    );

    const firstCall = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(firstCall[0]).toBe(`${DEFAULT_BASE_URL}/chat/completions`);
    expect(firstCall[1].method).toBe("POST");
    expect(firstCall[1].headers).toEqual(expect.objectContaining({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    }));
    expect(firstCall[1].body).toBe(JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Hi" }],
      tools: TOOLS,
    }));
  });

  it("omits the Authorization header when no apiKey is provided", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("Hello!")));

    await callChatCompletions([{ role: "user", content: "Hi" }], [], MODEL);

    const firstCall = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(firstCall[0]).toBe(`${DEFAULT_BASE_URL}/chat/completions`);
    expect(firstCall[1].headers).not.toHaveProperty("Authorization");
  });

  it("omits tools key when tools array is empty", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("Hello!")));

    await callChatCompletions([{ role: "user", content: "Hi" }], [], MODEL, DEFAULT_BASE_URL, API_KEY);

    const body = getJsonRequestBody(mockFetch, 0) as Record<string, unknown>;
    expect(body).not.toHaveProperty("tools");
  });

  it("throws a descriptive error on non-2xx response", async () => {
    mockFetch.mockResolvedValue(makeResponse(429, { error: "rate limited" }));

    await expect(
      callChatCompletions([{ role: "user", content: "Hi" }], [], MODEL, DEFAULT_BASE_URL, API_KEY)
    ).rejects.toThrow(/429/);
  });

  it("uses custom baseUrl when provided", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("Hello!")));
    const customBase = "https://openrouter.ai/api/v1";

    await callChatCompletions(
      [{ role: "user", content: "Hi" }],
      [],
      MODEL,
      customBase,
      API_KEY,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${customBase}/chat/completions`,
      expect.any(Object)
    );
  });

  it("returns the parsed response", async () => {
    const response = makeChoice("Paris is the capital of France.");
    mockFetch.mockResolvedValue(makeResponse(200, response));

    const result = await callChatCompletions(
      [{ role: "user", content: "What is the capital of France?" }],
      [],
      MODEL,
      DEFAULT_BASE_URL,
      API_KEY,
    );

    expect(result).toEqual(response);
  });

  it("aborts request when signal is aborted", async () => {
    const controller = new AbortController();
    const abortingFetch: typeof fetch = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
        }, { once: true });
      });
    vi.stubGlobal("fetch", abortingFetch);

    const promise = callChatCompletions(
      [{ role: "user", content: "Hi" }],
      [],
      MODEL,
      DEFAULT_BASE_URL,
      API_KEY,
      { signal: controller.signal },
    );

    controller.abort(new Error("request cancelled"));
    await expect(promise).rejects.toThrow("request cancelled");
  });
});

describe("toolCallingLoop", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  const toolHandlers: Record<string, ToolHandler> = {
    get_weather: (args) => Promise.resolve(`Weather in ${formatCityArg(args)}: sunny, 25°C`),
  };

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("returns content directly when no tool_calls in response", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("The sky is blue.")));

    const result = await toolCallingLoop({
      systemPrompt: HELPFUL_SYSTEM_PROMPT,
      userMessage: "Why is the sky blue?",
      tools: [],
      toolHandlers: {},
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("The sky is blue.");
  });

  it("logs request size and provider token usage when LLM debugging is enabled", async () => {
    const response = {
      ...makeChoice("The sky is blue."),
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    };
    mockFetch.mockResolvedValue(makeResponse(200, response));
    process.env["REPO_EXPERT_DEBUG_LLM"] = "1";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await toolCallingLoop({
        systemPrompt: HELPFUL_SYSTEM_PROMPT,
        userMessage: "Why is the sky blue?",
        tools: [],
        toolHandlers: {},
        model: MODEL,
        apiKey: API_KEY,
      });
    } finally {
      delete process.env["REPO_EXPERT_DEBUG_LLM"];
    }

    const output = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("message_chars=");
    expect(output).toContain("prompt_tokens=12");
    expect(output).toContain("completion_tokens=4");
    stderr.mockRestore();
  });

  it("throws when response has no tool_calls and empty content", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice(null)));

    await expect(
      toolCallingLoop({
        systemPrompt: HELPFUL_SYSTEM_PROMPT,
        userMessage: "Answer briefly.",
        tools: [],
        toolHandlers: {},
        model: MODEL,
        apiKey: API_KEY,
      }),
    ).rejects.toThrow("empty response");
  });

  it("executes one tool call and returns final content", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(200, makeChoice(null, [{ id: "tc1", name: "get_weather", args: JSON.stringify({ city: "Paris" }) }]))
      )
      .mockResolvedValueOnce(makeResponse(200, makeChoice("It is sunny in Paris.")));

    const result = await toolCallingLoop({
      systemPrompt: WEATHER_SYSTEM_PROMPT,
      userMessage: PARIS_WEATHER_QUESTION,
      tools: TOOLS,
      toolHandlers,
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("It is sunny in Paris.");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should include the tool result message
    const secondBody = getJsonRequestBody(mockFetch, 1) as {
      messages: Array<{ role: string; tool_call_id?: string; content?: string }>;
    };
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe("tc1");
    expect(toolMsg.content).toBe("Weather in Paris: sunny, 25°C");
  });

  it("handles multiple sequential tool calls", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(200, makeChoice(null, [{ id: "tc1", name: "get_weather", args: JSON.stringify({ city: "London" }) }]))
      )
      .mockResolvedValueOnce(
        makeResponse(200, makeChoice(null, [{ id: "tc2", name: "get_weather", args: JSON.stringify({ city: "Tokyo" }) }]))
      )
      .mockResolvedValueOnce(makeResponse(200, makeChoice("Both cities have nice weather.")));

    const result = await toolCallingLoop({
      systemPrompt: WEATHER_SYSTEM_PROMPT,
      userMessage: "Compare weather in London and Tokyo.",
      tools: TOOLS,
      toolHandlers,
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("Both cities have nice weather.");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("attempts final completion without tools when maxSteps is reached", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, makeChoice(null, [{ id: "tc1", name: "get_weather", args: JSON.stringify({ city: "Paris" }) }]))
    ).mockResolvedValueOnce(
      makeResponse(200, makeChoice("Final answer after tool execution."))
    );

    const result = await toolCallingLoop({
      systemPrompt: WEATHER_SYSTEM_PROMPT,
      userMessage: PARIS_WEATHER_QUESTION,
      tools: TOOLS,
      toolHandlers,
      model: MODEL,
      apiKey: API_KEY,
      maxSteps: 1,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const finalBody = getJsonRequestBody(mockFetch, 1) as Record<string, unknown>;
    expect(finalBody).not.toHaveProperty("tools");
    expect(result).toBe("Final answer after tool execution.");
  });

  it("finalizes with tool results when the last tool-calling response also has content", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, makeChoice(
        "I will check the weather.",
        [{ id: "tc1", name: "get_weather", args: JSON.stringify({ city: "Paris" }) }],
      )),
    ).mockResolvedValueOnce(
      makeResponse(200, makeChoice("It is sunny in Paris."))
    );

    const result = await toolCallingLoop({
      systemPrompt: WEATHER_SYSTEM_PROMPT,
      userMessage: PARIS_WEATHER_QUESTION,
      tools: TOOLS,
      toolHandlers,
      model: MODEL,
      apiKey: API_KEY,
      maxSteps: 1,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const finalBody = getJsonRequestBody(mockFetch, 1) as {
      messages: Array<{ role: string; content?: string }>;
    };
    expect(finalBody.messages.some((message) =>
      message.role === "tool" && message.content?.includes("sunny") === true
    )).toBe(true);
    expect(result).toBe("It is sunny in Paris.");
  });

  it("throws when maxSteps is reached and finalization has no content", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(200, makeChoice(null, [{ id: "tc1", name: "get_weather", args: JSON.stringify({ city: "Paris" }) }]))
      )
      .mockResolvedValueOnce(makeResponse(200, makeChoice(null)));

    await expect(
      toolCallingLoop({
        systemPrompt: WEATHER_SYSTEM_PROMPT,
        userMessage: PARIS_WEATHER_QUESTION,
        tools: TOOLS,
        toolHandlers,
        model: MODEL,
        apiKey: API_KEY,
        maxSteps: 1,
      }),
    ).rejects.toThrow("Tool loop exhausted");
  });

  it("handles unknown tool gracefully and continues", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(200, makeChoice(null, [{ id: "tc1", name: "unknown_tool", args: "{}" }]))
      )
      .mockResolvedValueOnce(makeResponse(200, makeChoice("Done.")));

    const result = await toolCallingLoop({
      systemPrompt: HELPFUL_SYSTEM_PROMPT,
      userMessage: "Do something.",
      tools: [],
      toolHandlers: {},
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("Done.");

    const secondBody = getJsonRequestBody(mockFetch, 1) as {
      messages: Array<{ role: string; tool_call_id?: string; content?: string }>;
    };
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.content).toBe("Error: unknown tool unknown_tool");
  });

  it("handles malformed tool-call arguments gracefully and continues", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(200, makeChoice(null, [{ id: "tc1", name: "get_weather", args: "{bad-json" }]))
      )
      .mockResolvedValueOnce(makeResponse(200, makeChoice("Done despite malformed args.")));

    const result = await toolCallingLoop({
      systemPrompt: HELPFUL_SYSTEM_PROMPT,
      userMessage: "Do something.",
      tools: TOOLS,
      toolHandlers,
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("Done despite malformed args.");
    const secondBody = getJsonRequestBody(mockFetch, 1) as {
      messages: Array<{ role: string; tool_call_id?: string; content?: string }>;
    };
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.content).toContain("Error: invalid arguments for tool get_weather");
  });
});

describe("embed", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("posts texts to {base_url}/embeddings with the embedding model", async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, {
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
      }),
    );

    const vectors = await embed(["alpha", "beta"], "nomic-embed-text", DEFAULT_BASE_URL, API_KEY);

    const firstCall = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(firstCall[0]).toBe(`${DEFAULT_BASE_URL}/embeddings`);
    expect(firstCall[1].method).toBe("POST");
    const headers = firstCall[1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(getJsonRequestBody(mockFetch, 0)).toEqual({
      model: "nomic-embed-text",
      input: ["alpha", "beta"],
    });
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("omits the Authorization header without an API key", async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, { data: [{ index: 0, embedding: [1] }] }),
    );

    await embed(["alpha"], "nomic-embed-text");

    const firstCall = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(firstCall[0]).toBe(`${DEFAULT_LLM_BASE_URL}/embeddings`);
    const headers = firstCall[1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("returns embeddings in input order even when the response is out of order", async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, {
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    );

    const vectors = await embed(["alpha", "beta"], "nomic-embed-text");

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("returns an empty array without calling the endpoint for empty input", async () => {
    const vectors = await embed([], "nomic-embed-text");

    expect(vectors).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on non-OK responses", async () => {
    mockFetch.mockResolvedValue(makeResponse(500, {}));

    await expect(embed(["alpha"], "nomic-embed-text")).rejects.toThrow("HTTP 500");
  });

  it("throws when the response is missing an embedding for an input", async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, { data: [{ index: 0, embedding: [1] }] }),
    );

    await expect(embed(["alpha", "beta"], "nomic-embed-text")).rejects.toThrow(
      "embedding count mismatch",
    );
  });
});
