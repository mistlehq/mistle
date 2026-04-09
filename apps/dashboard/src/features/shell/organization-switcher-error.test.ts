import { describe, expect, it } from "vitest";

import { resolveOrganizationSwitcherErrorMessage } from "./organization-switcher-error.js";

describe("resolveOrganizationSwitcherErrorMessage", () => {
  it("prefers a switch mutation error over organization list query errors", () => {
    expect(
      resolveOrganizationSwitcherErrorMessage({
        organizationOptionsError: new Error("Unable to load organizations."),
        switchOrganizationError: "Unable to switch organization.",
      }),
    ).toBe("Unable to switch organization.");
  });

  it("returns the organization list query error when switching has not failed", () => {
    expect(
      resolveOrganizationSwitcherErrorMessage({
        organizationOptionsError: new Error("Unable to load organizations."),
        switchOrganizationError: null,
      }),
    ).toBe("Unable to load organizations.");
  });

  it("returns null when there is no switcher-specific error", () => {
    expect(
      resolveOrganizationSwitcherErrorMessage({
        organizationOptionsError: null,
        switchOrganizationError: null,
      }),
    ).toBeNull();
  });
});
