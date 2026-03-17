import { describe, expect, it } from "vitest";

import { OpenAiConnectionConfigSchema, resolveOpenAiCredentialSecretType } from "./auth.js";

describe("OpenAI auth", () => {
  it("parses the api-key connection method", () => {
    expect(
      OpenAiConnectionConfigSchema.parse({
        connection_method: "api-key",
      }),
    ).toEqual({ connection_method: "api-key" });
  });

  it("resolves credential secret type for the supported connection method", () => {
    expect(resolveOpenAiCredentialSecretType({ connection_method: "api-key" })).toBe("api_key");
  });
});
