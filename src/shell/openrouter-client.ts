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

export async function callOpenRouter(
  messages: Message[],
  tools: ToolDefinition[],
  model: string,
  apiKey: string,
  baseUrl = "https://openrouter.ai/api/v1",
): Promise<ChatCompletionResponse> {
  const url = `${baseUrl}/chat/completions`;
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) {
    body.tools = tools;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

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
  } = params;

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  let steps = 0;

  while (steps < maxSteps) {
    const response = await callOpenRouter(messages, tools, model, apiKey, baseUrl);
    steps++;
    const choice = response.choices[0];

    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      return choice.message.content ?? "";
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
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        result = await handler(args);
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }

    if (steps >= maxSteps) {
      return choice.message.content ?? "";
    }
  }

  return "";
}
