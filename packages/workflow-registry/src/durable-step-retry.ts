type DurableStepErrorShape = {
  name?: unknown;
  retryPolicy?: unknown;
  stepFailedAttempts?: unknown;
};

type DurableStepRetryPolicyShape = {
  maximumAttempts?: unknown;
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
