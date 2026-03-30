export class StaleConnectionAttemptError extends Error {
  constructor() {
    super("Stale connection attempt.");
  }
}

export function isStaleConnectionAttemptError(
  error: unknown,
): error is StaleConnectionAttemptError {
  return error instanceof StaleConnectionAttemptError;
}

export function describeCodexSessionStepError(stepLabel: string, error: unknown): Error {
  if (isStaleConnectionAttemptError(error)) {
    return error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return new Error(`${stepLabel} failed: ${error.message}`);
  }

  return new Error(`${stepLabel} failed.`);
}

export function getCodexSessionErrorMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallbackMessage;
}
