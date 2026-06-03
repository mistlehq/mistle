import {
  RemoteAPIError,
  SandboxError as TensorlakeSandboxError,
  SandboxNotFoundError,
} from "tensorlake";

import { SandboxError } from "../../errors.js";

export const TensorlakeClientOperationIds = {
  CREATE_SANDBOX: "create_sandbox",
  GET_SANDBOX_INFO: "get_sandbox_info",
  RESUME_SANDBOX: "resume_sandbox",
  CREATE_SNAPSHOT: "create_snapshot",
  SUSPEND_SANDBOX: "suspend_sandbox",
  TERMINATE_SANDBOX: "terminate_sandbox",
  ACTIVATE: "activate",
  ENSURE_SANDBOXD: "ensure_sandboxd",
  STOP_SANDBOXD_DAEMON: "stop_sandboxd_daemon",
  RESET_TRANSPARENT_EGRESS_NFTABLES: "reset_transparent_egress_nftables",
  READ_SANDBOXD_VERSION: "read_sandboxd_version",
  READ_OPERATION_LOG: "read_operation_log",
  RUN_COMMAND: "run_command",
  BUILD_BASE_IMAGE: "build_base_image",
} as const;
export type TensorlakeClientOperation =
  (typeof TensorlakeClientOperationIds)[keyof typeof TensorlakeClientOperationIds];

export const TensorlakeClientErrorCodes = {
  NOT_FOUND: "not_found",
  INVALID_ARGUMENT: "invalid_argument",
  UNAUTHENTICATED: "unauthenticated",
  RATE_LIMITED: "rate_limited",
  COMMAND_EXIT: "command_exit",
  REMOTE_API: "remote_api",
  UNKNOWN: "unknown",
} as const;
export type TensorlakeClientErrorCode =
  (typeof TensorlakeClientErrorCodes)[keyof typeof TensorlakeClientErrorCodes];

type CreateTensorlakeClientErrorInput = {
  code: TensorlakeClientErrorCode;
  operation: TensorlakeClientOperation;
  retryable: boolean;
  message: string;
  cause: unknown;
};

export class TensorlakeClientError extends SandboxError {
  readonly code: TensorlakeClientErrorCode;
  readonly operation: TensorlakeClientOperation;
  readonly retryable: boolean;

  constructor(input: CreateTensorlakeClientErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "TensorlakeClientError";
    this.code = input.code;
    this.operation = input.operation;
    this.retryable = input.retryable;
  }
}

export class TensorlakeCommandExitError extends TensorlakeClientError {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: {
    operation: TensorlakeClientOperation;
    commandDescription: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }) {
    super({
      code: TensorlakeClientErrorCodes.COMMAND_EXIT,
      operation: input.operation,
      retryable: false,
      message: `Tensorlake operation \`${input.operation}\` failed: ${input.commandDescription} exited with code ${String(input.exitCode)}.${formatCommandOutput(
        {
          stdout: input.stdout,
          stderr: input.stderr,
        },
      )}`,
      cause: undefined,
    });
    this.name = "TensorlakeCommandExitError";
    this.exitCode = input.exitCode;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
}

export function isTensorlakeRemoteApiStatusCode(
  error: unknown,
  statusCode: number,
): error is RemoteAPIError {
  return error instanceof RemoteAPIError && error.statusCode === statusCode;
}

function formatCommandOutput(input: { stdout: string; stderr: string }): string {
  const outputs: string[] = [];
  const trimmedStdout = input.stdout.trim();
  const trimmedStderr = input.stderr.trim();

  if (trimmedStdout.length > 0) {
    outputs.push(`stdout: ${trimmedStdout}`);
  }
  if (trimmedStderr.length > 0) {
    outputs.push(`stderr: ${trimmedStderr}`);
  }

  return outputs.length === 0 ? "" : ` ${outputs.join(" ")}`;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Unknown Tensorlake SDK error.";
}

function createMappedError(input: {
  code: TensorlakeClientErrorCode;
  operation: TensorlakeClientOperation;
  retryable: boolean;
  sourceMessage: string;
  cause: unknown;
}): TensorlakeClientError {
  return new TensorlakeClientError({
    code: input.code,
    operation: input.operation,
    retryable: input.retryable,
    message: `Tensorlake operation \`${input.operation}\` failed: ${input.sourceMessage}`,
    cause: input.cause,
  });
}

export function mapTensorlakeClientError(
  operation: TensorlakeClientOperation,
  error: unknown,
): TensorlakeClientError {
  if (error instanceof TensorlakeClientError) {
    return error;
  }

  const sourceMessage = extractErrorMessage(error);

  if (error instanceof SandboxNotFoundError) {
    return createMappedError({
      code: TensorlakeClientErrorCodes.NOT_FOUND,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof RemoteAPIError) {
    if (error.statusCode === 400) {
      return createMappedError({
        code: TensorlakeClientErrorCodes.INVALID_ARGUMENT,
        operation,
        retryable: false,
        sourceMessage,
        cause: error,
      });
    }

    if (error.statusCode === 401 || error.statusCode === 403) {
      return createMappedError({
        code: TensorlakeClientErrorCodes.UNAUTHENTICATED,
        operation,
        retryable: false,
        sourceMessage,
        cause: error,
      });
    }

    if (error.statusCode === 404) {
      return createMappedError({
        code: TensorlakeClientErrorCodes.NOT_FOUND,
        operation,
        retryable: false,
        sourceMessage,
        cause: error,
      });
    }

    if (error.statusCode === 429) {
      return createMappedError({
        code: TensorlakeClientErrorCodes.RATE_LIMITED,
        operation,
        retryable: false,
        sourceMessage,
        cause: error,
      });
    }

    return createMappedError({
      code: TensorlakeClientErrorCodes.REMOTE_API,
      operation,
      retryable: error.statusCode >= 500,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof TensorlakeSandboxError) {
    return createMappedError({
      code: TensorlakeClientErrorCodes.REMOTE_API,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  return createMappedError({
    code: TensorlakeClientErrorCodes.UNKNOWN,
    operation,
    retryable: false,
    sourceMessage,
    cause: error,
  });
}
