import { FileUploadResetCodes } from "@mistle/sandbox-session-protocol";

import { type LogFields, type LogLevel } from "../runtime/logger.js";

export const FileUploadFailureClasses = {
  AUTHENTICITY_FAILURE: "authenticity_failure",
  GATEWAY_OR_TUNNEL_DISCONNECT: "gateway_or_tunnel_disconnect",
  INCOMPLETE_TRANSPORT: "incomplete_transport",
  INVALID_UPLOAD_METADATA: "invalid_upload_metadata",
  RUNTIME_STORAGE_FAILURE: "runtime_storage_failure",
} as const;

export type FileUploadFailureClass =
  (typeof FileUploadFailureClasses)[keyof typeof FileUploadFailureClasses];

export const FileUploadTerminalEvents = {
  COMPLETED: "sandbox_file_upload_completed",
  FAILED: "sandbox_file_upload_failed",
  INTERRUPTED: "sandbox_file_upload_interrupted",
  REJECTED: "sandbox_file_upload_rejected",
} as const;

export type FileUploadObservabilityContext = {
  declaredMimeType: string;
  declaredSizeBytes: number;
  receivedBytes: number;
  streamId: number;
  threadId: string;
};

type FileUploadTerminalLogEntry = {
  event: string;
  fields: LogFields;
  level: LogLevel;
};

type FileUploadRejectedOutcome =
  | {
      code: string;
      kind: "rejected";
    }
  | {
      errorMessage: string;
      failureClass: FileUploadFailureClass;
      kind: "rejected";
    };

type FileUploadCompletedOutcome = {
  attachmentId: string;
  kind: "completed";
};

type FileUploadInterruptedOutcome = {
  kind: "interrupted";
  reason: string;
};

type FileUploadFailedOutcome = {
  errorMessage: string;
  failureClass: FileUploadFailureClass;
  kind: "failed";
};

type FileUploadTerminalOutcome =
  | FileUploadCompletedOutcome
  | FileUploadFailedOutcome
  | FileUploadInterruptedOutcome
  | FileUploadRejectedOutcome;

const IncompleteTransportResetCodes = new Set<string>([
  "byte_count_exceeded",
  "byte_count_mismatch",
  "invalid_stream_data",
]);

function classifyValidationResetCode(code: string): FileUploadFailureClass {
  if (IncompleteTransportResetCodes.has(code)) {
    return FileUploadFailureClasses.INCOMPLETE_TRANSPORT;
  }
  if (
    code === FileUploadResetCodes.INVALID_FILE_TYPE ||
    code === FileUploadResetCodes.INVALID_IMAGE_CONTENT ||
    code === FileUploadResetCodes.MIME_TYPE_MISMATCH
  ) {
    return FileUploadFailureClasses.AUTHENTICITY_FAILURE;
  }

  return FileUploadFailureClasses.RUNTIME_STORAGE_FAILURE;
}

function createBaseLogFields(input: FileUploadObservabilityContext): LogFields {
  return {
    declaredMimeType: input.declaredMimeType,
    declaredSizeBytes: input.declaredSizeBytes,
    receivedBytes: input.receivedBytes,
    streamId: input.streamId,
    threadId: input.threadId,
  };
}

export function createFileUploadObservabilityContext(
  input: FileUploadObservabilityContext,
): FileUploadObservabilityContext {
  return input;
}

export function classifyUploadMetadataError(errorMessage: string): FileUploadFailureClass {
  if (
    errorMessage === "threadId is required." ||
    errorMessage === "threadId must not include leading or trailing whitespace." ||
    errorMessage === "threadId exceeds the configured length limit." ||
    errorMessage === "threadId must use only ASCII letters, digits, '_' or '-'." ||
    errorMessage === "sizeBytes must be greater than 0." ||
    errorMessage === "sizeBytes exceeds the configured upload limit." ||
    errorMessage.startsWith("Unsupported image MIME type ")
  ) {
    return FileUploadFailureClasses.INVALID_UPLOAD_METADATA;
  }

  return FileUploadFailureClasses.RUNTIME_STORAGE_FAILURE;
}

export function classifyFileUploadResetCode(code: string): FileUploadFailureClass {
  return classifyValidationResetCode(code);
}

export function createFileUploadTerminalLogEntry(input: {
  context: FileUploadObservabilityContext;
  outcome: FileUploadTerminalOutcome;
}): FileUploadTerminalLogEntry {
  const baseFields = createBaseLogFields(input.context);
  switch (input.outcome.kind) {
    case "completed":
      return {
        level: "info",
        event: FileUploadTerminalEvents.COMPLETED,
        fields: {
          ...baseFields,
          attachmentId: input.outcome.attachmentId,
        },
      };
    case "failed":
      return {
        level: "error",
        event: FileUploadTerminalEvents.FAILED,
        fields: {
          ...baseFields,
          errorMessage: input.outcome.errorMessage,
          failureClass: input.outcome.failureClass,
        },
      };
    case "interrupted":
      return {
        level: "warn",
        event: FileUploadTerminalEvents.INTERRUPTED,
        fields: {
          ...baseFields,
          failureClass: FileUploadFailureClasses.GATEWAY_OR_TUNNEL_DISCONNECT,
          reason: input.outcome.reason,
        },
      };
    case "rejected":
      if ("code" in input.outcome) {
        return {
          level: "warn",
          event: FileUploadTerminalEvents.REJECTED,
          fields: {
            ...baseFields,
            failureClass: classifyValidationResetCode(input.outcome.code),
            resetCode: input.outcome.code,
          },
        };
      }

      return {
        level: "warn",
        event: FileUploadTerminalEvents.REJECTED,
        fields: {
          ...baseFields,
          errorMessage: input.outcome.errorMessage,
          failureClass: input.outcome.failureClass,
        },
      };
  }
}
