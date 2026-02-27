import { z } from "zod";

import { SandboxError } from "../../errors.js";

export const DockerClientOperationIds = {
  PULL_IMAGE: "pull_image",
  CREATE_CONTAINER: "create_container",
  START_CONTAINER: "start_container",
  RESOLVE_CONTAINER: "resolve_container",
  COMMIT_CONTAINER: "commit_container",
  PUSH_IMAGE: "push_image",
  INSPECT_IMAGE: "inspect_image",
  REMOVE_CONTAINER: "remove_container",
} as const;
export type DockerClientOperation =
  (typeof DockerClientOperationIds)[keyof typeof DockerClientOperationIds];

export const DockerClientErrorCodes = {
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  INVALID_ARGUMENT: "invalid_argument",
  UNAUTHENTICATED: "unauthenticated",
  UNKNOWN: "unknown",
} as const;
export type DockerClientErrorCode =
  (typeof DockerClientErrorCodes)[keyof typeof DockerClientErrorCodes];

type CreateDockerClientErrorInput = {
  code: DockerClientErrorCode;
  operation: DockerClientOperation;
  retryable: boolean;
  message: string;
  cause: unknown;
};

export class DockerClientError extends SandboxError {
  readonly code: DockerClientErrorCode;
  readonly operation: DockerClientOperation;
  readonly retryable: boolean;

  constructor(input: CreateDockerClientErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "DockerClientError";
    this.code = input.code;
    this.operation = input.operation;
    this.retryable = input.retryable;
  }
}

const ErrorShapeSchema = z.looseObject({
  statusCode: z.number().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});
type ErrorShape = z.output<typeof ErrorShapeSchema>;

function parseErrorShape(error: unknown): ErrorShape | undefined {
  const parsed = ErrorShapeSchema.safeParse(error);
  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
}

function extractErrorMessage(error: unknown, errorShape?: ErrorShape): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (errorShape === undefined) {
    return "Unknown Docker API error.";
  }

  const reason = errorShape.reason;
  if (reason !== undefined && reason.length > 0) {
    return reason;
  }

  const message = errorShape.message;
  if (message !== undefined && message.length > 0) {
    return message;
  }

  return "Unknown Docker API error.";
}

function formatOperationMessage(operation: DockerClientOperation, message: string): string {
  return `Docker operation \`${operation}\` failed: ${message}`;
}

function createMappedError(
  input: Omit<CreateDockerClientErrorInput, "message"> & {
    sourceMessage: string;
  },
): DockerClientError {
  return new DockerClientError({
    code: input.code,
    operation: input.operation,
    retryable: input.retryable,
    message: formatOperationMessage(input.operation, input.sourceMessage),
    cause: input.cause,
  });
}

export function mapDockerClientError(
  operation: DockerClientOperation,
  error: unknown,
): DockerClientError {
  if (error instanceof DockerClientError) {
    return error;
  }

  const errorShape = parseErrorShape(error);
  const sourceMessage = extractErrorMessage(error, errorShape);
  const statusCode = errorShape?.statusCode;

  if (statusCode === 404) {
    return createMappedError({
      code: DockerClientErrorCodes.NOT_FOUND,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (statusCode === 409) {
    return createMappedError({
      code: DockerClientErrorCodes.CONFLICT,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (statusCode === 400) {
    return createMappedError({
      code: DockerClientErrorCodes.INVALID_ARGUMENT,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (statusCode === 401) {
    return createMappedError({
      code: DockerClientErrorCodes.UNAUTHENTICATED,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  return createMappedError({
    code: DockerClientErrorCodes.UNKNOWN,
    operation,
    retryable: false,
    sourceMessage,
    cause: error,
  });
}
