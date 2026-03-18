import { describe, expect, it } from "vitest";

import { requireActiveOrganizationId, resolveActiveOrganizationId } from "./session-context.js";

describe("members api helpers", () => {
  it("resolves the active organization id from session payload", () => {
    expect(
      resolveActiveOrganizationId({
        session: {
          activeOrganizationId: "org_123",
        },
      }),
    ).toBe("org_123");
  });

  it("returns null when session payload is missing organization context", () => {
    expect(resolveActiveOrganizationId(null)).toBeNull();
    expect(
      resolveActiveOrganizationId({
        session: {
          activeOrganizationId: null,
        },
      }),
    ).toBeNull();
    expect(
      resolveActiveOrganizationId({
        session: {
          activeOrganizationId: "",
        },
      }),
    ).toBeNull();
  });

  it("throws when required organization context is unavailable", () => {
    expect(() => requireActiveOrganizationId(null)).toThrow(
      "No active organization is available in the current session.",
    );
  });
});
