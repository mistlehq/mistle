import {
  AlreadyExistsError as ModalAlreadyExistsError,
  InvalidError as ModalInvalidError,
  NotFoundError as ModalNotFoundError,
  SandboxTimeoutError as ModalSandboxTimeoutError,
} from "modal";
import { describe, expect, it } from "vitest";

import {
  ModalClientError,
  ModalClientErrorCodes,
  ModalClientOperationIds,
  mapModalClientError,
} from "./client-errors.js";

describe("mapModalClientError", () => {
  it("maps modal not found errors", () => {
    const mapped = mapModalClientError(
      ModalClientOperationIds.RESOLVE_IMAGE,
      new ModalNotFoundError("image missing"),
    );

    expect(mapped).toBeInstanceOf(ModalClientError);
    expect(mapped.code).toBe(ModalClientErrorCodes.NOT_FOUND);
    expect(mapped.operation).toBe(ModalClientOperationIds.RESOLVE_IMAGE);
    expect(mapped.retryable).toBe(false);
  });

  it("maps modal already exists errors", () => {
    const mapped = mapModalClientError(
      ModalClientOperationIds.START_SANDBOX,
      new ModalAlreadyExistsError("sandbox exists"),
    );

    expect(mapped.code).toBe(ModalClientErrorCodes.ALREADY_EXISTS);
    expect(mapped.operation).toBe(ModalClientOperationIds.START_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });

  it("maps modal invalid errors", () => {
    const mapped = mapModalClientError(
      ModalClientOperationIds.START_SANDBOX,
      new ModalInvalidError("invalid request"),
    );

    expect(mapped.code).toBe(ModalClientErrorCodes.INVALID_ARGUMENT);
    expect(mapped.operation).toBe(ModalClientOperationIds.START_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });

  it("maps modal timeout errors", () => {
    const mapped = mapModalClientError(
      ModalClientOperationIds.START_SANDBOX,
      new ModalSandboxTimeoutError("operation timed out"),
    );

    expect(mapped.code).toBe(ModalClientErrorCodes.TIMEOUT);
    expect(mapped.operation).toBe(ModalClientOperationIds.START_SANDBOX);
    expect(mapped.retryable).toBe(true);
  });

  it("maps grpc unauthenticated status", () => {
    const mapped = mapModalClientError(ModalClientOperationIds.START_SANDBOX, {
      code: 16,
      details: "invalid token",
    });

    expect(mapped.code).toBe(ModalClientErrorCodes.UNAUTHENTICATED);
    expect(mapped.operation).toBe(ModalClientOperationIds.START_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });

  it("maps image not found failed precondition status to not found", () => {
    const mapped = mapModalClientError(ModalClientOperationIds.RESOLVE_IMAGE, {
      code: 9,
      details: "Could not find image with ID im-123",
    });

    expect(mapped.code).toBe(ModalClientErrorCodes.NOT_FOUND);
    expect(mapped.operation).toBe(ModalClientOperationIds.RESOLVE_IMAGE);
    expect(mapped.retryable).toBe(false);
  });

  it("maps non-evidenced grpc statuses to unknown", () => {
    const mapped = mapModalClientError(ModalClientOperationIds.STOP_SANDBOX, {
      code: 14,
      details: "upstream unavailable",
    });

    expect(mapped.code).toBe(ModalClientErrorCodes.UNKNOWN);
    expect(mapped.operation).toBe(ModalClientOperationIds.STOP_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });

  it("maps unknown errors to unknown code", () => {
    const mapped = mapModalClientError(
      ModalClientOperationIds.START_SANDBOX,
      new Error("unexpected failure"),
    );

    expect(mapped.code).toBe(ModalClientErrorCodes.UNKNOWN);
    expect(mapped.operation).toBe(ModalClientOperationIds.START_SANDBOX);
    expect(mapped.retryable).toBe(false);
  });
});
