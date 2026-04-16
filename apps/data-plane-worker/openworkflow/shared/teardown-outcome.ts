export function throwSandboxTeardownOutcome(input: {
  lifecycle: "stop" | "destroy";
  computeTeardownError?: unknown;
  storageCleanupError?: unknown;
}): void {
  if (input.computeTeardownError !== undefined && input.storageCleanupError !== undefined) {
    throw new Error(
      `Failed to ${input.lifecycle} sandbox compute and failed to clean up sandbox storage after compute teardown.`,
      {
        cause: {
          computeTeardownError: input.computeTeardownError,
          storageCleanupError: input.storageCleanupError,
        },
      },
    );
  }

  if (input.computeTeardownError !== undefined) {
    throw input.computeTeardownError;
  }

  if (input.storageCleanupError !== undefined) {
    throw input.storageCleanupError;
  }
}
