import {
  AuthenticationError,
  BuildError,
  CommandExitError,
  InvalidArgumentError,
  RateLimitError,
  SandboxNotFoundError,
  TemplateError,
} from "e2b";

import { SandboxError } from "../../errors.js";

export const E2BClientOperationIds = {
  /**
   * `Template.exists(...)` and `Template.build(...)`.
   * Sources:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/template/index.ts#L288-L292
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/template/index.ts#L152-L170
   */
  RESOLVE_TEMPLATE_ALIAS: "resolve_template_alias",
  /**
   * `Sandbox.create(...)`.
   * Source:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/index.ts#L268-L275
   */
  CREATE_SANDBOX: "create_sandbox",
  /**
   * `Sandbox.connect(...)`.
   * Source:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/index.ts#L444-L453
   */
  CONNECT_SANDBOX: "connect_sandbox",
  /**
   * `sandbox.pause()`.
   * Source:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/index.ts#L588-L589
   */
  PAUSE_SANDBOX: "pause_sandbox",
  /**
   * `sandbox.kill()`.
   * Source:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/index.ts#L566-L572
   */
  KILL_SANDBOX: "kill_sandbox",
  /**
   * `sandbox.commands.run(...)` and `CommandHandle.wait()` for `/usr/bin/tini -- /usr/local/bin/sandboxd serve`,
   * plus readiness probes executed through `sandbox.commands.run(...)`.
   * Sources:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/commands/index.ts#L411-L469
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L193-L203
   */
  ENSURE_SUPERVISOR_READY: "ensure_supervisor_ready",
  /**
   * `sandbox.commands.run(...)`, `sendStdin(...)`, `closeStdin(...)`, and `handle.wait()`.
   * Sources:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/commands/index.ts#L411-L469
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/commands/index.ts#L187-L210
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/commands/index.ts#L224-L240
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L193-L203
   */
  APPLY_STARTUP: "apply_startup",
} as const;
export type E2BClientOperation = (typeof E2BClientOperationIds)[keyof typeof E2BClientOperationIds];

export const E2BClientErrorCodes = {
  /**
   * Backed by `Sandbox.connect(...)` and `SandboxApi.pause(...)` explicit 404 handling.
   * Sources:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/sandboxApi.ts#L824-L830
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/errors.ts#L86-L90
   */
  NOT_FOUND: "not_found",
  /**
   * Backed by envd RPC/API mappings for 400 / invalid argument.
   * Sources:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/envd/api.ts#L21-L27
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/envd/rpc.ts#L16-L24
   */
  INVALID_ARGUMENT: "invalid_argument",
  /**
   * Backed by `handleApiError(...)` 401 handling.
   * Source:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/api/index.ts#L20-L31
   */
  UNAUTHENTICATED: "unauthenticated",
  /**
   * Backed by `handleApiError(...)` 429 handling.
   * Source:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/api/index.ts#L33-L41
   */
  RATE_LIMITED: "rate_limited",
  /**
   * Backed by template alias/build APIs throwing `TemplateError`.
   * Sources:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/template/buildApi.ts#L247-L250
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/errors.ts#L126-L130
   */
  TEMPLATE_ERROR: "template_error",
  /**
   * Backed by template build/file upload APIs throwing `BuildError` / `FileUploadError`.
   * Sources:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/template/buildApi.ts#L56-L59
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/errors.ts#L146-L151
   */
  BUILD_ERROR: "build_error",
  /**
   * Backed by `CommandHandle.wait()` throwing `CommandExitError` for non-zero exits.
   * Sources:
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L39-L63
   * https://github.com/e2b-dev/E2B/blob/a240f99db52396306857b7fc9a07c225ac7d5221/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L193-L203
   */
  COMMAND_EXIT: "command_exit",
  /**
   * Default for SDK errors without a narrower class-specific mapping.
   */
  UNKNOWN: "unknown",
} as const;
export type E2BClientErrorCode = (typeof E2BClientErrorCodes)[keyof typeof E2BClientErrorCodes];

type CreateE2BClientErrorInput = {
  code: E2BClientErrorCode;
  operation: E2BClientOperation;
  retryable: boolean;
  message: string;
  cause: unknown;
};

export class E2BClientError extends SandboxError {
  readonly code: E2BClientErrorCode;
  readonly operation: E2BClientOperation;
  readonly retryable: boolean;

  constructor(input: CreateE2BClientErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "E2BClientError";
    this.code = input.code;
    this.operation = input.operation;
    this.retryable = input.retryable;
  }
}

function formatOperationMessage(operation: E2BClientOperation, message: string): string {
  return `E2B operation \`${operation}\` failed: ${message}`;
}

function createMappedError(input: {
  code: E2BClientErrorCode;
  operation: E2BClientOperation;
  retryable: boolean;
  sourceMessage: string;
  cause: unknown;
}): E2BClientError {
  return new E2BClientError({
    code: input.code,
    operation: input.operation,
    retryable: input.retryable,
    message: formatOperationMessage(input.operation, input.sourceMessage),
    cause: input.cause,
  });
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Unknown E2B SDK error.";
}

export function mapE2BClientError(operation: E2BClientOperation, error: unknown): E2BClientError {
  if (error instanceof E2BClientError) {
    return error;
  }

  const sourceMessage = extractErrorMessage(error);

  if (error instanceof SandboxNotFoundError) {
    return createMappedError({
      code: E2BClientErrorCodes.NOT_FOUND,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof InvalidArgumentError) {
    return createMappedError({
      code: E2BClientErrorCodes.INVALID_ARGUMENT,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof AuthenticationError) {
    return createMappedError({
      code: E2BClientErrorCodes.UNAUTHENTICATED,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof RateLimitError) {
    return createMappedError({
      code: E2BClientErrorCodes.RATE_LIMITED,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof TemplateError) {
    return createMappedError({
      code: E2BClientErrorCodes.TEMPLATE_ERROR,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof BuildError) {
    return createMappedError({
      code: E2BClientErrorCodes.BUILD_ERROR,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  if (error instanceof CommandExitError) {
    return createMappedError({
      code: E2BClientErrorCodes.COMMAND_EXIT,
      operation,
      retryable: false,
      sourceMessage,
      cause: error,
    });
  }

  return createMappedError({
    code: E2BClientErrorCodes.UNKNOWN,
    operation,
    retryable: false,
    sourceMessage,
    cause: error,
  });
}
