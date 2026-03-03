## Unified MCP Tools

10 tools available via `letta-tools` MCP server.

- `agent_list` — no params. Returns `{ agents: [...], errors?: [...] }` with namespaced IDs (`letta:<id>`, `viking:<id>`).
- `agent_call(agent_id, content, override_model?, timeout_ms?, max_steps?)` — call a namespaced agent ID and return text.
- `letta_list_agents` — no params. Legacy compatibility tool for primary provider.
- `letta_get_agent(agent_id)` — full agent details including tools, blocks, model settings.
- `letta_send_message(agent_id, content, override_model?, timeout_ms?, max_steps?)` — legacy compatibility call.
- `letta_get_core_memory(agent_id)` — returns `[{label, value, limit}]` for all memory blocks.
- `letta_search_archival(agent_id, query, top_k?)` — semantic search over archival passages.
- `letta_insert_passage(agent_id, text)` — insert a passage into archival memory.
- `letta_delete_passage(agent_id, passage_id)` — delete a passage. To update, delete then insert.
- `letta_update_block(agent_id, label, value)` — overwrite a memory block's value.

For cross-provider usage, call `agent_list` first and then pass the returned namespaced `agent_id` to `agent_call`.
