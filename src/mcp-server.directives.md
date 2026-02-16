## Letta MCP Tools

6 tools available via `letta-tools` MCP server. Each has a tight schema — pass exactly what's required.

- `letta_list_agents` — no params. Returns `[{id, name, description, model}]`.
- `letta_get_agent(agent_id)` — full agent details including tools, blocks, model settings.
- `letta_send_message(agent_id, content)` — send a user message, returns the agent's text reply.
- `letta_get_core_memory(agent_id)` — returns `[{label, value, limit}]` for all memory blocks.
- `letta_search_archival(agent_id, query)` — semantic search over archival passages.
- `letta_update_block(agent_id, label, value)` — overwrite a memory block's value.

Always get the `agent_id` from `letta_list_agents` first. Don't guess IDs.
