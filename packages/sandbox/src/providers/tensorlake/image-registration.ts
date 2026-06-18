import { createSandboxImage } from "tensorlake";

import type { SandboxSdkImageBaseImageSource } from "../../types.js";
import { createTensorlakeSandboxBaseImage } from "./base-image-definition.js";

const TensorlakeApiKeyEnv = "TENSORLAKE_API_KEY";

export type RegisterTensorlakeSandboxBaseImageInput = {
  readonly apiKey: string;
  readonly contextPath: string;
  readonly source: Omit<SandboxSdkImageBaseImageSource, "contextPath" | "kind">;
};

export async function registerTensorlakeSandboxBaseImage(
  input: RegisterTensorlakeSandboxBaseImageInput,
): Promise<void> {
  await withTensorlakeApiKey(input.apiKey, async () => {
    const buildLogs = createTensorlakeBuildLogCollector();

    try {
      await createSandboxImage(
        createTensorlakeSandboxBaseImage({
          baseImageRef: input.source.baseImageRef,
          name: input.source.imageId,
          ...(input.source.sandboxd === undefined ? {} : { sandboxd: input.source.sandboxd }),
        }),
        {
          registeredName: input.source.imageId,
          contextDir: input.contextPath,
        },
        { emit: buildLogs.emit },
      );
    } catch (error) {
      throw formatTensorlakeBuildFailure(error, buildLogs.entries());
    }
  });
}

type TensorlakeBuildLogEntry = {
  readonly label: string;
  readonly message: string;
};

type TensorlakeBuildLogCollector = {
  readonly emit: (event: Record<string, unknown>) => void;
  readonly entries: () => readonly TensorlakeBuildLogEntry[];
};

function createTensorlakeBuildLogCollector(): TensorlakeBuildLogCollector {
  const entries: TensorlakeBuildLogEntry[] = [];

  return {
    emit: (event) => {
      const entry = parseTensorlakeBuildLogEntry(event);
      if (entry === null) {
        return;
      }

      entries.push(entry);
      process.stderr.write(`[${entry.label}] ${entry.message}\n`);
    },
    entries: () => entries,
  };
}

function parseTensorlakeBuildLogEntry(
  event: Record<string, unknown>,
): TensorlakeBuildLogEntry | null {
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

export function formatTensorlakeBuildFailure(
  error: unknown,
  entries: readonly TensorlakeBuildLogEntry[],
): Error {
  const baseMessage =
    error instanceof Error
      ? error.message
      : `Tensorlake sandbox image build failed: ${String(error)}`;

  const logMessage = formatTensorlakeBuildLogs(entries);
  const message =
    logMessage.length === 0
      ? baseMessage
      : `${baseMessage}\n\nTensorlake sandbox image build output:\n${logMessage}`;

  return new Error(message, { cause: error });
}

function formatTensorlakeBuildLogs(entries: readonly TensorlakeBuildLogEntry[]): string {
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
