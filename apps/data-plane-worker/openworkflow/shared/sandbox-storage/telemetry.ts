import type { SandboxStorageConfigSource } from "@mistle/db/control-plane";
import type { SandboxInstancePersistenceMode } from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import type { SandboxProvider, SandboxStorageBackend } from "@mistle/sandbox";
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

import { logger } from "../../../logger.js";

type SandboxStorageTelemetryAttributeInput = {
  sandboxInstanceId?: string;
  organizationId?: string;
  persistenceMode?: SandboxInstancePersistenceMode;
  runtimeProvider?: SandboxProvider;
  storageBackend?: SandboxStorageBackend;
  storageConfigSource?: SandboxStorageConfigSource;
  region?: string;
  operation: string;
};

type SandboxStorageFailureAttributes = {
  "mistle.sandbox.storage.failure_code": string;
  "mistle.sandbox.storage.failure_category": string;
};

type SandboxStorageTelemetryContext = {
  logger: MistleLogger;
  setAttributes: (attributes: Attributes) => void;
};

type ErrorWithCode = {
  code: string;
};

const SandboxStorageTracer = trace.getTracer("@mistle/data-plane-worker");

function hasStringCode(error: unknown): error is ErrorWithCode {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  );
}

function normalizeRecordedException(error: unknown): Error | string {
  if (error instanceof Error || typeof error === "string") {
    return error;
  }

  return new Error(String(error));
}

function resolveFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return String(error);
}

export function createSandboxStorageTelemetryAttributes(
  input: SandboxStorageTelemetryAttributeInput,
): Attributes {
  return {
    "mistle.sandbox.storage.operation": input.operation,
    ...(input.sandboxInstanceId === undefined
      ? {}
      : {
          "mistle.sandbox.instance_id": input.sandboxInstanceId,
        }),
    ...(input.organizationId === undefined
      ? {}
      : {
          "mistle.organization.id": input.organizationId,
        }),
    ...(input.persistenceMode === undefined
      ? {}
      : {
          "mistle.sandbox.persistence_mode": input.persistenceMode,
        }),
    ...(input.runtimeProvider === undefined
      ? {}
      : {
          "mistle.sandbox.runtime_provider": input.runtimeProvider,
        }),
    ...(input.storageBackend === undefined
      ? {}
      : {
          "mistle.sandbox.storage.backend": input.storageBackend,
        }),
    ...(input.storageConfigSource === undefined
      ? {}
      : {
          "mistle.sandbox.storage.config_source": input.storageConfigSource,
        }),
    ...(input.region === undefined
      ? {}
      : {
          "mistle.sandbox.storage.region": input.region,
        }),
  };
}

export function createSandboxStorageFailureAttributes(
  error: unknown,
): SandboxStorageFailureAttributes {
  return {
    "mistle.sandbox.storage.failure_code": hasStringCode(error) ? error.code : "unknown_error",
    "mistle.sandbox.storage.failure_category": error instanceof Error ? error.name : typeof error,
  };
}

export async function withSandboxStorageTelemetry<Output>(input: {
  operation: string;
  telemetry: SandboxStorageTelemetryAttributeInput;
  providerOperation?: string;
  fn: (ctx: SandboxStorageTelemetryContext) => Promise<Output>;
}): Promise<Output> {
  const initialAttributes = createSandboxStorageTelemetryAttributes(input.telemetry);

  return SandboxStorageTracer.startActiveSpan(
    `data_plane_worker.sandbox_storage.${input.operation}`,
    {
      attributes: initialAttributes,
    },
    async (span: Span) => {
      let currentAttributes: Attributes = initialAttributes;
      let dynamicLogAttributes: Attributes = {};
      const operationLogger = logger.child(initialAttributes);

      function setAttributes(attributes: Attributes): void {
        currentAttributes = {
          ...currentAttributes,
          ...attributes,
        };
        dynamicLogAttributes = {
          ...dynamicLogAttributes,
          ...attributes,
        };
        span.setAttributes(attributes);
      }

      operationLogger.info("Starting sandbox storage operation.");

      try {
        const output = await input.fn({
          logger: operationLogger,
          setAttributes,
        });
        operationLogger.info(dynamicLogAttributes, "Completed sandbox storage operation.");
        span.end();
        return output;
      } catch (error) {
        const failureAttributes = createSandboxStorageFailureAttributes(error);
        const providerOperationAttributes =
          input.providerOperation === undefined
            ? {}
            : {
                "mistle.sandbox.storage.provider_operation": input.providerOperation,
              };

        setAttributes({
          ...failureAttributes,
          ...providerOperationAttributes,
        });
        span.recordException(normalizeRecordedException(error));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: resolveFailureMessage(error),
        });
        operationLogger.error(
          {
            err: error,
            ...dynamicLogAttributes,
          },
          "Sandbox storage operation failed.",
        );
        span.end();
        throw error;
      }
    },
  );
}
