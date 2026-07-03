## repo-expert MCP Tools

8 tools available via the `repo-expert` MCP server. Agent IDs are plain repo names (no namespacing).

- `agent_list` — no params. Returns the array of agent summaries.
- `agent_get(agent_id)` — full agent details including memory blocks.
- `agent_call(agent_id, content, override_model?, timeout_ms?, max_steps?)` — send a message to an agent and return its text response.
- `agent_get_core_memory(agent_id)` — returns `[{label, value, limit}]` for all memory blocks.
- `agent_search_archival(agent_id, query, top_k?)` — semantic search over archival passages.
- `agent_insert_passage(agent_id, text)` — insert a passage into archival memory.
- `agent_delete_passage(agent_id, passage_id)` — delete a passage. To update, delete then insert.
- `agent_update_block(agent_id, label, value)` — overwrite a memory block's value.

Call `agent_list` first to discover agent IDs, then pass an `agent_id` to the other tools.
