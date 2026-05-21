import { describe, expect, it } from "vitest";

import { resolveRevokingApiKeyId } from "./organization-api-keys-settings-page-state.js";

describe("resolveRevokingApiKeyId", () => {
  it("keeps revoke actions enabled after a revoke mutation has completed", () => {
    expect(
      resolveRevokingApiKeyId({
        isPending: false,
        variables: {
          apiKeyId: "apk_completed",
        },
      }),
    ).toBeNull();
  });

  it("returns the active API key id while a revoke mutation is pending", () => {
    expect(
      resolveRevokingApiKeyId({
        isPending: true,
        variables: {
          apiKeyId: "apk_pending",
        },
      }),
    ).toBe("apk_pending");
  });
});
