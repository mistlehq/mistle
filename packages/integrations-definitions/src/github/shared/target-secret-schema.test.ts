import { describe, expect, it } from "vitest";

import { GitHubTargetSecretSchema } from "./target-secret-schema.js";

describe("GitHubTargetSecretSchema", () => {
  it("parses optional github app private key secret", () => {
    const parsed = GitHubTargetSecretSchema.parse({
      app_private_key_pem: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });

    expect(parsed).toEqual({
      appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });
  });

  it("accepts empty secret payload", () => {
    const parsed = GitHubTargetSecretSchema.parse({});

    expect(parsed).toEqual({});
  });

  it("fails for unknown fields", () => {
    expect(() =>
      GitHubTargetSecretSchema.parse({
        webhook_secret: "secret",
      }),
    ).toThrowError();
  });
});
