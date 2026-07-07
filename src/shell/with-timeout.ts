/**
 * Race a promise-returning function against a timer, threading an
 * AbortSignal into the function so the underlying operation can react to
 * (and cancel) the timeout — instead of continuing to run orphaned in the
 * background after this call has already rejected. A late orphaned response
 * from an un-cancelled call can otherwise clobber newer state (e.g. a memory
 * write) that lands after the timeout already gave up on it.
 */
export async function withTimeoutSignal<T>(
  label: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`${label} timed out after ${String(timeoutMs)}ms`);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
