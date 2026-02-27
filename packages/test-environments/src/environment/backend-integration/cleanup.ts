export type CleanupTask = {
  label: string;
  run: () => Promise<void>;
};

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runCleanupTasks(cleanupTasks: readonly CleanupTask[]): Promise<void> {
  const errors: Error[] = [];

  for (const cleanupTask of cleanupTasks) {
    try {
      await cleanupTask.run();
    } catch (error) {
      const normalizedError = normalizeError(error);
      errors.push(new Error(`Cleanup failed for ${cleanupTask.label}: ${normalizedError.message}`));
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "Multiple cleanup failures occurred while stopping control-plane integration environment.",
    );
  }
}
