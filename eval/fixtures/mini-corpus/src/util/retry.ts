export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  attempts: 5,
  baseDelayMs: 50,
  maxDelayMs: 2000,
};

function backoffDelay(attempt: number, options: RetryOptions): number {
  const exponential = options.baseDelayMs * 2 ** attempt;
  return Math.min(exponential, options.maxDelayMs);
}

/**
 * Run an async operation, retrying with exponential backoff on rejection.
 * Sole definition site of retryWithBackoff.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = DEFAULT_OPTIONS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = backoffDelay(attempt, options);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("retryWithBackoff exhausted");
}
