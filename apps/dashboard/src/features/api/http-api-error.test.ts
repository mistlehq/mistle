import { describe, expect, it } from "vitest";

import {
  HttpApiError,
  isUnavailableResourceError,
  stopUnavailableResourceRefetchInterval,
} from "./http-api-error.js";

describe("isUnavailableResourceError", () => {
  it("recognizes HTTP API 404 errors as unavailable resources", () => {
    const error = new HttpApiError({
      operation: "getResource",
      status: 404,
      body: { code: "NOT_FOUND", message: "Resource was not found." },
      message: "Resource was not found.",
    });

    expect(isUnavailableResourceError(error)).toBe(true);
  });

  it("does not classify permission-denied actions as unavailable resources", () => {
    const error = new HttpApiError({
      operation: "deleteResource",
      status: 403,
      body: { code: "FORBIDDEN", message: "Permission denied." },
      message: "Permission denied.",
    });

    expect(isUnavailableResourceError(error)).toBe(false);
  });
});

describe("stopUnavailableResourceRefetchInterval", () => {
  it("stops polling after an unavailable resource error", () => {
    const error = new HttpApiError({
      operation: "getResource",
      status: 404,
      body: { code: "NOT_FOUND", message: "Resource was not found." },
      message: "Resource was not found.",
    });

    expect(
      stopUnavailableResourceRefetchInterval({
        error,
        refetchInterval: 1_000,
      }),
    ).toBe(false);
  });

  it("keeps the resolved polling interval for non-unavailable errors", () => {
    const error = new HttpApiError({
      operation: "getResource",
      status: 500,
      body: null,
      message: "Resource failed to load.",
    });

    expect(
      stopUnavailableResourceRefetchInterval({
        error,
        refetchInterval: 1_000,
      }),
    ).toBe(1_000);
  });
});
