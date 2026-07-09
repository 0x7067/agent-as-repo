import { describe, expect, it } from "vitest";
import { createSymbolLookupFromState } from "./symbol-lookup.js";
import type { AppState } from "../core/types.js";

describe("createSymbolLookupFromState", () => {
  it("returns ranked hits from agent symbolFiles", () => {
    const state: AppState = {
      stateVersion: 2,
      agents: {
        myrepo: {
          agentId: "myrepo",
          repoName: "myrepo",
          passages: {},
          symbolFiles: {
            "src/lib.ts": {
              symbols: [
                {
                  kind: "FUNCTION",
                  name: "helper",
                  qualifiedName: "helper",
                  startIndex: 0,
                  endIndex: 10,
                  startLine: 1,
                  endLine: 1,
                },
              ],
              refs: [],
            },
          },
          symbolRanks: { "def:src/lib.ts#helper@1": 0.42 },
          lastBootstrap: null,
          lastSyncCommit: null,
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };

    const lookup = createSymbolLookupFromState(state);
    const hits = lookup.find("myrepo", "helper");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ filePath: "src/lib.ts", rank: 0.42 });
  });

  it("returns [] for unknown agents", () => {
    const state: AppState = { stateVersion: 2, agents: {} };
    expect(createSymbolLookupFromState(state).find("missing", "x")).toEqual([]);
  });
});
