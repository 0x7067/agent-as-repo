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
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`OpenRouter request timed out after ${String(timeoutMs)}ms`));
  }, timeoutMs);
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

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
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
    throw new Error(`HTTP ${String(res.status)} from ${url}`);
  }

  return res.json() as Promise<ChatCompletionResponse>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

function disabledDebug(_message: string): void {
  // intentionally empty
}

function writeDebug(message: string): void {
  process.stderr.write(`[openrouter] ${message}\n`);
}

function getMessageContentText(content: string | null): string {
  return (content ?? "").trim();
}

function getToolCalls(choice: ChatCompletionResponse["choices"][number]): ToolCall[] {
  return choice.message.tool_calls ?? [];
}

function getFirstChoiceOrThrow(
  response: ChatCompletionResponse,
  context: string,
): ChatCompletionResponse["choices"][number] {
  const choice = response.choices.at(0);
  if (choice === undefined) {
    throw new Error(`OpenRouter returned no choices (${context})`);
  }
  return choice;
}

function readTerminalAssistantMessage(choice: ChatCompletionResponse["choices"][number]): string {
  const directContent = getMessageContentText(choice.message.content);
  if (directContent.length > 0) {
    return choice.message.content ?? "";
  }
  throw new Error("Model returned an empty response without tool calls");
}

async function executeToolCalls(params: {
  toolCalls: ToolCall[];
  toolHandlers: Partial<Record<string, ToolHandler>>;
  messages: Message[];
}): Promise<void> {
  const { toolCalls, toolHandlers, messages } = params;

  for (const toolCall of toolCalls) {
    const handler = toolHandlers[toolCall.function.name];
    let result: string;

    if (handler) {
      try {
        const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        result = await handler(args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = `Error: invalid arguments for tool ${toolCall.function.name}: ${message}`;
      }
    } else {
      result = `Error: unknown tool ${toolCall.function.name}`;
    }

    messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
  }
}

async function requestFinalAssistantMessage(params: {
  messages: Message[];
  model: string;
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  maxSteps: number;
  debug: (message: string) => void;
}): Promise<string> {
  const {
    messages,
    model,
    apiKey,
    baseUrl,
    signal,
    requestTimeoutMs,
    maxSteps,
    debug,
  } = params;

  debug("max_steps reached with pending tool flow; requesting final completion without tools");
  const finalResponse = await callOpenRouter(messages, [], model, apiKey, baseUrl, {
    signal,
    timeoutMs: requestTimeoutMs,
  });
  const finalChoice = getFirstChoiceOrThrow(finalResponse, "finalization");
  const finalContent = getMessageContentText(finalChoice.message.content);
  debug(`finalization finish_reason=${finalChoice.finish_reason} content_length=${String(finalContent.length)}`);
  if (finalContent.length > 0) {
    return finalChoice.message.content ?? "";
  }

  throw new Error(`Tool loop exhausted after ${String(maxSteps)} steps without a final assistant response`);
}

export async function toolCallingLoop(params: {
  systemPrompt: string;
  userMessage: string;
  tools: ToolDefinition[];
  toolHandlers: Partial<Record<string, ToolHandler>>;
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
  const debug = debugEnabled ? writeDebug : disabledDebug;

  while (steps < maxSteps) {
    const startedAt = Date.now();
    const response = await callOpenRouter(messages, tools, model, apiKey, baseUrl, {
      signal,
      timeoutMs: requestTimeoutMs,
    });
    steps++;
    const choice = getFirstChoiceOrThrow(response, `step-${String(steps)}`);
    const toolCalls = getToolCalls(choice);
    const elapsedMs = Date.now() - startedAt;
    debug(`step=${String(steps)} model=${model} finish_reason=${choice.finish_reason} tool_calls=${String(toolCalls.length)} elapsed_ms=${String(elapsedMs)}`);

    if (toolCalls.length === 0) {
      return readTerminalAssistantMessage(choice);
    }

    // Append assistant message with tool_calls
    messages.push({
      role: "assistant",
      content: choice.message.content,
      tool_calls: toolCalls,
    });

    // Execute each tool call and append results
    await executeToolCalls({ toolCalls, toolHandlers, messages });

    if (steps >= maxSteps) {
      const directContent = getMessageContentText(choice.message.content);
      if (directContent.length > 0) {
        return choice.message.content ?? "";
      }

      return requestFinalAssistantMessage({
        messages,
        model,
        apiKey,
        baseUrl,
        signal,
        requestTimeoutMs,
        maxSteps,
        debug,
      });
    }
  }

  throw new Error(`Tool loop exited unexpectedly after ${String(maxSteps)} steps`);
}
