import { describe, expect, it } from "vitest";

import {
  DockerClientError,
  DockerClientErrorCodes,
  DockerClientOperationIds,
  mapDockerClientError,
} from "./client-errors.js";

describe("mapDockerClientError", () => {
  it("maps 404 not found status", () => {
    const mapped = mapDockerClientError(DockerClientOperationIds.RESOLVE_CONTAINER, {
      statusCode: 404,
      reason: "No such container",
    });

    expect(mapped).toBeInstanceOf(DockerClientError);
    expect(mapped.code).toBe(DockerClientErrorCodes.NOT_FOUND);
    expect(mapped.operation).toBe(DockerClientOperationIds.RESOLVE_CONTAINER);
    expect(mapped.retryable).toBe(false);
  });

  it("maps 409 conflict status", () => {
    const mapped = mapDockerClientError(DockerClientOperationIds.REMOVE_CONTAINER, {
      statusCode: 409,
      message: "container is paused",
    });

    expect(mapped.code).toBe(DockerClientErrorCodes.CONFLICT);
    expect(mapped.operation).toBe(DockerClientOperationIds.REMOVE_CONTAINER);
    expect(mapped.retryable).toBe(false);
  });

  it("maps 400 invalid argument status", () => {
    const mapped = mapDockerClientError(DockerClientOperationIds.CREATE_CONTAINER, {
      statusCode: 400,
      reason: "invalid image reference",
    });

    expect(mapped.code).toBe(DockerClientErrorCodes.INVALID_ARGUMENT);
    expect(mapped.operation).toBe(DockerClientOperationIds.CREATE_CONTAINER);
    expect(mapped.retryable).toBe(false);
  });

  it("maps 401 unauthenticated status", () => {
    const mapped = mapDockerClientError(DockerClientOperationIds.PUSH_IMAGE, {
      statusCode: 401,
      reason: "authentication required",
    });

    expect(mapped.code).toBe(DockerClientErrorCodes.UNAUTHENTICATED);
    expect(mapped.operation).toBe(DockerClientOperationIds.PUSH_IMAGE);
    expect(mapped.retryable).toBe(false);
  });

  it("maps unknown error shapes to unknown", () => {
    const mapped = mapDockerClientError(
      DockerClientOperationIds.PULL_IMAGE,
      new Error("unexpected docker failure"),
    );

    expect(mapped.code).toBe(DockerClientErrorCodes.UNKNOWN);
    expect(mapped.operation).toBe(DockerClientOperationIds.PULL_IMAGE);
    expect(mapped.retryable).toBe(false);
  });
});
