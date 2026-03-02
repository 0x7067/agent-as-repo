export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
}

interface OpenRouterRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function composeAbortSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  if (signal) {
    onAbort = () => {
      controller.abort(signal.reason ?? new Error("Request aborted"));
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  timeoutId = setTimeout(() => {
    controller.abort(new Error(`OpenRouter request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    },
  };
}

function normalizeAbortError(error: unknown, signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (typeof signal.reason === "string" && signal.reason.trim().length > 0) {
    return new Error(signal.reason);
  }

  if (error instanceof Error && error.message) return error;
  return new Error("OpenRouter request aborted");
}

export async function callOpenRouter(
  messages: Message[],
  tools: ToolDefinition[],
  model: string,
  apiKey: string,
  baseUrl = "https://openrouter.ai/api/v1",
  options: OpenRouterRequestOptions = {},
): Promise<ChatCompletionResponse> {
  const url = `${baseUrl}/chat/completions`;
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) {
    body.tools = tools;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const request = composeAbortSignal(options.signal, timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch (error) {
    request.cleanup();
    if (request.signal.aborted) {
      throw normalizeAbortError(error, request.signal);
    }
    throw error;
  }
  request.cleanup();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  return res.json() as Promise<ChatCompletionResponse>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export async function toolCallingLoop(params: {
  systemPrompt: string;
  userMessage: string;
  tools: ToolDefinition[];
  toolHandlers: Record<string, ToolHandler>;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}): Promise<string> {
  const {
    systemPrompt,
    userMessage,
    tools,
    toolHandlers,
    model,
    apiKey,
    baseUrl,
    maxSteps = 10,
    signal,
    requestTimeoutMs,
  } = params;

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  let steps = 0;

  const debugEnabled = process.env["REPO_EXPERT_DEBUG_OPENROUTER"] === "1";
  const debug = (message: string) => {
    if (debugEnabled) {
      process.stderr.write(`[openrouter] ${message}\n`);
    }
  };

  while (steps < maxSteps) {
    const startedAt = Date.now();
    const response = await callOpenRouter(messages, tools, model, apiKey, baseUrl, {
      signal,
      timeoutMs: requestTimeoutMs,
    });
    steps++;
    const choice = response.choices[0];
    const toolCallsCount = choice.message.tool_calls?.length ?? 0;
    debug(`step=${steps} model=${model} finish_reason=${choice.finish_reason} tool_calls=${toolCallsCount} elapsed_ms=${Date.now() - startedAt}`);

    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      const directContent = (choice.message.content ?? "").trim();
      if (directContent.length > 0) {
        return choice.message.content ?? "";
      }
      throw new Error("Model returned an empty response without tool calls");
    }

    // Append assistant message with tool_calls
    messages.push({
      role: "assistant",
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    });

    // Execute each tool call and append results
    for (const tc of choice.message.tool_calls) {
      const handler = toolHandlers[tc.function.name];
      let result: string;
      if (!handler) {
        result = `Error: unknown tool ${tc.function.name}`;
      } else {
        try {
          const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          result = await handler(args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result = `Error: invalid arguments for tool ${tc.function.name}: ${message}`;
        }
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }

    if (steps >= maxSteps) {
      if ((choice.message.content ?? "").trim().length > 0) {
        return choice.message.content ?? "";
      }

      debug("max_steps reached with pending tool flow; requesting final completion without tools");
      const finalResponse = await callOpenRouter(messages, [], model, apiKey, baseUrl, {
        signal,
        timeoutMs: requestTimeoutMs,
      });
      const finalChoice = finalResponse.choices[0];
      const finalContent = (finalChoice.message.content ?? "").trim();
      debug(`finalization finish_reason=${finalChoice.finish_reason} content_length=${finalContent.length}`);
      if (finalContent.length > 0) {
        return finalChoice.message.content ?? "";
      }

      throw new Error(`Tool loop exhausted after ${maxSteps} steps without a final assistant response`);
    }
  }

  throw new Error(`Tool loop exited unexpectedly after ${maxSteps} steps`);
}
