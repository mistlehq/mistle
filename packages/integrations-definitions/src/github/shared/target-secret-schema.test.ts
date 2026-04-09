import { describe, expect, it } from "vitest";

import { GitHubTargetSecretSchema } from "./target-secret-schema.js";

describe("GitHubTargetSecretSchema", () => {
  it("accepts empty secret payload", () => {
    const parsed = GitHubTargetSecretSchema.parse({});

    expect(parsed).toEqual({});
  });

  it("rejects legacy github app target secrets", () => {
    expect(() =>
      GitHubTargetSecretSchema.parse({
        webhook_secret: "whsec_123",
      }),
    ).toThrow(/Unrecognized key/u);
  });
});
