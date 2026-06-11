const ProviderExecutionMissingCode = "provider_execution_missing";

function isConversationProviderErrorLike(
  value: unknown,
): value is Pick<Error, "message"> & { code?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string" &&
    (!("code" in value) || typeof value.code === "string")
  );
}

export function isRecoverableLateSteerError(input: { error: unknown }): boolean {
  if (!isConversationProviderErrorLike(input.error)) {
    return false;
  }

  return (
    input.error.code === ProviderExecutionMissingCode &&
    input.error.message.includes("no active turn to steer")
  );
}

export function isStaleActiveTurnMismatchError(input: { error: unknown }): boolean {
  if (!isConversationProviderErrorLike(input.error)) {
    return false;
  }

  return (
    input.error.code === ProviderExecutionMissingCode &&
    input.error.message.includes("expected active turn id `")
  );
}
