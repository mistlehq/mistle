import { BadRequestError } from "@mistle/http/errors.js";
import { describe, expect, it } from "vitest";

import {
  buildConvertedConnectionSecrets,
  parseGitHubAppManifestConversionResponse,
} from "./complete-manifest.js";

function createGitHubAppManifestConversionFixture(input?: { clientSecret?: string }) {
  return parseGitHubAppManifestConversionResponse({
    id: "123",
    slug: "mistle-github-app",
    client_id: "Iv1.manifestclientid",
    ...(input?.clientSecret === undefined ? {} : { client_secret: input.clientSecret }),
    pem: "private-key",
    webhook_secret: "webhook-secret",
  });
}

describe("parseGitHubAppManifestConversionResponse", () => {
  it("rejects conversion responses missing required credential material", () => {
    let thrownError: unknown = null;

    try {
      parseGitHubAppManifestConversionResponse({
        id: 123,
        slug: "mistle-github-app",
        client_id: "Iv1.manifestclientid",
        webhook_secret: "manifest-webhook-secret",
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected invalid conversion response to throw a bad request error.");
    }
    expect(thrownError.code).toBe("INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT");
    expect(thrownError.message).toBe("GitHub App manifest conversion response is invalid.");
  });
});

describe("buildConvertedConnectionSecrets", () => {
  it("maps required GitHub credential material into connection secrets", () => {
    const conversion = createGitHubAppManifestConversionFixture({
      clientSecret: "manifest-client-secret",
    });

    expect(
      buildConvertedConnectionSecrets({
        conversion,
        supportsClientSecret: true,
      }),
    ).toEqual({
      appPrivateKeyPem: "private-key",
      webhookSecret: "webhook-secret",
      clientSecret: "manifest-client-secret",
    });
  });

  it("omits client secret when the target method does not support it", () => {
    const conversion = createGitHubAppManifestConversionFixture();

    expect(
      buildConvertedConnectionSecrets({
        conversion,
        supportsClientSecret: false,
      }),
    ).toEqual({
      appPrivateKeyPem: "private-key",
      webhookSecret: "webhook-secret",
    });
  });

  it("fails fast when a supported client secret is missing from the conversion", () => {
    const conversion = createGitHubAppManifestConversionFixture();
    let thrownError: unknown = null;

    try {
      buildConvertedConnectionSecrets({
        conversion,
        supportsClientSecret: true,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected missing client secret to throw a bad request error.");
    }
    expect(thrownError.code).toBe("INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT");
    expect(thrownError.message).toBe(
      "GitHub App manifest conversion response is missing `client_secret`.",
    );
  });
});
