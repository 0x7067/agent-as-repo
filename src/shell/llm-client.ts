/* eslint-disable max-lines -- request transport and tool-loop state machine remain colocated for auditability. */
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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ChatCompletionsRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Default OpenAI-compatible endpoint: local Ollama. */
export const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
export const DEFAULT_MAX_TOOL_STEPS = 5;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function composeAbortSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`LLM request timed out after ${String(timeoutMs)}ms`));
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
  return new Error("LLM request aborted");
}

/**
 * POST a JSON body to an OpenAI-compatible endpoint with timeout/abort
 * handling. Sends `Authorization: Bearer <apiKey>` only when an API key is
 * provided (local endpoints like Ollama need none). Throws on non-OK status.
 */
async function postJson(
  url: string,
  body: Record<string, unknown>,
  apiKey: string | undefined,
  options: ChatCompletionsRequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey !== undefined && apiKey.length > 0) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const request = composeAbortSignal(options.signal, timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) {
      throw normalizeAbortError(error, request.signal);
    }
    throw error;
  } finally {
    request.cleanup();
  }

  if (!res.ok) {
    throw new Error(`HTTP ${String(res.status)} from ${url}`);
  }

  return res;
}

/** Call an OpenAI-compatible chat-completions endpoint. */
export async function callChatCompletions(
  messages: Message[],
  tools: ToolDefinition[],
  model: string,
  baseUrl = DEFAULT_LLM_BASE_URL,
  apiKey?: string,
  options: ChatCompletionsRequestOptions = {},
): Promise<ChatCompletionResponse> {
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) {
    body["tools"] = tools;
  }

  const res = await postJson(`${baseUrl}/chat/completions`, body, apiKey, options);
  return res.json() as Promise<ChatCompletionResponse>;
}

/**
 * Call an OpenAI-compatible embeddings endpoint (Ollama serves it too).
 * Returns one vector per input text, in input order.
 */
export async function embed(
  texts: string[],
  model: string,
  baseUrl = DEFAULT_LLM_BASE_URL,
  apiKey?: string,
  options: ChatCompletionsRequestOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await postJson(`${baseUrl}/embeddings`, { model, input: texts }, apiKey, options);
  const payload = await res.json() as { data: Array<{ index: number; embedding: number[] }> };

  const vectors: Array<number[] | undefined> = Array.from({ length: texts.length });
  for (const entry of payload.data) {
    vectors[entry.index] = entry.embedding;
  }

  if (vectors.includes(undefined)) {
    throw new Error(
      `Embeddings endpoint returned an embedding count mismatch: expected ${String(texts.length)}, got ${String(payload.data.length)}`,
    );
  }

  return vectors as number[][];
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

function disabledDebug(_message: string): void {
  // intentionally empty
}

function writeDebug(message: string): void {
  process.stderr.write(`[llm] ${message}\n`);
}

function usageDebugFields(usage: ChatCompletionResponse["usage"]): string {
  if (usage === undefined) return "prompt_tokens=unknown completion_tokens=unknown total_tokens=unknown";
  return [
    `prompt_tokens=${String(usage.prompt_tokens ?? "unknown")}`,
    `completion_tokens=${String(usage.completion_tokens ?? "unknown")}`,
    `total_tokens=${String(usage.total_tokens ?? "unknown")}`,
  ].join(" ");
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
    throw new Error(`LLM returned no choices (${context})`);
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
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  maxSteps: number;
  debug: (message: string) => void;
}): Promise<string> {
  const {
    messages,
    model,
    baseUrl,
    apiKey,
    signal,
    requestTimeoutMs,
    maxSteps,
  debug,
  } = params;

  debug("max_steps reached with pending tool flow; requesting final completion without tools");
  const requestOptions: ChatCompletionsRequestOptions = {
    ...(signal === undefined ? {} : { signal }),
    ...(requestTimeoutMs === undefined ? {} : { timeoutMs: requestTimeoutMs }),
  };
  const finalResponse = await callChatCompletions(messages, [], model, baseUrl, apiKey, requestOptions);
  const finalChoice = getFirstChoiceOrThrow(finalResponse, "finalization");
  const finalContent = getMessageContentText(finalChoice.message.content);
  debug(`finalization finish_reason=${finalChoice.finish_reason} content_length=${String(finalContent.length)}`);
  if (finalContent.length > 0) {
    return finalChoice.message.content ?? "";
  }

  throw new Error(`Tool loop exhausted after ${String(maxSteps)} steps without a final assistant response`);
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Tool-calling orchestration intentionally keeps loop control and fallback behavior in one place.
export async function toolCallingLoop(params: {
  systemPrompt: string;
  userMessage: string;
  tools: ToolDefinition[];
  toolHandlers: Partial<Record<string, ToolHandler>>;
  model: string;
  baseUrl?: string;
  apiKey?: string;
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
    baseUrl,
    apiKey,
    maxSteps = DEFAULT_MAX_TOOL_STEPS,
    signal,
    requestTimeoutMs,
  } = params;

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  let steps = 0;

  const debugEnabled = process.env["REPO_EXPERT_DEBUG_LLM"] === "1";
  const debug = debugEnabled ? writeDebug : disabledDebug;
  const requestOptions: ChatCompletionsRequestOptions = {
    ...(signal === undefined ? {} : { signal }),
    ...(requestTimeoutMs === undefined ? {} : { timeoutMs: requestTimeoutMs }),
  };

  while (steps < maxSteps) {
    const startedAt = Date.now();
    const messageChars = JSON.stringify(messages).length;
    const toolSchemaChars = JSON.stringify(tools).length;
    const response = await callChatCompletions(messages, tools, model, baseUrl, apiKey, requestOptions);
    steps++;
    const choice = getFirstChoiceOrThrow(response, `step-${String(steps)}`);
    const toolCalls = getToolCalls(choice);
    const elapsedMs = Date.now() - startedAt;
    debug(`step=${String(steps)} model=${model} finish_reason=${choice.finish_reason} tool_calls=${String(toolCalls.length)} message_chars=${String(messageChars)} tool_schema_chars=${String(toolSchemaChars)} ${usageDebugFields(response.usage)} elapsed_ms=${String(elapsedMs)}`);

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
    const beforeToolResults = messages.length;
    await executeToolCalls({ toolCalls, toolHandlers, messages });
    const toolResultChars = messages
      .slice(beforeToolResults)
      .reduce((total, message) =>
        total + (message.role === "tool" ? message.content.length : 0), 0);
    debug(`step=${String(steps)} tool_result_chars=${String(toolResultChars)}`);

    if (steps >= maxSteps) {
      const finalRequestParams = {
        messages,
        model,
        maxSteps,
        debug,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(signal === undefined ? {} : { signal }),
        ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      };
      return requestFinalAssistantMessage(finalRequestParams);
    }
  }

  throw new Error(`Tool loop exited unexpectedly after ${String(maxSteps)} steps`);
}

/* eslint-enable max-lines */
