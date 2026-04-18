import { describe, expect, it } from "vitest";

import {
  appendIntegrationConnectionReturnParams,
  resolveIntegrationConnectionReturnPath,
} from "./integration-connection-return-path.js";

describe("resolveIntegrationConnectionReturnPath", () => {
  it("keeps safe in-app paths", () => {
    expect(
      resolveIntegrationConnectionReturnPath(
        "/settings/organization/identity-linking?tab=github#connection",
      ),
    ).toBe("/settings/organization/identity-linking?tab=github#connection");
  });

  it("rejects unsafe paths", () => {
    expect(resolveIntegrationConnectionReturnPath(null)).toBeNull();
    expect(resolveIntegrationConnectionReturnPath("https://example.com")).toBeNull();
    expect(resolveIntegrationConnectionReturnPath("//evil.example.com/path")).toBeNull();
  });

  it("appends query params while preserving the existing path shape", () => {
    expect(
      appendIntegrationConnectionReturnParams({
        returnPath: "/settings/organization/identity-linking?tab=github#connection",
        params: {
          createdConnectionId: "icn_new",
        },
      }),
    ).toBe(
      "/settings/organization/identity-linking?tab=github&createdConnectionId=icn_new#connection",
    );
  });
});
