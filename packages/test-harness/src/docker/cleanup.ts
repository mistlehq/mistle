type DockerStopOptions = {
  remove?: boolean;
  removeVolumes?: boolean;
  timeout?: number;
};

type StoppableContainer = {
  stop: (options?: DockerStopOptions) => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

export function isIgnorableContainerStopError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const statusCode = readNumberField(error, "statusCode");
  const reason = readStringField(error, "reason");
  const json = isRecord(error.json) ? error.json : undefined;
  const message = json === undefined ? undefined : readStringField(json, "message");

  return (
    (statusCode === 404 && message?.includes("No such container") === true) ||
    (statusCode === 409 &&
      reason === "container stopped/paused" &&
      message?.includes("is not running") === true)
  );
}

export async function stopContainerIgnoringMissing(
  container: StoppableContainer,
  options?: DockerStopOptions,
): Promise<void> {
  try {
    await container.stop(options);
  } catch (error) {
    if (isIgnorableContainerStopError(error)) {
      return;
    }

    throw error;
  }
}
