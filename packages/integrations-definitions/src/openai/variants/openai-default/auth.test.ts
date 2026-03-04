import { describe, expect, it } from "vitest";

import { OpenAiConnectionConfigSchema, resolveOpenAiCredentialSecretType } from "./auth.js";

describe("OpenAI auth", () => {
  it("parses api-key and oauth auth schemes", () => {
    expect(
      OpenAiConnectionConfigSchema.parse({
        auth_scheme: "api-key",
      }),
    ).toEqual({ auth_scheme: "api-key" });

    expect(
      OpenAiConnectionConfigSchema.parse({
        auth_scheme: "oauth",
      }),
    ).toEqual({ auth_scheme: "oauth" });
  });

  it("resolves credential secret type for supported schemes", () => {
    expect(resolveOpenAiCredentialSecretType({ auth_scheme: "api-key" })).toBe("api_key");
    expect(resolveOpenAiCredentialSecretType({ auth_scheme: "oauth" })).toBe("api_key");
  });
});
