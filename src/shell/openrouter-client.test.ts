import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  callOpenRouter,
  toolCallingLoop,
  type ToolDefinition,
  type ToolHandler,
} from "./openrouter-client.js";

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const MODEL = "openai/gpt-4o-mini";
const API_KEY = "test-api-key";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

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

describe("callOpenRouter", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("posts to the correct URL with correct headers and body", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("Hello!")));

    await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      TOOLS,
      MODEL,
      API_KEY
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_BASE_URL}/chat/completions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: "Hi" }],
          tools: TOOLS,
        }),
      })
    );
  });

  it("omits tools key when tools array is empty", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("Hello!")));

    await callOpenRouter([{ role: "user", content: "Hi" }], [], MODEL, API_KEY);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty("tools");
  });

  it("throws a descriptive error on non-2xx response", async () => {
    mockFetch.mockResolvedValue(makeResponse(429, { error: "rate limited" }));

    await expect(
      callOpenRouter([{ role: "user", content: "Hi" }], [], MODEL, API_KEY)
    ).rejects.toThrow(/429/);
  });

  it("uses custom baseUrl when provided", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("Hello!")));
    const customBase = "http://localhost:8080/api/v1";

    await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      [],
      MODEL,
      API_KEY,
      customBase
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${customBase}/chat/completions`,
      expect.any(Object)
    );
  });

  it("returns the parsed response", async () => {
    const response = makeChoice("Paris is the capital of France.");
    mockFetch.mockResolvedValue(makeResponse(200, response));

    const result = await callOpenRouter(
      [{ role: "user", content: "What is the capital of France?" }],
      [],
      MODEL,
      API_KEY
    );

    expect(result).toEqual(response);
  });
});

describe("toolCallingLoop", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  const toolHandlers: Record<string, ToolHandler> = {
    get_weather: async (args) => `Weather in ${args.city}: sunny, 25°C`,
  };

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("returns content directly when no tool_calls in response", async () => {
    mockFetch.mockResolvedValue(makeResponse(200, makeChoice("The sky is blue.")));

    const result = await toolCallingLoop({
      systemPrompt: "You are helpful.",
      userMessage: "Why is the sky blue?",
      tools: [],
      toolHandlers: {},
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("The sky is blue.");
  });

  it("executes one tool call and returns final content", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(200, makeChoice(null, [{ id: "tc1", name: "get_weather", args: JSON.stringify({ city: "Paris" }) }]))
      )
      .mockResolvedValueOnce(makeResponse(200, makeChoice("It is sunny in Paris.")));

    const result = await toolCallingLoop({
      systemPrompt: "You are a weather assistant.",
      userMessage: "What is the weather in Paris?",
      tools: TOOLS,
      toolHandlers,
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("It is sunny in Paris.");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should include the tool result message
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
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
      systemPrompt: "You are a weather assistant.",
      userMessage: "Compare weather in London and Tokyo.",
      tools: TOOLS,
      toolHandlers,
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("Both cities have nice weather.");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("respects maxSteps limit", async () => {
    // Always returns tool_calls — infinite loop without maxSteps guard
    mockFetch.mockResolvedValue(
      makeResponse(200, makeChoice(null, [{ id: "tc1", name: "get_weather", args: JSON.stringify({ city: "Paris" }) }]))
    );

    const result = await toolCallingLoop({
      systemPrompt: "You are a weather assistant.",
      userMessage: "What is the weather in Paris?",
      tools: TOOLS,
      toolHandlers,
      model: MODEL,
      apiKey: API_KEY,
      maxSteps: 3,
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    // When maxSteps is exhausted with tool_calls, content is null → returns ""
    expect(result).toBe("");
  });

  it("handles unknown tool gracefully and continues", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(200, makeChoice(null, [{ id: "tc1", name: "unknown_tool", args: "{}" }]))
      )
      .mockResolvedValueOnce(makeResponse(200, makeChoice("Done.")));

    const result = await toolCallingLoop({
      systemPrompt: "You are helpful.",
      userMessage: "Do something.",
      tools: [],
      toolHandlers: {},
      model: MODEL,
      apiKey: API_KEY,
    });

    expect(result).toBe("Done.");

    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.content).toBe("Error: unknown tool unknown_tool");
  });
});
