import { SchemaCompatibilityError } from '../compatibility.js';

const PRODUCTION_SCHEMA_WAIT_MS = 40 * 60 * 1_000;
const RETRY_INTERVAL_MS = 10_000;

interface WaitOptions {
  readonly timeoutMs?: number;
  readonly retryIntervalMs?: number;
  readonly now?: () => number;
  readonly pause?: (milliseconds: number) => Promise<void>;
  readonly onWait?: () => void;
}

/** Preview validates migrations in isolated CI and never gates on a shared live schema. */
export function shouldVerifyLiveSchema(vercelEnvironment: string | undefined): boolean {
  return vercelEnvironment === 'production';
}

/**
 * Keeps an early production build pending while the trusted main workflow
 * applies a required migration. Only missing schema is retryable; credential,
 * privilege and connectivity failures remain immediate build failures.
 */
export async function waitForProductionSchema<T>(
  verify: () => Promise<T>,
  options: WaitOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? PRODUCTION_SCHEMA_WAIT_MS;
  const retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const pause =
    options.pause ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      return await verify();
    } catch (error) {
      if (!isMissingSchema(error) || now() >= deadline) {
        throw error;
      }

      options.onWait?.();
      await pause(retryIntervalMs);
    }
  }
}

function isMissingSchema(error: unknown): error is SchemaCompatibilityError {
  return (
    error instanceof SchemaCompatibilityError &&
    error.problems.length > 0 &&
    error.problems.every((problem) => problem.startsWith('missing '))
  );
}
