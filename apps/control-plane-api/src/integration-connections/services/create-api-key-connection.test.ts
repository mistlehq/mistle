import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { assertApiKeyConnectionMethodSupportedOrThrow } from "./create-api-key-connection.js";
import { IntegrationConnectionsBadRequestError } from "./errors.js";

describe("assertApiKeyConnectionMethodSupportedOrThrow", () => {
  it("allows targets that include api-key auth", () => {
    expect(() =>
      assertApiKeyConnectionMethodSupportedOrThrow({
        targetKey: "github-cloud",
        connectionMethods: [
          {
            id: IntegrationConnectionMethodIds.API_KEY,
          },
          {
            id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("throws API_KEY_NOT_SUPPORTED when target excludes api-key auth", () => {
    let thrownError: unknown = null;

    try {
      assertApiKeyConnectionMethodSupportedOrThrow({
        targetKey: "oauth2-only-target",
        connectionMethods: [
          {
            id: IntegrationConnectionMethodIds.OAUTH2,
          },
        ],
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(IntegrationConnectionsBadRequestError);
    if (!(thrownError instanceof IntegrationConnectionsBadRequestError)) {
      throw new Error("Expected API-key auth support guard to throw.");
    }
    expect(thrownError.code).toBe("API_KEY_NOT_SUPPORTED");
    expect(thrownError.message).toBe(
      "Integration target 'oauth2-only-target' does not support API-key authentication.",
    );
  });
});
