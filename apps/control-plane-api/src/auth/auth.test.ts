import { describe, expect, it } from "vitest";

import { createAccountOptions } from "./auth.js";

describe("createAccountOptions", () => {
  it("trusts google for account linking when google auth is enabled", () => {
    const accountOptions = createAccountOptions({
      authGoogleClientId: "google-client-id",
      authGoogleClientSecret: "google-client-secret",
    });

    expect(accountOptions).toEqual({
      modelName: "accounts",
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    });
  });

  it("does not trust any social providers when google auth is disabled", () => {
    const accountOptions = createAccountOptions({
      authGoogleClientId: null,
      authGoogleClientSecret: null,
    });

    expect(accountOptions).toEqual({
      modelName: "accounts",
      accountLinking: {
        enabled: true,
        trustedProviders: [],
      },
    });
  });
});
