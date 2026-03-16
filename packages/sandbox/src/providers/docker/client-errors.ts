import { z } from "zod";

import { SandboxError } from "../../errors.js";

export const DockerClientOperationIds = {
  /**
   * `docker.pull(...)` delegates to `createImage(...)`.
   * Sources:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/docker.js#L1480-L1492
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/docker.js#L44-L59
   */
  PULL_IMAGE: "pull_image",
  /**
   * `docker.createContainer(...)`.
   * Source:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/docker.js#L44-L79
   */
  CREATE_CONTAINER: "create_container",
  /**
   * `container.start(...)`.
   * Source:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/container.js#L388-L420
   */
  START_CONTAINER: "start_container",
  /**
   * `container.attach({ stdin: true, ... })`.
   * Source:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/container.js#L737-L770
   */
  ATTACH_STDIN: "attach_stdin",
  WRITE_STDIN: "write_stdin",
  CLOSE_STDIN: "close_stdin",
  /**
   * `container.inspect(...)`.
   * Source:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/container.js#L47-L76
   */
  RESOLVE_CONTAINER: "resolve_container",
  /**
   * `container.remove(...)`.
   * Source:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/container.js#L815-L847
   */
  REMOVE_CONTAINER: "remove_container",
} as const;
export type DockerClientOperation =
  (typeof DockerClientOperationIds)[keyof typeof DockerClientOperationIds];

export const DockerClientErrorCodes = {
  /**
   * Backed by dockerode status code maps that include `404`.
   * Sources:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/container.js#L56-L60
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/image.js#L29-L33
   */
  NOT_FOUND: "not_found",
  /**
   * Backed by dockerode status code maps that include `409`.
   * Sources:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/image.js#L219
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/network.js#L68
   */
  CONFLICT: "conflict",
  /**
   * Backed by dockerode status code maps that include `400`.
   * Sources:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/docker.js#L55
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/container.js#L825
   */
  INVALID_ARGUMENT: "invalid_argument",
  /**
   * Backed by dockerode status code maps that include `401`.
   * Source:
   * https://github.com/apocas/dockerode/blob/b9b1c71df369a7947ff398cbfdf4d20406598d38/lib/image.js#L68
   */
  UNAUTHENTICATED: "unauthenticated",
  /**
   * Default for statuses without explicit mapping/evidence in this package call path.
   */
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
  // docker-modem sets `statusCode` and `reason` on request errors.
  // Source:
  // https://github.com/apocas/docker-modem/blob/main/lib/modem.js#L375-L390
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
