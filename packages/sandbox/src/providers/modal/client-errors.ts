import {
  AlreadyExistsError as ModalAlreadyExistsError,
  InvalidError as ModalInvalidError,
  NotFoundError as ModalNotFoundError,
  SandboxTimeoutError as ModalSandboxTimeoutError,
} from "modal";
import { z } from "zod";

import { SandboxError } from "../../errors.js";

export const ModalClientOperationIds = {
  /**
   * `apps.fromName(...)`
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/app.ts#L28-L49
   */
  RESOLVE_APP: "resolve_app",
  /**
   * `images.fromId(...)`
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/image.ts#L36-L50
   */
  RESOLVE_IMAGE: "resolve_image",
  /**
   * `sandboxes.create(...)`
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L433-L449
   */
  START_SANDBOX: "start_sandbox",
  /**
   * `sandboxes.fromId(...)`
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L455-L468
   */
  RESOLVE_SANDBOX: "resolve_sandbox",
  /**
   * `sandbox.terminate(...)`
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L1033-L1045
   */
  STOP_SANDBOX: "stop_sandbox",
  /**
   * `sandbox.stdin.writeBytes(...)` via `Sandbox.stdin` stream.
   * Sources:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L747-L753
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L1390-L1398
   */
  WRITE_STDIN: "write_stdin",
  /**
   * `WritableStreamDefaultWriter.close()` on `sandbox.stdin`.
   * Sources:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L747-L753
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L1398-L1404
   */
  CLOSE_STDIN: "close_stdin",
  APPLY_STARTUP: "apply_startup",
} as const;
export type ModalClientOperation =
  (typeof ModalClientOperationIds)[keyof typeof ModalClientOperationIds];

export const ModalClientErrorCodes = {
  /**
   * Backed by modal-js `NotFoundError` and gRPC `NOT_FOUND`.
   * Sources:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/errors.ts#L25-L30
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/app.ts#L46-L48
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/image.ts#L41-L42
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L462-L463
   */
  NOT_FOUND: "not_found",
  /**
   * Backed by modal-js `AlreadyExistsError` and gRPC `ALREADY_EXISTS`.
   * Sources:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/errors.ts#L33-L38
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L437-L439
   */
  ALREADY_EXISTS: "already_exists",
  /**
   * Backed by modal-js `InvalidError`.
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/errors.ts#L41-L46
   */
  INVALID_ARGUMENT: "invalid_argument",
  /**
   * Backed by observed gRPC `UNAUTHENTICATED` status usage in modal-js middleware.
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/task_command_router_client.ts#L461-L463
   */
  UNAUTHENTICATED: "unauthenticated",
  /**
   * Backed by modal-js `SandboxTimeoutError`.
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/errors.ts#L73-L79
   */
  TIMEOUT: "timeout",
  /**
   * Default for statuses or error shapes without explicit evidence in the currently used call paths.
   */
  UNKNOWN: "unknown",
} as const;
export type ModalClientErrorCode =
  (typeof ModalClientErrorCodes)[keyof typeof ModalClientErrorCodes];

type CreateModalClientErrorInput = {
  code: ModalClientErrorCode;
  operation: ModalClientOperation;
  retryable: boolean;
  message: string;
  cause: unknown;
};

export class ModalClientError extends SandboxError {
  readonly code: ModalClientErrorCode;
  readonly operation: ModalClientOperation;
  readonly retryable: boolean;

  constructor(input: CreateModalClientErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "ModalClientError";
    this.code = input.code;
    this.operation = input.operation;
    this.retryable = input.retryable;
  }
}

const GrpcStatusCodes = {
  /**
   * gRPC NOT_FOUND (5), surfaced in modal-js for app/image/sandbox lookups.
   * Sources:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/app.ts#L46-L47
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/image.ts#L41-L42
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L462-L463
   */
  NOT_FOUND: 5,
  /**
   * gRPC ALREADY_EXISTS (6), surfaced in modal-js sandbox creation conflicts.
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/sandbox.ts#L437-L438
   */
  ALREADY_EXISTS: 6,
  /**
   * gRPC FAILED_PRECONDITION (9), used by modal-js image lookup fallback handling.
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/image.ts#L44-L47
   */
  FAILED_PRECONDITION: 9,
  /**
   * gRPC UNAUTHENTICATED (16), observed in modal-js auth refresh/retry handling.
   * Source:
   * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/task_command_router_client.ts#L461-L463
   */
  UNAUTHENTICATED: 16,
} as const;

const ErrorShapeSchema = z.looseObject({
  code: z.number().optional(),
  details: z.string().optional(),
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
    return "Unknown Modal SDK error.";
  }

  const details = errorShape.details;
  if (details !== undefined && details.length > 0) {
    return details;
  }

  const message = errorShape.message;
  if (message !== undefined && message.length > 0) {
    return message;
  }

  return "Unknown Modal SDK error.";
}

function formatOperationMessage(operation: ModalClientOperation, message: string): string {
  return `Modal operation \`${operation}\` failed: ${message}`;
}

function createMappedError(
  input: Omit<CreateModalClientErrorInput, "message"> & {
    sourceMessage: string;
  },
): ModalClientError {
  return new ModalClientError({
    code: input.code,
    operation: input.operation,
    retryable: input.retryable,
    message: formatOperationMessage(input.operation, input.sourceMessage),
    cause: input.cause,
  });
}

/**
 * modal-js treats FAILED_PRECONDITION with this message pattern as image-not-found.
 * Reference:
 * https://github.com/modal-labs/libmodal/blob/12a48ff63c32dcffa7267cbfbc3b8901db243cc9/modal-js/src/image.ts#L44-L48
 */
function isImageNotFoundPreconditionMessage(message: string): boolean {
  return message.includes("Could not find image with ID");
}

export function mapModalClientError(
  operation: ModalClientOperation,
  error: unknown,
): ModalClientError {
  if (error instanceof ModalClientError) {
    return error;
  }

  const errorShape = parseErrorShape(error);
  const sourceMessage = extractErrorMessage(error, errorShape);

  if (error instanceof ModalNotFoundError) {
    return createMappedError({
      code: ModalClientErrorCodes.NOT_FOUND,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof ModalAlreadyExistsError) {
    return createMappedError({
      code: ModalClientErrorCodes.ALREADY_EXISTS,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof ModalInvalidError) {
    return createMappedError({
      code: ModalClientErrorCodes.INVALID_ARGUMENT,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof ModalSandboxTimeoutError) {
    return createMappedError({
      code: ModalClientErrorCodes.TIMEOUT,
      operation,
      retryable: true,
      sourceMessage,
      cause: error,
    });
  }

  const grpcCode = errorShape?.code;
  if (grpcCode !== undefined) {
    if (grpcCode === GrpcStatusCodes.NOT_FOUND) {
      return createMappedError({
        code: ModalClientErrorCodes.NOT_FOUND,
        operation,
        retryable: false,
        sourceMessage,
        cause: error,
      });
    }

    if (grpcCode === GrpcStatusCodes.ALREADY_EXISTS) {
      return createMappedError({
        code: ModalClientErrorCodes.ALREADY_EXISTS,
        operation,
        retryable: false,
        sourceMessage,
        cause: error,
      });
    }

    if (grpcCode === GrpcStatusCodes.UNAUTHENTICATED) {
      return createMappedError({
        code: ModalClientErrorCodes.UNAUTHENTICATED,
        operation,
        retryable: false,
        sourceMessage,
        cause: error,
      });
    }

    if (
      grpcCode === GrpcStatusCodes.FAILED_PRECONDITION &&
      isImageNotFoundPreconditionMessage(sourceMessage)
    ) {
      return createMappedError({
        code: ModalClientErrorCodes.NOT_FOUND,
        operation,
        retryable: false,
        sourceMessage,
        cause: error,
      });
    }
  }

  return createMappedError({
    code: ModalClientErrorCodes.UNKNOWN,
    operation,
    retryable: false,
    sourceMessage,
    cause: error,
  });
}
