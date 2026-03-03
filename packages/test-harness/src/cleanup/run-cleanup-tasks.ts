export type CleanupTask = () => Promise<void>;

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runCleanupTasks(input: {
  tasks: readonly CleanupTask[];
  context: string;
}): Promise<void> {
  const errors: Error[] = [];

  for (const cleanupTask of input.tasks) {
    try {
      await cleanupTask();
    } catch (error) {
      errors.push(normalizeError(error));
    }
  }

  if (errors.length === 1) {
    const firstError = errors[0];
    if (firstError === undefined) {
      throw new Error("Expected exactly one cleanup error.");
    }
    throw firstError;
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, `Multiple cleanup tasks failed in ${input.context}.`);
  }
}
