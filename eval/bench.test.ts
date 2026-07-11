import { describe, it, expect } from "vitest";
import { runBench, evaluateGates } from "./bench.js";

/**
 * Smoke test so the bench script can't rot: it runs the whole pipeline
 * (copy fixture -> git init -> collect -> chunk -> store -> searchLegs -> score)
 * in-process on a small slice of gold queries. Not the full benchmark (that is
 * `pnpm bench`); this only guards executability and report shape.
 */
describe("bench smoke", () => {
  it("runs end to end on a small query slice and produces a well-formed report", async () => {
    const { report, gatesPassed } = await runBench({ limit: 3, quiet: true });

    expect(report.engine).toBe("deterministic");
    expect(report.queryCount).toBe(3);
    expect(report.performance.passageCount).toBeGreaterThan(0);
    expect(report.performance.chunkCount).toBe(report.performance.passageCount);

    // The first three gold queries are all identifiers; identifier Recall@1
    // must be a perfect 1.0 (the hybrid guarantee).
    expect(report.legs.fused.recallAt1.byKind["identifier"]).toBe(1);
    expect(gatesPassed).toBe(true);
  }, 30_000);

  it("evaluateGates reports the three deterministic-tier gates", async () => {
    const { report } = await runBench({ limit: 5, quiet: true });
    const gates = evaluateGates(report);

    expect(gates.lines).toHaveLength(3);
    expect(gates.passed).toBe(true);
  }, 30_000);
});
