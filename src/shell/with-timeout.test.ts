import { describe, it, expect, vi } from "vitest";
import { withTimeoutSignal } from "./with-timeout.js";

describe("withTimeoutSignal", () => {
  it("resolves with the function result when it completes in time", async () => {
    const result = await withTimeoutSignal("test", 1000, () => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("rejects with a timeout error when function exceeds timeoutMs", async () => {
    await expect(
      withTimeoutSignal("my-op", 10, () => new Promise((resolve) => setTimeout(resolve, 5000))),
    ).rejects.toThrow("my-op timed out after 10ms");
  });

  it("clears the timer after the function resolves (no timer leak)", async () => {
    const spy = vi.spyOn(globalThis, "clearTimeout");
    await withTimeoutSignal("test", 5000, () => Promise.resolve("done"));
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("clears the timer after the function rejects for its own reasons (no timer leak)", async () => {
    const spy = vi.spyOn(globalThis, "clearTimeout");
    await expect(withTimeoutSignal("test", 5000, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("threads an AbortSignal into fn that is not aborted while running normally", async () => {
    let observedAborted: boolean | undefined;
    await withTimeoutSignal("test", 1000, (signal) => {
      observedAborted = signal.aborted;
      return Promise.resolve("ok");
    });
    expect(observedAborted).toBe(false);
  });

  it("aborts the signal passed to fn when the timeout fires, so the underlying call can cancel", async () => {
    let signalRef: AbortSignal | undefined;
    const pending = withTimeoutSignal("slow-op", 10, (signal) => {
      signalRef = signal;
      // Simulate a long-running call that never resolves on its own; it must
      // observe the abort instead of being left running orphaned forever.
      return new Promise((resolve) => setTimeout(resolve, 5000));
    });

    await expect(pending).rejects.toThrow("slow-op timed out after 10ms");
    expect(signalRef?.aborted).toBe(true);
  });
});
