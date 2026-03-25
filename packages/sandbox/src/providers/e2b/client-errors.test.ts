import {
  AuthenticationError,
  BuildError,
  CommandExitError,
  InvalidArgumentError,
  RateLimitError,
  SandboxNotFoundError,
  TemplateError,
} from "e2b";
import { describe, expect, it } from "vitest";

import {
  E2BClientError,
  E2BClientErrorCodes,
  E2BClientOperationIds,
  mapE2BClientError,
} from "./client-errors.js";

describe("mapE2BClientError", () => {
  it("maps sandbox not found errors", () => {
    const mapped = mapE2BClientError(
      E2BClientOperationIds.CONNECT_SANDBOX,
      new SandboxNotFoundError("sandbox missing"),
    );

    expect(mapped).toBeInstanceOf(E2BClientError);
    expect(mapped.code).toBe(E2BClientErrorCodes.NOT_FOUND);
    expect(mapped.operation).toBe(E2BClientOperationIds.CONNECT_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });

  it("maps invalid argument errors", () => {
    const mapped = mapE2BClientError(
      E2BClientOperationIds.CONNECT_SANDBOX,
      new InvalidArgumentError("invalid sandbox id"),
    );

    expect(mapped.code).toBe(E2BClientErrorCodes.INVALID_ARGUMENT);
    expect(mapped.operation).toBe(E2BClientOperationIds.CONNECT_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });

  it("maps authentication errors", () => {
    const mapped = mapE2BClientError(
      E2BClientOperationIds.CREATE_SANDBOX,
      new AuthenticationError("bad api key"),
    );

    expect(mapped.code).toBe(E2BClientErrorCodes.UNAUTHENTICATED);
    expect(mapped.operation).toBe(E2BClientOperationIds.CREATE_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });

  it("maps rate limit errors", () => {
    const mapped = mapE2BClientError(
      E2BClientOperationIds.CREATE_SANDBOX,
      new RateLimitError("too many requests"),
    );

    expect(mapped.code).toBe(E2BClientErrorCodes.RATE_LIMITED);
    expect(mapped.operation).toBe(E2BClientOperationIds.CREATE_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });

  it("maps template errors", () => {
    const mapped = mapE2BClientError(
      E2BClientOperationIds.RESOLVE_TEMPLATE_ALIAS,
      new TemplateError("template is outdated"),
    );

    expect(mapped.code).toBe(E2BClientErrorCodes.TEMPLATE_ERROR);
    expect(mapped.operation).toBe(E2BClientOperationIds.RESOLVE_TEMPLATE_ALIAS);
    expect(mapped.retryable).toBe(false);
  });

  it("maps build errors", () => {
    const mapped = mapE2BClientError(
      E2BClientOperationIds.RESOLVE_TEMPLATE_ALIAS,
      new BuildError("build failed"),
    );

    expect(mapped.code).toBe(E2BClientErrorCodes.BUILD_ERROR);
    expect(mapped.operation).toBe(E2BClientOperationIds.RESOLVE_TEMPLATE_ALIAS);
    expect(mapped.retryable).toBe(false);
  });

  it("maps command exit errors", () => {
    const mapped = mapE2BClientError(
      E2BClientOperationIds.APPLY_STARTUP,
      new CommandExitError({
        exitCode: 17,
        error: "startup failed",
        stdout: "out",
        stderr: "err",
      }),
    );

    expect(mapped.code).toBe(E2BClientErrorCodes.COMMAND_EXIT);
    expect(mapped.operation).toBe(E2BClientOperationIds.APPLY_STARTUP);
    expect(mapped.retryable).toBe(false);
  });

  it("passes through existing client errors", () => {
    const error = new E2BClientError({
      code: E2BClientErrorCodes.UNKNOWN,
      operation: E2BClientOperationIds.CREATE_SANDBOX,
      retryable: false,
      message: "already mapped",
      cause: new Error("boom"),
    });

    expect(mapE2BClientError(E2BClientOperationIds.CONNECT_SANDBOX, error)).toBe(error);
  });

  it("maps unknown errors to unknown", () => {
    const mapped = mapE2BClientError(E2BClientOperationIds.KILL_SANDBOX, new Error("unexpected"));

    expect(mapped.code).toBe(E2BClientErrorCodes.UNKNOWN);
    expect(mapped.operation).toBe(E2BClientOperationIds.KILL_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });
});
