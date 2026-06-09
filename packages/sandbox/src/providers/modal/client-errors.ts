import { AlreadyExistsError, NotFoundError, SandboxTimeoutError, TimeoutError } from "modal";

import { SandboxError } from "../../errors.js";

export const ModalClientOperationIds = {
  BUILD_BASE_IMAGE: "build_base_image",
  CREATE_SANDBOX: "create_sandbox",
  GET_SANDBOX_INFO: "get_sandbox_info",
  RESUME_SANDBOX: "resume_sandbox",
  CREATE_SNAPSHOT: "create_snapshot",
  TERMINATE_SANDBOX: "terminate_sandbox",
  ACTIVATE: "activate",
  ENSURE_SANDBOXD: "ensure_sandboxd",
  SHUTDOWN_SANDBOXD: "shutdown_sandboxd",
  STOP_SANDBOXD_DAEMON: "stop_sandboxd_daemon",
  RESET_TRANSPARENT_EGRESS_NFTABLES: "reset_transparent_egress_nftables",
  READ_SANDBOXD_VERSION: "read_sandboxd_version",
  READ_OPERATION_LOG: "read_operation_log",
  RUN_COMMAND: "run_command",
} as const;
export type ModalClientOperation =
  (typeof ModalClientOperationIds)[keyof typeof ModalClientOperationIds];

export const ModalClientErrorCodes = {
  NOT_FOUND: "not_found",
  ALREADY_EXISTS: "already_exists",
  TIMEOUT: "timeout",
  COMMAND_EXIT: "command_exit",
  UNKNOWN: "unknown",
} as const;
export type ModalClientErrorCode =
  (typeof ModalClientErrorCodes)[keyof typeof ModalClientErrorCodes];

export class ModalClientError extends SandboxError {
  readonly code: ModalClientErrorCode;
  readonly operation: ModalClientOperation;
  readonly retryable: boolean;

  constructor(input: {
    code: ModalClientErrorCode;
    operation: ModalClientOperation;
    retryable: boolean;
    message: string;
    cause: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "ModalClientError";
    this.code = input.code;
    this.operation = input.operation;
    this.retryable = input.retryable;
  }
}

export class ModalCommandExitError extends ModalClientError {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: {
    operation: ModalClientOperation;
    commandDescription: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }) {
    super({
      code: ModalClientErrorCodes.COMMAND_EXIT,
      operation: input.operation,
      retryable: false,
      message: `Modal operation \`${input.operation}\` failed: ${input.commandDescription} exited with code ${String(input.exitCode)}.${formatCommandOutput(
        {
          stdout: input.stdout,
          stderr: input.stderr,
        },
      )}`,
      cause: undefined,
    });
    this.name = "ModalCommandExitError";
    this.exitCode = input.exitCode;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
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
  return "Unknown Modal SDK error.";
}

function createMappedError(input: {
  code: ModalClientErrorCode;
  operation: ModalClientOperation;
  retryable: boolean;
  cause: unknown;
}): ModalClientError {
  return new ModalClientError({
    code: input.code,
    operation: input.operation,
    retryable: input.retryable,
    message: `Modal operation \`${input.operation}\` failed: ${extractErrorMessage(input.cause)}`,
    cause: input.cause,
  });
}

export function mapModalClientError(
  operation: ModalClientOperation,
  error: unknown,
): ModalClientError {
  if (error instanceof ModalClientError) {
    return error;
  }

  if (error instanceof NotFoundError) {
    return createMappedError({
      code: ModalClientErrorCodes.NOT_FOUND,
      operation,
      retryable: false,
      cause: error,
    });
  }

  if (error instanceof AlreadyExistsError) {
    return createMappedError({
      code: ModalClientErrorCodes.ALREADY_EXISTS,
      operation,
      retryable: false,
      cause: error,
    });
  }

  if (error instanceof TimeoutError || error instanceof SandboxTimeoutError) {
    return createMappedError({
      code: ModalClientErrorCodes.TIMEOUT,
      operation,
      retryable: true,
      cause: error,
    });
  }

  return createMappedError({
    code: ModalClientErrorCodes.UNKNOWN,
    operation,
    retryable: false,
    cause: error,
  });
}
