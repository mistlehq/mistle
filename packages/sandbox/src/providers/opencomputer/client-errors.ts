import { SandboxError } from "../../errors.js";

export const OpenComputerClientOperationIds = {
  BUILD_BASE_IMAGE: "build_base_image",
  PREPARE_IMAGE: "prepare_image",
  CREATE_SANDBOX: "create_sandbox",
  GET_SANDBOX_INFO: "get_sandbox_info",
  RESUME_SANDBOX: "resume_sandbox",
  CREATE_CHECKPOINT: "create_checkpoint",
  HIBERNATE_SANDBOX: "hibernate_sandbox",
  DELETE_SANDBOX: "delete_sandbox",
  RUN_COMMAND: "run_command",
  ACTIVATE: "activate",
  ENSURE_SANDBOXD: "ensure_sandboxd",
  SHUTDOWN_SANDBOXD: "shutdown_sandboxd",
  STOP_SANDBOXD_DAEMON: "stop_sandboxd_daemon",
  RESET_TRANSPARENT_EGRESS_NFTABLES: "reset_transparent_egress_nftables",
  READ_SANDBOXD_VERSION: "read_sandboxd_version",
  READ_OPERATION_LOG: "read_operation_log",
  WRITE_FILE: "write_file",
} as const;
export type OpenComputerClientOperation =
  (typeof OpenComputerClientOperationIds)[keyof typeof OpenComputerClientOperationIds];

export const OpenComputerClientErrorCodes = {
  NOT_FOUND: "not_found",
  ALREADY_EXISTS: "already_exists",
  INVALID_ARGUMENT: "invalid_argument",
  PAYMENT_REQUIRED: "payment_required",
  UNAUTHENTICATED: "unauthenticated",
  RATE_LIMITED: "rate_limited",
  COMMAND_EXIT: "command_exit",
  REMOTE_API: "remote_api",
  TRANSPORT: "transport",
  UNKNOWN: "unknown",
} as const;
export type OpenComputerClientErrorCode =
  (typeof OpenComputerClientErrorCodes)[keyof typeof OpenComputerClientErrorCodes];

export class OpenComputerClientError extends SandboxError {
  readonly code: OpenComputerClientErrorCode;
  readonly operation: OpenComputerClientOperation;
  readonly retryable: boolean;

  constructor(input: {
    code: OpenComputerClientErrorCode;
    operation: OpenComputerClientOperation;
    retryable: boolean;
    message: string;
    cause: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "OpenComputerClientError";
    this.code = input.code;
    this.operation = input.operation;
    this.retryable = input.retryable;
  }
}

export class OpenComputerCommandExitError extends OpenComputerClientError {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: {
    operation: OpenComputerClientOperation;
    commandDescription: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }) {
    super({
      code: OpenComputerClientErrorCodes.COMMAND_EXIT,
      operation: input.operation,
      retryable: false,
      message: `OpenComputer operation \`${input.operation}\` failed: ${input.commandDescription} exited with code ${String(input.exitCode)}.${formatCommandOutput(
        {
          stdout: input.stdout,
          stderr: input.stderr,
        },
      )}`,
      cause: undefined,
    });
    this.name = "OpenComputerCommandExitError";
    this.exitCode = input.exitCode;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
}

export class OpenComputerHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(input: { status: number; body: string }) {
    super(formatHttpErrorMessage(input));
    this.name = "OpenComputerHttpError";
    this.status = input.status;
    this.body = input.body;
  }
}

export function mapOpenComputerClientError(
  operation: OpenComputerClientOperation,
  error: unknown,
): OpenComputerClientError {
  if (error instanceof OpenComputerClientError) {
    return error;
  }

  if (error instanceof OpenComputerHttpError) {
    if (error.status === 400) {
      return createMappedError({
        code: OpenComputerClientErrorCodes.INVALID_ARGUMENT,
        operation,
        retryable: false,
        sourceMessage: error.message,
        cause: error,
      });
    }
    if (error.status === 401 || error.status === 403) {
      return createMappedError({
        code: OpenComputerClientErrorCodes.UNAUTHENTICATED,
        operation,
        retryable: false,
        sourceMessage: error.message,
        cause: error,
      });
    }
    if (error.status === 402) {
      return createMappedError({
        code: OpenComputerClientErrorCodes.PAYMENT_REQUIRED,
        operation,
        retryable: false,
        sourceMessage: error.message,
        cause: error,
      });
    }
    if (error.status === 404) {
      return createMappedError({
        code: OpenComputerClientErrorCodes.NOT_FOUND,
        operation,
        retryable: false,
        sourceMessage: error.message,
        cause: error,
      });
    }
    if (error.status === 409) {
      return createMappedError({
        code: OpenComputerClientErrorCodes.ALREADY_EXISTS,
        operation,
        retryable: false,
        sourceMessage: error.message,
        cause: error,
      });
    }
    if (error.status === 429) {
      return createMappedError({
        code: OpenComputerClientErrorCodes.RATE_LIMITED,
        operation,
        retryable: true,
        sourceMessage: error.message,
        cause: error,
      });
    }
    return createMappedError({
      code: OpenComputerClientErrorCodes.REMOTE_API,
      operation,
      retryable: error.status >= 500,
      sourceMessage: error.message,
      cause: error,
    });
  }

  return createMappedError({
    code: OpenComputerClientErrorCodes.UNKNOWN,
    operation,
    retryable: false,
    sourceMessage:
      error instanceof Error && error.message.length > 0 ? error.message : String(error),
    cause: error,
  });
}

function createMappedError(input: {
  code: OpenComputerClientErrorCode;
  operation: OpenComputerClientOperation;
  retryable: boolean;
  sourceMessage: string;
  cause: unknown;
}): OpenComputerClientError {
  return new OpenComputerClientError({
    code: input.code,
    operation: input.operation,
    retryable: input.retryable,
    message: `OpenComputer operation \`${input.operation}\` failed: ${input.sourceMessage}`,
    cause: input.cause,
  });
}

function formatHttpErrorMessage(input: { status: number; body: string }): string {
  const body = input.body.trim().slice(0, 500);
  return `OpenComputer API returned HTTP ${String(input.status)}.${body.length === 0 ? "" : ` ${body}`}`;
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
