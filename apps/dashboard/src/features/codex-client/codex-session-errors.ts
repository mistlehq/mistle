export class StaleConnectionAttemptError extends Error {
  constructor() {
    super("Stale connection attempt.");
  }
}

export function describeCodexSessionStepError(stepLabel: string, error: unknown): Error {
  if (error instanceof StaleConnectionAttemptError) {
    return error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return new Error(`${stepLabel} failed: ${error.message}`);
  }

  return new Error(`${stepLabel} failed.`);
}
