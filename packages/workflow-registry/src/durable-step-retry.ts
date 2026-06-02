type DurableStepErrorShape = {
  message?: unknown;
  name?: unknown;
  originalError?: unknown;
  retryPolicy?: unknown;
  stepFailedAttempts?: unknown;
};

type DurableStepRetryPolicyShape = {
  maximumAttempts?: unknown;
};

type DurableStepOriginalErrorShape = {
  retryable?: unknown;
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

export type DurableStepRetryOptions = {
  finalizeNonRetryableOriginalError?: boolean;
};

export function shouldRethrowDurableStepErrorForRetry(
  error: unknown,
  options?: DurableStepRetryOptions,
): boolean {
  if (!isDurableStepErrorShape(error)) {
    return false;
  }

  const { retryPolicy, stepFailedAttempts } = error;
  if (
    options?.finalizeNonRetryableOriginalError === true &&
    isDurableStepOriginalErrorShape(error.originalError) &&
    error.originalError.retryable === false
  ) {
    return false;
  }

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
  retryOptions?: DurableStepRetryOptions,
): void {
  if (!shouldRethrowDurableStepErrorForRetry(error, retryOptions)) {
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

export function resolveDurableStepFinalError(
  error: unknown,
  options?: DurableStepRetryOptions,
): unknown {
  if (!isDurableStepErrorShape(error) || shouldRethrowDurableStepErrorForRetry(error, options)) {
    return error;
  }

  if (error.originalError instanceof Error) {
    return error.originalError;
  }

  if (isErrorMessageShape(error.originalError)) {
    return new Error(error.originalError.message, { cause: error.originalError });
  }

  return new Error(getDurableStepErrorMessage(error), { cause: error });
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

function isDurableStepOriginalErrorShape(
  originalError: unknown,
): originalError is DurableStepOriginalErrorShape {
  return typeof originalError === "object" && originalError !== null;
}

function isErrorMessageShape(error: unknown): error is { message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function getDurableStepErrorMessage(error: DurableStepErrorShape): string {
  if (typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  return "Durable step failed.";
}
