import { SandboxError } from "../../errors.js";

export const FreestyleClientOperationIds = {
  BUILD_BASE_IMAGE: "build_base_image",
  CREATE_SANDBOX: "create_sandbox",
  GET_SANDBOX_INFO: "get_sandbox_info",
  RESUME_SANDBOX: "resume_sandbox",
  CREATE_SNAPSHOT: "create_snapshot",
  SUSPEND_SANDBOX: "suspend_sandbox",
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
export type FreestyleClientOperation =
  (typeof FreestyleClientOperationIds)[keyof typeof FreestyleClientOperationIds];

export const FreestyleClientErrorCodes = {
  NOT_FOUND: "not_found",
  INVALID_ARGUMENT: "invalid_argument",
  UNAUTHENTICATED: "unauthenticated",
  RATE_LIMITED: "rate_limited",
  COMMAND_EXIT: "command_exit",
  REMOTE_API: "remote_api",
  UNKNOWN: "unknown",
} as const;
export type FreestyleClientErrorCode =
  (typeof FreestyleClientErrorCodes)[keyof typeof FreestyleClientErrorCodes];

export class FreestyleClientError extends SandboxError {
  readonly code: FreestyleClientErrorCode;
  readonly operation: FreestyleClientOperation;
  readonly retryable: boolean;

  constructor(input: {
    code: FreestyleClientErrorCode;
    operation: FreestyleClientOperation;
    retryable: boolean;
    message: string;
    cause: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "FreestyleClientError";
    this.code = input.code;
    this.operation = input.operation;
    this.retryable = input.retryable;
  }
}

export class FreestyleCommandExitError extends FreestyleClientError {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: {
    operation: FreestyleClientOperation;
    commandDescription: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }) {
    super({
      code: FreestyleClientErrorCodes.COMMAND_EXIT,
      operation: input.operation,
      retryable: false,
      message: `Freestyle operation \`${input.operation}\` failed: ${input.commandDescription} exited with code ${String(input.exitCode)}.${formatCommandOutput(
        {
          stdout: input.stdout,
          stderr: input.stderr,
        },
      )}`,
      cause: undefined,
    });
    this.name = "FreestyleCommandExitError";
    this.exitCode = input.exitCode;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
}

export class FreestyleHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly providerErrorCode: string | null;

  constructor(input: { status: number; body: string; providerErrorCode: string | null }) {
    super(formatHttpErrorMessage(input));
    this.name = "FreestyleHttpError";
    this.status = input.status;
    this.body = input.body;
    this.providerErrorCode = input.providerErrorCode;
  }
}

export function mapFreestyleClientError(
  operation: FreestyleClientOperation,
  error: unknown,
): FreestyleClientError {
  if (error instanceof FreestyleClientError) {
    return error;
  }

  if (error instanceof FreestyleHttpError) {
    if (error.status === 400) {
      return createMappedError({
        code: FreestyleClientErrorCodes.INVALID_ARGUMENT,
        operation,
        retryable: false,
        sourceMessage: error.message,
        cause: error,
      });
    }
    if (error.status === 401 || error.status === 403) {
      return createMappedError({
        code: FreestyleClientErrorCodes.UNAUTHENTICATED,
        operation,
        retryable: false,
        sourceMessage: error.message,
        cause: error,
      });
    }
    if (error.status === 404) {
      return createMappedError({
        code: FreestyleClientErrorCodes.NOT_FOUND,
        operation,
        retryable: false,
        sourceMessage: error.message,
        cause: error,
      });
    }
    if (error.status === 429) {
      return createMappedError({
        code: FreestyleClientErrorCodes.RATE_LIMITED,
        operation,
        retryable: true,
        sourceMessage: error.message,
        cause: error,
      });
    }
    return createMappedError({
      code: FreestyleClientErrorCodes.REMOTE_API,
      operation,
      retryable: error.status >= 500,
      sourceMessage: error.message,
      cause: error,
    });
  }

  return createMappedError({
    code: FreestyleClientErrorCodes.UNKNOWN,
    operation,
    retryable: false,
    sourceMessage:
      error instanceof Error && error.message.length > 0 ? error.message : String(error),
    cause: error,
  });
}

function createMappedError(input: {
  code: FreestyleClientErrorCode;
  operation: FreestyleClientOperation;
  retryable: boolean;
  sourceMessage: string;
  cause: unknown;
}): FreestyleClientError {
  return new FreestyleClientError({
    code: input.code,
    operation: input.operation,
    retryable: input.retryable,
    message: `Freestyle operation \`${input.operation}\` failed: ${input.sourceMessage}`,
    cause: input.cause,
  });
}

function formatHttpErrorMessage(input: {
  status: number;
  body: string;
  providerErrorCode: string | null;
}): string {
  const code = input.providerErrorCode === null ? "" : ` ${input.providerErrorCode}:`;
  const body = input.body.trim().slice(0, 500);
  return `Freestyle API returned HTTP ${String(input.status)}.${code}${body.length === 0 ? "" : ` ${body}`}`;
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
