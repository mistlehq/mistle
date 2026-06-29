import { importSandboxImage } from "tensorlake";

const TensorlakeApiKeyEnv = "TENSORLAKE_API_KEY";

export type RegisterTensorlakeSandboxBaseImageInput = {
  readonly apiKey: string;
  readonly source: {
    readonly baseImageRef: string;
    readonly imageId: string;
  };
};

export async function registerTensorlakeSandboxBaseImage(
  input: RegisterTensorlakeSandboxBaseImageInput,
): Promise<void> {
  await withTensorlakeApiKey(input.apiKey, async () => {
    const importLogs = createTensorlakeImageImportLogCollector();

    try {
      await importSandboxImage(
        input.source.baseImageRef,
        {
          registeredName: input.source.imageId,
          dockerCompat: true,
        },
        { emit: importLogs.emit },
      );
    } catch (error) {
      throw formatTensorlakeImageImportFailure(error, importLogs.entries());
    }
  });
}

type TensorlakeImageImportLogEntry = {
  readonly label: string;
  readonly message: string;
};

type TensorlakeImageImportLogCollector = {
  readonly emit: (event: Record<string, unknown>) => void;
  readonly entries: () => readonly TensorlakeImageImportLogEntry[];
};

function createTensorlakeImageImportLogCollector(): TensorlakeImageImportLogCollector {
  const entries: TensorlakeImageImportLogEntry[] = [];

  return {
    emit: (event) => {
      const entry = parseTensorlakeImageImportLogEntry(event);
      if (entry === null) {
        return;
      }

      entries.push(entry);
      process.stderr.write(`[${entry.label}] ${entry.message}\n`);
    },
    entries: () => entries,
  };
}

function parseTensorlakeImageImportLogEntry(
  event: Record<string, unknown>,
): TensorlakeImageImportLogEntry | null {
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
        : "import";

  return { label, message };
}

export function formatTensorlakeImageImportFailure(
  error: unknown,
  entries: readonly TensorlakeImageImportLogEntry[],
): Error {
  const baseMessage =
    error instanceof Error
      ? error.message
      : `Tensorlake sandbox image import failed: ${String(error)}`;

  const logMessage = formatTensorlakeImageImportLogs(entries);
  const message =
    logMessage.length === 0
      ? baseMessage
      : `${baseMessage}\n\nTensorlake sandbox image import output:\n${logMessage}`;

  return new Error(message, { cause: error });
}

function formatTensorlakeImageImportLogs(
  entries: readonly TensorlakeImageImportLogEntry[],
): string {
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
