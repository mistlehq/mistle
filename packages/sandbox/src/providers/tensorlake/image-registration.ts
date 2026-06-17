import { importSandboxImage } from "tensorlake";

const TensorlakeApiKeyEnv = "TENSORLAKE_API_KEY";

export type RegisterTensorlakeSandboxBaseImageInput = {
  readonly apiKey: string;
  readonly registeredName: string;
  readonly sourceImageRef: string;
};

export async function registerTensorlakeSandboxBaseImage(
  input: RegisterTensorlakeSandboxBaseImageInput,
): Promise<void> {
  await withTensorlakeApiKey(input.apiKey, async () => {
    const importLogs = createTensorlakeImportLogCollector();

    try {
      await importSandboxImage(
        input.sourceImageRef,
        {
          registeredName: input.registeredName,
        },
        { emit: importLogs.emit },
      );
    } catch (error) {
      throw formatTensorlakeImportFailure(error, importLogs.entries());
    }
  });
}

type TensorlakeImportLogEntry = {
  readonly label: string;
  readonly message: string;
};

type TensorlakeImportLogCollector = {
  readonly emit: (event: Record<string, unknown>) => void;
  readonly entries: () => readonly TensorlakeImportLogEntry[];
};

function createTensorlakeImportLogCollector(): TensorlakeImportLogCollector {
  const entries: TensorlakeImportLogEntry[] = [];

  return {
    emit: (event) => {
      const entry = parseTensorlakeImportLogEntry(event);
      if (entry === null) {
        return;
      }

      entries.push(entry);
      process.stderr.write(`[${entry.label}] ${entry.message}\n`);
    },
    entries: () => entries,
  };
}

function parseTensorlakeImportLogEntry(
  event: Record<string, unknown>,
): TensorlakeImportLogEntry | null {
  if (typeof event.message !== "string") {
    return null;
  }

  const message = event.message.trimEnd();
  if (message.length === 0) {
    return null;
  }

  const label =
    typeof event.stream === "string" && event.stream.length > 0
      ? event.stream
      : typeof event.type === "string" && event.type.length > 0
        ? event.type
        : "build";

  return { label, message };
}

export function formatTensorlakeImportFailure(
  error: unknown,
  entries: readonly TensorlakeImportLogEntry[],
): Error {
  const baseMessage =
    error instanceof Error
      ? error.message
      : `Tensorlake sandbox image import failed: ${String(error)}`;

  const logMessage = formatTensorlakeImportLogs(entries);
  const message =
    logMessage.length === 0
      ? baseMessage
      : `${baseMessage}\n\nTensorlake sandbox image import output:\n${logMessage}`;

  return new Error(message, { cause: error });
}

function formatTensorlakeImportLogs(entries: readonly TensorlakeImportLogEntry[]): string {
  return entries.map((entry) => `${entry.label}:\n${entry.message}`).join("\n");
}

async function withTensorlakeApiKey<Result>(
  apiKey: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previousApiKey = process.env[TensorlakeApiKeyEnv];
  process.env[TensorlakeApiKeyEnv] = apiKey;

  try {
    return await operation();
  } finally {
    if (previousApiKey === undefined) {
      delete process.env[TensorlakeApiKeyEnv];
    } else {
      process.env[TensorlakeApiKeyEnv] = previousApiKey;
    }
  }
}
