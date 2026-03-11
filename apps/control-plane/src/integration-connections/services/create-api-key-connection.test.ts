import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { assertApiKeyAuthSchemeSupportedOrThrow } from "./create-api-key-connection.js";
import { IntegrationConnectionsBadRequestError } from "./errors.js";

describe("assertApiKeyAuthSchemeSupportedOrThrow", () => {
  it("allows targets that include api-key auth", () => {
    expect(() =>
      assertApiKeyAuthSchemeSupportedOrThrow({
        targetKey: "github-cloud",
        supportedAuthSchemes: [
          IntegrationSupportedAuthSchemes.API_KEY,
          IntegrationSupportedAuthSchemes.OAUTH,
        ],
      }),
    ).not.toThrow();
  });

  it("throws API_KEY_NOT_SUPPORTED when target excludes api-key auth", () => {
    let thrownError: unknown = null;

    try {
      assertApiKeyAuthSchemeSupportedOrThrow({
        targetKey: "oauth-only-target",
        supportedAuthSchemes: [IntegrationSupportedAuthSchemes.OAUTH],
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
      "Integration target 'oauth-only-target' does not support API-key authentication.",
    );
  });
});
