import { describe, expect, it } from "vitest";

import { deriveDashboardAuthMethods } from "./dashboard-auth-methods.js";

describe("deriveDashboardAuthMethods", () => {
  it("reports google as disabled when google auth config is absent", () => {
    expect(deriveDashboardAuthMethods({ google: undefined })).toEqual({
      google: false,
    });
  });

  it("reports google as enabled when google auth config is present", () => {
    expect(
      deriveDashboardAuthMethods({
        google: {
          clientId: "google-client-id",
          clientSecret: "google-client-secret",
        },
      }),
    ).toEqual({
      google: true,
    });
  });
});
