type DurableStepErrorShape = {
  name?: unknown;
  retryPolicy?: unknown;
  stepFailedAttempts?: unknown;
};

type DurableStepRetryPolicyShape = {
  maximumAttempts?: unknown;
};

type DurableStepRetryLogger = {
  warn(attributes: Record<string, unknown>, message: string): void;
};

type DurableStepRetryLogOptions = {
  attributes?: Record<string, unknown>;
  eventName: string;
  logger: DurableStepRetryLogger;
  message: string;
};

export function shouldRethrowDurableStepErrorForRetry(error: unknown): boolean {
  if (!isDurableStepErrorShape(error)) {
    return false;
  }

  const { retryPolicy, stepFailedAttempts } = error;
  if (!isDurableStepRetryPolicyShape(retryPolicy)) {
    return false;
  }

  if (
    !isNonnegativeInteger(stepFailedAttempts) ||
    !isPositiveInteger(retryPolicy.maximumAttempts)
  ) {
    return false;
  }

  return stepFailedAttempts < retryPolicy.maximumAttempts;
}

export function rethrowDurableStepErrorForRetry(
  error: unknown,
  logOptions?: DurableStepRetryLogOptions,
): void {
  if (!shouldRethrowDurableStepErrorForRetry(error)) {
    return;
  }

  if (logOptions !== undefined) {
    logOptions.logger.warn(
      {
        ...logOptions.attributes,
        eventName: logOptions.eventName,
        err: error,
      },
      logOptions.message,
    );
  }

  throw error;
}

function isDurableStepErrorShape(error: unknown): error is DurableStepErrorShape {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "StepError"
  );
}

function isDurableStepRetryPolicyShape(
  retryPolicy: unknown,
): retryPolicy is DurableStepRetryPolicyShape {
  return typeof retryPolicy === "object" && retryPolicy !== null;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
