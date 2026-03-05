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

  it("parses optional webhook secret", () => {
    const parsed = GitHubTargetSecretSchema.parse({
      webhook_secret: "whsec_123",
    });

    expect(parsed).toEqual({
      webhookSecret: "whsec_123",
    });
  });
});
