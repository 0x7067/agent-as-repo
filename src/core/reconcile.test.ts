import { describe, expect, it } from "vitest";
import { cleanMissingFromMap, computeReconcilePlan } from "./reconcile.js";
import type { PassageMap } from "./types.js";

describe("computeReconcilePlan", () => {
  it("reports in-sync when local map matches server", () => {
    const passageMap: PassageMap = { "a.ts": ["p1", "p2"], "b.ts": ["p3"] };
    const serverPassages = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    const plan = computeReconcilePlan(passageMap, serverPassages);
    expect(plan.inSync).toBe(true);
    expect(plan.orphanPassageIds).toEqual([]);
    expect(plan.missingPassageIds).toEqual([]);
  });

  it("detects orphan passages (on server, not in local map)", () => {
    const passageMap: PassageMap = { "a.ts": ["p1"] };
    const serverPassages = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    const plan = computeReconcilePlan(passageMap, serverPassages);
    expect(plan.inSync).toBe(false);
    expect(plan.orphanPassageIds).toEqual(expect.arrayContaining(["p2", "p3"]));
    expect(plan.missingPassageIds).toEqual([]);
  });

  it("detects missing passages (in local map, not on server)", () => {
    const passageMap: PassageMap = { "a.ts": ["p1", "p2"] };
    const serverPassages = [{ id: "p1" }];
    const plan = computeReconcilePlan(passageMap, serverPassages);
    expect(plan.inSync).toBe(false);
    expect(plan.orphanPassageIds).toEqual([]);
    expect(plan.missingPassageIds).toEqual(["p2"]);
  });

  it("handles empty local map with server passages as all-orphan", () => {
    const passageMap: PassageMap = {};
    const serverPassages = [{ id: "p1" }];
    const plan = computeReconcilePlan(passageMap, serverPassages);
    expect(plan.inSync).toBe(false);
    expect(plan.orphanPassageIds).toEqual(["p1"]);
  });

  it("handles empty both sides as in-sync", () => {
    const plan = computeReconcilePlan({}, []);
    expect(plan.inSync).toBe(true);
  });
});

describe("cleanMissingFromMap", () => {
  it("removes missing passage IDs from map", () => {
    const map: PassageMap = { "a.ts": ["p1", "p2"], "b.ts": ["p3"] };
    const result = cleanMissingFromMap(map, ["p2"]);
    expect(result["a.ts"]).toEqual(["p1"]);
    expect(result["b.ts"]).toEqual(["p3"]);
  });

  it("drops files whose passage list becomes empty", () => {
    const map: PassageMap = { "a.ts": ["p1"] };
    const result = cleanMissingFromMap(map, ["p1"]);
    expect("a.ts" in result).toBe(false);
  });

  it("returns same map if no missing IDs", () => {
    const map: PassageMap = { "a.ts": ["p1"] };
    const result = cleanMissingFromMap(map, []);
    expect(result).toBe(map); // identity check — no copy made
  });
});
