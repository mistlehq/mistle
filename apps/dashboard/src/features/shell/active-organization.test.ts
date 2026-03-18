import { describe, expect, it } from "vitest";

import {
  MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE,
  requireActiveOrganizationId,
  resolveActiveOrganizationIdFromSession,
} from "./active-organization.js";

describe("resolveActiveOrganizationIdFromSession", () => {
  it("returns active organization id when present", () => {
    expect(
      resolveActiveOrganizationIdFromSession({
        session: {
          activeOrganizationId: "org_123",
        },
      }),
    ).toBe("org_123");
  });

  it("returns null when active organization id is missing", () => {
    expect(resolveActiveOrganizationIdFromSession(null)).toBeNull();
    expect(resolveActiveOrganizationIdFromSession({ session: {} })).toBeNull();
    expect(
      resolveActiveOrganizationIdFromSession({
        session: {
          activeOrganizationId: "",
        },
      }),
    ).toBeNull();
  });
});

describe("requireActiveOrganizationId", () => {
  it("returns active organization id when it exists", () => {
    expect(requireActiveOrganizationId("org_123")).toBe("org_123");
  });

  it("throws when active organization id is unavailable", () => {
    expect(() => requireActiveOrganizationId(null)).toThrow(
      MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE,
    );
  });
});
