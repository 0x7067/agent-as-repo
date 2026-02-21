import { Letta } from "@letta-ai/letta-client";
import * as dotenv from "dotenv";

dotenv.config();

const agentIds = [
  "agent-ab36f35f-dddb-45ea-96f7-bd4ae8bc4de9",
  "agent-c39b67ab-4442-4828-b825-8203e7e0e0ec",
  "agent-735997a4-4d84-46c6-b998-35bc45c7c2e4",
  "agent-e0d9e87f-5be1-4838-a4f5-b90569eb2139",
];

async function main() {
  const client = new Letta({ token: process.env.LETTA_API_KEY });

  for (const agentId of agentIds) {
    const agent = await client.agents.retrieve(agentId);
    const group = (agent as Record<string, unknown>).multi_agent_group;
    console.log(`\n${agentId}`);
    console.log(`  name: ${agent.name}`);
    if (group && typeof group === "object") {
      const g = group as Record<string, unknown>;
      console.log(`  sleeptime: ${g.manager_type === "sleeptime" ? "✓ ACTIVE" : "✗ NOT sleeptime"}`);
      console.log(`  frequency: every ${g.sleeptime_agent_frequency} steps`);
      console.log(`  group_id: ${g.id}`);
    } else {
      console.log(`  sleeptime: ✗ NO GROUP`);
    }
  }
}

main().catch(console.error);
