import { describe, expect, it } from "vitest";

import { unwrapOpenApiFetchResponse } from "./openapi-fetch-response.js";

describe("unwrapOpenApiFetchResponse", () => {
  it("returns response data when no api error is present", () => {
    const result = unwrapOpenApiFetchResponse({
      data: {
        total: 1,
      },
    });

    expect(result).toEqual({
      total: 1,
    });
  });

  it("rethrows non-2xx api errors instead of returning undefined data", () => {
    const apiError = {
      status: 403,
      message: "Forbidden",
      body: {
        error: {
          code: "forbidden",
          message: "Access denied",
        },
      },
    };

    expect(() =>
      unwrapOpenApiFetchResponse({
        error: apiError,
      }),
    ).toThrow(apiError);
  });
});
